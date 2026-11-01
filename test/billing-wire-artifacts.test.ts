// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import * as formatsModule from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  billingChangeResponse, billingDecisionPeriod, checkoutResponse, planChangeRequest,
  purchaseIntentConfirmRequest, purchaseIntentResponse,
} from '../src/index.js'
import { eligibleIntent, intentBase, operationKey, startedIntent } from './purchase-fixtures.js'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const addFormats = formatsModule.default as unknown as (validator: Ajv2020) => void
addFormats(ajv)
const validArtifact = (name: string, value: unknown): boolean => {
  const schema = JSON.parse(readFileSync(new URL('../artifacts/schema/' + name + '.schema.json', import.meta.url), 'utf8'))
  return Boolean(ajv.compile(schema)(value))
}
const billing = { available: true, account: null, payment_method: null, payment_method_options: [], issuer: 'cloud', invoices: [], charges: [] }
const acceptedNoPayment = {
  intent: {
    intent_id: intentBase.intent_id, operation_key: operationKey, operation: 'paid_change',
    state: 'accepted_no_payment', quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2',
    quote: { currency: 'eur', net_cents: 0, vat_cents: 0, gross_cents: 0, rate_percent: 0 },
    accepted_at: '2026-11-01T11:00:00Z',
  },
  billing, charged: null,
}
const paidChange = { intent: { ...startedIntent, operation: 'paid_change', payment: { kind: 'mandate' } }, billing, charged: null }
const period = {
  display_time_zone: 'Europe/Berlin', starts_on: '2026-10-01', starts_at: '2026-09-30T22:00:00Z',
  current_period_ends_at: '2026-10-25T01:30:00Z', renews_at: '2026-10-25T01:30:00Z',
  effective: { mode: 'scheduled', at: '2026-10-25T01:30:00Z', at_period_end: true },
}
const finalBasic = {
  change_id: intentBase.intent_id, operation_key: operationKey, target_plan: 'basic', keep: null,
  confirmation_proof: 'x'.repeat(43),
}

