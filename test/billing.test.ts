// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  BILLING_RETRY_DAYS, BILLING_LOCK_DAY, EU_COUNTRIES, billingAccount, billingInvoice, changeNetCents, chargeAmounts, checkoutQuote, checkoutRequest,
  billingChangeRequest, currencyForCountry, normalizeVatId, paymentMethod, paymentMethodChangeRequest, paymentMethodKind, billingView, periodDays, periodNetCents, prorateCents, remainingDays, vatFor,
  viesCountry,
} from '../src/billing.js'
import * as billing from '../src/billing.js'
import { operationKey, company, intentBase, pendingIntent, eligibleIntent, heldIntent, startedIntent } from './purchase-fixtures.js'
import { ERROR_CODES, paymentProviderUnavailableDetails } from '../src/errors.js'

const NONE = { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 }
const at = (s: string) => new Date(s)

describe('new paid VAT decisions', () => {
  it.each(['DE', 'NL', 'US'])('refuses a person in %s', (country) => {
    expect(vatFor({ kind: 'person', country, vies: null })).toEqual({ state: 'refused', rule: 'company_required' })
  })
  it('Germany taxes the company at 19 percent without VIES', () => {
    expect(vatFor({ kind: 'company', country: 'DE', vies: null })).toEqual({ state: 'eligible', treatment: 'de_standard', rate_percent: 19 })
  })
  it.each([
    [null, { state: 'refused', rule: 'vat_id_required' }],
    [{ status: 'invalid' }, { state: 'refused', rule: 'vat_id_invalid' }],
    [{ status: 'unavailable' }, { state: 'pending', reason: 'vies_unavailable' }],
    [{ status: 'unverified' }, { state: 'pending', reason: 'vies_unverified' }],
    [{ status: 'valid' }, { state: 'pending', reason: 'vies_identifier_missing' }],
    [{ status: 'valid', requestIdentifier: null }, { state: 'pending', reason: 'vies_identifier_missing' }],
    [{ status: 'valid', requestIdentifier: '   ' }, { state: 'pending', reason: 'vies_identifier_missing' }],
    [{ status: 'valid', requestIdentifier: 'confirmation-1' }, { state: 'eligible', treatment: 'reverse_charge', rate_percent: 0 }],
  ] as const)('requires definitive EU evidence: %j', (vies, expected) => {
    expect(vatFor({ kind: 'company', country: 'NL', vies })).toEqual(expected)
  })
  it('classifies a non-EU company separately from its purchase-detail validation', () => {
    expect(vatFor({ kind: 'company', country: 'US', vies: null })).toEqual({ state: 'eligible', treatment: 'outside_eu', rate_percent: 0 })
  })
  it.each(['DE', 'FR', 'GB', 'US', 'CH'])('quotes new purchases in EUR in %s', (country) => {
    expect(currencyForCountry(country)).toBe('eur')
  })
})

describe('normalizeVatId', () => {
  it.each([
    ['DE', 'de 328 675 075', 'DE328675075'],
    ['DE', 'DE-328.675.075', 'DE328675075'],
    ['DE', '328675075', 'DE328675075'],
    ['GR', 'EL123456789', 'EL123456789'],
    ['GR', 'GR123456789', 'EL123456789'],
    ['GR', '123456789', 'EL123456789'],
  ])('%s %s → %s', (country, raw, out) => expect(normalizeVatId(country, raw)).toBe(out))
  it('empty is null', () => expect(normalizeVatId('DE', '  ')).toBeNull())
  it('VIES calls Greece EL', () => expect(viesCountry('GR')).toBe('EL'))
})

