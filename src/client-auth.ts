// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { appIdentifier } from './apps.js'
import { APP_USER_DISPLAY_NAME_MAX, providerSlug } from './app-users.js'
import { password } from './identity.js'

/**
 * **The client auth API: the whole of what an app user's browser talks to**
 * (spec `2026-09-05-app-user-auth`, §4).
 *
 * Fleetless shows an app user **no page** (D2). The developer's own UI owns
 * every screen — login, registration, verification, invitation acceptance,
 * password reset, the provider buttons, the MCP consent — and calls these
 * routes as JSON. The hosted, app-branded login and consent pages this file
 * used to describe are deleted.
 *
 * Everything here is public: `app_identifier` travels in the body (in the
 * query for a GET), CORS is answered only for the app's `allowed_origins`, and
 * the whole family is rate-limited per app, address and IP.
 *
 * **Two kinds of caller reach the authenticated half**, and both use
 * `Authorization: Bearer`:
 *
 * - an **app user**, with the JWT access token issued here;
 * - a **server key** (`flk_…`), for server-side code, carrying full app rights.
 *
 * The cloud tells them apart by shape — a `flk_` prefix is a server key,
 * anything else is parsed as a JWT. That rule is written down once, here, so
 * the SDK and the cloud cannot drift into disagreeing about it.
 *
 * **The enumeration discipline is the design's, not a preference** (§4):
 * `register`, `resend-verification` and `password/reset` answer `202` for every
 * policy-allowed request whether or not the address exists, and `login` answers
 * the identical `invalid_credentials` for a wrong password, a `blocked` account
 * and a `pending_verification` one. Policy refusals are honest —
 * `registration_closed` and `domain_not_allowed` say what they are, because
 * neither reveals whether a *person* exists.
 */

/* ------------------------------------------------------ password login -- */

export const clientLoginRequest = z.object({
  app_identifier: appIdentifier.meta({
    description: 'The app being logged in to, as its globally unique identifier — the lowercase, underscore-separated string the developer chose when the app was created. There is no organisation context at login, so this is what decides which app the credentials are checked for.',
  }),
  email: z.email().meta({
    description: 'The app user\'s address. Addresses are unique **per app**, not across Fleetless: the same address may be an unrelated account in another app of the same organisation, so this pair is what identifies a person here.',
  }),
  password: z.string().min(1).meta({
    description: 'The app user\'s password. A wrong pair is refused without saying which half was wrong — and a `blocked` or not-yet-verified account is refused identically, so a failed login is not an account-enumeration oracle in any of its three forms.',
  }),
})
export type ClientLoginRequest = z.infer<typeof clientLoginRequest>

export const clientRefreshRequest = z.object({
  refresh_token: z.string().min(1).meta({
    description: 'The refresh token from the last login or refresh. Refresh tokens rotate on every use, so the value sent here is spent — keep the one that comes back, and presenting a spent one is treated as theft and ends the whole family.',
  }),
})
export type ClientRefreshRequest = z.infer<typeof clientRefreshRequest>

/**
 * Logging out revokes the whole token family server-side. Without this, a
 * refresh token stolen before the user pressed "log out" keeps working —
 * clearing a client-side store is a UI gesture, not a revocation.
 *
 * **The route answers `204` and has no response shape.** It used to answer a
 * `clientLogoutResponse` reporting what was left of the session at the identity
 * provider — RP-initiated logout, an `end_session_endpoint` to redirect to,
 * four ways of saying "we cannot end that session". That whole apparatus
 * belonged to the hosted login flow, where Fleetless owned the browser. It does
 * not own it any more: the developer's app does, and an app that wants to end
 * a provider session redirects there itself, knowing its own provider, which
 * Fleetless never did better than it. Listed as a breaking change rather than
 * quietly kept as a field nobody fills.
 */
export const clientLogoutRequest = z.object({
  refresh_token: z.string().min(1).meta({
    description: 'Any refresh token of the session to end. The whole token family is revoked server-side, so a token stolen before this call stops working too — clearing a client-side store is a gesture, not a revocation. The answer is `204`: a token the server does not recognise gets it too, since the end state a caller asked for is the end state they get.',
  }),
})
export type ClientLogoutRequest = z.infer<typeof clientLogoutRequest>

