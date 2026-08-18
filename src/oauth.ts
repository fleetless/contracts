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
      if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.host.split(':')[0] ?? '')
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
  consent: '/oauth/consent',
  /** The console-built page the cloud serves from its own origin (see §3.4). */
  login: '/login',
} as const