describe('published C.4 JSON Schemas match route-bound Zod responses', () => {
  it('publishes the cancelled invoice and optional document kind in generated artifacts', () => {
    const invoice = {
      id: '11111111-1111-4111-8111-111111111111', number: 'FL-2026-0001',
      issued_at: '2026-10-01T00:00:00Z', status: 'cancelled',
      cancellation_document_url: '/api/billing/invoices/11111111-1111-4111-8111-111111111111/pdf?kind=cancellation',
      currency: 'eur', net_cents: 100, vat_rate_percent: 0, vat_cents: 0, gross_cents: 100,
    }
    expect(validArtifact('billing-invoice', invoice)).toBe(true)
    expect(validArtifact('billing-invoice', { ...invoice, cancellation_document_url: undefined })).toBe(false)
    for (const status of ['open', 'paid', 'uncollectible']) {
      expect(validArtifact('billing-invoice', { ...invoice, status, cancellation_document_url: null })).toBe(true)
    }
    const routes = JSON.parse(readFileSync(new URL('../artifacts/routes.json', import.meta.url), 'utf8'))
    const pdf = routes.routes.find((route: { path: string }) => route.path === '/api/billing/invoices/:id/pdf')
    expect(pdf.query).toBe('billing-invoice-pdf-query')
    for (const kind of [undefined, 'invoice', 'cancellation']) {
      expect(validArtifact(pdf.query, kind === undefined ? {} : { kind })).toBe(true)
    }
    expect(validArtifact(pdf.query, { kind: 'other' })).toBe(false)
    const openapi = JSON.parse(readFileSync(new URL('../artifacts/openapi.json', import.meta.url), 'utf8'))
    expect(openapi.paths['/api/billing/invoices/{id}/pdf'].get.parameters).toContainEqual(
      expect.objectContaining({ name: 'kind', in: 'query', required: false, schema: expect.objectContaining({ enum: ['invoice', 'cancellation'] }) }),
    )
  })

  it('rejects a bare paid-change payment from intent recovery', () => {
    const wrong = { ...startedIntent, operation: 'paid_change', payment: { kind: 'mandate' } }
    const draft = { ...eligibleIntent, operation: 'paid_change' }
    expect(purchaseIntentResponse.safeParse(draft).success).toBe(true)
    expect(validArtifact('purchase-intent-response', draft)).toBe(true)
    expect(purchaseIntentResponse.safeParse(paidChange).success).toBe(true)
    expect(validArtifact('purchase-intent-response', paidChange)).toBe(true)
    expect(purchaseIntentResponse.safeParse(wrong).success).toBe(false)
    expect(validArtifact('purchase-intent-response', wrong)).toBe(false)
  })

  it('keeps billing-change starts on paid-change drafts', () => {
    const valid = { intent: { ...eligibleIntent, operation: 'paid_change' } }
    const wrong = { intent: { ...eligibleIntent, operation: 'invoice_payment', invoice_id: intentBase.intent_id } }
    expect(billingChangeResponse.safeParse(valid).success).toBe(true)
    expect(validArtifact('billing-change-response', valid)).toBe(true)
    expect(billingChangeResponse.safeParse(wrong).success).toBe(false)
    expect(validArtifact('billing-change-response', wrong)).toBe(false)
  })

  it('excludes an accepted paid change from checkout and payment-method responses', () => {
    expect(checkoutResponse.safeParse(eligibleIntent).success).toBe(true)
    expect(validArtifact('checkout-response', eligibleIntent)).toBe(true)
    const wrongDraft = { ...eligibleIntent, operation: 'paid_change' }
    expect(checkoutResponse.safeParse(wrongDraft).success).toBe(false)
    expect(validArtifact('checkout-response', wrongDraft)).toBe(false)
    expect(checkoutResponse.safeParse(acceptedNoPayment.intent).success).toBe(false)
    expect(validArtifact('checkout-response', acceptedNoPayment.intent)).toBe(false)
    expect(billingChangeResponse.safeParse(acceptedNoPayment).success).toBe(true)
    expect(validArtifact('billing-change-response', acceptedNoPayment)).toBe(true)
  })

  it('requires proof only for a customer checkout confirmation', () => {
    const base = { operation_key: operationKey, quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2' }
    const checkout = { ...base, operation: 'checkout' }
    const change = { ...base, operation: 'paid_change' }
    const invoice = { ...base, operation: 'invoice_payment' }
    expect(purchaseIntentConfirmRequest.safeParse(checkout).success).toBe(false)
    expect(validArtifact('purchase-intent-confirm-request', checkout)).toBe(false)
    expect(purchaseIntentConfirmRequest.safeParse(change).success).toBe(false)
    expect(validArtifact('purchase-intent-confirm-request', change)).toBe(false)
    expect(purchaseIntentConfirmRequest.safeParse({ ...checkout, confirmation_proof: 'x'.repeat(43) }).success).toBe(true)
    expect(validArtifact('purchase-intent-confirm-request', { ...checkout, confirmation_proof: 'x'.repeat(43) })).toBe(true)
    expect(purchaseIntentConfirmRequest.safeParse(invoice).success).toBe(true)
    expect(validArtifact('purchase-intent-confirm-request', invoice)).toBe(true)
  })

  it('rejects a 501-character Basic cancellation reason before trimming', () => {
    const valid = { ...finalBasic, cancellation_reason: 'x'.repeat(500) }
    const wrong = { ...finalBasic, cancellation_reason: 'x'.repeat(501) }
    expect(planChangeRequest.safeParse(valid).success).toBe(true)
    expect(validArtifact('plan-change-request', valid)).toBe(true)
    expect(planChangeRequest.safeParse(wrong).success).toBe(false)
    expect(validArtifact('plan-change-request', wrong)).toBe(false)
  })

  it('rejects ambiguous time-zone abbreviations in runtime and published period schemas', () => {
    expect(billingDecisionPeriod.safeParse(period).success).toBe(true)
    expect(validArtifact('billing-decision-period', period)).toBe(true)
    for (const display_time_zone of ['CET', 'Unknown/Nowhere']) {
      const wrong = { ...period, display_time_zone }
      expect(billingDecisionPeriod.safeParse(wrong).success).toBe(false)
      expect(validArtifact('billing-decision-period', wrong)).toBe(false)
    }
  })
})
