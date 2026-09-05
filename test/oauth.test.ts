import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import {
  app,
  codeChallengeMethod,
  dynamicClientRegistrationRequest,
  ERROR_CODES,
  idpIssuer,
  oauthError,
  oauthRedirectResponse,
  oauthTokenRequest,
  oauthTokenResponse,
  redirectUri,
  updateAppRequest,
} from '../src/index.js'

/**
 * The MCP authorization server — the only OAuth surface left (D8).
 *
 * Every test here names a thing that would otherwise be believed without
 * evidence. The rule this file was written to: name what would make the
 * check fail, and go make it fail once.
 */

describe('redirectUri', () => {
  it('accepts https and explicit loopback http', () => {
    for (const ok of [
      'https://app.example.com/cb',
      'https://app.example.com/cb?x=1',
      'http://localhost:3000/cb',
      'http://127.0.0.1:8080/cb',
      // IPv6 loopback, both spellings. These were refused by every earlier
      // version of this validator while two developer-facing messages named
      // them as allowed — `host.split(':')[0]` on an address made of colons.
      'http://[::1]:8080/cb',
      'http://[::1]/cb',
    ]) {
      expect(redirectUri.safeParse(ok).success, ok).toBe(true)
    }
  })

  it('refuses every scheme that can execute or embed', () => {
    // The threat is a redirect target that is not a network fetch at all.
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'about:blank']) {
      expect(redirectUri.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('refuses plain http on a host that is not loopback', () => {
    expect(redirectUri.safeParse('http://app.example.com/cb').success).toBe(false)
    // A host that merely *contains* a loopback name is not loopback.
    expect(redirectUri.safeParse('http://localhost.evil.test/cb').success).toBe(false)
  })

  it('refuses a fragment (RFC 6749 §3.1.2)', () => {
    expect(redirectUri.safeParse('https://app.example.com/cb#x').success).toBe(false)
  })

  it('is a parse and not a prefix match', () => {
    // This is the case a `startsWith('https://')` check accepts. It is here
    // because that is exactly what this validator did in its first draft.
    expect(redirectUri.safeParse('https://').success).toBe(false)
  })
})

describe('the client model', () => {
  /**
   * **The developer-registered client is gone; every MCP client registers
   * itself.** `oauthClient`, `oauthClientRegistration` and the app-level
   * registration routes described a distinction between a client the developer
   * vetted and one nobody did — and with the app OAuth flow deleted, only the
   * second kind exists. The distinction did not become untrue; it became
   * one-sided, so the marker moved to where the person actually sees it:
   * `clientMcpInteraction.client_name_verified`, a `z.literal(false)`.
   */
  it('no longer models a developer-registered client', () => {
    for (const gone of ['oauthClient', 'oauthClientListResponse', 'oauthClientRegistration']) {
      expect(gone in barrel, gone).toBe(false)
    }
    expect(barrel.clientMcpInteraction.shape.client_name_verified.safeParse(false).success).toBe(true)
    expect(barrel.clientMcpInteraction.shape.client_name_verified.safeParse(true).success).toBe(false)
  })

  it('refuses PKCE downgrade: there is no `plain`', () => {
    expect(codeChallengeMethod.safeParse('S256').success).toBe(true)
    expect(codeChallengeMethod.safeParse('plain').success).toBe(false)
  })
})

describe('dynamicClientRegistrationRequest', () => {
  const ok = { client_name: 'Claude Desktop', redirect_uris: ['http://127.0.0.1:33418/cb'] }

  it('accepts the minimum an RFC 7591 client sends', () => {
    expect(dynamicClientRegistrationRequest.safeParse(ok).success).toBe(true)
  })

  it('is strict — an unknown key is a 400, not a silent strip', () => {
    // A request shape that strips is a request shape that lies quietly.
    expect(dynamicClientRegistrationRequest.safeParse({ ...ok, client_secret: 'hunter2' }).success).toBe(false)
  })

  it('refuses a client that claims it can authenticate itself', () => {
    // A self-registered client is public by construction: nobody issued it a
    // secret, so a secret it presents proves nothing.
    expect(
      dynamicClientRegistrationRequest.safeParse({ ...ok, token_endpoint_auth_method: 'client_secret_post' }).success,
    ).toBe(false)
  })

  it('refuses a hostile redirect at registration, not later', () => {
    expect(dynamicClientRegistrationRequest.safeParse({ ...ok, redirect_uris: ['javascript:alert(1)'] }).success).toBe(
      false,
    )
  })
})

describe('the error codes this surface answers', () => {
  it('keeps the ones a dynamic registration can meet, and the list has no duplicates', () => {
    for (const code of [
      'dynamic_registration_disabled',
      'client_limit_reached',
      'idp_unavailable',
      'invalid_redirect_uri',
      'interaction_expired',
    ]) {
      expect(ERROR_CODES, code).toContain(code)
    }
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })

  /**
   * **The two federated-login codes went with the flow that produced them.**
   * `identity_conflict` and `identity_not_provisioned` answered an app user
   * signing in through the hosted flow; that flow is deleted, and the per-app
   * OIDC callback redirects `clientOidcErrorCode` to the developer's own page
   * instead of answering an `apiError`. Their meanings survive there —
   * `email_taken` and `no_access` — where the app renders them.
   */
  it('has dropped the two the hosted federated login produced', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).not.toContain('identity_conflict')
    expect(codes).not.toContain('identity_not_provisioned')
    expect(barrel.clientOidcErrorCode.options).toContain('email_taken')
    expect(barrel.clientOidcErrorCode.options).toContain('no_access')
  })
})