/* ---------------------------------------------- registration and mails -- */

/**
 * **Self-registration** (D6) — and the account it creates cannot log in yet.
 *
 * `register` writes the user as `pending_verification` and mails the app's
 * `verify_url`. Without that step the domain whitelist would prove nothing:
 * anybody could claim any address at an allowed domain and be `active`
 * immediately.
 *
 * **The answer is `202` for every policy-allowed request**, whether the address
 * was new or already known — a mail goes out only in the first case, and a
 * `register` that finds the address on an account still waiting to verify
 * replaces that account's password and mails a fresh link, so the mailbox's own
 * owner always wins over whoever typed their address first. A `202` that
 * depended on existence would be the enumeration oracle the whole family is
 * built to avoid. The refusals it *does* make are honest, because none is about
 * a person: `403 registration_closed` when the app has self-registration off,
 * `403 domain_not_allowed` when the address is outside `allowed_domains`, and
 * `404 not_found` for an app identifier no app carries.
 */
export const clientRegisterRequest = z
  .object({
    app_identifier: appIdentifier.meta({
      description: 'The app to register with. An identifier no app carries is `404 not_found` — an identifier is public, so naming it is no disclosure, and collapsing it into `registration_closed` sent a developer who mistyped their own identifier hunting a configuration bug that was not there. The **address** is never the subject of a refusal.',
    }),
    email: z.email().meta({
      description: 'The address to register. Unique per app, case-insensitively. An address this app already knows still answers `202`, without a mail — the answer may not say whether an account exists.',
    }),
    password: password.meta({
      description: 'The password for the new account. At least 12 characters; length only, because a rule a user cannot predict is a rule they work around.',
    }),
    display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'An optional human name for the account. The developer\'s own UI decides whether to ask for it.',
    }),
  })
  .strict()
export type ClientRegisterRequest = z.infer<typeof clientRegisterRequest>

/** Spending the verification token: the account becomes `active` and the answer is a session, so the person is not asked to log in immediately after proving they can read the mail. */
export const clientVerifyEmailRequest = z
  .object({
    token: z.string().min(1).meta({
      description: 'The opaque token from the verification link, valid 24 hours. Unknown, expired and already-spent all answer `410 token_spent` — telling them apart would say whether a token ever existed.',
    }),
  })
  .strict()
export type ClientVerifyEmailRequest = z.infer<typeof clientVerifyEmailRequest>

/** Asking for the verification mail again. **Always `202`**, for the reason `register` is: an answer that depended on the address existing would be the oracle by another door. */
export const clientResendVerificationRequest = z
  .object({
    app_identifier: appIdentifier.meta({ description: 'The app the address belongs to.' }),
    email: z.email().meta({
      description: 'The address to re-send to. The answer is `202` whether or not it names an account, and whether or not that account is already verified.',
    }),
  })
  .strict()
export type ClientResendVerificationRequest = z.infer<typeof clientResendVerificationRequest>

/**
 * Asking for a reset link **as an app user**.
 *
 * Same act as `passwordResetRequest`, different shape, because the two surfaces
 * identify a person differently. A Fleetless user's address is globally unique
 * and resolves alone; an app user's is unique only within their app, so the
 * pair is what names them.
 *
 * The response is identical for a known and an unknown pair — otherwise this
 * becomes the enumeration oracle the rest of the family is carefully built not
 * to be. An **app identifier** no app carries is the one refusal, `404
 * not_found`, because an identifier is public and an address is not.
 *
 * Moved here from `identity.ts`, where it sat because the client surface had no
 * file of its own for it. It is an app-user shape and belongs with them.
 */
export const clientPasswordResetRequest = z
  .object({
    app_identifier: appIdentifier.meta({ description: 'The app the address belongs to.' }),
    email: z.email().meta({
      description: 'The address to mail a reset link to. The answer is `202` for a known address and an unknown one alike, in status, body and timing. An app identifier no app carries is `404 not_found`; the address is never the subject of a refusal.',
    }),
  })
  .strict()
