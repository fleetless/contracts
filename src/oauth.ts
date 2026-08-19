import { z } from 'zod'

/**
 * The hosted authorization server (spec §3.4, §17).
 *
 * Fleetless is **both sides of an OAuth exchange and they must not be
 * confused**. Toward an app's end users it is the *authorization server*: it
 * serves the login page, mints the code, exchanges it for the same Fleetless
 * token `/api/client/login` already returns. Toward a developer's own IdP it
 * is a *relying party*: it federates out and maps the claims back. §3.4's
 * whole promise is that both paths converge — *"Beide Wege enden im selben
 * Fleetless-Token"* — so nothing here introduces a second token shape.
 *
 * **§17 is the reason this exists now rather than later.** An MCP app's login
 * is not its own: *"der Endnutzer trägt nur die URL ein; das KI-Tool
 * durchläuft den Standard-Flow über die Fleetless-Login-Seite (inkl.
 * IdP-Föderation, §3.4)"*. W7b therefore builds W7c's front door, and the one
 * thing it must get right in advance is the **client model** — see
 * `oauthClientRegistration`.
 */

/**
 * **This file speaks two error dialects on purpose, and unifying them would
 * break conformance.**
 *
 * The OAuth endpoints (`/oauth/authorize`, `/oauth/token`, registration)
 * answer in RFC 6749 §5.2's shape — a flat `error` string from a fixed set,
 * with an optional `error_description`. That is what an RFC-compliant client
 * parses, and `mcp-inspector` is such a client. A Fleetless `apiError` there
 * would be well-formed JSON that no standard client can read.
 *
 * The *management* endpoints beside them — configuring an IdP, editing
 * branding, listing clients — are ordinary console API and use `apiError` with
 * `ERROR_CODES` like everything else.
 *
 * So: **two shapes, split by audience, not by accident.** Written down here
 * because the natural instinct on finding two error formats in one server is
 * to unify them, and doing so silently removes the reason the standard one is
 * there.
 *
 * **The split is by audience and the path prefix will mislead you.**
 * `/oauth/consent` sits under `/oauth/` and is nevertheless an `apiError`
 * endpoint: it is not in RFC 6749's or RFC 7591's endpoint set, and its only
 * caller is our own login page. Whoever later sorts these by prefix will move
 * it, and be wrong. Ask who parses the response, not where it lives.
 */
export const oauthErrorCode = z.enum([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  /** RFC 8707: the `resource` named is not one this server issues tokens for. */
  'invalid_target',
])
export type OauthErrorCode = z.infer<typeof oauthErrorCode>

export const oauthError = z.object({
  error: oauthErrorCode,
  error_description: z.string().min(1).max(500).optional(),
  /** Echoed back per RFC 6749 §4.1.2.1 so a client can match the response. */
  state: z.string().min(1).max(500).optional(),
  /**
   * **A Fleetless reason carried inside a standard envelope, and it exists
   * because the alternative lost a distinction.**
   *
   * Two policy refusals at `/oauth/register` — the app has not opted in, and
   * the app's client ceiling is full — both map to RFC 6749's `access_denied`,
   * which is the honest standard code for either. Answering with only that
   * makes the two indistinguishable to the caller, and *a field that cannot
   * express a distinction produces a workaround somewhere else*. Answering in
   * `apiError` instead would keep the distinction and hand an RFC-compliant
   * client a body it cannot parse — which is the conformance this wave exists
   * to provide.
   *
   * So both: `error` is what a standard client reads, `fleetless_code` is what
   * our own tooling switches on. RFC 6749 §5.2 permits additional members, and
   * a client that ignores this one still behaves correctly.
   */
  fleetless_code: z.string().min(1).max(60).optional(),
})
export type OauthError = z.infer<typeof oauthError>

/**
 * **The distinction this wave exists to be able to express.**
 *
 * A `developer` client is registered by the developer who owns the app: the
 * redirect URIs are known before anyone logs in, and the developer has vetted
 * the software.
 *
 * A `dynamic` client registers *itself* (RFC 7591) because the end user only
 * ever enters a URL into an AI tool (§17). **Nobody vetted it**, its redirect
 * URIs arrive from the client itself, and the tools it will call move a
 * physical robot.
 *
 * The two differ in what may be trusted, not merely in how they were created,
 * and every consumer has to be able to ask which it is holding. W7a's most
 * expensive lesson was a field that could not express a distinction —
 * `failed` was a flat `string[]` carrying three different facts, and the cost
 * surfaced as a workaround in a different repo, where reconciliation could not
 * tell *no longer referenced* from *referenced and not delivered*. **A field
 * that cannot express a distinction produces a workaround somewhere else, and
 * the workaround is where you find out.** So the discriminator is here from
 * the first commit rather than inferred later from the presence of a
 * `client_secret` or from a nullable timestamp.
 */
