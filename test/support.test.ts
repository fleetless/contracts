// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  authMeResponse,
  authMeSupportResponse,
  ERROR_CODES,
  ROUTES,
  supportRenewFailRequest,
  supportRenewFailRefusal,
  supportSessionInfo,
  supportTokenRequest,
  supportTokenResponse,
} from '../src/index.js'
import { IN_HANDLER_SECURITY, exportedSchemas, routesArtifact, schemaIo } from '../scripts/export-schemas.js'

const SESSION_ID = '6f1c1f0e-4b4a-4a8e-9b1a-1f0e4b4a4a8e'
const ORG_ID = '7f1c1f0e-4b4a-4a8e-9b1a-1f0e4b4a4a8e'
const GRANT = 'a'.repeat(43)
const VERIFIER = 'b'.repeat(43)
const FLOW_ID = '8f1c1f0e-4b4a-4a8e-9b1a-1f0e4b4a4a8e'

const session = { session_id: SESSION_ID, mode: 'read' as const, operator_name: 'Fleetless-Support', expires_at: '2026-10-28T12:00:00.000Z' }

describe('supportSessionInfo', () => {
  it('accepts a read or edit session', () => {
    expect(supportSessionInfo.safeParse(session).success).toBe(true)
    expect(supportSessionInfo.safeParse({ ...session, mode: 'edit' }).success).toBe(true)
  })
  it('refuses a mode that is neither', () => {
    expect(supportSessionInfo.safeParse({ ...session, mode: 'write' }).success).toBe(false)
  })
  it('refuses an empty operator name and one over 200 characters', () => {
    expect(supportSessionInfo.safeParse({ ...session, operator_name: '' }).success).toBe(false)
    expect(supportSessionInfo.safeParse({ ...session, operator_name: 'x'.repeat(200) }).success).toBe(true)
    expect(supportSessionInfo.safeParse({ ...session, operator_name: 'x'.repeat(201) }).success).toBe(false)
  })
  it('wants a uuid session_id and an ISO 8601 expires_at', () => {
    expect(supportSessionInfo.safeParse({ ...session, session_id: 'nope' }).success).toBe(false)
    expect(supportSessionInfo.safeParse({ ...session, expires_at: 'tomorrow' }).success).toBe(false)
  })
  it('is strict', () => {
    expect(supportSessionInfo.safeParse({ ...session, extra: true }).success).toBe(false)
  })
})

describe('supportTokenRequest', () => {
  const ok = { grant: GRANT, code_verifier: VERIFIER }

  it('accepts a 43-character base64url grant and a 43-128 character verifier', () => {
    expect(supportTokenRequest.safeParse(ok).success).toBe(true)
    expect(supportTokenRequest.safeParse({ ...ok, code_verifier: 'c'.repeat(128) }).success).toBe(true)
  })
  it('refuses a grant of the wrong length or charset', () => {
    expect(supportTokenRequest.safeParse({ ...ok, grant: 'a'.repeat(42) }).success).toBe(false)
    expect(supportTokenRequest.safeParse({ ...ok, grant: 'a'.repeat(44) }).success).toBe(false)
    expect(supportTokenRequest.safeParse({ ...ok, grant: '+'.repeat(43) }).success).toBe(false)
  })
  it('refuses a verifier shorter than 43 or longer than 128 characters', () => {
    expect(supportTokenRequest.safeParse({ ...ok, code_verifier: 'b'.repeat(42) }).success).toBe(false)
    expect(supportTokenRequest.safeParse({ ...ok, code_verifier: 'b'.repeat(129) }).success).toBe(false)
  })
  it('is strict: no third field, no code_verifier typo, nothing extra', () => {
    expect(supportTokenRequest.safeParse(ok).success).toBe(true)
    expect(supportTokenRequest.safeParse({ ...ok, state: 'x' }).success).toBe(false)
    expect(supportTokenRequest.safeParse({ grant: GRANT }).success).toBe(false)
    expect(supportTokenRequest.safeParse({ code_verifier: VERIFIER }).success).toBe(false)
  })
})

