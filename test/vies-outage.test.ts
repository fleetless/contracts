// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import * as formatsModule from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  ROUTES, billingChangeResponse, billingDetailsConflictDetails, checkoutResponse, checkoutStartResponse, purchaseIntent, purchaseIntentDraft,
  purchaseIntentResponse, vatDecision, vatFor, vatIdCheckResponse, viesOutage, viesPendingReason, viesUnavailableDetails,
  type ViesOutage,
} from '../src/index.js'
import { intentBase } from './purchase-fixtures.js'

/**
 * **`vies_outage` travels with `vies_unavailable`, and with nothing else**
 * (fleetless/fleetless#1181). Every object that says VIES did not answer
 * also says which side was down: `member_state` (VIES answers, the country's
 * VAT register does not) or `vies` (VIES itself). The other two pending
 * reasons are no outage and carry none.
 *
 * Each object is checked twice, by zod and by its committed JSON Schema: a
 * rule only zod knows is a rule the bridge's and every other non-TypeScript
 * consumer never hears of.
 *
 * What makes this fail: make `vies_outage` optional on any of them, or
 * let it stand beside `vies_unverified`.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false })
const addFormats = formatsModule.default as unknown as (validator: Ajv2020) => void
addFormats(ajv)
const artifact = (name: string) => ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))

const BELGIUM: ViesOutage = { scope: 'member_state', country: 'BE' }
const VIES_WIDE: ViesOutage = { scope: 'vies', country: 'GR' }
const invoiceId = '5b0f7f0e-3b3f-4a51-9d0f-0b9a1c2d3e4f'

describe('viesOutage', () => {
  const validate = artifact('vies-outage')

  it.each([BELGIUM, VIES_WIDE])('parses %j, and the JSON Schema agrees', (value) => {
    expect(viesOutage.safeParse(value).success).toBe(true)
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
  })

  it.each([
    [{ scope: 'member_state' }, 'no country'],
    [{ scope: 'country', country: 'BE' }, 'an unknown scope'],
    [{ scope: 'member_state', country: 'be' }, 'a lower-case country'],
    [{ scope: 'member_state', country: 'Belgium' }, 'a country name'],
    [{ scope: 'member_state', country: '' }, 'an empty country'],
    [{ ...BELGIUM, fault: 'MS_UNAVAILABLE' }, "VIES's fault code"],
  ])('refuses %j: %s', (value, _why) => {
    expect(viesOutage.safeParse(value).success).toBe(false)
    expect(validate(value)).toBe(false)
  })
})

/** The objects, each as the value that says `vies_unavailable` once its `reason` and `vies_outage` are added. */
const OBJECTS: { name: string; schema: { safeParse(value: unknown): { success: boolean } }; artifact: string; base: Record<string, unknown> }[] = [
  { name: 'vatDecision pending', schema: vatDecision, artifact: 'vat-decision', base: { state: 'pending' } },
  {
    name: 'purchaseIntentDraft awaiting_vies', schema: purchaseIntentDraft, artifact: 'purchase-intent-draft',
    base: { ...intentBase, operation: 'invoice_payment', invoice_id: invoiceId, state: 'awaiting_vies', next_attempt_at: '2026-11-23T09:00:00Z' },
  },
  {
    name: 'purchaseIntentResponse awaiting_vies', schema: purchaseIntentResponse, artifact: 'purchase-intent-response',
    base: { ...intentBase, operation: 'invoice_payment', invoice_id: invoiceId, state: 'awaiting_vies', next_attempt_at: '2026-11-23T09:00:00Z' },
  },
  {
    name: 'checkoutResponse awaiting_vies', schema: checkoutResponse, artifact: 'checkout-response',
    base: { ...intentBase, operation: 'payment_method_invoice', invoice_id: invoiceId, state: 'awaiting_vies', next_attempt_at: '2026-11-23T09:00:00Z' },
  },
  { name: 'checkoutStartResponse vies_unavailable', schema: checkoutStartResponse, artifact: 'checkout-start-response', base: { state: 'vies_unavailable', field: 'billing.vat_id' } },
  { name: 'viesUnavailableDetails', schema: viesUnavailableDetails, artifact: 'vies-unavailable-details', base: { field: 'billing.vat_id', rule: 'vies_unavailable' } },
  { name: 'billingDetailsConflictDetails vies_unavailable', schema: billingDetailsConflictDetails, artifact: 'billing-details-conflict-details', base: { field: 'billing.vat_id', rule: 'vies_unavailable' } },
  { name: 'vatIdCheckResponse pending', schema: vatIdCheckResponse, artifact: 'vat-id-check-response', base: { state: 'pending', status: 'unavailable', vat_id: 'BE0123456789', name: null } },
]