describe('the token endpoint', () => {
  const code = {
    grant_type: 'authorization_code' as const,
    code: 'c_xyz',
    redirect_uri: 'https://app.example.com/cb',
    client_id: 'c_abc',
    code_verifier: 'a'.repeat(43),
  }

  it('accepts both grants and refuses a third', () => {
    expect(oauthTokenRequest.safeParse(code).success).toBe(true)
    expect(
      oauthTokenRequest.safeParse({ grant_type: 'refresh_token', refresh_token: 'r', client_id: 'c_abc' }).success,
    ).toBe(true)
    // OAuth 2.1 removes the password grant. A union that admits it is a union
    // that will be handed one.
    expect(
      oauthTokenRequest.safeParse({ grant_type: 'password', username: 'a', password: 'b', client_id: 'c_abc' }).success,
    ).toBe(false)
  })

  it('bounds code_verifier at both ends and by charset (RFC 7636 §4.1)', () => {
    // A verifier is compared, not parsed — an unbounded length is a length the
    // attacker picks.
    expect(oauthTokenRequest.safeParse({ ...code, code_verifier: 'a'.repeat(42) }).success).toBe(false)
    expect(oauthTokenRequest.safeParse({ ...code, code_verifier: 'a'.repeat(129) }).success).toBe(false)
    expect(oauthTokenRequest.safeParse({ ...code, code_verifier: `${'a'.repeat(42)}+` }).success).toBe(false)
  })

  it('lets both grants carry a resource, so an audience can survive rotation', () => {
    // The refresh half is the one that matters: without it a refreshed token
    // silently loses its `aud` and the validating resource refuses a token the
    // caller obtained legitimately.
    //
    // **Asserted on the parsed value, not on `.success`.** These branches are
    // not `.strict()` — deliberately, because RFC 6749 lets a conformant
    // client send parameters we do not read. So an unknown key is *stripped*
    // and the parse still succeeds: a `.success` assertion here would pass
    // just as happily against a schema with no `resource` field at all. It
    // did, when this test was first written, and dropping the field from the
    // refresh branch changed nothing about the result.
    const R = 'https://api.example.com/mcp/x'
    const fromCode = oauthTokenRequest.parse({ ...code, resource: R })
    expect(fromCode.resource).toBe(R)
    const fromRefresh = oauthTokenRequest.parse({
      grant_type: 'refresh_token',
      refresh_token: 'r',
      client_id: 'c_abc',
      resource: R,
    })
    expect(fromRefresh.resource).toBe(R)
  })

  it('lets a refresh narrow its scope, which RFC 6749 §6 permits', () => {
    const parsed = oauthTokenRequest.parse({
      grant_type: 'refresh_token',
      refresh_token: 'r',
      client_id: 'c_abc',
      scope: 'read',
    })
    // Erst den Diskriminator festhalten, dann das Feld: `oauthTokenRequest`
    // ist eine Union, und `scope` gibt es NUR am refresh-Zweig. Vorher las der
    // Test das Feld direkt — zur Laufzeit richtig, aber tsc sah es nie, weil
    // `test/` in diesem Repo lange gar nicht typgeprueft wurde. So geprueft
    // beweist der Test zusaetzlich, dass der richtige Zweig entstanden ist.
    expect(parsed.grant_type).toBe('refresh_token')
    expect(parsed.grant_type === 'refresh_token' && parsed.scope).toBe('read')
  })

  it('states expires_in in seconds and refuses a timestamp-shaped value', () => {
    const ok = { access_token: 'a', token_type: 'Bearer', expires_in: 900 }
    expect(oauthTokenResponse.safeParse(ok).success).toBe(true)
    expect(oauthTokenResponse.safeParse({ ...ok, expires_in: -1 }).success).toBe(false)
    expect(oauthTokenResponse.safeParse({ ...ok, expires_in: 900.5 }).success).toBe(false)
    expect(oauthTokenResponse.safeParse({ ...ok, token_type: 'bearer' }).success).toBe(false)
  })
})