export type ClientPasswordResetRequest = z.infer<typeof clientPasswordResetRequest>

/** Spending the reset token. **Every refresh family of that user is revoked**, because a forgotten password is one of the two states where somebody else may be holding a session. */
export const clientPasswordResetConfirmRequest = z
  .object({
    token: z.string().min(1).meta({
      description: 'The opaque token from the reset link, valid one hour. Single-use; unknown, expired and spent all answer `410 token_spent`.',
    }),
    new_password: password.meta({
      description: 'The replacement password. Accepting it revokes every refresh family the account holds — the answer carries a fresh pair, so the person is signed in on the device that completed the reset and nowhere else.',
    }),
  })
  .strict()
export type ClientPasswordResetConfirmRequest = z.infer<typeof clientPasswordResetConfirmRequest>

/**
 * Accepting an app invitation. Creates the account, or activates one that was
 * invited before it existed, with the role the invitation fixed at creation.
 *
 * An invitation **always bypasses the domain whitelist**: a developer inviting
 * somebody by hand has already made the decision the whitelist automates.
 */
export const clientAcceptInvitationRequest = z
  .object({
    token: z.string().min(1).meta({
      description: 'The opaque token from the invitation link, valid seven days. Unknown, expired, revoked and already-accepted all answer `410 token_spent`.',
    }),
    password: password.meta({ description: 'The password the new account will use.' }),
    display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'An optional name, overriding whatever the invitation pre-filled.',
    }),
  })
  .strict()
export type ClientAcceptInvitationRequest = z.infer<typeof clientAcceptInvitationRequest>

/* ------------------------------------------------------ OIDC, per app -- */

/**
 * **The one OIDC callback path, for every app and every provider**, declared
 * once so the cloud, the console and the documentation cannot spell it
 * differently.
 *
 * `appAuthConfig.oidc_callback_url` is this path appended to the cloud's own
 * `PUBLIC_API_BASE_URL`, and that URL is what a developer registers at their
 * identity provider. So the string is not an implementation detail of one
 * route: it is copied out of the console into somebody else's IdP
 * configuration, where a later rename would break every sign-in with no error
 * anybody here can see.
 *
 * **This is the path, not the URL.** The cloud mints the URL from its
 * canonical public base — the same rule `MCP_ENDPOINT_PATH` states — and a
 * friendly alias in front of the API is not a substitute, because the
 * redirect target must match the one string registered at the provider
 * exactly.
 *
 * `OAUTH_PATHS` is the precedent, and the warning: nine paths declared once so
 * two repositories could not disagree, one of which then named a route the
 * cloud had deleted. What keeps this one honest is `routes.ts` — the manifest
 * carries the same path, the cloud's `route-manifest.test.ts` asserts set
 * equality with it, and the test beside this file asserts the two spellings
 * are the one string rather than two that currently agree.
 */
export const CLIENT_OIDC_CALLBACK_PATH = '/api/client/oidc/callback' as const

/** The query of `GET /api/client/providers` — which app's sign-in buttons to draw. */
export const clientProviderListQuery = z
  .object({
    app_identifier: appIdentifier.meta({ description: 'The app whose enabled providers to list.' }),
  })
  .meta({ description: 'The one parameter of the public provider listing.' })
export type ClientProviderListQuery = z.infer<typeof clientProviderListQuery>

/**
 * What the developer's login page needs to draw its provider buttons, and
 * **nothing more**. This route is public and unauthenticated: the issuer, the
 * client id, the scopes and the linking policy are all management-side facts
 * that would tell a stranger how the app's federation is configured.
 *
 * Only **enabled** providers appear. A disabled one is not a button that
 * refuses; it is a button that is not there.
 */
export const clientProviderListResponse = z.object({
  providers: z
    .array(
      z.object({
        slug: providerSlug.meta({ description: 'The handle to put in the start URL: `GET /api/client/oidc/<slug>/start`.' }),
        name: z.string().meta({ description: 'What to write on the button, as the developer configured it.' }),
      }),
    )
    .meta({
      description: 'The app\'s **enabled** providers, slug and display name only. An app with none answers an empty array, which is the state of an app that offers password login alone.',
    }),
})
export type ClientProviderListResponse = z.infer<typeof clientProviderListResponse>