export const oauthClientRegistration = z.enum(['developer', 'dynamic'])
export type OauthClientRegistration = z.infer<typeof oauthClientRegistration>

/**
 * A redirect URI, and the rule is stricter than "a URL".
 *
 * **The defence for this was already written down in this codebase, twice.**
 * `config.ts` validates a V4L2 device path from the wire with a prefix rule
 * *and* an explicit refusal of `..` segments, tested, with the reasoning
 * recorded; W7's review then found a `package://` traversal in the bridge
 * that the same rule would have prevented, and the finding that mattered was
 * not the traversal but that **the rule existed one file over and was never
 * carried across.** A redirect URI is the same shape of problem from a less
 * trusted source: an attacker-supplied string that decides where a credential
 * is sent.
 *
 * Matching at the server is **exact string comparison against a registered
 * value** — never a prefix, never a wildcard host, never "starts with". A
 * prefix match on `https://app.example.com/cb` accepts
 * `https://app.example.com/cb.evil.test`.
 */
export const redirectUri = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (v) => {
      // Parsed, not prefix-matched. `startsWith('https://')` alone accepts the
      // literal string `https://` and anything else that merely opens with
      // those characters — a shape check standing in for a value check, which
      // is the failure this project keeps meeting under other names.
      let url: URL
      try {
        url = new URL(v)
      } catch {
        return false
      }
      if (url.hash !== '') return false // RFC 6749 §3.1.2
      if (url.protocol === 'https:') return url.hostname.length > 0
      // Loopback http is allowed because a native app cannot hold a
      // certificate; `localhost` and the literal addresses only, never an
      // arbitrary host that merely resolves there.
      //
      // **`url.hostname`, not `url.host.split(':')[0]`.** The first version
      // split on `:` to drop the port — which works for `127.0.0.1:8080` and
      // yields `"["` for `[::1]:8080`, because an IPv6 literal is *made of*
      // colons. So `[::1]` never matched the allow-list it is named in, in any
      // spelling, while two developer-facing messages went on saying it was
      // permitted. Found by Momus-W7b, reproduced against the live server.
      // `hostname` already strips the port and keeps the brackets.
      if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      return false
    },
    { message: 'redirect_uri must be an https URL, or http on an explicit loopback address, and carry no fragment' },
  )
export type RedirectUri = z.infer<typeof redirectUri>

/**
 * OAuth 2.1 removes the implicit and password grants and **makes PKCE
 * mandatory for every client**, public or confidential. `plain` is not
 * offered: a challenge equal to its verifier defends against nothing, and
 * offering it means a downgrade is negotiable.
 */
export const codeChallengeMethod = z.enum(['S256'])

export const oauthClient = z.object({
  id: z.uuid(),
  app_id: z.uuid(),
  /** The `client_id` on the wire — opaque, and not the app identifier. */
  client_id: z.string().min(1).max(200),
  client_name: z.string().min(1).max(200),
  registration: oauthClientRegistration,
  redirect_uris: z.array(redirectUri).min(1).max(20),
  created_at: z.iso.datetime(),
  /**
   * **Only `dynamic` clients expire, and the field is nullable rather than
   * absent so a consumer must decide what it means.** A self-registered client
   * that never completes a flow is an unauthenticated write somebody left
   * behind; a developer's own client is a configured thing that should not
   * vanish under them.
   */
  expires_at: z.iso.datetime().nullable(),
  last_used_at: z.iso.datetime().nullable(),
})
export type OauthClient = z.infer<typeof oauthClient>

/**
 * RFC 7591, the subset this server accepts. `.strict()` because a registration
 * request that silently strips is a registration request that lies quietly —
 * the same reasoning as `appCreateRequest` and `assetSyncRequest`, both of
 * which were tightened after somebody assumed a field into existence and got
 * a `201` describing something that had not happened.
 *
 * **This is an unauthenticated write endpoint**, which is why it is gated per
 * app (`acceptsDynamicClients`), bounded per app, rate-limited by W6c's
 * two-tier limiter, and why the rows it creates expire.
 */
