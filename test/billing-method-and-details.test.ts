// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import * as formatsModule from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { ROUTES, billingDetailsConflictDetails, checkoutResponse, purchaseRefusalRule } from '../src/index.js'
import { eligibleIntent, heldIntent, intentBase, pendingIntent, startedIntent } from './purchase-fixtures.js'

/**
 * fleetless/fleetless#1185: a payment-method change is a 0.00 hosted payment
 * (`mandate_setup` in `payment_started`), and `PATCH /api/billing/details`
 * refuses what a purchase would refuse. The JSON Schema artifacts say the same
 * as the zod schemas: a consumer that is not TypeScript reads only those.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false })
const addFormats = formatsModule.default as unknown as (validator: Ajv2020) => void
addFormats(ajv)
const artifact = (name: string) => ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))

const started = { ...startedIntent, operation: 'mandate_setup' }

describe('mandate_setup on the wire and in its artifacts', () => {
  const cases: [string, unknown, boolean][] = [
    ['a started hosted payment', started, true],
    ['the hold stored before 17.0.0', heldIntent, true],
    ['a mandate charge', { ...started, payment: { kind: 'mandate' } }, false],
    ['an eligible quote', { ...eligibleIntent, operation: 'mandate_setup' }, false],
    ['a wait for VIES', { ...pendingIntent, operation: 'mandate_setup' }, false],
    ['a refusal', { ...intentBase, operation: 'mandate_setup', state: 'refused', field: 'billing.tax_id', rule: 'tax_id_required' }, false],
    ['a hold for another reason', { ...heldIntent, reason: 'issuer_cutover_in_progress' }, false],
    ['the mandate hold on a checkout', { ...heldIntent, operation: 'checkout' }, false],
  ]

  it.each(cases)('%s', (_name, value, valid) => {
    expect(checkoutResponse.safeParse(value).success).toBe(valid)
    expect(artifact('checkout-response')(value)).toBe(valid)
  })

  it('the payment-started artifact admits it, hosted only', () => {
    const validate = artifact('purchase-intent-payment-started')
    expect(validate(started)).toBe(true)
    expect(validate({ ...started, payment: { kind: 'mandate' } })).toBe(false)
    expect(validate(startedIntent)).toBe(true)
  })
})

describe('billingDetailsConflictDetails', () => {
  const validate = artifact('billing-details-conflict-details')
  const both = (value: unknown, valid: boolean) => {
    expect(billingDetailsConflictDetails.safeParse(value).success).toBe(valid)
    expect(validate(value)).toBe(valid)
  }

  it('names the field a purchase would refuse, by every refusal rule', () => {
    for (const rule of purchaseRefusalRule.options) both({ field: 'billing.vat_id', rule }, true)
    both({ field: 'billing.address.state', rule: 'us_state_required' }, true)
    both({ field: '', rule: 'vat_id_required' }, false)
    both({ field: 'billing.vat_id', rule: 'vat_id_unknown' }, false)
    both({ field: 'billing.vat_id', rule: 'vat_id_invalid', saved: true }, false)
  })

  it('says VIES did not answer, with its reason', () => {
    both({ field: 'billing.vat_id', rule: 'vies_unavailable', reason: 'vies_unavailable' }, true)
    both({ field: 'billing.vat_id', rule: 'vies_unavailable', reason: 'vies_unverified' }, true)
    both({ field: 'billing.vat_id', rule: 'vies_unavailable' }, false)
    both({ field: 'billing.tax_id', rule: 'vies_unavailable', reason: 'vies_unavailable' }, false)
  })

  it('says the details changed meanwhile', () => {
    both({ field: 'billing', rule: 'buyer_changed' }, true)
    both({ field: 'intent', rule: 'buyer_changed' }, false)
  })
})

describe('the route entries', () => {
  const route = (method: string, path: string) => {
    const entry = ROUTES.find(candidate => candidate.method === method && candidate.path === path)
    if (!entry) throw new Error(`No route ${method} ${path}`)
    return entry
  }

  it('PATCH /api/billing/details lists its 409 and names both details', () => {
    const entry = route('PATCH', '/api/billing/details')
    expect(entry.errors).toContain('target_state_conflict')
    for (const word of ['billingDetailsConflictDetails', 'viesUnavailableDetails', 'purchaseRefusalRule', 'buyer_changed', 'vat_id_invalid']) {
      expect(entry.notes, word).toContain(word)
    }
  })

  it('POST /api/billing/payment-method describes the 0.00 payment and no hold on a new change', () => {
    const entry = route('POST', '/api/billing/payment-method')
    expect(entry.response).toBe(checkoutResponse)
    for (const word of ['mandate_setup', 'payment_started', '0.00', 'checkout_not_open', 'payment_provider_unavailable', 'operation_key_reused']) {
      expect(entry.notes, word).toContain(word)
    }
    expect(entry.notes).not.toContain('until the integration decision')
  })

  it('GET /api/billing/intents lists what a hosted payment read at the provider answers', () => {
    const entry = route('GET', '/api/billing/intents')
    expect(entry.errors).toEqual(expect.arrayContaining(['target_state_conflict', 'payment_provider_unavailable']))
  })
})