/**
 * The query of `GET /api/client/oidc/:slug/start`.
 *
 * **The app runs its own PKCE** here, against Fleetless — a second, independent
 * exchange from the one Fleetless runs against the identity provider. So the
 * one-time code the callback hands back is bound to a verifier only the app's
 * page holds, and a code intercepted in the redirect is worth nothing on its
 * own.
 *
 * `redirect_uri` is validated against the app's `allowed_origins` **before
 * anything else**, and a failure there never redirects: until the target is
 * known-good, sending a browser to it is the attack.
 */
export const clientOidcStartQuery = z.object({
  app_identifier: appIdentifier.meta({ description: 'The app being signed in to.' }),
  redirect_uri: z.url().max(2000).meta({
    description: 'Where to send the browser when the flow finishes, with `code` and `state` or with `error` and `state`. **Its origin must be one of the app\'s `allowed_origins`**; a failure here is refused flat, with no redirect, because until the target is confirmed there is nowhere trusted to bounce a browser to.',
  }),
  state: z.string().min(8).max(512).meta({
    description: 'Returned unchanged on the callback, and on the error redirect too, so the app can bind either answer to the request it started. At least eight characters: this is what ties the callback to the browser that began the flow, and a guessable value defends nothing.',
  }),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).meta({
    description: 'The app\'s own PKCE challenge (RFC 7636, S256 base64url). The verifier is presented at `oidc/exchange`, so the one-time code is worth nothing to whoever intercepts the redirect. `plain` is not accepted: a challenge equal to its verifier defends against nothing.',
  }),
})
export type ClientOidcStartQuery = z.infer<typeof clientOidcStartQuery>

/**
 * **The query of `GET /api/client/oidc/callback` — the identity provider's
 * wire, not Fleetless's.**
 *
 * Every field but `state` is optional and **the object is not `.strict()`**,
 * which is the whole point of writing it down. A conforming provider sends
 * `code` and `state` on success and `error` (with an optional
 * `error_description`) on refusal, and many send more besides — `iss` per RFC
 * 9207, `session_state`, a vendor field. A strict schema over somebody else's
 * specification refuses conforming callers, which is the mistake
 * `POST /mcp/oauth/register` documents having avoided by not parsing its body
 * at all. Declaring the shape loosely says what arrives without promising it is
 * the only thing that will.
 *
 * `state` is the one required field because it is the one Fleetless minted: it
 * resolves the `oidc_interactions` row that holds the app's `redirect_uri`,
 * and without it there is nowhere to send any answer, success or failure. That
 * is the single case where the cloud renders a page of its own (D2).
 *
 * It exists as a schema rather than as four parameters read by hand because
 * the manifest forbids the second: a documented route whose prose names a
 * `?parameter=` must declare what it reads, and every phrase that used to
 * excuse one was removed by writing the schema rather than by rewording.
 */
export const clientOidcCallbackQuery = z.object({
  state: z.string().min(1).meta({
    description: 'The opaque state Fleetless sent to the provider, which resolves the pending interaction — and with it the app\'s `redirect_uri`. Not the app\'s own `state` from `start`: that one is stored on the interaction and put back on the redirect to the app. A callback whose state resolves to nothing has no confirmed target to answer, and is the one case Fleetless renders a page for.',
  }),
  code: z.string().min(1).optional().meta({
    description: 'The provider\'s authorization code, present when the sign-in succeeded. Exchanged server-side by the cloud, so it never reaches the app — the app gets its own one-time code, bound to the PKCE challenge it sent at `start`.',
  }),
  error: z.string().min(1).optional().meta({
    description: 'The provider\'s own refusal, present instead of `code` when the person declined or the provider would not issue one. It is carried back to the app as a `clientOidcErrorCode`, not passed through: the provider\'s vocabulary is its own, and an app branching on it would be branching on a string nobody here controls.',
  }),
  error_description: z.string().optional().meta({
    description: 'The provider\'s human-readable note about `error`, when it sends one. Logged, never rendered to an app user and never put on the redirect — it is text from a system Fleetless does not run.',
  }),
})
export type ClientOidcCallbackQuery = z.infer<typeof clientOidcCallbackQuery>

