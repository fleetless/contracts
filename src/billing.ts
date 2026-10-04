// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import {
  ADDONS,
  PLANS,
  PLAN_ORDER,
  addonKey,
  type AddonKey,
  type OrgAddons,
  type PlanCurrency,
  type PlanId,
  type PlanPrices,
} from './plans.js'

/**
 * Countries, VAT and the money math for billing through Mollie
 * (fleetless/fleetless#104).
 *
 * Every price here reads from `plans.ts`'s `PLANS` / `ADDONS` catalogue,
 * never a cent amount of its own, so a price change in one place is a price
 * change everywhere. Money is integer cents throughout; the one rounding a
 * proration or a VAT amount is allowed is `Math.round`, applied exactly
 * once (`prorateCents`, `vatCents`, and `changeNetCents`'s single
 * proration).
 */

/** ISO 3166-1 alpha-2, upper case. Greece is `GR` here; VIES calls it `EL`. */
export const countryCode = z.string().regex(/^[A-Z]{2}$/)

/** The 27 EU member states, as the billing country. Greece is `GR`. */
export const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const

/** The seller: Dehne Robotik GmbH. Fleetless never charges another EU country's VAT. */
export const SELLER_COUNTRY = 'DE'

/** Germany's VAT rate, in whole percent. */
export const DE_VAT_RATE_PERCENT = 19

/** Whether `country` is one of the 27 EU member states. */
export function isEuCountry(country: string): boolean {
  return (EU_COUNTRIES as readonly string[]).includes(country)
}

/** EUR in the EU, USD elsewhere (spec, Currency). */
export function currencyForCountry(country: string): PlanCurrency {
  return isEuCountry(country) ? 'eur' : 'usd'
}

/** Who is paying: a company (may hold a VAT ID) or a person (spec: full name, never a VAT ID). */
export const payerKind = z.enum(['company', 'person'])
export type PayerKind = z.infer<typeof payerKind>

/** The billing cycle: monthly, or yearly at twelve months for 15 % off (#103). */
export const billingCycle = z.enum(['monthly', 'yearly'])
export type BillingCycle = z.infer<typeof billingCycle>

/**
 * How a charge is taxed: `de_standard` (German VAT), `reverse_charge` (0 %,
 * an EU company whose VAT ID VIES confirms) or `outside_eu` (0 %, no
 * reverse-charge note).
 */
export const vatTreatment = z.enum(['de_standard', 'reverse_charge', 'outside_eu'])
export type VatTreatment = z.infer<typeof vatTreatment>

/**
 * Why `vatFor` refused a payer: `eu_person` (a person outside Germany, in
 * another EU country), `vat_id_required` (a company in another EU country
 * gave no VAT ID) or `vat_id_invalid` (VIES said the given VAT ID is
 * invalid).
 */
export const payerRefusalRule = z.enum(['eu_person', 'vat_id_required', 'vat_id_invalid'])
export type PayerRefusalRule = z.infer<typeof payerRefusalRule>

/** What `vatFor` decides: allowed with a treatment and rate, or refused with a rule. */
export type VatDecision = { allowed: true; treatment: VatTreatment; rate_percent: number } | { allowed: false; rule: PayerRefusalRule }

/**
 * The spec's "Who may pay, and VAT" table. `vatIdValid`: `null` = no VAT ID
 * given; `true` = VIES valid **or unverified** (VIES unreachable is
 * accepted); `false` = VIES said invalid.
 *
 * Germany is unconditional — company or person, VAT ID optional, 19 %
 * regardless of whether a given ID checks out. A German VAT ID's validity
 * never gates checkout, only the renewal sweep later (dunning, ruling 12);
 * `vatFor` only ever prices the charge in hand.
 */
export function vatFor(input: { kind: PayerKind; country: string; vatIdValid: boolean | null }): VatDecision {
  const { kind, country, vatIdValid } = input
  if (country === SELLER_COUNTRY) return { allowed: true, treatment: 'de_standard', rate_percent: DE_VAT_RATE_PERCENT }
  if (isEuCountry(country)) {
    if (kind === 'person') return { allowed: false, rule: 'eu_person' }
    if (vatIdValid === true) return { allowed: true, treatment: 'reverse_charge', rate_percent: 0 }
    if (vatIdValid === false) return { allowed: false, rule: 'vat_id_invalid' }
    return { allowed: false, rule: 'vat_id_required' }
  }
  return { allowed: true, treatment: 'outside_eu', rate_percent: 0 }
}