describe('oauthError.fleetless_code', () => {
  it('keeps two policy refusals distinguishable inside one standard code', () => {
    // Both map to `access_denied`, which is the honest RFC code for either.
    // Without the extra member the caller cannot tell them apart — the exact
    // shape this project already paid for once with `failed` as a flat
    // string[].
    const disabled = oauthError.parse({
      error: 'access_denied', fleetless_code: 'dynamic_registration_disabled',
    })
    const full = oauthError.parse({ error: 'access_denied', fleetless_code: 'client_limit_reached' })
    expect(disabled.error).toBe(full.error)
    expect(disabled.fleetless_code).not.toBe(full.fleetless_code)
  })

  it('is optional, so an ordinary RFC error needs nothing extra', () => {
    expect(oauthError.safeParse({ error: 'invalid_request' }).success).toBe(true)
  })
})

describe('idpIssuer', () => {
  it('refuses every scheme that is not http(s)', () => {
    // All of these were stored through PUT /api/apps/:id/idp and the outbound
    // discovery fetch was then caught on a purpose-built listener.
    for (const bad of ['file:///etc/passwd', 'gopher://x/', 'data:text/plain,x', 'ftp://idp.test/']) {
      expect(idpIssuer.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('refuses credentials, a query and a fragment', () => {
    // RFC 8414 §3 builds the discovery URL from the issuer's path, so a query
    // there is meaningless — and a `@` is a redirect trick, not a username.
    expect(idpIssuer.safeParse('https://user:pw@idp.test/').success).toBe(false)
    expect(idpIssuer.safeParse('https://idp.test/?x=1').success).toBe(false)
    expect(idpIssuer.safeParse('https://idp.test/#x').success).toBe(false)
  })

  it('still accepts the dev IdP, which is the point of the limit below', () => {
    // This schema CANNOT tell the dev Keycloak from postgres — both are
    // loopback http. It is not the SSRF defence and the doc comment says so;
    // this test pins the fact that it deliberately lets this through.
    expect(idpIssuer.safeParse('http://localhost:8081/realms/fleetless-test').success).toBe(true)
    expect(idpIssuer.safeParse('http://127.0.0.1:5432').success).toBe(true)
    expect(idpIssuer.safeParse('https://login.microsoftonline.com/tenant/v2.0').success).toBe(true)
  })
})

describe('what the app OAuth flow took with it', () => {
  /**
   * Removed-symbol guards for the hosted app flow. Each named a page or a
   * stored decision that only existed because Fleetless owned the app user's
   * browser; it does not (D2), so a re-appearance is a merge accident.
   *
   * `OAUTH_PATHS` is here rather than merely deleted quietly: it was created
   * *after* this repository found five hand-written copies of one constant,
   * and then reproduced the same defect itself, standing for months with an
   * `idpStart` entry naming a route the cloud had deleted. Every one of its
   * nine values named a route this train removes.
   */
  it('exports none of the hosted-flow shapes', () => {
    for (const gone of [
      'OAUTH_PATHS',
      'oauthInteraction',
      'oauthConsentInteraction',
      'oauthLoginRequest',
      'oauthLoginResponse',
      'oauthConsentResponse',
      'consentDecision',
      'consentGrant',
      'consentGrantSummary',
      'consentGrantListResponse',
      'consentRevokeResponse',
      'idpConfig',
      'idpConfigRequest',
      'brandingConfig',
    ]) {
      expect(gone in barrel, gone).toBe(false)
    }
  })

  /**
   * The redirect shape survived because three live routes still answer it —
   * the console portal's login and sign-up steps, and the MCP login and
   * consent. Asserted so this file is not claiming an empty world, which is
   * how a removed-symbol sweep goes vacuous.
   */
  it('keeps oauthRedirectResponse, which the console portal and MCP still answer', () => {
    expect(oauthRedirectResponse.safeParse({ redirect_to: 'https://app.example.com/cb?code=x' }).success).toBe(true)
    expect(oauthRedirectResponse.safeParse({}).success).toBe(false)
  })

  /**
   * The app shape lost the switch that gated app-level dynamic registration.
   * Strict on both write shapes, so an offered value is a `400` naming the
   * field rather than a `200` that changed nothing.
   */
  it('drops accepts_dynamic_clients from the app and refuses it on a write', () => {
    expect('accepts_dynamic_clients' in app.shape).toBe(false)
    expect(updateAppRequest.safeParse({ accepts_dynamic_clients: true }).success).toBe(false)
  })

  /**
   * A logo was up to 256 KiB, and the reason it never sat on `app` was that
   * every app list would pay for it. Branding is deleted outright now — a
   * developer who wants it writes it into a mail template — so this is the
   * tripwire for it arriving back on the shape that least needs it.
   */
  it('keeps branding off the app shape', () => {
    expect('branding' in app.shape).toBe(false)
    expect('logo_data_uri' in app.shape).toBe(false)
  })
})