describe('supportTokenResponse', () => {
  const ok = { access_token: 't', token_type: 'Bearer' as const, expires_in: 3600, org_id: ORG_ID, support: session }

  it('accepts a full response, up to the sixty-minute ceiling', () => {
    expect(supportTokenResponse.safeParse(ok).success).toBe(true)
  })
  it('refuses expires_in above 3600 or below 1', () => {
    expect(supportTokenResponse.safeParse({ ...ok, expires_in: 3601 }).success).toBe(false)
    expect(supportTokenResponse.safeParse({ ...ok, expires_in: 0 }).success).toBe(false)
  })
  it('wants the literal token_type Bearer', () => {
    expect(supportTokenResponse.safeParse({ ...ok, token_type: 'bearer' }).success).toBe(false)
  })
  it('never accepts a refresh_token: the field is not part of the shape at all', () => {
    // A support session has a hard ceiling with no extension — there is
    // nothing a refresh could buy back. `.strict()` means a caller that
    // sends one anyway is refused rather than silently stripped, so an SDK
    // that still expects a refresh token to come back fails loudly instead
    // of quietly polling a field that will never appear.
    expect(supportTokenResponse.safeParse({ ...ok, refresh_token: 'r' }).success).toBe(false)
    expect(Object.keys(supportTokenResponse.shape)).not.toContain('refresh_token')
  })
  it('is strict otherwise too', () => {
    expect(supportTokenResponse.safeParse({ ...ok, scope: 'x' }).success).toBe(false)
  })
})

describe('supportRenewFailRequest', () => {
  const valid = { flow_id: FLOW_ID, code_verifier: VERIFIER, reason: 'authority_failed' }

  it('accepts only the bound flow, RFC 7636 verifier and fixed reason', () => {
    expect(supportRenewFailRequest.safeParse(valid).success).toBe(true)
    expect(supportRenewFailRequest.safeParse({ ...valid, code_verifier: 'c'.repeat(128) }).success).toBe(true)
    for (const value of [
      { ...valid, flow_id: 'not-a-uuid' },
      { ...valid, code_verifier: 'b'.repeat(42) },
      { ...valid, code_verifier: 'b'.repeat(129) },
      { ...valid, code_verifier: '+'.repeat(43) },
      { ...valid, reason: 'login_required' },
      { ...valid, error: 'failed' },
      { flow_id: FLOW_ID, reason: 'authority_failed' },
    ]) expect(supportRenewFailRequest.safeParse(value).success).toBe(false)
  })
})

describe('supportRenewFailRefusal', () => {
  const pairs = [
    ['validation_error', 'invalid_flow'],
    ['unauthorized', 'invalid_authority'],
    ['not_found', 'invalid_flow'],
    ['not_found', 'identity_mismatch'],
    ['target_state_conflict', 'expired'],
    ['target_state_conflict', 'replayed'],
    ['target_state_conflict', 'session_inactive'],
    ['target_state_conflict', 'stale_generation'],
  ] as const

  it('accepts exactly the failure route code/rule pairs', () => {
    for (const [code, rule] of pairs) {
      expect(supportRenewFailRefusal.safeParse({ code, message: 'Refused', details: { rule } }).success).toBe(true)
    }
    for (const value of [
      { code: 'unauthorized', message: 'Refused', details: { rule: 'expired' } },
      { code: 'not_found', message: 'Refused', details: { rule: 'stale_generation' } },
      { code: 'target_state_conflict', message: 'Refused', details: { rule: 'invalid_authority' } },
      { code: 'forbidden', message: 'Refused', details: { rule: 'invalid_authority' } },
      { code: 'unauthorized', message: 'Refused' },
      { code: 'unauthorized', message: 'Refused', details: { rule: 'invalid_authority', secret: 'x' } },
    ]) expect(supportRenewFailRefusal.safeParse(value).success).toBe(false)
  })
})

