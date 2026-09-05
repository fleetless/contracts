import { z } from 'zod'

/**
 * **OAuth 2.1, and it remains only for MCP** (2026-09-05 app-user-auth, D8).
 *
 * This file used to describe two front doors: an app's end users signing in
 * through a Fleetless-hosted, app-branded login page, and MCP clients signing
 * in for the central endpoint. The first is deleted. An app now has its own UI
 * and calls the JSON client-auth API (`client-auth.ts`); Fleetless renders an
 * app user no page, so there is no hosted login, no consent screen, no
 * developer-registered client and no app-level dynamic registration.
 *
 * What remains is the MCP authorization server — central, for Fleetless users,
 * and per app for an app's users — and the console's own OAuth portal, which
 * answers `oauthRedirectResponse` at its login and sign-up steps.
 *
 * The client model this file was written to get right is still the important
 * part, and it survived the cut intact: an MCP client **registers itself**
 * (RFC 7591) because the person only ever pastes a URL into an AI tool.
 * Nobody vetted it, its redirect URIs arrive from the client itself, and the
 * tools it will call move a physical robot. That is why consent names the
 * client with an explicit *unverified* marker — see `clientMcpInteraction` in
 * `client-auth.ts`, which is where the per-app half of that screen is now
 * described, because the app renders it and Fleetless does not.
 */

/**
 * **This file speaks two error dialects on purpose, and unifying them would
 * break conformance.**
 *
 * The OAuth endpoints (`/mcp/oauth/authorize`, `/mcp/oauth/token`,
 * registration) answer in RFC 6749 §5.2's shape — a flat `error` string from a fixed set,
 * with an optional `error_description`. That is what an RFC-compliant client
 * parses, and `mcp-inspector` is such a client. A Fleetless `apiError` there
 * would be well-formed JSON that no standard client can read.
 *
 * The *management* endpoints beside them — configuring a provider, editing an
 * app's auth settings — are ordinary console API and use `apiError` with
 * `ERROR_CODES` like everything else.
 *
 * So: **two shapes, split by audience, not by accident.** Written down here
 * because the natural instinct on finding two error formats in one server is
 * to unify them, and doing so silently removes the reason the standard one is
 * there.
 *
 * **The split is by audience and the path prefix will mislead you.**
 * `/mcp/oauth/consent` sits under an `/oauth/` segment and is nevertheless an
 * `apiError` endpoint: it is not in RFC 6749's or RFC 7591's endpoint set, and
 * its only caller is a page this server rendered. Whoever later sorts these by
 * prefix will move it, and be wrong. Ask who parses the response, not where it
 * lives.
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
   * Two policy refusals at the registration endpoint — MCP is off for this
   * app, and the app's client ceiling is full — both map to RFC 6749's
   * `access_denied`, which is the honest standard code for either. Answering with only that
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

/**
 * RFC 7591, the subset this server accepts. `.strict()` because a registration
 * request that silently strips is a registration request that lies quietly —
 * the same reasoning as `appCreateRequest` and `assetSyncRequest`, both of
 * which were tightened after somebody assumed a field into existence and got
 * a `201` describing something that had not happened.
 *
 * **This is an unauthenticated write endpoint**, which is why it is gated by
 * the app's `mcp_enabled` switch, bounded per app, rate-limited by W6c's
 * two-tier limiter, and why the rows it creates expire.
 */
export const dynamicClientRegistrationRequest = z
  .object({
    client_name: z.string().min(1).max(200).meta({
      description: 'The name the client calls itself. It is **not** vouched for by Fleetless and must never be rendered as if it were — a self-registered client chooses this string, and one has called itself *"Fleetless Official Helper"*.',
    }),
    redirect_uris: z.array(redirectUri).min(1).max(20).meta({
      description: 'Where the authorization code may be returned. Each must be an `https` URL, or `http` on an explicit loopback address for a native app that cannot hold a certificate, and none may carry a fragment. There must be between `1` and `20` of them.',
    }),
    grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional().meta({
      description: 'Accepted and echoed back for conformance with RFC 7591. This server issues `authorization_code` and `refresh_token` and nothing else.',
    }),
    response_types: z.array(z.enum(['code'])).optional().meta({
      description: 'Accepted and echoed back for conformance. `code` is the only response type OAuth 2.1 leaves, the implicit grant having been removed.',
    }),
    token_endpoint_auth_method: z.enum(['none']).optional().meta({
      description: '`none`, RFC 7591\'s value for a public client. There is no client secret to hold: mandatory PKCE is the defence.',
    }),
    scope: z.string().max(500).optional().meta({
      description: 'The scopes the client asks to be registered for, space-separated.',
    }),
  })
  .strict()