describe('money (worked examples)', () => {
  it('Pro monthly, German payer: 149,00 + 28,31 = 177,31', () => {
    expect(chargeAmounts(periodNetCents({ plan: 'pro', addons: NONE, cycle: 'monthly', currency: 'eur' }), 19)).toEqual({ net_cents: 14900, vat_cents: 2831, gross_cents: 17731 })
  })
  it('a robot on day 10 of a 30-day month: 19 € × 21/30 = 13,30 €', () => {
    const start = at('2026-09-01T09:00:00Z'), end = at('2026-10-01T09:00:00Z'), now = at('2026-09-10T15:00:00Z')
    expect(periodDays(start, end)).toBe(30)
    expect(remainingDays(now, end, 30)).toBe(21)
    expect(prorateCents(1900, 21, 30)).toBe(1330)
    expect(changeNetCents({ from: { plan: 'pro', addons: NONE, cycle: 'monthly' }, to: { plan: 'pro', addons: { ...NONE, robots: 1 }, cycle: 'monthly' }, currency: 'eur', periodStart: start, periodEnd: end, now })).toBe(1330)
  })
  it('yearly, 100 days before the end: 193,80 € × 100/365 = 53,10 €', () => {
    const start = at('2026-01-01T00:00:00Z'), end = at('2027-01-01T00:00:00Z'), now = at('2026-09-23T01:00:00Z')
    expect(periodDays(start, end)).toBe(365)
    expect(remainingDays(now, end, 365)).toBe(100)
    expect(changeNetCents({ from: { plan: 'pro', addons: NONE, cycle: 'yearly' }, to: { plan: 'pro', addons: { ...NONE, robots: 1 }, cycle: 'yearly' }, currency: 'eur', periodStart: start, periodEnd: end, now })).toBe(5310)
  })
  it('Plus → Pro: (Pro − Plus) × remaining / days', () => {
    const start = at('2026-09-01T09:00:00Z'), end = at('2026-10-01T09:00:00Z'), now = at('2026-09-10T15:00:00Z')
    expect(changeNetCents({ from: { plan: 'plus', addons: NONE, cycle: 'monthly' }, to: { plan: 'pro', addons: NONE, cycle: 'monthly' }, currency: 'eur', periodStart: start, periodEnd: end, now })).toBe(8400)
  })
  it('monthly → yearly: the yearly price minus the unused share of the month', () => {
    const start = at('2026-09-01T09:00:00Z'), end = at('2026-10-01T09:00:00Z'), now = at('2026-09-10T15:00:00Z')
    expect(changeNetCents({ from: { plan: 'pro', addons: NONE, cycle: 'monthly' }, to: { plan: 'pro', addons: NONE, cycle: 'yearly' }, currency: 'eur', periodStart: start, periodEnd: end, now })).toBe(151980 - 10430)
  })
  it('decreases charge nothing now', () => {
    const start = at('2026-09-01T09:00:00Z'), end = at('2026-10-01T09:00:00Z'), now = at('2026-09-10T15:00:00Z')
    expect(changeNetCents({ from: { plan: 'pro', addons: { ...NONE, robots: 2 }, cycle: 'yearly' }, to: { plan: 'plus', addons: NONE, cycle: 'monthly' }, currency: 'eur', periodStart: start, periodEnd: end, now })).toBe(0)
  })
  it('add-ons count only on Pro', () => {
    expect(periodNetCents({ plan: 'plus', addons: { ...NONE, robots: 3 }, cycle: 'monthly', currency: 'eur' })).toBe(2900)
    expect(periodNetCents({ plan: 'pro', addons: { ...NONE, robots: 2, app_user_packs: 1 }, cycle: 'yearly', currency: 'eur' })).toBe(151980 + 2 * 19380 + 10200)
  })
  it('checkout quote: lines in net and gross, a person sees 177,31', () => {
    const q = checkoutQuote({ plan: 'pro', addons: NONE, cycle: 'monthly', currency: 'eur', rate_percent: 19 })
    expect(q.lines).toEqual([{ item: 'plan', quantity: 1, net_cents: 14900, gross_cents: 17731 }])
    expect(q).toMatchObject({ net_cents: 14900, vat_cents: 2831, gross_cents: 17731, rate_percent: 19, currency: 'eur', cycle: 'monthly' })
  })
  it('checkout quote: the gross lines add up to the gross charged', () => {
    // EUR yearly with two seats: rounding each line's VAT on its own came to
    // 2027,04 € while the charge is 2027,05 €.
    const q = checkoutQuote({ plan: 'pro', addons: { ...NONE, seats: 2 }, cycle: 'yearly', currency: 'eur', rate_percent: 19 })
    expect(q.gross_cents).toBe(202705)
    expect(q.lines.reduce((sum, l) => sum + l.gross_cents, 0)).toBe(q.gross_cents)
  })
  it('checkout quote: every Pro basket, the gross lines add up to the gross charged', () => {
    const keys = Object.keys(NONE) as (keyof typeof NONE)[]
    for (const currency of ['eur'] as const)
      for (const cycle of ['monthly', 'yearly'] as const)
        for (const rate_percent of [0, 19])
          for (const k of keys)
            for (let n = 1; n <= 5; n++) {
              const q = checkoutQuote({ plan: 'pro', addons: { ...NONE, [k]: n }, cycle, currency, rate_percent })
              expect(q.lines.reduce((sum, l) => sum + l.gross_cents, 0), `${currency} ${cycle} ${rate_percent} % ${n} ${k}`).toBe(q.gross_cents)
            }
    const all = checkoutQuote({ plan: 'pro', addons: { seats: 3, robots: 5, apps: 2, app_user_packs: 4, live_video_packs: 1 }, cycle: 'yearly', currency: 'eur', rate_percent: 19 })
    expect(all.lines.reduce((sum, l) => sum + l.gross_cents, 0)).toBe(all.gross_cents)
  })
  it('dunning schedule', () => {
    expect(BILLING_RETRY_DAYS).toEqual([3, 7])
    expect(BILLING_LOCK_DAY).toBe(14)
  })
})

