// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  billingCharge,
  billingChargeInvoice,
  billingIssuer,
  billingView,
  purchaseHoldReason,
} from '../src/billing.js'

const CHARGE_ID = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const DOCUMENT_ID = '2f6a1e2a-6c2d-4a4b-9a2b-1c9f6d5e3a10'

const baseCharge = {
  id: CHARGE_ID,
  kind: 'renewal',
  status: 'due',
  currency: 'eur',
  net_cents: 14900,
  vat_rate_percent: 19,
  vat_cents: 2831,
  gross_cents: 17731,
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-11-01T00:00:00Z',
  due_at: '2026-10-01T00:00:00Z',
  paid_at: null,
  invoice: { state: 'not_issued' },
}

describe('billingChargeInvoice', () => {
  it('accepts the three states, and refuses issued without a document id', () => {
    expect(billingChargeInvoice.safeParse({ state: 'not_issued' }).success).toBe(true)
    expect(billingChargeInvoice.safeParse({ state: 'pending' }).success).toBe(true)
    expect(billingChargeInvoice.safeParse({ state: 'issued', document_id: DOCUMENT_ID }).success).toBe(true)
    expect(billingChargeInvoice.safeParse({ state: 'issued' }).success).toBe(false)
  })
})

describe('billingCharge (the Lexware issuer cutover, fleetless/fleetless#327)', () => {
  it('accepts a due charge with no invoice yet', () => {
    expect(billingCharge.safeParse(baseCharge).success).toBe(true)
  })

  it('accepts a paid charge with a confirmed Lexware invoice', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'paid', paid_at: '2026-10-02T00:00:00Z', invoice: { state: 'issued', document_id: DOCUMENT_ID } }).success).toBe(true)
  })

  it('accepts a paid charge whose Lexware invoice is not yet confirmed', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'paid', paid_at: '2026-10-02T00:00:00Z', invoice: { state: 'pending' } }).success).toBe(true)
  })

  it('rejects a paid charge with no invoice at all', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'paid', paid_at: '2026-10-02T00:00:00Z', invoice: { state: 'not_issued' } }).success).toBe(false)
  })

  it('rejects a due charge that already carries an issued invoice', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'due', invoice: { state: 'issued', document_id: DOCUMENT_ID } }).success).toBe(false)
  })

  it('rejects a due charge whose invoice is pending', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'due', invoice: { state: 'pending' } }).success).toBe(false)
  })

  it('rejects a currency other than eur', () => {
    expect(billingCharge.safeParse({ ...baseCharge, currency: 'usd' }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(billingCharge.safeParse({ ...baseCharge, net_cents: -100 }).success).toBe(false)
  })

  it('rejects an unknown extra key', () => {
    expect(billingCharge.safeParse({ ...baseCharge, extra: 'nope' }).success).toBe(false)
  })

  it('rejects an issued invoice with no document id', () => {
    expect(billingCharge.safeParse({ ...baseCharge, status: 'paid', paid_at: '2026-10-02T00:00:00Z', invoice: { state: 'issued' } }).success).toBe(false)
  })
})

describe('billingView after the issuer cutover', () => {
  it('requires issuer and charges', () => {
    const base = { available: true, account: null, payment_method: null, payment_method_options: [], invoices: [] }
    expect(billingView.safeParse(base).success).toBe(false)
    expect(billingView.safeParse({ ...base, issuer: 'cloud' }).success).toBe(false)
    expect(billingView.safeParse({ ...base, charges: [] }).success).toBe(false)
    expect(billingView.safeParse({ ...base, issuer: 'cloud', charges: [] }).success).toBe(true)
  })

  it('accepts lexware issuer with charges', () => {
    const base = { available: true, account: null, payment_method: null, payment_method_options: [], invoices: [] }
    expect(billingView.safeParse({ ...base, issuer: 'lexware', charges: [baseCharge] }).success).toBe(true)
  })
})

describe('the descriptions the Lexware issuer cutover requires', () => {
  it("billingView.charges names only due charges with issuer lexware", () => {
    expect(billingView.shape.charges.meta()?.description).toMatch(/only due charges with issuer `lexware`/)
  })

  it('billingCharge.status describes a charged back or manually refunded charge staying paid', () => {
    const description = billingCharge.shape.status.meta()?.description ?? ''
    expect(description).toMatch(/charged back or manually refunded/)
    expect(description).toMatch(/stays `paid`/)
  })

  it('the status/invoice invariant travels in JSON Schema', () => {
    const schema = z.toJSONSchema(billingCharge, { io: 'output' }) as { allOf?: unknown[] }
    expect(schema.allOf).toEqual([
      expect.objectContaining({ if: { properties: { status: { const: 'paid' } }, required: ['status'] } }),
      expect.objectContaining({ then: { properties: { invoice: { properties: { state: { const: 'not_issued' } } } } } }),
    ])
  })
})

describe('purchaseHoldReason gains the Lexware integration holds', () => {
  it('accepts the four new values', () => {
    for (const reason of ['lexware_contact_pending', 'lexware_contact_changed', 'issuer_cutover_in_progress', 'lexware_issuance_paused']) {
      expect(purchaseHoldReason.safeParse(reason).success, reason).toBe(true)
    }
  })

  it('keeps the historical values', () => {
    for (const reason of ['legacy_usd_invoice', 'legacy_payer_unresolved', 'mandate_policy_unresolved']) {
      expect(purchaseHoldReason.safeParse(reason).success, reason).toBe(true)
    }
  })
})

describe('billingIssuer', () => {
  it('is cloud or lexware, nothing else', () => {
    expect(billingIssuer.options).toEqual(['cloud', 'lexware'])
    expect(billingIssuer.safeParse('mollie').success).toBe(false)
  })
})