/** VIES's member-state code: `EL` for `GR`, the country otherwise. */
export function viesCountry(country: string): string {
  return country === 'GR' ? 'EL' : country
}

/**
 * Upper-case, without spaces, dots and dashes, and without a leading
 * country prefix: the VIES code (`EL` for Greece) or, for Greece only, the
 * address code `GR` as well — a payer typing their own country's postal
 * code ahead of the number is as likely as the VIES one. `null` for an
 * empty string (trimmed).
 */
export function normalizeVatId(country: string, raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let cleaned = trimmed.toUpperCase().replace(/[\s.-]/g, '')
  const vies = viesCountry(country)
  const prefixes = country === 'GR' ? [vies, country] : [vies]
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length)
      break
    }
  }
  return vies + cleaned
}

function priceKeyFor(cycle: BillingCycle, currency: PlanCurrency): keyof PlanPrices {
  return `${currency}_${cycle === 'monthly' ? 'month' : 'year'}` as keyof PlanPrices
}

function planPriceCentsFor(plan: PlanId, cycle: BillingCycle, currency: PlanCurrency): number {
  const prices = PLANS[plan].prices
  if (prices === null) throw new Error(`billing: ${plan} has no catalogue price — sold by contract, never self-service`)
  return prices[priceKeyFor(cycle, currency)]
}

/**
 * Net price of one period: the plan plus each add-on × units, for the
 * cycle and currency. Add-ons count only on Pro — `plans.ts`'s own rule for
 * which plans may buy them at all (`planFeature.addons`). Throws for
 * `enterprise`: its price is `null`, sold by contract, and self-service
 * never charges it.
 */
export function periodNetCents(input: { plan: PlanId; addons: OrgAddons; cycle: BillingCycle; currency: PlanCurrency }): number {
  const { plan, addons, cycle, currency } = input
  const key = priceKeyFor(cycle, currency)
  let total = planPriceCentsFor(plan, cycle, currency)
  if (plan === 'pro') {
    for (const addon of addonKey.options) {
      const units = addons[addon]
      if (units > 0) total += ADDONS[addon].prices[key] * units
    }
  }
  return total
}

/** `Math.round(priceCents * remainingDays / periodDays)` — the one rounding every proration in this module uses. */
export function prorateCents(priceCents: number, remainingDays: number, periodDays: number): number {
  return Math.round((priceCents * remainingDays) / periodDays)
}

/** `Math.round(netCents * ratePercent / 100)`. */
export function vatCents(netCents: number, ratePercent: number): number {
  return Math.round((netCents * ratePercent) / 100)
}

/** One charge's amounts, in integer cents, excluding and including VAT. */
export interface ChargeAmounts {
  net_cents: number
  vat_cents: number
  gross_cents: number
}

/** Net, VAT (`vatCents`) and gross for one charge. */
export function chargeAmounts(netCents: number, ratePercent: number): ChargeAmounts {
  const vat = vatCents(netCents, ratePercent)
  return { net_cents: netCents, vat_cents: vat, gross_cents: netCents + vat }
}

/** Milliseconds in a day. */
export const DAY_MS = 86_400_000

/** Whole days between `start` and `end` (`Math.round`). */
export function periodDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS)
}

/** Days left until `end`, as of `now` (`Math.ceil`), clamped to `[0, days]`. */
export function remainingDays(now: Date, end: Date, days: number): number {
  const left = Math.ceil((end.getTime() - now.getTime()) / DAY_MS)
  return Math.min(Math.max(left, 0), days)
}

/** A billing state: plan, add-ons and cycle — enough to price one period, or compare two for `changeNetCents`. */
export interface BillingState {
  plan: PlanId
  addons: OrgAddons
  cycle: BillingCycle
}

/**
 * The net amount charged NOW for moving `from` → `to` within the period
 * (spec, "Changes within a period"). Three branches, in this order:
 *
 * 1. **Monthly → yearly**: the full yearly price of `to` (plan plus
 *    add-ons, Pro only) minus the unused share of `from`'s monthly price,
 *    floored at 0. The period restarts today with a new anchor (ruling
 *    14), so this is the only branch that prices `to` and `from` on
 *    different cycles.
 * 2. **Yearly → monthly**: the reverse is a cycle *decrease* — charged 0
 *    now, stored as `next_cycle` and applied at the period's end (ruling
 *    10), like every other decrease.
 * 3. **Same cycle**: the increase only — the plan difference when `to` is
 *    the higher plan (`PLAN_ORDER`), plus each add-on's added units × its
 *    unit price, prorated once over the remaining days. A plan decrease
 *    contributes 0 to the plan term; add-ons count only when `to.plan` is
 *    `pro`, so moving down and away from Pro makes `to`'s add-ons
 *    irrelevant even if the caller still sends them — both the plan
 *    decrease and the add-on drop wait for the period's end. A plan
 *    *increase* combined with an add-on *increase* in the same request
 *    simply sums both terms before the single proration; a plan decrease
 *    combined with an add-on *increase* still charges the add-on term (it
 *    is priced independently of the plan term), unless the add-on increase
 *    is itself on the now-irrelevant `to`'s Pro-only add-ons.
 */