describe('billing shapes (I-2)', () => {
  const company = {
    kind: 'company', company_name: 'Acme Robotics GmbH', vat_id: 'ATU12345678',
    address: { line1: 'Ring 1', line2: null, postal_code: '1010', city: 'Wien', country: 'AT' },
    invoice_email: 'billing@acme.example',
  }
  it('a company checkout requires the terms', () => {
    expect(checkoutRequest.safeParse({ operation_key: operationKey, plan: 'pro', cycle: 'monthly', billing: company, accept_terms: true }).success).toBe(true)
    expect(checkoutRequest.safeParse({ operation_key: operationKey, plan: 'pro', cycle: 'monthly', billing: company, accept_terms: false }).success).toBe(false)
    expect(checkoutRequest.safeParse({ plan: 'basic', cycle: 'monthly', billing: company, accept_terms: true }).success).toBe(false)
    expect(
      checkoutRequest.safeParse({ operation_key: operationKey, plan: 'pro', cycle: 'monthly', billing: { ...company, kind: 'person', full_name: 'Ada' }, accept_terms: true }).success,
    ).toBe(false) // a person has no vat_id/company_name
  })
  it('a change names at least one thing, with absolute add-on counts', () => {
    expect(billingChangeRequest.safeParse({}).success).toBe(false)
    expect(billingChangeRequest.safeParse({ operation_key: operationKey, addons: { robots: 2 } }).success).toBe(true)
    expect(billingChangeRequest.safeParse({ plan: 'basic' }).success).toBe(false)
  })
  it('the billing view parses an active account and the mockup invoice number', () => {
    expect(billingInvoice.shape.number.safeParse('FL-2026-0142').success).toBe(true)
    expect(billingInvoice.shape.number.safeParse('FL-2026-142').success).toBe(false)
    expect(paymentMethod.safeParse({ kind: 'card', brand: 'Visa', last4: '4242', expires: '08/28' }).success).toBe(true)
  })
  it('card, PayPal and Apple Pay; no SEPA (André, 2026-10-04)', () => {
    expect(paymentMethodKind.options).toEqual(['card', 'paypal', 'applepay'])
    expect(paymentMethodChangeRequest.safeParse({ operation_key: operationKey, method: 'applepay' }).success).toBe(true)
    expect(paymentMethodChangeRequest.safeParse({ method: 'sepa' }).success).toBe(false)
    expect(paymentMethod.safeParse({ kind: 'applepay', brand: 'Mastercard', last4: '0004', expires: '11/29' }).success).toBe(true)
    expect(paymentMethod.safeParse({ kind: 'paypal', account: 'ada@example.com' }).success).toBe(true)
    expect(paymentMethod.safeParse({ kind: 'sepa', holder: 'Ada', iban_last4: '0000' }).success).toBe(false)
    expect(billingView.shape.payment_method_options.safeParse([{ method: 'card', pays_invoice: false }, { method: 'applepay', pays_invoice: true }]).success).toBe(true)
  })
  it('knows the new codes', () => {
    for (const c of ['billing_unavailable', 'payment_provider_unavailable']) expect(ERROR_CODES).toContain(c)
    expect(paymentProviderUnavailableDetails.safeParse({ provider: 'mollie', status: null }).success).toBe(true)
  })
})