/** Trading the one-time code for a session. The code lives 60 seconds and is bound to the challenge from `start`. */
export const clientOidcExchangeRequest = z
  .object({
    code: z.string().min(1).meta({
      description: 'The one-time code from the callback redirect. Valid 60 seconds, single-use, and bound to the PKCE challenge the start step carried.',
    }),
    code_verifier: z.string().regex(/^[A-Za-z0-9_.~-]{43,128}$/).meta({
      description: 'The verifier for the challenge sent at `start`. RFC 7636 §4.1\'s alphabet and length.',
    }),
  })
  .strict()
export type ClientOidcExchangeRequest = z.infer<typeof clientOidcExchangeRequest>

/**
 * **Why a federated sign-in ended without a session, in a code the app can
 * branch on** — carried back to the app's own `redirect_uri` as `error`, not
 * rendered by Fleetless (D2). The only Fleetless-rendered page in this flow is
 * the one for a state that can no longer be resolved to a redirect URI, because
 * then there is nowhere to send the answer.
 *
 * The five rows of D4's table are the first five values plus `no_access`:
 *
 * - `no_access` — the identity is unknown and nothing admits it, or the account
 *   it names is not `active`. **One code for both**, because to the person the
 *   remedy is the same — ask somebody to let you in — and a code that split an
 *   outcome nobody acts on differently would tell a stranger which half applied.
 * - `email_taken` — the address already belongs to another app user, and the
 *   provider is not permitted to link (`link_verified_emails`, or the provider
 *   did not assert `email_verified`). Deliberately not `no_access`: the remedy
 *   is different — *sign in the way you signed up*.
 * - `email_unverified` — the provider asserted an address without
 *   `email_verified`. **An unverified address never produces or links an
 *   account**, whatever the rest of the policy says.
 * - `domain_not_allowed`, `registration_closed` — the self-registration policy
 *   refused. Honest, because neither is about whether a person exists.
 * - `idp_unavailable`, `exchange_failed`, `claims_incomplete`,
 *   `provider_misconfigured`, `provider_disabled` — the provider's or the
 *   developer's to fix, and the app can say so.
 * - `invalid_request` — the start parameters did not hold up.
 * - `quota_exceeded` — the org has as many app users as its `max_end_users`
 *   quota allows, so no account can be created for this identity. Named rather
 *   than folded into `no_access`, for `domain_not_allowed`'s reason: it is not
 *   about the person, the app can say what happened, and the remedy belongs to
 *   the developer rather than to whoever is trying to sign in. It is raised
 *   **only where an account would be created** — an identity that already has
 *   one signs in at the quota exactly as it does under it, because refusing a
 *   sign-in would turn a protection limit into an outage.
 */
export const clientOidcErrorCode = z.enum([
  'no_access',
  'email_taken',
  'email_unverified',
  'domain_not_allowed',
  'registration_closed',
  'idp_unavailable',
  'exchange_failed',
  'claims_incomplete',
  'provider_misconfigured',
  'provider_disabled',
  'invalid_request',
  'quota_exceeded',
])
export type ClientOidcErrorCode = z.infer<typeof clientOidcErrorCode>

/* ------------------------------------------------ MCP, delegated login -- */

/**
 * **A pending MCP authorization, as the app's own consent screen reads it**
 * (D7). Fleetless renders no page here either: `authorize` redirects to the
 * app's `mcp_login_url` with an interaction id, the app authenticates the user
 * with its normal UI, shows this, and approves or denies through the API.
 *
 * `client_name_verified` is `z.literal(false)`, and that is the whole point of
 * the field. The name comes from an **unauthenticated** dynamic registration —
 * the client typed it about itself, nobody checked it — so a consent screen
 * that rendered it as though it were an identity would be teaching people to
 * trust a string an attacker chooses. A literal rather than a boolean because
 * there is no verified case to distinguish: an app that reads this field at all
 * has to handle the untrusted one, and a `true` branch would be dead code
 * pretending to be a safeguard.
 */