export function changeNetCents(input: {
  from: BillingState
  to: BillingState
  currency: PlanCurrency
  periodStart: Date
  periodEnd: Date
  now: Date
}): number {
  const { from, to, currency, periodStart, periodEnd, now } = input
  const days = periodDays(periodStart, periodEnd)
  const remaining = remainingDays(now, periodEnd, days)

  if (from.cycle === 'monthly' && to.cycle === 'yearly') {
    const yearlyTo = periodNetCents({ plan: to.plan, addons: to.addons, cycle: 'yearly', currency })
    const unusedFromShare = prorateCents(
      periodNetCents({ plan: from.plan, addons: from.addons, cycle: 'monthly', currency }),
      remaining,
      days,
    )
    return Math.max(0, yearlyTo - unusedFromShare)
  }

  if (from.cycle === 'yearly' && to.cycle === 'monthly') return 0

  const planIncrease =
    PLAN_ORDER.indexOf(to.plan) > PLAN_ORDER.indexOf(from.plan)
      ? planPriceCentsFor(to.plan, to.cycle, currency) - planPriceCentsFor(from.plan, to.cycle, currency)
      : 0

  let addonIncrease = 0
  if (to.plan === 'pro') {
    const fromAddons = from.plan === 'pro' ? from.addons : null
    const key = priceKeyFor(to.cycle, currency)
    for (const addon of addonKey.options) {
      const base = fromAddons ? fromAddons[addon] : 0
      const added = Math.max(0, to.addons[addon] - base)
      if (added > 0) addonIncrease += added * ADDONS[addon].prices[key]
    }
  }

  return prorateCents(planIncrease + addonIncrease, remaining, days)
}

/** One line of a `CheckoutQuote`: the plan, or one add-on, with its quantity and both amounts. */
export interface QuoteLine {
  item: 'plan' | AddonKey
  quantity: number
  net_cents: number
  gross_cents: number
}

/** The first charge of a checkout, broken into lines, in the cycle and currency it is quoted in. */
export interface CheckoutQuote extends ChargeAmounts {
  lines: QuoteLine[]
  rate_percent: number
  currency: PlanCurrency
  cycle: BillingCycle
}

/**
 * The first charge of a checkout: one full period of `plan` + `addons`.
 * One line for the plan, then one line per add-on actually bought
 * (quantity 0 is omitted, not a zero-amount line).
 */
export function checkoutQuote(input: {
  plan: 'plus' | 'pro'
  addons: OrgAddons
  cycle: BillingCycle
  currency: PlanCurrency
  rate_percent: number
}): CheckoutQuote {
  const { plan, addons, cycle, currency, rate_percent } = input
  const key = priceKeyFor(cycle, currency)
  const lines: QuoteLine[] = []

  const planNet = planPriceCentsFor(plan, cycle, currency)
  lines.push({ item: 'plan', quantity: 1, net_cents: planNet, gross_cents: chargeAmounts(planNet, rate_percent).gross_cents })

  if (plan === 'pro') {
    for (const addon of addonKey.options) {
      const quantity = addons[addon]
      if (quantity > 0) {
        const net = ADDONS[addon].prices[key] * quantity
        lines.push({ item: addon, quantity, net_cents: net, gross_cents: chargeAmounts(net, rate_percent).gross_cents })
      }
    }
  }

  const netCents = lines.reduce((sum, line) => sum + line.net_cents, 0)
  return { ...chargeAmounts(netCents, rate_percent), lines, rate_percent, currency, cycle }
}

/** Dunning (spec, Failed renewal): retries on these days after the charge's due date. */
export const BILLING_RETRY_DAYS = [3, 7] as const

/** The day, after the charge's due date, the org is locked when still unpaid. */
export const BILLING_LOCK_DAY = 14