describe('the VAT-ID hold and chargebacks (André, 2026-10-04, Multica DR-297)', () => {
  it('dunning describes the VAT-ID hold and chargebacks', () => {
    const d = billingAccount.shape.dunning.unwrap().shape
    expect(d.invoice_id.meta()?.description).toMatch(/no number yet/)
    expect(d.next_retry_at.meta()?.description).toMatch(/chargeback/)
    expect(d.failure.meta()?.description).toMatch(/charged_back/)
    expect(d.failure.meta()?.description).toMatch(/vat_id_invalid/)
  })
})


describe('purchase contracts and historical reads', () => {
  const request = { operation_key: operationKey, plan: 'pro', cycle: 'monthly', billing: company, accept_terms: true }
  it.each(['DE', 'NL', 'US'])('keeps person reads but rejects paid person writes in %s', (country) => {
    const person = { kind: 'person', full_name: 'Ada', address: { ...company.address, country }, invoice_email: 'ada@example.com' }
    expect(billing.billingDetails.safeParse(person).success).toBe(true)
    expect(checkoutRequest.safeParse({ ...request, billing: person }).success).toBe(false)
  })
  it('requires a stable operation key and refuses consumer withdrawal on company purchases', () => {
    expect(checkoutRequest.safeParse(request).success).toBe(true)
    expect(checkoutRequest.safeParse({ ...request, operation_key: undefined }).success).toBe(false)
    expect(checkoutRequest.safeParse({ ...request, accept_withdrawal: true }).success).toBe(false)
  })
  it('requires VAT ID in other EU countries, Tax ID outside and state for US purchases', () => {
    expect(checkoutRequest.safeParse({ ...request, billing: { ...company, vat_id: null } }).success).toBe(false)
    const us = { ...company, vat_id: null, address: { ...company.address, country: 'US' } }
    expect(checkoutRequest.safeParse({ ...request, billing: us }).success).toBe(false)
    expect(checkoutRequest.safeParse({ ...request, billing: { ...us, tax_id: 'TIN 42' } }).success).toBe(false)
    expect(checkoutRequest.safeParse({ ...request, billing: { ...us, tax_id: 'TIN 42', address: { ...us.address, state: 'CA' } } }).success).toBe(true)
    expect(checkoutRequest.safeParse({ ...request, billing: { ...us, tax_id: ' ', address: { ...us.address, state: 'CA' } } }).success).toBe(false)
  })
  it('allows owner detail corrections without claiming they are already verified', () => {
    expect(billing.billingDetailsUpdate.parse({ company_name: 'New Buyer', tax_id: 'TIN 42', address: { ...company.address, country: 'US', state: 'NY' }, invoice_email: 'finance@buyer.example' })).toMatchObject({ tax_id: 'TIN 42', address: { state: 'NY' } })
  })
  it('retains a person/USD account and invoice without changing the currency', () => {
    const account = { payer: { kind: 'person', full_name: 'Ada', address: company.address, invoice_email: 'ada@example.com' }, vat_id_status: null, vat: { treatment: 'outside_eu', rate_percent: 0 }, currency: 'usd', cycle: 'monthly', status: 'active', period_starts_at: null, period_ends_at: null, next_charge: null, scheduled: { cycle: null, addons: null }, dunning: null }
    expect(billingAccount.parse(account).currency).toBe('usd')
    expect(billingInvoice.parse({ id: intentBase.intent_id, number: 'FL-2026-0001', issued_at: '2026-10-01T00:00:00Z', status: 'open', currency: 'usd', net_cents: 17200, vat_rate_percent: 0, vat_cents: 0, gross_cents: 17200 }).currency).toBe('usd')
  })
  it.each([pendingIntent, eligibleIntent, heldIntent])('has no redirect before payment: $state', (intent) => {
    expect(billing.checkoutResponse.safeParse(intent).success).toBe(true)
    expect(billing.checkoutResponse.safeParse({ ...intent, checkout_url: startedIntent.payment.checkout_url }).success).toBe(false)
    expect(billing.billingChangeResponse.safeParse({ intent }).success).toBe(true)
  })
  it('rejects USD eligible quotes and mandate setup pretending to be eligible', () => {
    expect(billing.checkoutResponse.safeParse({ ...eligibleIntent, quote: { ...eligibleIntent.quote, currency: 'usd' } }).success).toBe(false)
    expect(billing.checkoutResponse.safeParse({ ...eligibleIntent, operation: 'mandate_setup' }).success).toBe(false)
  })
  it('exposes a redirect only with a persisted payment identity', () => {
    expect(billing.checkoutResponse.safeParse(startedIntent).success).toBe(true)
    expect(billing.checkoutResponse.safeParse({ ...startedIntent, payment_id: undefined }).success).toBe(false)
    expect(billing.checkoutResponse.safeParse({ ...startedIntent, payment: { ...startedIntent.payment, checkout_url: undefined } }).success).toBe(false)
  })
  it('shows unpaid accounts without inventing a tax treatment', () => {
    expect(billingAccount.shape.vat.safeParse(null).success).toBe(true)
  })
  it('does not expose full VIES evidence in a public check response', () => {
    const pending = { status: 'valid', state: 'pending', reason: 'vies_identifier_missing', vat_id: 'NL123', name: null }
    expect(billing.vatIdCheckResponse.safeParse(pending).success).toBe(true)
    expect(billing.vatIdCheckResponse.safeParse({ ...pending, requestIdentifier: 'protected' }).success).toBe(false)
  })
})


