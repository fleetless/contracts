import { z } from 'zod'
import { appIdentifier } from './apps.js'

/**
 * What a client app sends to become someone (spec §3.4, §11.1).
 *
 * Two kinds of caller reach the client API, and both use the `Authorization:
 * Bearer` header:
 *
 * - an **end user**, with the JWT access token issued here;
 * - a **server key** (`flk_…`), for server-side code, carrying full app
 *   rights.
 *
 * The cloud tells them apart by shape — a `flk_` prefix is a server key,
 * anything else is parsed as a JWT. That rule is written down once, here, so
 * the SDK and the cloud cannot drift into disagreeing about it.
 *
 * The credentials path is the whole of W3. The OIDC redirect flow of §3.4
 * arrives in W7 with the hosted login page, and ends in exactly these same
 * tokens.
 */

export const clientLoginRequest = z.object({
  app_identifier: appIdentifier,
  email: z.email(),
  password: z.string().min(1),
})
export type ClientLoginRequest = z.infer<typeof clientLoginRequest>

export const clientRefreshRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientRefreshRequest = z.infer<typeof clientRefreshRequest>

/**
 * Logging out revokes the whole token family server-side. Without this, a
 * refresh token stolen before the user pressed "log out" keeps working —
 * clearing a client-side store is a UI gesture, not a revocation.
 */
export const clientLogoutRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientLogoutRequest = z.infer<typeof clientLogoutRequest>

/**
 * **What logout can and cannot end, said in three separable facts (W9c,
 * DEF-098).**
 *
 * Until now this route answered `204`: the Fleetless session was over and the
 * response had nothing to say about the *other* session. For a federated user
 * that is the larger half — they clicked "log out", the IdP's cookie survived,
 * and the next login goes straight through without a password. The register
 * row calls that an expectation gap, and it is: the word on the button is
 * "log out", not "log out of this app".
 *
 * **The Fleetless session is ended before this is computed, unconditionally.**
 * Nothing below can fail in a way that leaves the caller logged in here — a
 * logout that depends on reaching a third party is not a logout.
 *
 * Three outcomes, and they are deliberately not collapsed into a nullable
 * URL. *No IdP was involved* and *an IdP was involved and publishes no
 * `end_session_endpoint`* are different things: the first needs no action and
 * the second means a session survives that this platform cannot end. A caller
 * that renders them identically is choosing to; a contract that cannot tell
 * them apart makes the choice for everyone.
 */
export const clientLogoutResponse = z.object({
  idp_logout: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('redirect'),
      /** Send the browser here. Built from the IdP's own `end_session_endpoint`. */
      url: z.url().max(2000),
    }),
    /** This session did not come from an IdP — there is nothing else to end. */
    z.object({ status: z.literal('not_federated') }),
    /**
     * It did, and the IdP's discovery document names no `end_session_endpoint`
     * (RP-initiated logout is optional in OIDC). **The IdP session survives and
     * this platform cannot end it** — say so rather than implying success.
     */
    z.object({ status: z.literal('unsupported_by_idp') }),
    /**
     * **Federated, the IdP *can* end the session, and we cannot ask it to
     * (W9c, Nimbus-W9c's proposal).**
     *
     * `id_token_hint` is missing: the stored value could not be decrypted, or
     * the session predates the fix that started keeping one. Deliberately not
     * folded into `unsupported_by_idp` — there the cause is **the IdP's**, here
     * it is **ours**, and an operator reading a rise in these needs to know
     * which of the two they are looking at.
     *
     * **No `url` field, and that is the whole point.** Sending somebody to a
     * bare `end_session_endpoint` produces a page that *asks* rather than one
     * that ends — measured against real Keycloak, which renders *"Do you want
     * to log out?"* and leaves the session alive. An outcome that promises
     * something it does not deliver is worse than one that admits it.
     *
     * **The two causes are one status on purpose.** A caller can do nothing
     * differently between "decryption failed" and "this session is older than
     * the fix" — both mean *the IdP session survives and you cannot end it
     * from here*. The distinction matters to whoever runs this platform, and
     * it belongs in the server's log, not on the wire: splitting a wire enum
     * to carry a fact no consumer can act on is how a contract grows keys
     * nobody reads.
     */
    z.object({ status: z.literal('hint_unavailable') }),
  ]),
})
export type ClientLogoutResponse = z.infer<typeof clientLogoutResponse>

/**
 * Who the caller turned out to be. Returned by the "who am I" endpoint and by
 * the realtime `auth_ok` frame, so a client can render a session without
 * decoding a token itself — decoding a JWT in the client is how apps end up
 * trusting claims nobody verified.
 *
 * **Three kinds of caller reach the client API, not two.** Besides end users
 * and server keys, a **developer** does: spec §15.2 says the console's
 * playground runs over the real client API and appears in the audit as the
 * developer, and the console's own live views (robot list badges, the Live
 * tab) subscribe on `/realtime` as one. A developer is **org-scoped, not
 * app-scoped** — they own the configuration of every robot in their org — so
 * `app_id` and `role_id` are null for them, and roles do not filter what they
 * see. `kind` states this explicitly rather than leaving it to be inferred
 * from which id happens to be set.
 */
export const clientIdentity = z.object({
  kind: z.enum(['developer', 'end_user', 'server_key']),
  developer_id: z.uuid().nullable(),
  end_user_id: z.uuid().nullable(),
  server_key_id: z.uuid().nullable(),
  app_id: z.uuid().nullable(),
  role_id: z.uuid().nullable(),
  email: z.email().nullable(),
})
export type ClientIdentity = z.infer<typeof clientIdentity>
