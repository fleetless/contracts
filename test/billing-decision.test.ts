// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { billingDecisionDisplayRequest, billingDecisionDisplayResponse, planChangePrepareResponse } from '../src/billing.js'

const key = '0c15bc92-c26c-4a56-aac8-0046ff758391'
const id = '039172ce-712c-4ec8-897c-15492a7eeb76'
const proof = 'x'.repeat(43)
const terms = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/terms/v1.0/' }
const dpa = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/dpa/v1.0/' }

const snapshot = {
  snapshot_id: id,
  decision_kind: 'plan_change',
  decision_id: '88791f9a-fae3-4f4b-87c0-b204e45d6a90',
  operation_key: key,
  owner_id: 'fa87ac72-a398-4b55-b343-993d4b297a29',
  organization_id: '0d5c9e93-bfce-4d2f-90dc-31eb82c02c94',
  organization_name: 'Acme Robotics',
  quote_revision: 'quote-2',
  buyer_fingerprint: 'buyer-2',
  selection: {
    plan: 'plus', cycle: 'monthly',
    addons: { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 },
    keep: null,
  },
  amounts: {
    currency: 'eur', quote: { currency: 'eur', net_cents: 0, vat_cents: 0, gross_cents: 0, rate_percent: 19 },
    plan_net_cents: 2900, addon_lines: [], period_net_cents: 2900, period_vat_cents: 551,
    period_gross_cents: 3451, vat_treatment: 'de_standard',
    vat_treatment_line: '19% German VAT: €5.51; total €34.51 per month',
    due_today_gross_cents: 0, prorated_net_cents: null, renewal_net_cents: 2900,
  },
  period: {
    display_time_zone: 'Europe/Berlin', starts_on: '2026-10-01', starts_at: '2026-09-30T22:00:00Z',
    current_period_ends_at: '2026-10-25T01:30:00Z', renews_at: '2026-10-25T01:30:00Z',
    effective: { mode: 'scheduled', at: '2026-10-25T01:30:00Z', at_period_end: true },
  },
  declaration: {
    text_id: 'DR-1374-draft-3-C.4',
    text: 'By selecting “Order and pay”, you agree to the Terms of Service and the Data Processing Agreement for Acme Robotics.',
    terms, dpa,
  },
  expires_at: '2026-10-25T01:20:00Z',
}
const display = { confirmation_proof: proof, expires_at: snapshot.expires_at, snapshot }

describe('C.4 billing decision display', () => {
  it('accepts a Basic-route plan change and both purchase-intent kinds', () => {
    expect(billingDecisionDisplayResponse.safeParse(display).success).toBe(true)
    expect(planChangePrepareResponse.safeParse({ change_id: snapshot.decision_id, display }).success).toBe(true)
    for (const decision_kind of ['checkout', 'paid_change']) {
      const { keep: _keep, ...selection } = snapshot.selection
      expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, decision_kind, selection } }).success).toBe(true)
    }
    expect(billingDecisionDisplayRequest.parse({ operation_key: key, operation: 'checkout' })).toEqual({ operation_key: key, operation: 'checkout' })
  })

  it('rejects a missing proof, malformed proof and client-invented request fields', () => {
    expect(billingDecisionDisplayResponse.safeParse({ ...display, confirmation_proof: undefined }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, confirmation_proof: 'bad' }).success).toBe(false)
    expect(billingDecisionDisplayRequest.safeParse({ operation_key: key, operation: 'checkout', text_id: 'client' }).success).toBe(false)
  })

  it('rejects blank quote and buyer revisions before issuing a proof', () => {
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, quote_revision: '   ' } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, buyer_fingerprint: '   ' } }).success).toBe(false)
  })

  it('enforces keep only on plan-change displays and distinct immutable legal links', () => {
    const { keep: _keep, ...selection } = snapshot.selection
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, selection } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, decision_kind: 'checkout' } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, declaration: { ...snapshot.declaration, dpa: undefined } } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, declaration: { ...snapshot.declaration, dpa: terms } } }).success).toBe(false)
  })

  it('binds VAT treatment to the quote rate and zero-VAT cases', () => {
    const amounts = snapshot.amounts
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, amounts: { ...amounts, vat_treatment: 'reverse_charge' } } }).success).toBe(false)
    const zero = { ...amounts, quote: { ...amounts.quote, rate_percent: 0 }, period_vat_cents: 0, period_gross_cents: 2900, vat_treatment: 'reverse_charge', vat_treatment_line: 'Reverse charge — VAT payable by the recipient' }
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, amounts: zero } }).success).toBe(true)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, amounts: { ...zero, vat_treatment: 'outside_eu' } } }).success).toBe(false)
  })

  it('checks exact period boundaries and local start date through the DST transition', () => {
    const period = snapshot.period
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, period: { ...period, display_time_zone: 'Unknown/Nowhere' } } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, period: { ...period, starts_on: '2026-09-30' } } }).success).toBe(false)
    expect(billingDecisionDisplayResponse.safeParse({ ...display, snapshot: { ...snapshot, period: { ...period, effective: { ...period.effective, at: '2026-10-25T00:30:00Z' } } } }).success).toBe(false)
  })
})