export const dynamicClientRegistrationRequest = z
  .object({
    client_name: z.string().min(1).max(200),
    redirect_uris: z.array(redirectUri).min(1).max(20),
    /** Accepted and echoed for conformance; this server issues only this pair. */
    grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
    response_types: z.array(z.enum(['code'])).optional(),
    /** RFC 7591 allows `none` for public clients; OAuth 2.1 + PKCE is the defence. */
    token_endpoint_auth_method: z.enum(['none']).optional(),
    scope: z.string().max(500).optional(),
  })
  .strict()
export type DynamicClientRegistrationRequest = z.infer<typeof dynamicClientRegistrationRequest>

export const dynamicClientRegistrationResponse = z.object({
  client_id: z.string().min(1).max(200),
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(redirectUri),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.literal('none'),
  client_id_issued_at: z.number().int().nonnegative(),
  /** Seconds since the epoch, per RFC 7591. `0` would mean "never expires". */
  client_secret_expires_at: z.literal(0),
})
export type DynamicClientRegistrationResponse = z.infer<typeof dynamicClientRegistrationResponse>

/**
 * `POST /oauth/token`, both grants, as a discriminated union.
 *
 * **`resource` is on the refresh grant too, and that is the point of writing
 * this down.** RFC 8707 binds an access token to an audience; a refresh that
 * cannot carry the resource forward mints a successor with no `aud`, and the
 * validating resource then refuses a token the caller obtained legitimately.
 * The failure lands one token lifetime after a login that worked, on somebody
 * who did nothing wrong — which is the hardest kind of report to act on. The
 * field being present in the type is not the fix; **preserving the audience
 * across rotation is the fix**, and the type is here so the omission has to be
 * deliberate rather than silent.
 *
 * `code_verifier`'s bounds are RFC 7636 §4.1's, charset included. A verifier
 * is compared, not parsed, so a length nobody checks is a length an attacker
 * chooses.
 *
 * **These branches are deliberately not `.strict()`**, unlike
 * `dynamicClientRegistrationRequest` above, and the difference is the caller.
 * A registration request comes from a client we are about to trust and an
 * unknown key there is a caller assuming a feature into existence. A token
 * request comes from any RFC-compliant client, which may legitimately send
 * parameters this server does not read — refusing those would be a
 * conformance bug. The consequence is worth stating because it bit the test
 * for this very schema: unknown keys are **stripped**, so `safeParse().success`
 * cannot tell a present field from an absent one. Assert on the parsed value.
 */
export const oauthTokenRequest = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1).max(500),
    redirect_uri: redirectUri,
    client_id: z.string().min(1).max(200),
    code_verifier: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'code_verifier must be 43-128 unreserved characters (RFC 7636 §4.1)'),
    resource: z.url().optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1).max(500),
    client_id: z.string().min(1).max(200),
    resource: z.url().optional(),
    /** RFC 6749 §6 — a refresh may narrow scope, never widen it. */
    scope: z.string().max(500).optional(),
  }),
])
export type OauthTokenRequest = z.infer<typeof oauthTokenRequest>

/**
 * RFC 6749 §5.1's success envelope — **the second deliberate dialect, and this
 * one is a success shape rather than an error shape.**
 *
 * The values inside are the same tokens `/api/client/login` mints; only the
 * envelope differs, because an RFC-compliant client parses this one and knows
 * nothing about Fleetless. So a consumer holding this **normalises it into
 * `sessionTokens` and stores that** — it does not carry the envelope around.
 * Written here rather than invented once in the cloud and once in the SDK,
 * which is how two implementations of one wire shape start disagreeing.
 *
 * `token_type` is `Bearer` as a literal because it is what this server emits.
 * RFC 6749 §5.1 makes the value case-insensitive **for a client reading it**;
 * that leniency belongs in a parser we do not own, not in the shape we
 * produce.
 */
export const oauthTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  /** Seconds, per RFC 6749 §5.1 — not a timestamp, and not milliseconds. */
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().max(500).optional(),
})
export type OauthTokenResponse = z.infer<typeof oauthTokenResponse>

