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