it('returns the current intent on a stale confirmation, with no stale payment URL', () => {
  expect(billing.purchaseConflictDetails.parse({ field: 'intent', rule: 'stale_quote', current_intent: eligibleIntent })).toMatchObject({ current_intent: { quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2' } })
  expect(billing.purchaseConflictDetails.safeParse({ field: 'intent', rule: 'stale_quote' }).success).toBe(false)
  expect(billing.purchaseConflictDetails.safeParse({ field: 'operation_key', rule: 'operation_key_reused' }).success).toBe(true)
})

it('holds original USD balances and does not emit a mandate-only payment', () => {
  const held = { ...heldIntent, operation: 'invoice_payment', invoice_id: intentBase.intent_id, reason: 'legacy_usd_invoice', original_amount: { currency: 'usd', gross_cents: 17200 } }
  expect(billing.checkoutResponse.parse(held)).toMatchObject({ original_amount: { currency: 'usd', gross_cents: 17200 } })
  expect(billing.checkoutResponse.safeParse({ ...startedIntent, operation: 'mandate_setup' }).success).toBe(false)
})

it('keeps the payment identity in a completed paid-change response', () => {
  const view = { available: true, account: null, payment_method: null, payment_method_options: [], invoices: [] }
  const result = { billing: view, charged: null, intent: { ...startedIntent, operation: 'paid_change', payment: { kind: 'mandate' } } }
  expect(billing.billingChangeResponse.parse(result)).toHaveProperty('intent.payment_id', startedIntent.payment_id)
  expect(billing.purchaseIntentResponse.parse(result)).toEqual(result)
  expect(billing.billingChangeResponse.safeParse({ billing: view, charged: null }).success).toBe(true)
})

it('rejects historical currency when calculating a new charge, even a zero-charge change', () => {
  // Simulates a JS caller or a historic account crossing the new-write boundary.
  const currency = 'usd' as 'eur'
  expect(() => periodNetCents({ plan: 'pro', addons: NONE, cycle: 'monthly', currency })).toThrow(/EUR/)
  expect(() => checkoutQuote({ plan: 'pro', addons: NONE, cycle: 'monthly', currency, rate_percent: 0 })).toThrow(/EUR/)
  expect(() => changeNetCents({ from: { plan: 'pro', addons: NONE, cycle: 'yearly' }, to: { plan: 'plus', addons: NONE, cycle: 'monthly' }, currency, periodStart: at('2026-01-01'), periodEnd: at('2027-01-01'), now: at('2026-06-01') })).toThrow(/EUR/)
})


it('binds invoice-paying intents to an invoice and mandate setup to its unresolved hold', () => {
  for (const operation of ['invoice_payment', 'payment_method_invoice']) {
    expect(billing.checkoutResponse.safeParse({ ...eligibleIntent, operation }).success).toBe(false)
    expect(billing.checkoutResponse.safeParse({ ...eligibleIntent, operation, invoice_id: intentBase.intent_id }).success).toBe(true)
  }
  expect(billing.checkoutResponse.safeParse({ ...heldIntent, reason: 'legacy_payer_unresolved' }).success).toBe(false)
  expect(billing.checkoutResponse.safeParse({ ...heldIntent, operation: 'checkout' }).success).toBe(false)
  expect(billing.checkoutResponse.safeParse({ ...startedIntent, payment: { kind: 'mandate' } }).success).toBe(false)
})
