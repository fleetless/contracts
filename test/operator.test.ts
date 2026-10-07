// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  OPERATOR_ROLES, CONFIRMATION_LEVELS, operatorAssertionClaims, OPERATOR_ASSERTION_ISSUER,
  noopCommandRequest, noopCommandResponse, previewStaleDetails, ERROR_CODES,
  adminSearchHit, adminOrgDetail, PLANS,
  ADMIN_SEARCH_KINDS, adminOrgBillingState, billingAccountStatus,
} from '../src/index.js'

const valid = { iss: OPERATOR_ASSERTION_ISSUER, aud: 'fleetless-cloud-admin', sub: 'ak-123', name: 'Test Operator', email: 'op@example.com', roles: ['operator-admin'], iat: 1_800_000_000, exp: 1_800_000_060, jti: 'a'.repeat(16) }

describe('operator vocabulary (fleetless/fleetless#268)', () => {
  it('names exactly three roles and three confirmation levels', () => {
    expect([...OPERATOR_ROLES]).toEqual(['operator-admin', 'operator-finance', 'operator-support'])
    expect([...CONFIRMATION_LEVELS]).toEqual(['click', 'second_click', 'type_to_confirm'])
  })
  it('accepts a well-formed assertion claim set', () => {
    expect(operatorAssertionClaims.parse(valid)).toEqual(valid)
  })
  it.each([
    ['an unknown role', { roles: ['operator-root'] }],
    ['another issuer', { iss: 'someone-else' }],
    ['a short jti', { jti: 'short' }],
    ['no email', { email: 'not-an-address' }],
    ['an empty audience', { aud: '' }],
  ])('refuses %s', (_label, patch) => {
    expect(operatorAssertionClaims.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})

const ORG = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'
const KEY = '0b9c7e3e-6c1a-4a8e-9a4f-2d8f1f3c5b7a'

describe('the command protocol (fleetless/fleetless#268)', () => {
  it('takes a preview', () => {
    expect(noopCommandRequest.parse({ mode: 'preview', input: { org_id: ORG } })).toEqual({ mode: 'preview', input: { org_id: ORG } })
  })
  it('takes an execute with reason, preview token and idempotency key', () => {
    const body = { mode: 'execute', input: { org_id: ORG }, reason: 'Checking the command path', preview_token: '1.abc', idempotency_key: KEY }
    expect(noopCommandRequest.parse(body)).toEqual(body)
  })
  it.each([
    ['a short reason', { reason: 'too short' }],
    ['a reason that is only long because of spaces', { reason: '   short    ' }],
    ['no idempotency key', { idempotency_key: undefined }],
    ['a non-uuid idempotency key', { idempotency_key: 'retry-1' }],
    ['no preview token', { preview_token: undefined }],
  ])('refuses an execute with %s', (_l, patch) => {
    const body = { mode: 'execute', input: { org_id: ORG }, reason: 'Checking the command path', preview_token: '1.abc', idempotency_key: KEY, ...patch }
    expect(noopCommandRequest.safeParse(body).success).toBe(false)
  })
  it('answers a preview or a result with audit references', () => {
    expect(noopCommandResponse.safeParse({ preview: { effects: [{ kind: 'keeps', label: 'Nothing changes.' }] }, preview_token: '1.abc' }).success).toBe(true)
    expect(noopCommandResponse.safeParse({ result: { changed: false }, audit_ref: { operator_audit: KEY, org_audit: null } }).success).toBe(true)
    expect(noopCommandResponse.safeParse({ preview: { effects: [] }, preview_token: '1.abc' }).success).toBe(false)
  })
  it('carries a fresh preview on 409 preview_stale', () => {
    expect(previewStaleDetails.safeParse({ preview: { effects: [{ kind: 'keeps', label: 'x' }] }, preview_token: '2.def' }).success).toBe(true)
  })
  it('knows the two new error codes', () => {
    expect(ERROR_CODES).toContain('preview_stale')
    expect(ERROR_CODES).toContain('idempotency_key_reused')
  })
})

describe('the read schemas (fleetless/fleetless#268)', () => {
  it('answers exactly the kinds ADMIN_SEARCH_KINDS names', () => {
    expect(adminSearchHit.options.map((o) => o.shape.kind.value)).toEqual([...ADMIN_SEARCH_KINDS])
  })
  it("mirrors the billing account's statuses, with `none` for an org that has no account", () => {
    expect(adminOrgBillingState.options).toEqual(['none', ...billingAccountStatus.options])
  })
  it('refuses a person hit without an org_id', () => {
    expect(adminSearchHit.safeParse({ kind: 'person', user_id: ORG, email: 'a@example.com', display_name: null, org_name: 'Acme' }).success).toBe(false)
  })
  it("refuses a payment hit with matched: 'other'", () => {
    expect(adminSearchHit.safeParse({ kind: 'payment', payment_id: null, mollie_id: 'tr_123', matched: 'other', org_id: ORG, org_name: 'Acme' }).success).toBe(false)
  })
  const plan = {
    plan: 'basic' as const,
    currency: 'eur' as const,
    period_ends_at: '2026-10-01T00:00:00.000Z',
    addons: { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 },
    limits: PLANS.basic.limits,
    features: PLANS.basic.features,
    usage: { seats: 1, robots: 0, apps: 0, app_users: 0, live_video_ms_this_month: 0, asset_bytes: 0 },
    pending_change: null,
    lock: null,
    switch: null,
  }
  it('refuses an org detail with negative counts', () => {
    const detail = {
      id: ORG, name: 'Acme', created_at: '2026-10-01T00:00:00.000Z', owner: null,
      plan,
      billing: { state: 'none', next_charge_at: null },
      counts: { members: -1, robots: 0, robots_online: 0, apps: 0 },
      last_activity_at: null,
    }
    expect(adminOrgDetail.safeParse(detail).success).toBe(false)
  })
  it('parses a valid org detail', () => {
    const detail = {
      id: ORG, name: 'Acme', created_at: '2026-10-01T00:00:00.000Z', owner: null,
      plan,
      billing: { state: 'none', next_charge_at: null },
      counts: { members: 1, robots: 0, robots_online: 0, apps: 0 },
      last_activity_at: null,
    }
    expect(adminOrgDetail.safeParse(detail).success).toBe(true)
  })
})