export const clientMcpInteraction = z.object({
  id: z.string().meta({ description: 'The interaction, as it arrived in the app\'s `mcp_login_url`. Not a credential: it names a pending request the server already holds, and approving it needs the app user\'s own access token.' }),
  app_id: z.uuid().meta({ description: 'The app this authorization is for. The approving token\'s `app_id` must match it — an interaction of one app cannot be approved with a session from another.' }),
  client_name: z.string().nullable().meta({ description: 'What the MCP client calls itself, or `null` if it named nothing. **Unverified** — see `client_name_verified`.' }),
  client_name_verified: z.literal(false).meta({
    description: 'Always `false`. The client registered itself without authentication and chose this name about itself, so it must be rendered as a claim and never as an identity. There is no verified case, which is why this is a literal and not a boolean: a `true` branch would be dead code that looked like a safeguard.',
  }),
  scopes: z.array(z.string()).meta({ description: 'The scopes the client asked for, to show the person before they approve.' }),
  already_granted: z.boolean().meta({ description: 'Whether this user has already approved this client. It is a record of what they answered last time, and **this route makes no second use of it**: an app that skips its own consent screen when this is `true` is the only thing deciding that, and approve succeeds identically for a user who holds no grant at all. The standing grant is read elsewhere, on every request to the app\'s MCP endpoint. Withdrawing it is `DELETE /api/client/mcp/grants/:clientId` for the person themselves and `DELETE /api/apps/:id/users/:userId/mcp-grants/:clientId` for the developer. A withdrawal makes this `false` again at the next authorization **and stops the client at its very next MCP call**, unexpired access token and all — up to fifteen minutes of it — because the endpoint keys that check on the `client_id` the token carries.' }),
  expires_at: z.iso.datetime().meta({ description: 'When the interaction stops being approvable. Ten minutes from the authorize step; afterwards both approve and deny answer `interaction_expired`.' }),
})
export type ClientMcpInteraction = z.infer<typeof clientMcpInteraction>

/**
 * What approve and deny both answer: **where to send the browser**. A denial
 * carries a redirect too, with `error=access_denied` on it — a client that is
 * refused must learn so from its own callback rather than from a page nobody
 * sent it.
 */
export const clientMcpInteractionDecisionResponse = z.object({
  redirect_to: z.url().meta({
    description: 'Send the browser here. It is the MCP client\'s own callback, carrying either the authorization code or `error=access_denied` — a denial redirects as well, so the client learns the outcome from the place it is waiting.',
  }),
})
export type ClientMcpInteractionDecisionResponse = z.infer<typeof clientMcpInteractionDecisionResponse>

/**
 * **One standing MCP consent, as both withdrawal doors list it.**
 *
 * A grant is what lets a later authorization skip the app's consent screen:
 * `clientMcpInteraction.already_granted` is a read of exactly this row. It is
 * written when a person approves and it is removed by neither the client's
 * registration lapsing nor its access token expiring — so without a door it
 * was a decision a person could make once and never unmake.
 *
 * **Standing only.** A withdrawn grant is stamped rather than deleted, so the
 * store still holds it; neither listing returns one. The question both doors
 * ask is *what is connected right now*, and a row that answered "connected,
 * but no" would be a state every caller has to filter for itself.
 *
 * `client_name_verified` is `z.literal(false)` for the reason
 * `clientMcpInteraction` gives at length: the name comes from an
 * unauthenticated dynamic registration, the client chose it about itself, and
 * a list that rendered it as an identity would be teaching people to trust a
 * string an attacker picked. Here it matters more than on the consent screen,
 * not less — a "connected apps" list is read long after the moment of
 * approval, when nobody remembers what they clicked.
 */
