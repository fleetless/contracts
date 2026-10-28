// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { authMeResponse } from './identity.js'

/**
 * **Support sessions: an operator temporarily holding a console session for
 * one org, under that org's own audit trail.**
 *
 * The operator app mints a one-time grant for an org (its own command surface,
 * outside this package) and sends the browser to the console, whose server
 * redeems it through
 * `POST /console/support/token`, which exchanges it for an ordinary-looking
 * developer session scoped to that org. From the console's own point of view
 * it is just a session: the same `GET /api/auth/me` it always calls, extended
 * with a `support` block so the console can show who is driving and let the
 * person end the session themselves.
 *
 * This whole surface is **internal and additive** — `audience: 'internal'` on
 * both routes, nothing here replaces or narrows the public developer
 * reference. Every shape in this file is read by the console and the cloud;
 * none of it is published documentation for an outside integrator, which is
 * also why `authMeResponse` itself is left untouched and `authMeSupportResponse`
 * exists beside it instead.
 */

/**
 * What a support session tells the console about itself: who is holding it,
 * in which mode, and until when. Carried inside `supportTokenResponse` at the
 * start of the session and inside `authMeSupportResponse` on every later call,
 * because the session row — mode, expiry, whether it has since ended — is
 * re-read from storage each time rather than trusted from the token's claims.
 */
export const supportSessionInfo = z
  .object({
    session_id: z.uuid().meta({
      description: 'The support session this token or response describes. Stable for the life of the session.',
    }),
    mode: z.enum(['read', 'edit']).meta({
      description: "The session's current mode. Every support session starts `read`; an operator-admin switches one session into `edit`, never the other way, and the switch is a one-way door for the life of the session.",
    }),
    operator_name: z.string().min(1).max(200).meta({
      description: 'The name of the operator-admin holding this session, for the console banner the operator-admin sees. Only the operator-admin\'s own console receives it; the customer\'s audit names every edit as Fleetless-Support, never this name.',
    }),
    expires_at: z.iso.datetime().meta({
      description: 'When the session stops being usable regardless of activity, as an ISO 8601 timestamp. A support session has a hard ceiling; nothing extends it past this instant.',
    }),
  })
  .strict()
export type SupportSessionInfo = z.infer<typeof supportSessionInfo>

/**
 * `POST /console/support/token`'s request: a one-time grant, proven with the
 * PKCE verifier bound to it when it was minted.
 *
 * **Server to server only** — the console's own server calls this, never a
 * browser — and the grant is single-use: a second presentation of the same
 * grant, a grant that has expired, or a verifier that does not match is every
 * one of them `invalid_grant`, the same RFC 6749 §5.2 dialect
 * `POST /console/oauth/token` already answers in.
 */
export const supportTokenRequest = z
  .object({
    grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/).meta({
      description: 'The one-time grant minted when the support session was started: 32 random bytes, base64url, no padding. Consumed atomically by this exchange — presenting it again answers the same refusal a forged one would.',
    }),
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).meta({
      description: 'The PKCE verifier whose `S256` hash was sent as the grant\'s challenge when the session was started. Between 43 and 128 unreserved characters, RFC 7636 §4.1\'s charset — the same shape `oauthCodeTokenRequest.code_verifier` checks, compared rather than parsed.',
    }),
  })
  .strict()
export type SupportTokenRequest = z.infer<typeof supportTokenRequest>

/**
 * `POST /console/support/token`'s response: a bearer token scoped to the org
 * the grant was minted for, **and no refresh token**.
 *
 * A support session is bounded (sixty minutes, no extension) by design, so
 * there is nothing for a refresh to buy back — a refresh token here would be
 * a second way to outlive the ceiling `supportSessionInfo.expires_at` already
 * states. When the access token expires the session is over; starting
 * another one is a new grant, a new exchange, and a new audit trail.
 */
export const supportTokenResponse = z
  .object({
    access_token: z.string().min(1).meta({
      description: 'The token to send as `Authorization: Bearer <token>`. Short-lived: read `expires_in`, never assume a lifetime.',
    }),
    token_type: z.literal('Bearer').meta({
      description: '`Bearer`, the same spelling every other session token on this wire uses.',
    }),
    expires_in: z.number().int().min(1).max(3600).meta({
      description: 'How long the access token stays valid, in seconds from now — at most 3600 (sixty minutes), the hard ceiling of any support session. Not a timestamp, and not milliseconds.',
    }),
    org_id: z.uuid().meta({
      description: 'The organisation this session was scoped to when the grant was minted.',
    }),
    support: supportSessionInfo.meta({
      description: 'The session as it stands at the moment of exchange: freshly started, in `read` mode.',
    }),
  })
  .strict()
export type SupportTokenResponse = z.infer<typeof supportTokenResponse>

/**
 * What `GET /api/auth/me` answers **to a support token** — `authMeResponse`
 * with one more, optional field. The public route entry keeps `authMeResponse`
 * itself, so this block stays out of the public reference and the ordinary
 * developer session answer is unchanged; the console validates the actual
 * response it receives against this shape instead, and reads `support` to
 * decide whether to render the "someone is holding this session" banner at
 * all.
 *
 * `support` is **absent, not null**, for an ordinary developer session: the
 * field means "this is a support session" by its own presence, and an
 * ordinary session has never had anything to put there.
 */
export const authMeSupportResponse = authMeResponse.extend({ support: supportSessionInfo.optional() })
export type AuthMeSupportResponse = z.infer<typeof authMeSupportResponse>
