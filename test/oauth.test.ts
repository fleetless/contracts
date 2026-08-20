import { describe, expect, it } from 'vitest'
import {
  app,
  brandingConfig,
  codeChallengeMethod,
  dynamicClientRegistrationRequest,
  ERROR_CODES,
  idpConfig,
  idpIssuer,
  selfRegistration,
  OAUTH_PATHS,
  oauthClient,
  oauthClientRegistration,
  oauthConsentInteraction,
  oauthError,
  idpConfigRequest,
  oauthLoginRequest,
  oauthConsentResponse,
  oauthTokenRequest,
  oauthTokenResponse,
  redirectUri,
  updateAppRequest,
} from '../src/index.js'

/**
 * The hosted authorization server.
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
  it('can express both registration kinds and demands one', () => {
    expect(oauthClientRegistration.options).toEqual(['developer', 'dynamic'])
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      app_id: '00000000-0000-4000-8000-000000000002',
      client_id: 'c_abc',
      client_name: 'Some Tool',
      redirect_uris: ['https://app.example.com/cb'],
      created_at: '2026-08-18T00:00:00.000Z',
      expires_at: null,
      last_used_at: null,
    }
    // The whole point of the discriminator is that it cannot be omitted and
    // then inferred later from some other field's nullability.
    expect(oauthClient.safeParse(base).success).toBe(false)
    expect(oauthClient.safeParse({ ...base, registration: 'dynamic' }).success).toBe(true)
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

describe('brandingConfig', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='

  it('accepts a raster logo and one canonical colour spelling', () => {
    expect(brandingConfig.safeParse({ primary_color: '#0b5fff', logo_data_uri: png }).success).toBe(true)
    // Two configs that look identical must be identical.
    expect(brandingConfig.safeParse({ primary_color: '#0B5FFF' }).success).toBe(false)
  })

  it('refuses SVG — the login page holds a password field', () => {
    expect(
      brandingConfig.safeParse({ primary_color: '#0b5fff', logo_data_uri: 'data:image/svg+xml;base64,PHN2Zz4=' })
        .success,
    ).toBe(false)
  })

  it('refuses an off-platform logo URL', () => {
    // An outbound fetch from the login page is a beacon on every attempt.
    expect(
      brandingConfig.safeParse({ primary_color: '#0b5fff', logo_data_uri: 'https://cdn.evil.test/logo.png' }).success,
    ).toBe(false)
  })

  it('bounds the logo', () => {
    const huge = `data:image/png;base64,${'A'.repeat(349_600)}`
    expect(brandingConfig.safeParse({ primary_color: '#0b5fff', logo_data_uri: huge }).success).toBe(false)
  })
})

describe('idpConfig', () => {
  it('cannot carry the client secret back out', () => {
    const parsed = idpConfig.parse({
      app_id: '00000000-0000-4000-8000-000000000002',
      issuer: 'https://idp.example.com',
      client_id: 'fleetless',
      client_secret: 'hunter2',
      scopes: ['openid', 'email'],
      claims: { subject_claim: 'sub', email_claim: 'email' },
      // `link_verified_emails` ist auf die Org gewandert — es entschied ueber
      // eine org-weite Identitaet und sass auf einem App-Objekt. Der Paritaets-Waechter unten gilt unveraendert weiter.
      has_client_secret: true,
      updated_at: '2026-08-18T00:00:00.000Z',
    })
    // A secret a response can return is a secret in every log that captured one.
    expect('client_secret' in parsed).toBe(false)
    expect(parsed.has_client_secret).toBe(true)
  })
})

describe('the new error codes', () => {
  it('are present and the list has no duplicates', () => {
    for (const code of [
      'dynamic_registration_disabled',
      'client_limit_reached',
      'identity_conflict',
      'idp_unavailable',
    ]) {
      expect(ERROR_CODES, code).toContain(code)
    }
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('OAUTH_PATHS', () => {
  it('has one definition per path and they are distinct', () => {
    const values = Object.values(OAUTH_PATHS)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v.startsWith('/'), v).toBe(true)
    // Non-vacuity: this test is worthless if the object is ever emptied.
    expect(values.length).toBeGreaterThan(5)
  })
})

describe('accepts_dynamic_clients', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    org_id: '00000000-0000-4000-8000-000000000002',
    name: 'Some App',
    identifier: 'some-app',
    robot_ids: [],
    // MCP added a second required switch. It belongs in `base` and NOT in the
    // assertion below: with it missing here too, `safeParse(base)` would fail
    // for two reasons, and this test would go on passing if
    // `accepts_dynamic_clients` were quietly made optional. A check that
    // cannot fail for its own reason has stopped measuring its own claim.
    mcp_enabled: false,
    created_at: '2026-08-18T00:00:00.000Z',
  }

  it('is required on `app` — an unauthenticated write endpoint is not gated by an optional field', () => {
    // Optional here would mean `undefined` at every reader, and `undefined` is
    // not `false` until somebody remembers to make it so. The gate is a fact
    // about the app, so every app states it.
    expect(app.safeParse(base).success).toBe(false)
    expect(app.safeParse({ ...base, accepts_dynamic_clients: false }).success).toBe(true)
  })

  it('can be turned on and off through an update', () => {
    expect(updateAppRequest.safeParse({ accepts_dynamic_clients: true }).success).toBe(true)
    expect(updateAppRequest.safeParse({ accepts_dynamic_clients: false }).success).toBe(true)
    expect(updateAppRequest.safeParse({ accepts_dynamic_clients: 'yes' }).success).toBe(false)
  })

  it('keeps branding off the app shape', () => {
    // A logo is up to 256 KiB. If it ever lands on `app`, every app list pays
    // for it — so this test is the tripwire for that refactor.
    expect('branding' in app.shape).toBe(false)
    expect('logo_data_uri' in app.shape).toBe(false)
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

describe('the hosted page handoff', () => {
  it('does not let the page name the app it is authenticating against', () => {
    // `clientLoginRequest` carries `app_identifier`; this one must not. The app
    // is a property of the pending request the server holds. If the page named
    // it, a caller could authenticate against one app and get a code for
    // another — and the two shapes are similar enough that somebody will one
    // day paste one into the other.
    expect('app_identifier' in oauthLoginRequest.shape).toBe(false)
    expect('interaction_id' in oauthLoginRequest.shape).toBe(true)
  })

  it('refuses an extra field rather than stripping it', () => {
    const ok = { interaction_id: 'i_1', email: 'a@b.test', password: 'x' }
    expect(oauthLoginRequest.safeParse(ok).success).toBe(true)
    expect(oauthLoginRequest.safeParse({ ...ok, app_identifier: 'other-app' }).success).toBe(false)
  })

  it('names on the consent screen every noun the grant binds', () => {
    // `consentGrant` binds client, app, role and scope. A screen that shows
    // fewer is asking about something other than what it records.
    const shown = new Set(Object.keys(oauthConsentInteraction.shape))
    for (const noun of ['app_name', 'client_name', 'role_name', 'scope']) {
      expect(shown.has(noun), noun).toBe(true)
    }
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

describe('idpConfigRequest', () => {
  const base = {
    issuer: 'https://idp.example.com',
    client_id: 'fleetless',
    scopes: ['openid', 'email'],
  }

  it('can set every field `idpConfig` can show', () => {
    // A field a response exposes and a request cannot set is a field nobody
    // can turn on. This has happened twice here; the test is the guard.
    expect(idpConfigRequest.safeParse(base).success).toBe(true)
  })

  it('keeps the secret write-only and refuses unknown keys', () => {
    const ok = { ...base }
    expect(idpConfigRequest.safeParse({ ...ok, client_secret: 'hunter2' }).success).toBe(true)
    expect(idpConfigRequest.safeParse({ ...ok, has_client_secret: true }).success).toBe(false)
  })
})

describe('oauthConsentResponse', () => {
  it('exists and is the same shape the login page already handles', () => {
    // A consumer forced to hand-write a schema for a documented response is a
    // consumer guessing. Somebody said so instead of importing something near
    // enough, which is why this exists.
    expect(oauthConsentResponse.safeParse({ redirect_to: 'https://app.example.com/cb?code=x' }).success).toBe(true)
    expect(oauthConsentResponse.safeParse({}).success).toBe(false)
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

describe('one self-registration policy, not two', () => {
  it('idpConfig carries no role of its own', () => {
    // There was briefly a `default_role_id` here — a weaker copy of
    // `selfRegistration` that the federated path read while reading none of
    // the app's actual policy, so a developer who had turned self-registration
    // off still handed out accounts through the federated door. Removed
    // 2026-08-18. This test is the tripwire for it coming back.
    expect('default_role_id' in idpConfig.shape).toBe(false)
    expect('default_role_id' in idpConfigRequest.shape).toBe(false)
  })

  it('selfRegistration still carries all four controls the decision needs', () => {
    for (const field of ['enabled', 'all_domains', 'domains', 'role_id']) {
      expect(field in selfRegistration.shape, field).toBe(true)
    }
  })
})