/** RFC 8414 §2 — the document a client reads *instead of* being told anything. */
export const authorizationServerMetadata = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url().optional(),
  response_types_supported: z.array(z.literal('code')),
  grant_types_supported: z.array(z.enum(['authorization_code', 'refresh_token'])),
  code_challenge_methods_supported: z.array(codeChallengeMethod),
  token_endpoint_auth_methods_supported: z.array(z.literal('none')),
  scopes_supported: z.array(z.string()).optional(),
})
export type AuthorizationServerMetadata = z.infer<typeof authorizationServerMetadata>

/**
 * RFC 9728 — what a *resource* publishes about who may authorize for it.
 *
 * W7b mints tokens bound to a resource that W7c builds. **A minting mechanism
 * with no validator is the failure mode this project has now met twelve times
 * in one wave: a check that cannot fail.** So W7b also ships a resource that
 * *rejects* a token whose audience names something else, and the gate measures
 * the rejection rather than the presence of the claim.
 */
export const protectedResourceMetadata = z.object({
  resource: z.url(),
  authorization_servers: z.array(z.url()).min(1),
  bearer_methods_supported: z.array(z.literal('header')),
  scopes_supported: z.array(z.string()).optional(),
})
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadata>

/**
 * What the consent screen states, and what the grant it produces is bound to.
 *
 * **Consent fires for `dynamic` clients only** (André, 2026-08-18). A
 * developer's own app client goes straight through — the developer *is* the
 * client and has already vetted it. A self-registered AI tool gets a step that
 * names the app, the client and the role the token will carry, because nobody
 * vetted it and the tools it reaches move a physical robot.
 *
 * §17 is not contradicted: it says the AI tool *"durchläuft den Standard-Flow"*
 * and consent is part of that standard flow.
 *
 * **The grant is bound to all four fields, not just the client.** A consent
 * recorded against a client alone would be re-usable for a different app or a
 * role the user never saw — the user consented to a *sentence*, and every noun
 * in it has to be part of what is stored.
 */
export const consentGrant = z.object({
  client_id: z.string().min(1).max(200),
  app_id: z.uuid(),
  end_user_id: z.uuid(),
  role_id: z.uuid(),
  scope: z.string().max(500),
  granted_at: z.iso.datetime(),
})
export type ConsentGrant = z.infer<typeof consentGrant>

/**
 * **What an end user sees about their own consents, and why it is not
 * `consentGrant` (W9c, DEF-099).**
 *
 * `consentGrant` is the *record* — four ids and a scope string. A person
 * deciding whether to revoke something needs to recognise it, and an id is
 * not recognisable. So this carries the names that were on the screen when
 * they consented: the client's, the app's, and the role's.
 *
 * `client_id` stays, because it is what a revocation addresses — the names
 * are for reading, the id is for acting.
 */
export const consentGrantSummary = z.object({
  client_id: z.string().min(1).max(200),
  /**
   * The client's own declared name. **Not trusted, and the console/page must
   * not render it as if Fleetless vouched for it** — a self-registered client
   * chooses this string, and W7c already measured what that buys: one called
   * itself *"Fleetless Official Helper"*.
   */
  client_name: z.string().min(1).max(200),
  app_id: z.uuid(),
  app_name: z.string().min(1).max(120),
  role_id: z.uuid(),
  role_name: z.string().min(1).max(120),
  scope: z.string().max(500),
  granted_at: z.iso.datetime(),
})
export type ConsentGrantSummary = z.infer<typeof consentGrantSummary>

export const consentGrantListResponse = z.object({
  grants: z.array(consentGrantSummary).max(200),
})
export type ConsentGrantListResponse = z.infer<typeof consentGrantListResponse>

