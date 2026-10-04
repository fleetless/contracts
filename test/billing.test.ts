// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  BILLING_RETRY_DAYS, BILLING_LOCK_DAY, EU_COUNTRIES, billingAccount, billingInvoice, changeNetCents, chargeAmounts, checkoutQuote, checkoutRequest,
  billingChangeRequest, currencyForCountry, normalizeVatId, paymentMethod, paymentMethodChangeRequest, paymentMethodKind, billingView, periodDays, periodNetCents, prorateCents, remainingDays, vatFor,
  viesCountry,
} from '../src/billing.js'
import { ERROR_CODES, paymentProviderUnavailableDetails } from '../src/errors.js'

const NONE = { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 }
const at = (s: string) => new Date(s)

describe('who may pay, and the VAT', () => {
  it('Germany: company or person, 19 %, VAT ID optional', () => {
    expect(vatFor({ kind: 'company', country: 'DE', vatIdValid: null })).toEqual({ allowed: true, treatment: 'de_standard', rate_percent: 19 })
    expect(vatFor({ kind: 'person', country: 'DE', vatIdValid: null })).toEqual({ allowed: true, treatment: 'de_standard', rate_percent: 19 })
  })
  it('another EU country: only a company with a VAT ID VIES confirms, 0 % reverse charge', () => {
    expect(vatFor({ kind: 'company', country: 'AT', vatIdValid: true })).toEqual({ allowed: true, treatment: 'reverse_charge', rate_percent: 0 })
    expect(vatFor({ kind: 'company', country: 'AT', vatIdValid: null })).toEqual({ allowed: false, rule: 'vat_id_required' })
    expect(vatFor({ kind: 'company', country: 'AT', vatIdValid: false })).toEqual({ allowed: false, rule: 'vat_id_invalid' })
    expect(vatFor({ kind: 'person', country: 'AT', vatIdValid: null })).toEqual({ allowed: false, rule: 'eu_person' })
  })
  it('outside the EU: everyone, 0 %', () => {
    expect(vatFor({ kind: 'person', country: 'US', vatIdValid: null })).toEqual({ allowed: true, treatment: 'outside_eu', rate_percent: 0 })
    expect(vatFor({ kind: 'company', country: 'CH', vatIdValid: null })).toEqual({ allowed: true, treatment: 'outside_eu', rate_percent: 0 })
  })
  it('currency: EUR in the EU, USD elsewhere', () => {
    expect(EU_COUNTRIES).toHaveLength(27)
    expect(currencyForCountry('FR')).toBe('eur')
    expect(currencyForCountry('GB')).toBe('usd')
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
    expect(changeNetCents({ from: { plan: 'plus', addons: NONE, cycle: 'monthly' }, to: { plan: 'pro', addons: NONE, cycle: 'monthly' }, currency: 'usd', periodStart: start, periodEnd: end, now })).toBe(Math.round((17200 - 3400) * 21 / 30))
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
    expect(periodNetCents({ plan: 'pro', addons: { ...NONE, robots: 2, app_user_packs: 1 }, cycle: 'yearly', currency: 'usd' })).toBe(174800 + 2 * 22300 + 11800)
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
    for (const currency of ['eur', 'usd'] as const)
      for (const cycle of ['monthly', 'yearly'] as const)
        for (const rate_percent of [0, 19])
          for (const k of keys)
            for (let n = 1; n <= 5; n++) {
              const q = checkoutQuote({ plan: 'pro', addons: { ...NONE, [k]: n }, cycle, currency, rate_percent })
              expect(q.lines.reduce((sum, l) => sum + l.gross_cents, 0), `${currency} ${cycle} ${rate_percent} % ${n} ${k}`).toBe(q.gross_cents)
            }
    const all = checkoutQuote({ plan: 'pro', addons: { seats: 3, robots: 5, apps: 2, app_user_packs: 4, live_video_packs: 1 }, cycle: 'yearly', currency: 'usd', rate_percent: 19 })
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
  it('a checkout needs the terms; a person also the withdrawal sentence', () => {
    expect(checkoutRequest.safeParse({ plan: 'pro', cycle: 'monthly', billing: company, accept_terms: true }).success).toBe(true)
    expect(checkoutRequest.safeParse({ plan: 'pro', cycle: 'monthly', billing: company, accept_terms: false }).success).toBe(false)
    expect(checkoutRequest.safeParse({ plan: 'basic', cycle: 'monthly', billing: company, accept_terms: true }).success).toBe(false)
    expect(
      checkoutRequest.safeParse({ plan: 'pro', cycle: 'monthly', billing: { ...company, kind: 'person', full_name: 'Ada' }, accept_terms: true }).success,
    ).toBe(false) // a person has no vat_id/company_name
  })
  it('a change names at least one thing, with absolute add-on counts', () => {
    expect(billingChangeRequest.safeParse({}).success).toBe(false)
    expect(billingChangeRequest.safeParse({ addons: { robots: 2 } }).success).toBe(true)
    expect(billingChangeRequest.safeParse({ plan: 'basic' }).success).toBe(false)
  })
  it('the billing view parses an active account and the mockup invoice number', () => {
    expect(billingInvoice.shape.number.safeParse('FL-2026-0142').success).toBe(true)
    expect(billingInvoice.shape.number.safeParse('FL-2026-142').success).toBe(false)
    expect(paymentMethod.safeParse({ kind: 'card', brand: 'Visa', last4: '4242', expires: '08/28' }).success).toBe(true)
  })
  it('card, PayPal and Apple Pay; no SEPA (André, 2026-10-04)', () => {
    expect(paymentMethodKind.options).toEqual(['card', 'paypal', 'applepay'])
    expect(paymentMethodChangeRequest.safeParse({ method: 'applepay' }).success).toBe(true)
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