export type DynamicClientRegistrationRequest = z.infer<typeof dynamicClientRegistrationRequest>

export const dynamicClientRegistrationResponse = z.object({
  client_id: z.string().min(1).max(200).meta({
    description: 'The identifier this client sends at the authorize and token endpoints. Opaque, and not the app identifier.',
  }),
  client_name: z.string().min(1).max(200).meta({
    description: 'The name the client registered under, echoed back. Chosen by the client and not vouched for by Fleetless.',
  }),
  redirect_uris: z.array(redirectUri).meta({
    description: 'The redirect URIs this registration was accepted for. A code is returned to one of these and nowhere else.',
  }),
  grant_types: z.array(z.string()).meta({
    description: 'The grants this client may use: `authorization_code` and `refresh_token`.',
  }),
  response_types: z.array(z.string()).meta({
    description: 'The response types this client may ask for: `code`.',
  }),
  token_endpoint_auth_method: z.literal('none').meta({
    description: '`none` — this server registers public clients only, and PKCE rather than a secret is what protects the exchange.',
  }),
  client_id_issued_at: z.number().int().nonnegative().meta({
    description: 'When the registration was created, in seconds since the epoch, per RFC 7591.',
  }),
  client_secret_expires_at: z.literal(0).meta({
    description: 'Always `0`, which is RFC 7591\'s way of saying the client secret never expires — there is none. The **registration** itself does expire: a self-registered client that never completes a flow is an unauthenticated write somebody left behind.',
  }),
})
export type DynamicClientRegistrationResponse = z.infer<typeof dynamicClientRegistrationResponse>