/**
 * **Revoking one grant must end the access it authorised, not merely forget
 * that it happened (W9c, DEF-099).**
 *
 * The register row is about a user who wants a specific client to stop, and
 * the failure mode to avoid is a revocation that deletes the consent row
 * while every already-issued token keeps working until it expires. So the
 * response says what was actually ended, and a caller can tell *nothing
 * matched* from *matched and ended*.
 *
 * `tokens_revoked` is the count of refresh **families** ended. It is not a
 * count of access tokens, and deliberately so: an access token is stateless
 * and short-lived, and a number that claimed to have revoked one would be the
 * kind of sentence this project keeps having to take back.
 *
 * **What actually happens to the access token is stronger than this comment
 * first claimed, and narrower than its correction (W9c, 2026-08-19).** The
 * first version said *"let the access token expire"*. It does not. The
 * correction then said *"the same access token dies"*, which is true and
 * under-specified — Data-W9c read `resolveAnyToken` instead of copying the
 * sentence and found what the check is actually bound to:
 *
 *   `if (claims.client_id) { ...consent-grant lookup... }`
 *
 * So the immediate death is scoped to **`client_id`, not to a session and not
 * to the end user.** Every currently-valid token issued through *this
 * client's* OAuth flow for this end user dies at once — including a second
 * tab holding a different token from the same client. A plain `auth.login()`
 * session is untouched, because it carries no `client_id` for the check to
 * read, and a token bound to a *different* client is untouched too.
 *
 * That distinction is the whole point of revoking one grant rather than
 * logging somebody out: *"without touching any other client's access"* is
 * what this route promises, and the check is what makes it true.
 *
 * That is a better outcome than the contract promised, and it is written down
 * here for one reason: **a caller must not build on the weaker sentence.** If
 * this platform ever moves to stateless verification without the revocation
 * re-check, the access token would start living out its TTL again, and
 * anything that quietly relied on immediate death would break silently.
 */
export const consentRevokeResponse = z.object({
  revoked: z.boolean(),
  tokens_revoked: z.number().int().nonnegative(),
})
export type ConsentRevokeResponse = z.infer<typeof consentRevokeResponse>

/**
 * **What the hosted page is told about the request it is serving.**
 *
 * `/oauth/authorize` validates the request, stores it server-side and hands
 * the page an opaque `interaction_id`. Nothing else about the pending request
 * travels through the browser — not the redirect URI, not the code challenge,
 * not the client's identity beyond what is displayed. A page that carried
 * those would let a caller edit them between the two halves of the flow.
 *
 * **Injected into the page server-side, exactly like branding, and for the
 * same reason.** Fetching it would mean a second unauthenticated endpoint that
 * answers "does this app exist?" for any id somebody tries, and it would
 * render an empty form for one frame before it knew what it was serving.
 *
 * `idp` is `null` when the app has no federation configured. It carries a
 * label and nothing else: which issuer an app federates to is the developer's
 * business, not a fact the login page publishes to anyone who opens it.
 */
export const oauthInteraction = z.object({
  interaction_id: z.string().min(1).max(200),
  app_name: z.string().min(1).max(120),
  idp: z.object({ button_label: z.string().min(1).max(60) }).nullable(),
})
export type OauthInteraction = z.infer<typeof oauthInteraction>

/**
 * The consent screen's version of the same thing. **Every noun the user is
 * asked to approve is here**, because `consentGrant` binds all four and a
 * screen that names fewer than it binds is asking about something other than
 * what it records.
 */
export const oauthConsentInteraction = z.object({
  interaction_id: z.string().min(1).max(200),
  app_name: z.string().min(1).max(120),
  client_name: z.string().min(1).max(200),
  registration: oauthClientRegistration,
  role_name: z.string().min(1).max(120),
  scope: z.string().max(500),
})
export type OauthConsentInteraction = z.infer<typeof oauthConsentInteraction>

/**
 * The credential submission from the hosted page.
 *
 * **`interaction_id` instead of `app_identifier`** — the difference from
 * `clientLoginRequest` is the whole point. The app is a property of the
 * pending authorization request the server already holds, not something the
 * page asserts. If the page named the app, a caller could authenticate
 * against one app and be issued a code for another.
 *
 * `.strict()`: a credential endpoint that silently strips is a credential
 * endpoint that accepts a parameter somebody believes is being honoured.
 */
export const oauthLoginRequest = z
  .object({
    interaction_id: z.string().min(1).max(200),
    email: z.email(),
    password: z.string().min(1),
  })
  .strict()
export type OauthLoginRequest = z.infer<typeof oauthLoginRequest>

/**
 * Where the page goes next, and this shape is a **redirect the server chose**,
 * never one the page may be talked into.
 *
 * The server emits exactly two kinds of value here: its own consent path, or a
 * redirect URI already registered for this client with the code appended.
 * A page must navigate to it and nothing else — in particular it must not fall
 * back to any URL that arrived in its own query string if this field is
 * missing, which is how an open redirect gets built by accident on the way to
 * handling an error.
 *
 * JSON rather than a `302` because the page is an application: a redirect
 * cannot carry a field-level credential error back to a form, and a flow that
 * answers errors by navigating loses the state the user typed.
 */
