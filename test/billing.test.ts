// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { BILLING_RETRY_DAYS, BILLING_LOCK_DAY, EU_COUNTRIES, changeNetCents, chargeAmounts, checkoutQuote, currencyForCountry, normalizeVatId, periodDays, periodNetCents, prorateCents, remainingDays, vatFor, viesCountry } from '../src/billing.js'

const NONE = { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 }
const at = (s: string) => new Date(s)

describe('who may pay, and the VAT (spec table)', () => {
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

describe('money (spec examples)', () => {
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
  it('dunning schedule', () => {
    expect(BILLING_RETRY_DAYS).toEqual([3, 7])
    expect(BILLING_LOCK_DAY).toBe(14)
  })
})