/**
 * The MCP token endpoint, both grants, as a discriminated union.
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
    grant_type: z.literal('authorization_code').meta({
      description: 'This request exchanges the code from the authorize redirect for tokens.',
    }),
    code: z.string().min(1).max(500).meta({
      description: 'The authorization code from the redirect. It may be exchanged once.',
    }),
    redirect_uri: redirectUri.meta({
      description: 'The same redirect URI the authorize request used. It is compared, not merely recorded.',
    }),
    client_id: z.string().min(1).max(200).meta({
      description: 'The client making the exchange, as registered.',
    }),
    code_verifier: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'code_verifier must be 43-128 unreserved characters (RFC 7636 §4.1)').meta({
      description: 'The PKCE verifier whose `S256` hash was sent as the challenge at the authorize step. Between `43` and `128` unreserved characters, per RFC 7636 §4.1 — it is compared rather than parsed, so a length nobody checks is a length an attacker chooses. PKCE is mandatory for every client under OAuth 2.1.',
    }),
    resource: z.url().optional().meta({
      description: 'The resource the token is being requested for, per RFC 8707. It becomes the token\'s audience, and a resource refuses a token whose audience names something else.',
    }),
  }),
  z.object({
    grant_type: z.literal('refresh_token').meta({
      description: 'This request trades a refresh token for a fresh access token.',
    }),
    refresh_token: z.string().min(1).max(500).meta({
      description: 'The refresh token to spend. Refresh tokens rotate, and presenting one twice is treated as theft rather than as a retry.',
    }),
    client_id: z.string().min(1).max(200).meta({
      description: 'The client refreshing, as registered.',
    }),
    resource: z.url().optional().meta({
      description: 'The resource the successor token should be bound to, per RFC 8707. **Carry it forward**: a refresh that drops it mints a token with no audience, and the resource then refuses it one token lifetime after a login that worked, to somebody who did nothing wrong.',
    }),
    scope: z.string().max(500).optional().meta({
      description: 'A narrower scope for the successor token. RFC 6749 §6 lets a refresh narrow scope, never widen it.',
    }),
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
  access_token: z.string().min(1).meta({
    description: 'The bearer token. It is the same token the client login mints — only the envelope differs, because an RFC-compliant client parses this one and knows nothing about Fleetless.',
  }),
  token_type: z.literal('Bearer').meta({
    description: '`Bearer`. RFC 6749 §5.1 makes the value case-insensitive for a client reading it; this is the spelling this server emits.',
  }),
  expires_in: z.number().int().positive().meta({
    description: 'How long the access token is valid, in **seconds**, per RFC 6749 §5.1. Not a timestamp, and not milliseconds.',
  }),
  refresh_token: z.string().min(1).optional().meta({
    description: 'The refresh token, when one was issued. It rotates on every use.',
  }),
  scope: z.string().max(500).optional().meta({
    description: 'The scopes the issued token actually carries, space-separated.',
  }),
})
export type OauthTokenResponse = z.infer<typeof oauthTokenResponse>

/** RFC 8414 §2 — the document a client reads *instead of* being told anything. */
export const authorizationServerMetadata = z.object({
  issuer: z.url().meta({
    description: 'The issuer identifier of this authorization server, per RFC 8414 §2. It is what a client checks a token\'s `iss` against.',
  }),
  authorization_endpoint: z.url().meta({
    description: 'The URL a client sends the user to in order to authorize.',
  }),
  token_endpoint: z.url().meta({
    description: 'The URL where a client exchanges an authorization code, or a refresh token, for tokens.',
  }),
  registration_endpoint: z.url().optional().meta({
    description: 'The URL where a client may register itself, per RFC 7591. Absent when the app does not accept dynamic clients.',
  }),
  response_types_supported: z.array(z.literal('code')).meta({
    description: 'The response types this server offers: `code` only, the implicit grant being gone with OAuth 2.1.',
  }),
  grant_types_supported: z.array(z.enum(['authorization_code', 'refresh_token'])).meta({
    description: 'The grants this server offers. OAuth 2.1 removes the implicit and password grants, so neither appears here.',
  }),
  code_challenge_methods_supported: z.array(codeChallengeMethod).meta({
    description: 'The PKCE challenge methods accepted: `S256` only. `plain` is not offered — a challenge equal to its verifier defends against nothing, and offering it would make a downgrade negotiable.',
  }),
  token_endpoint_auth_methods_supported: z.array(z.literal('none')).meta({
    description: 'How a client authenticates at the token endpoint: `none`, the public-client method, with PKCE protecting the exchange.',
  }),
  scopes_supported: z.array(z.string()).optional().meta({
    description: 'The scopes this server knows about, where it publishes a list.',
  }),
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
  resource: z.url().meta({
    description: 'The resource identifier this document describes, per RFC 9728. A token whose audience names something else is rejected here rather than merely noted.',
  }),
  authorization_servers: z.array(z.url()).min(1).meta({
    description: 'The authorization servers that may issue tokens for this resource. There is always at least one.',
  }),
  bearer_methods_supported: z.array(z.literal('header')).meta({
    description: 'How a token may be presented: in the `Authorization` header only, never in a query parameter or a form field.',
  }),
  scopes_supported: z.array(z.string()).optional().meta({
    description: 'The scopes this resource understands, where it publishes a list.',
  }),
})
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadata>

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

/* `OAUTH_PATHS` was deleted on 2026-09-05, and every one of its nine entries
 * went with the routes it named.
 *
 * It existed so two repositories could not spell a discovered path
 * differently, and it worked — but every path it held belonged to the app-level
 * OAuth flow (`authorize`, `token`, `register`, `consent`, `login`,
 * `impersonate`, `idpCallback`) or to the stub resource's metadata documents,
 * and OAuth 2.1 now remains only for MCP (D8). The MCP authorization server
 * builds its own paths in `cloud/src/routes/mcp-oauth.ts`, where they are read
 * by one file rather than by two repositories.
 *
 * Deleted rather than left with the four entries whose routes this train also
 * removes, because that is precisely the defect this constant was created after
 * and then reproduced: its `idpStart` entry named a route the cloud had deleted
 * and stood for months with nothing noticing. A constant whose every value
 * names a deleted route is that failure at full size.
 */