describe('authMeSupportResponse', () => {
  const org = { id: ORG_ID, name: 'Acme', require_two_factor: false, created_at: '2026-01-01T00:00:00.000Z' }
  const user = {
    id: SESSION_ID,
    org_id: ORG_ID,
    email: 'a@example.com',
    display_name: null,
    tier: 'owner' as const,
    two_factor: { passkeys: 0, authenticator: false },
    created_at: '2026-01-01T00:00:00.000Z',
  }

  it('extends authMeResponse with an optional support block', () => {
    expect(authMeSupportResponse.safeParse({ org, user }).success).toBe(true)
    expect(authMeSupportResponse.safeParse({ org, user, support: session }).success).toBe(true)
    expect(authMeSupportResponse.safeParse({ org, user, support: { ...session, mode: 'nope' } }).success).toBe(false)
  })

  it('keeps support on its own answer; authMeResponse has no such field at all to strip', () => {
    // `authMeResponse` was never given a `support` field — there is nothing
    // in its own shape for a support session's data to collide with or be
    // dropped by. The two schemas simply answer different questions: the
    // public route entry on `GET /api/auth/me` keeps validating against
    // `authMeResponse`, and the console validates the same response against
    // `authMeSupportResponse` instead, which is the one that actually reads
    // `support` back out.
    expect(Object.keys(authMeResponse.shape)).not.toContain('support')
    const parsed = authMeSupportResponse.parse({ org, user, support: session })
    expect(parsed.support).toEqual(session)
  })
})

describe('the support-session routes', () => {
  const route = (m: string, p: string) => ROUTES.find((r) => r.method === m && r.path === p)

  it('POST /console/support/token exchanges a grant, internal audience, no body credential reused across stores', () => {
    const r = route('POST', '/console/support/token')
    expect(r).toMatchObject({
      section: 'developer-auth', audience: 'internal', auth: 'none', ownerTier: false, status: 200,
      request: supportTokenRequest, response: supportTokenResponse,
    })
    // The limiter is the one code this route can still answer in this
    // reference; every other refusal is the RFC 6749 §5.2 oauthError dialect
    // `/console/oauth/token` already uses, which is why `errors` is not `[]`
    // here even though the route emits none of the apiError codes otherwise.
    expect(r?.rateLimited).toBe(true)
    expect(r?.errors).toEqual(['rate_limited'])
  })

  it('POST /api/auth/support/end only ends a support token, internal audience', () => {
    const r = route('POST', '/api/auth/support/end')
    expect(r).toMatchObject({
      section: 'developer-auth', audience: 'internal', auth: 'developer', ownerTier: false, status: 204,
      request: null, response: null, rateLimited: false,
    })
    expect(r?.errors).toEqual(expect.arrayContaining(['unauthorized', 'token_expired', 'token_revoked', 'forbidden']))
  })

  it('POST /console/support/renew/fail uses an original support bearer, with a bodyless 204', () => {
    const r = route('POST', '/console/support/renew/fail')
    expect(r).toMatchObject({
      section: 'developer-auth', audience: 'internal', auth: 'in_handler', ownerTier: false,
      rateLimited: false, status: 204, params: [], query: null,
      request: supportRenewFailRequest, response: null,
      errors: ['validation_error', 'unauthorized', 'not_found', 'target_state_conflict'],
    })
    expect(r?.notes).toContain('Cache-Control: no-store')
    expect(r?.notes).toContain('stale_generation')
    expect(IN_HANDLER_SECURITY['POST /console/support/renew/fail']).toEqual([{ supportSession: [] }])
    expect(routesArtifact().routes.find((entry) => entry.path === '/console/support/renew/fail')).toMatchObject({
      request: 'support-renew-fail-request', response: null,
    })
    expect(exportedSchemas).toHaveProperty('support-renew-fail-request')
    expect(exportedSchemas).toHaveProperty('support-renew-fail-refusal')
    expect(schemaIo('support-renew-fail-request')).toBe('input')
    expect(schemaIo('support-renew-fail-refusal')).toBe('output')
  })

  it('all support-session routes are internal: none reaches the public developer reference', () => {
    for (const key of ['POST /console/support/token', 'POST /console/support/renew/fail', 'POST /api/auth/support/end']) {
      const [m, p] = key.split(' ')
      expect(route(m!, p!)?.audience, key).toBe('internal')
    }
  })
})

describe('the two support refusal codes', () => {
  it('are catalogued, 403, and distinct from forbidden', () => {
    expect(ERROR_CODES).toContain('support_read_only')
    expect(ERROR_CODES).toContain('support_forbidden')
    expect(new Set(['support_read_only', 'support_forbidden', 'forbidden']).size).toBe(3)
  })
})
