/**
 * The oidc-federation shapes (spec `2026-08-29-org-identity-redesign`, D3/D4):
 * a per-**group** OIDC provider, the federated callback error page, and the
 * impersonation interstitial's choice.
 *
 * These are behavioural pins, not a restatement of the schema. Each one names
 * the wrong outcome it exists to stop: a client secret coming back out of a
 * response, an impersonation body that says both "as a role" and "as a user"
 * at once, an issuer URL that decides where the server connects, an unbounded
 * grant list on a shape that gets stored and rendered.
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import * as identity from '../src/identity.js'
import {
  groupOidcProvider,
  putGroupOidcProviderRequest,
  jitGrant,
  oidcCallbackError,
  oidcCallbackErrorCode,
  impersonationChoice,
  clientIdentity,
} from '../src/index.js'
import { ERROR_CODES } from '../src/errors.js'

const UUID = '00000000-0000-4000-8000-000000000000'
const UUID2 = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-08-29T12:00:00.000Z'

describe('the group OIDC provider never returns a secret', () => {
  const valid = {
    group_id: UUID,
    issuer: 'https://idp.example.com/realms/acme',
    client_id: 'fleetless',
    scopes: ['openid', 'email'],
    jit_enabled: true,
    jit_grants: [{ app_id: UUID, role_id: UUID2 }],
    created_at: NOW,
  }

  it('accepts a well-formed provider', () => {
    expect(groupOidcProvider.safeParse(valid).success).toBe(true)
  })

  it('has no client_secret in the response shape at all', () => {
    // The whole point: a secret a response can carry is a secret in every log
    // that ever captured a response. `groupOidcProvider` is `.strict()`, so a
    // `client_secret` key is a REFUSAL rather than a silently dropped field —
    // which is the failure mode this project has already paid for once
    // (`toHaveBeenCalledWith` could not tell *field sent* from *field missing*).
    const withSecret = groupOidcProvider.safeParse({ ...valid, client_secret: 'super-secret-value-123' })
    expect(withSecret.success).toBe(false)
    // And even a valid parse never surfaces one.
    const parsed = groupOidcProvider.safeParse(valid)
    expect(parsed.success && 'client_secret' in parsed.data).toBe(false)
  })

  it('refuses an issuer that is not an http(s) URL — the idpIssuer precedent', () => {
    // Same guard as `idpIssuer` (and it IS `idpIssuer`): http(s) only, no
    // credentials, no query, no fragment. The residual it CANNOT decide —
    // loopback dev IdP vs loopback postgres — is named on `idpIssuer` and the
    // real SSRF defence lives at the fetch in the cloud, not here.
    expect(groupOidcProvider.safeParse({ ...valid, issuer: 'file:///etc/passwd' }).success).toBe(false)
    expect(groupOidcProvider.safeParse({ ...valid, issuer: 'https://user:pw@idp.example.com' }).success).toBe(false)
    expect(groupOidcProvider.safeParse({ ...valid, issuer: 'https://idp.example.com/?next=x' }).success).toBe(false)
  })

  it('bounds the JIT grant list rather than accepting any length', () => {
    // An unbounded array on a shape that is stored, logged and rendered is a
    // size nobody chose — the same reasoning as `scopes.max(20)` and
    // `userInvite.accept_url.max(500)`.
    const tooMany = Array.from({ length: 200 }, () => ({ app_id: UUID, role_id: UUID2 }))
    expect(groupOidcProvider.safeParse({ ...valid, jit_grants: tooMany }).success).toBe(false)
  })

  it('an empty grant list is legal — a provider without JIT still parses', () => {
    expect(groupOidcProvider.safeParse({ ...valid, jit_enabled: false, jit_grants: [] }).success).toBe(true)
  })

  it('does not special-case the Org Admins group — the ban is the cloud’s (D3)', () => {
    // The spec forbids a provider on the Org Admins group, but the schema sees
    // a uuid, not whether that group is the admin one. This asserts the shape
    // does NOT try to encode that ban (any uuid group_id parses); the refusal
    // lands cloud-side, and `target_state_conflict` is where it lands.
    expect(groupOidcProvider.safeParse({ ...valid, group_id: UUID2 }).success).toBe(true)
    expect(ERROR_CODES).toContain('target_state_conflict')
  })
})

describe('a jit grant is a strict (app, role) pair', () => {
  it('accepts an app/role pair', () => {
    expect(jitGrant.safeParse({ app_id: UUID, role_id: UUID2 }).success).toBe(true)
  })
  it('refuses a stray key', () => {
    expect(jitGrant.safeParse({ app_id: UUID, role_id: UUID2, extra: 1 }).success).toBe(false)
  })
})

describe('the provider write request is the only place a secret appears', () => {
  const valid = {
    issuer: 'https://idp.example.com/realms/acme',
    client_id: 'fleetless',
    client_secret: 'a-sufficiently-long-secret',
    scopes: ['openid'],
    jit_enabled: false,
    jit_grants: [],
  }

  it('accepts a full write with a secret', () => {
    expect(putGroupOidcProviderRequest.safeParse(valid).success).toBe(true)
  })

  it('is strict — it carries no group_id (that is in the path)', () => {
    expect(putGroupOidcProviderRequest.safeParse({ ...valid, group_id: UUID }).success).toBe(false)
  })

  it('the secret is optional but has a minimum length when present', () => {
    // Absent means "keep the stored secret" (rotate-only-when-present), the
    // `idpConfigRequest` precedent. Present-but-trivial is refused: a one-char
    // client secret is a misconfiguration, not a rotation.
    const { client_secret, ...noSecret } = valid
    void client_secret
    expect(putGroupOidcProviderRequest.safeParse(noSecret).success).toBe(true)
    expect(putGroupOidcProviderRequest.safeParse({ ...valid, client_secret: 'x' }).success).toBe(false)
  })

  it('carries the same issuer guard as the response', () => {
    expect(putGroupOidcProviderRequest.safeParse({ ...valid, issuer: 'http://169.254.169.254/latest/meta-data' }).success).toBe(
      // loopback/link-local is NOT decided here — this one is http, no creds,
      // no query/fragment, so the schema lets it through and the cloud's fetch
      // guard is what refuses it. Asserted so nobody mistakes this for the SSRF
      // defence.
      true,
    )
    expect(putGroupOidcProviderRequest.safeParse({ ...valid, issuer: 'file:///etc/passwd' }).success).toBe(false)
  })
})

describe('the callback error page contract', () => {
  it('enumerates exactly the six documented codes', () => {
    expect([...oidcCallbackErrorCode.options].sort()).toEqual(
      ['claims_incomplete', 'exchange_failed', 'email_collision', 'idp_unreachable', 'jit_disabled', 'provider_misconfigured'].sort(),
    )
  })

  it('accepts a code with safe user text', () => {
    expect(oidcCallbackError.safeParse({ code: 'jit_disabled', message: 'No access — contact your administrator.' }).success).toBe(
      true,
    )
  })

  it('refuses an unknown code', () => {
    expect(oidcCallbackError.safeParse({ code: 'fleetless_fallback', message: 'x' }).success).toBe(false)
  })

  it('requires a message — an error page with no words is not an error page', () => {
    expect(oidcCallbackError.safeParse({ code: 'idp_unreachable', message: '' }).success).toBe(false)
  })
})

describe('the impersonation choice is a strict discriminated union', () => {
  it('accepts sign-in as a role', () => {
    expect(impersonationChoice.safeParse({ mode: 'role', role_id: UUID }).success).toBe(true)
  })

  it('accepts sign-in as a specific user', () => {
    expect(impersonationChoice.safeParse({ mode: 'user', user_id: UUID }).success).toBe(true)
  })

  it('refuses an unknown mode', () => {
    expect(impersonationChoice.safeParse({ mode: 'nobody', role_id: UUID }).success).toBe(false)
  })

  it('refuses the role branch carrying a user_id, and vice versa', () => {
    // Strict branches: "as a role" must not also smuggle a user, or the
    // interstitial's two choices become one ambiguous body the handler has to
    // disambiguate.
    expect(impersonationChoice.safeParse({ mode: 'role', role_id: UUID, user_id: UUID2 }).success).toBe(false)
    expect(impersonationChoice.safeParse({ mode: 'user', user_id: UUID, role_id: UUID2 }).success).toBe(false)
  })

  it('refuses the wrong id for the branch', () => {
    expect(impersonationChoice.safeParse({ mode: 'role', user_id: UUID }).success).toBe(false)
    expect(impersonationChoice.safeParse({ mode: 'user', role_id: UUID }).success).toBe(false)
  })
})

describe('the identity shape documents the act (real admin) claim', () => {
  const base = {
    kind: 'end_user' as const,
    developer_id: null,
    end_user_id: UUID,
    server_key_id: null,
    app_id: UUID2,
    role_id: UUID2,
    email: 'user@example.com',
  }

  it('an ordinary session omits act entirely', () => {
    const parsed = clientIdentity.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'act' in parsed.data).toBe(false)
  })

  it('an impersonated session carries the real admin id', () => {
    const parsed = clientIdentity.safeParse({ ...base, act: { admin_user_id: UUID } })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.act?.admin_user_id).toBe(UUID)
  })

  it('act, when present, is a real uuid — not a free string', () => {
    expect(clientIdentity.safeParse({ ...base, act: { admin_user_id: 'A' } }).success).toBe(false)
  })
})

describe('the new shapes are exported from the barrel', () => {
  it('re-exports every new value', () => {
    for (const name of [
      'groupOidcProvider',
      'putGroupOidcProviderRequest',
      'jitGrant',
      'oidcCallbackError',
      'oidcCallbackErrorCode',
      'impersonationChoice',
    ]) {
      expect(name in barrel).toBe(true)
      expect(name in identity).toBe(true)
    }
  })
})