/**
 * The authorization request of RFC 6749 §4.1.1 with PKCE (RFC 7636) — the
 * shape `/mcp/oauth/authorize` reads.
 *
 * **The cloud reads every parameter by hand, and that is not an omission** —
 * each failure has its own answer. `client_id` and `redirect_uri` are refused
 * flat, with no redirect, because until both are confirmed there is no trusted
 * target to bounce a browser to; everything after them is reported to the
 * client's own callback as query parameters. A single `safeParse` would
 * collapse those two answers into one. So this schema pins the successful
 * shape and the documentation, not the error path.
 *
 * **No route entry points at it**, and that is worth saying rather than
 * leaving to be discovered. The app-level `/oauth/authorize` it was written
 * for is deleted; the MCP authorize route reads its query by hand and the
 * manifest records `query: null` for it, which is the honest description of
 * what that handler does. The schema is kept because it is the documentation
 * of a wire this server still speaks — and because the per-app MCP endpoint
 * (D7) speaks the same one.
 */
export const oauthAuthorizeQuery = z
  .object({
    response_type: z.literal('code').meta({
      description: 'Always `code`. RFC 6749 §4.1.2.1 names `unsupported_response_type` for any other value, but `oauthErrorCode` has no such member — this server issues no other grant from this endpoint — so an unsupported value comes back on the callback as `invalid_request`.',
    }),
    client_id: z.string().min(1).meta({
      description: 'The OAuth client, self-registered or the one well-known central client — **not** the app identifier. Unknown, expired-dynamic and mismatched clients all collapse into the same `400 invalid_client`, answered without a redirect.',
    }),
    redirect_uri: z.string().min(1).meta({
      description: 'One of the client\'s registered redirect URIs, compared **exactly** — string equality against the registered list, never a prefix or a host match. Both the shape (`redirectUri`) and the registration are checked, and a failure of either is a `400 invalid_request` with no redirect.',
    }),
    code_challenge: z.string().min(1).meta({
      description: 'The PKCE challenge; the verifier is presented at the token endpoint. Only non-emptiness is checked here — length and alphabet are not — since the verifier is what actually has to match.',
    }),
    code_challenge_method: z.literal('S256').meta({
      description: 'Only `S256`. `plain` is refused: a challenge equal to its verifier defends against nothing.',
    }),
    state: z.string().optional().meta({
      description: 'Returned unchanged on the callback, and on the error redirect too, so a client can bind either answer to its own request.',
    }),
    resource: z.string().optional().meta({
      description: 'RFC 8707 resource indicator: the API origin or the MCP endpoint the token is for. Checked against the resources this server issues tokens for **on behalf of this client\'s app**; a mismatch is `invalid_target` on the callback.',
    }),
    scope: z.string().optional().meta({
      description: 'Space-separated scopes. Carried onto the interaction and read again at consent — **nothing is enforced at this step**, so an unknown scope is not a refusal here.',
    }),
  })
  .meta({
    description: 'The authorization request an MCP client sends. The two parameters above `response_type` are validated first and refuse flat; every parameter after them reports to the callback.',
  })
export type OauthAuthorizeQuery = z.infer<typeof oauthAuthorizeQuery>

/**
 * Which app a dynamic client registration belongs to.
 *
 * It rides in the query because RFC 7591's request body has no field for it
 * and one registration endpoint can serve every app.
 *
 * **Unreferenced by the manifest today.** `POST /oauth/register` — the
 * app-level registration endpoint this described — is deleted with the app
 * OAuth flow, and `/mcp/oauth/register` is the central endpoint's and names no
 * app. It is kept for the per-app MCP registration the MCP train adds (D7),
 * which needs exactly this parameter; said plainly, because a schema that
 * looks like it describes a live route and does not is this repository's
 * commonest documentation defect.
 */
export const oauthRegisterQuery = z
  .object({
    app_identifier: z.string().min(1).meta({
      description: 'The app the dynamic client registers under, as `appIdentifier` spells it. Required: missing and unknown answer the same `400 invalid_request` in the `oauthError` dialect. Whether that app has MCP enabled at all is a separate, later refusal (`access_denied`).',
    }),
  })
  .meta({ description: 'The app a dynamic client registers under — the one parameter RFC 7591 has no body field for.' })
export type OauthRegisterQuery = z.infer<typeof oauthRegisterQuery>