export const mcpConsentGrant = z.object({
  client_id: z.string().meta({
    description: 'The MCP client this consent is for, as its dynamic registration was issued. It is the value the withdrawal routes take in their path, and it is the only stable handle on a client — the name beside it is not one.',
  }),
  client_name: z.string().nullable().meta({
    description: 'What the client calls itself, or `null` when its registration is gone and there is no longer anything to have named. **Unverified** — see `client_name_verified`.',
  }),
  client_name_verified: z.literal(false).meta({
    description: 'Always `false`. The client registered itself without authentication and chose this name about itself, so it must be rendered as a claim and never as an identity. There is no verified case, which is why this is a literal and not a boolean: a `true` branch would be dead code that looked like a safeguard.',
  }),
  granted_at: z.iso.datetime().meta({
    description: 'When the consent was last given. A withdrawal followed by a fresh approval moves it, because the second approval is the agreement that stands — it is not a record of the first time anybody ever said yes.',
  }),
})
export type McpConsentGrant = z.infer<typeof mcpConsentGrant>

/** What both grant listings answer. Never null: a person who has connected nothing gets an empty array, and an absent key would make "nothing" and "not answered" the same reading. */
export const mcpConsentGrantListResponse = z.object({
  grants: z.array(mcpConsentGrant).meta({
    description: 'Every standing consent this app user holds, newest first. Withdrawn ones are absent rather than listed as withdrawn; an app user who has connected no MCP client answers an empty array.',
  }),
})
export type McpConsentGrantListResponse = z.infer<typeof mcpConsentGrantListResponse>

/* -------------------------------------------------------- who am I -- */

/**
 * Who the caller turned out to be. Returned by the "who am I" endpoint and by
 * the realtime `auth_ok` frame, so a client can render a session without
 * decoding a token itself — decoding a JWT in the client is how apps end up
 * trusting claims nobody verified.
 *
 * **Three kinds of caller reach the client API.** Besides app users and server
 * keys, a **developer** does: the console's playground runs over the real
 * client API and appears in the audit as the developer, and the console's own
 * live views subscribe on `/realtime` as one. A developer is **org-scoped, not
 * app-scoped** — they own the configuration of every robot in their org — so
 * `app_id` and `role_id` are null for them, and roles do not filter what they
 * see. `kind` states this explicitly rather than leaving it to be inferred from
 * which id happens to be set.
 *
 * **`end_user_id` became `app_user_id`, and that is a rename with a meaning.**
 * The old subject was a member of the org's one pool, reachable through an
 * assignment; the new one is a row that belongs to exactly one app. Renaming
 * rather than keeping the key is deliberate: a consumer reading `.end_user_id`
 * would have typechecked and meant something subtly different, which is the
 * quietest way for a cut like this to go wrong.
 *
 * **`act` is gone.** It named the org admin behind an impersonation (the RFC
 * 8693 pattern). Impersonation is deleted with no successor (D1), so a field
 * that could still arrive would describe a delegation nothing can mint — and a
 * client rendering "you are acting as …" from it would be showing a state the
 * platform cannot enter.
 */
export const clientIdentity = z.object({
  kind: z.enum(['developer', 'app_user', 'server_key']).meta({
    description: 'Which of the three kinds of caller this is: a `developer` working through the console, an `app_user` holding a token from a client login, or a `server_key` used by server-side code. Stated outright rather than left to be inferred from which id happens to be set.',
  }),
  developer_id: z.uuid().nullable().meta({
    description: 'The Fleetless user behind this session, or `null` when `kind` is not `developer`.',
  }),
  app_user_id: z.uuid().nullable().meta({
    description: 'The app user behind this session, or `null` when `kind` is not `app_user`. An app user belongs to exactly one app and is unrelated to any Fleetless user with the same address.',
  }),
  server_key_id: z.uuid().nullable().meta({
    description: 'The server key this session was authenticated with, or `null` when `kind` is not `server_key`.',
  }),
  app_id: z.uuid().nullable().meta({
    description: 'The app this session belongs to, and `null` for a developer — a developer is organisation-scoped and owns the configuration of every robot in the organisation rather than reaching one through an app.',
  }),
  role_id: z.uuid().nullable().meta({
    description: 'The role that decides what this caller may reach, and `null` for a developer. Roles are the only visibility filter: what a role does not grant does not exist for that user.',
  }),
  email: z.email().nullable().meta({
    description: 'The address of the Fleetless user or app user behind this session, and `null` for a server key, which is not a person.',
  }),
})
export type ClientIdentity = z.infer<typeof clientIdentity>