export const oauthRedirectResponse = z.object({
  redirect_to: z.string().min(1).max(2000),
})
export type OauthRedirectResponse = z.infer<typeof oauthRedirectResponse>

/**
 * **Two names, one schema, and the duplication is deliberate.** `POST /login`
 * and `POST /oauth/consent` answer the identical question — *where does the
 * page go next* — so they are one type; but a consumer reading
 * `oauthConsentResponse` at a consent call site is reading the endpoint it is
 * talking to, which is worth more than the saving of one identifier.
 *
 * Eve-W7b validated the consent answer against a local schema because no
 * exported one existed, and **said so** rather than importing something near
 * enough. That is the gap this closes.
 */
export const oauthLoginResponse = oauthRedirectResponse
export type OauthLoginResponse = OauthRedirectResponse
export const oauthConsentResponse = oauthRedirectResponse
export type OauthConsentResponse = OauthRedirectResponse

export const consentDecision = z.object({
  /** The opaque handle the authorize step handed the consent screen. */
  interaction_id: z.string().min(1).max(200),
  approved: z.boolean(),
})
export type ConsentDecision = z.infer<typeof consentDecision>

/**
 * The well-known paths, in one place, because the bridge already taught this
 * lesson once: W7a added `artifacts/constants.json` after finding five
 * hand-written copies of `assetKind`'s members and a header name copied across
 * the TypeScript/Python line. A path that a client discovers must have exactly
 * one definition.
 */
export const OAUTH_PATHS = {
  authorizationServerMetadata: '/.well-known/oauth-authorization-server',
  protectedResourceMetadata: '/.well-known/oauth-protected-resource',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  /**
   * **One path, both verbs** — `GET` serves the consent page, `POST` accepts a
   * `consentDecision`. Decided 2026-08-18 rather than left to be inferred:
   * Eve-W7b asked whether the page's own GET route was this path or another,
   * which is the right question and had no answer anywhere.
   *
   * One entry means the console and the cloud cannot drift apart on it, which
   * is the failure W7a paid for when five hand-written copies of `assetKind`
   * and a header name crossed the TypeScript/Python line. Note that the two
   * verbs answer differently: the page is HTML, and a failed `POST` answers
   * `apiError` — see the dialect note at the top of this file, which names
   * this path as the exception the prefix will mislead you about.
   */
  consent: '/oauth/consent',
  /**
   * The two federation legs. **Server-owned redirect targets a client never
   * constructs** — the same category as `authorize`, `token` and `register`,
   * and the reason they belong here rather than as literals.
   *
   * Kassandra-W7b found `/oauth/idp-start` written as a literal in
   * `cloud/src/routes/oauth-federation.ts` **and** in
   * `console/oauth-pages/login/src/App.vue` — two repos agreeing on a string
   * with nothing shared between them. Worse than the `/idp` versus
   * `/idp-config` mismatch this wave already met, because the console half
   * ships as a **committed artifact**: the drift would survive a re-pin and an
   * install, and the symptom is a federation button that navigates to a 404,
   * invisible to both suites.
   *
   * `OAUTH_PATHS` was created in this wave with a doc comment citing W7a's
   * five hand-written copies of `assetKind`. The rule was applied to `login`
   * and `consent` and stopped there.
   */
  idpStart: '/oauth/idp-start',
  idpCallback: '/oauth/idp-callback',
  /**
   * The console-built page the cloud serves from its own origin (see §3.4) —
   * and, like `consent` above, **one path with both verbs**: `GET` serves the
   * page, `POST` accepts an `oauthLoginRequest` and answers an
   * `oauthLoginResponse`.
   *
   * Decided 2026-08-18. Nimbus-W7b proposed a separate `POST /oauth/login`,
   * which would work; one path is chosen for the same reason `consent` has
   * one — the page posts to its own URL, so there is no second string for two
   * repos to disagree about, and this wave has already produced one live
   * mismatch of exactly that kind (`/idp` versus `/idp-config`, caught by
   * comparing repos rather than by either suite).
   *
   * A failed `POST` answers `apiError`, not `oauthError`: the caller is our own
   * page, not a standard client. See the dialect note at the top of this file.
   */
  login: '/login',
} as const