describe.each(OBJECTS)('$name', ({ schema, artifact: file, base }) => {
  const validate = artifact(file)
  const both = (value: unknown, want: boolean) => {
    expect(schema.safeParse(value).success, `zod: ${JSON.stringify(value)}`).toBe(want)
    expect(validate(value), `JSON Schema: ${JSON.stringify(value)} ${ajv.errorsText(validate.errors)}`).toBe(want)
  }

  it.each([BELGIUM, VIES_WIDE])('says vies_unavailable with its outage %j', (outage) => {
    both({ ...base, reason: 'vies_unavailable', vies_outage: outage }, true)
  })

  it('refuses vies_unavailable without the outage', () => {
    both({ ...base, reason: 'vies_unavailable' }, false)
  })

  it('refuses a malformed outage', () => {
    both({ ...base, reason: 'vies_unavailable', vies_outage: { scope: 'member_state' } }, false)
    both({ ...base, reason: 'vies_unavailable', vies_outage: null }, false)
  })

  it.each(['vies_unverified', 'vies_identifier_missing'])('%s is no outage: it parses alone and refuses one', (reason) => {
    both({ ...base, reason }, true)
    both({ ...base, reason, vies_outage: BELGIUM }, false)
  })

  it('still refuses an unknown reason', () => {
    both({ ...base, reason: 'vies_down' }, false)
    both({ ...base, reason: 'vies_down', vies_outage: BELGIUM }, false)
  })
})

describe('the objects that never wait for VIES', () => {
  it('a paid change has no awaiting_vies, with or without an outage', () => {
    const waiting = { ...intentBase, operation: 'paid_change', state: 'awaiting_vies', next_attempt_at: '2026-11-23T09:00:00Z' }
    expect(billingChangeResponse.safeParse({ intent: { ...waiting, reason: 'vies_unavailable', vies_outage: BELGIUM } }).success).toBe(false)
    expect(billingChangeResponse.safeParse({ intent: { ...waiting, reason: 'vies_unverified' } }).success).toBe(false)
  })

  it('the full intent read keeps its other states unchanged', () => {
    const eligible = { ...intentBase, state: 'eligible', quote_revision: 'q', buyer_fingerprint: 'b', quote: { currency: 'eur', net_cents: 2900, vat_cents: 0, gross_cents: 2900, rate_percent: 0 } }
    expect(purchaseIntent.safeParse(eligible).success).toBe(true)
    expect(purchaseIntent.safeParse({ ...eligible, vies_outage: BELGIUM }).success).toBe(false)
  })
})

describe('vatFor passes the outage through', () => {
  it('an unavailable verdict names its outage in the decision', () => {
    expect(vatFor({ kind: 'company', country: 'BE', vies: { status: 'unavailable', outage: BELGIUM } }))
      .toEqual({ state: 'pending', reason: 'vies_unavailable', vies_outage: BELGIUM })
    expect(vatFor({ kind: 'company', country: 'GR', vies: { status: 'unavailable', outage: VIES_WIDE } }))
      .toEqual({ state: 'pending', reason: 'vies_unavailable', vies_outage: VIES_WIDE })
  })

  it('every decision vatFor returns parses as vatDecision', () => {
    const verdicts = [null, { status: 'invalid' }, { status: 'unverified' }, { status: 'valid' }, { status: 'valid', requestIdentifier: 'r-1' }, { status: 'unavailable', outage: BELGIUM }] as const
    for (const vies of verdicts) expect(vatDecision.safeParse(vatFor({ kind: 'company', country: 'BE', vies })).success, JSON.stringify(vies)).toBe(true)
  })

  it('keeps the three reasons', () => {
    expect(viesPendingReason.options).toEqual(['vies_unavailable', 'vies_unverified', 'vies_identifier_missing'])
  })
})

describe('the routes name vies_outage', () => {
  const notes = (method: string, path: string) => ROUTES.find(r => r.method === method && r.path === path)!.notes ?? ''

  it.each([
    ['POST', '/api/billing/checkout'],
    ['POST', '/api/billing/change'],
    ['POST', '/api/billing/vat-id/check'],
    ['PATCH', '/api/billing/details'],
    ['GET', '/api/billing/intents'],
  ])('%s %s', (method, path) => {
    expect(notes(method, path)).toMatch(/vies_outage/)
  })
})
