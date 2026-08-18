import { describe, expect, it } from 'vitest'
import {
  app,
  brandingConfig,
  codeChallengeMethod,
  dynamicClientRegistrationRequest,
  ERROR_CODES,
  idpConfig,
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
 * W7b — the hosted authorization server.
 *
 * Every test here names a thing that would otherwise be believed without
 * evidence. The wave's own rule: name what would make the check fail, and go
 * make it fail once.
 */

describe('redirectUri', () => {
  it('accepts https and explicit loopback http', () => {
    for (const ok of [
      'https://app.example.com/cb',
      'https://app.example.com/cb?x=1',
      'http://localhost:3000/cb',
      'http://127.0.0.1:8080/cb',
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
      link_verified_emails: true,
      default_role_id: null,
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
    expect(parsed.scope).toBe('read')
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
    // shape W7a paid for with `failed` as a flat string[].
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

describe('idpConfig.default_role_id', () => {
  const base = {
    app_id: '00000000-0000-4000-8000-000000000002',
    issuer: 'https://idp.example.com',
    client_id: 'fleetless',
    scopes: ['openid', 'email'],
    claims: { subject_claim: 'sub', email_claim: 'email' },
    link_verified_emails: false,
    has_client_secret: false,
    updated_at: '2026-08-18T00:00:00.000Z',
  }

  it('must be stated, and `null` is a real answer rather than an absent one', () => {
    // Omitting it would make "federation does not provision" indistinguishable
    // from "nobody decided yet", and this one governs who gets an account.
    expect(idpConfig.safeParse(base).success).toBe(false)
    expect(idpConfig.safeParse({ ...base, default_role_id: null }).success).toBe(true)
    expect(idpConfig.safeParse({ ...base, default_role_id: '00000000-0000-4000-8000-000000000009' }).success).toBe(true)
  })

  it('is independent of link_verified_emails — neither implies the other', () => {
    // One governs an email already known, the other an email that is not.
    for (const link of [true, false]) {
      for (const role of [null, '00000000-0000-4000-8000-000000000009']) {
        expect(idpConfig.safeParse({ ...base, link_verified_emails: link, default_role_id: role }).success).toBe(true)
      }
    }
  })
})

describe('idpConfigRequest', () => {
  const base = {
    issuer: 'https://idp.example.com',
    client_id: 'fleetless',
    scopes: ['openid', 'email'],
    link_verified_emails: false,
  }

  it('can set every field `idpConfig` can show', () => {
    // A field a response exposes and a request cannot set is a field nobody
    // can turn on. This happened twice in one wave; the test is the guard.
    expect(idpConfigRequest.safeParse(base).success).toBe(false)
    expect(idpConfigRequest.safeParse({ ...base, default_role_id: null }).success).toBe(true)
  })

  it('keeps the secret write-only and refuses unknown keys', () => {
    const ok = { ...base, default_role_id: null }
    expect(idpConfigRequest.safeParse({ ...ok, client_secret: 'hunter2' }).success).toBe(true)
    expect(idpConfigRequest.safeParse({ ...ok, has_client_secret: true }).success).toBe(false)
  })
})

describe('oauthConsentResponse', () => {
  it('exists and is the same shape the login page already handles', () => {
    // A consumer forced to hand-write a schema for a documented response is a
    // consumer guessing. Eve-W7b said so instead of importing something near
    // enough, which is why this exists.
    expect(oauthConsentResponse.safeParse({ redirect_to: 'https://app.example.com/cb?code=x' }).success).toBe(true)
    expect(oauthConsentResponse.safeParse({}).success).toBe(false)
  })
})
