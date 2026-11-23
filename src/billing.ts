// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import {
  ADDONS,
  PLANS,
  PLAN_ORDER,
  addonKey,
  orgAddons,
  planCurrency,
  planId,
  planChangeKeep,
  type AddonKey,
  type OrgAddons,
  type PlanId,
  type PlanPrices,
} from './plans.js'
import { legalDocumentReference } from './legal.js'
import { purchaseOperationKey } from './purchase-operation-key.js'
import { confirmationProof } from './confirmation-proof.js'
import { ianaTimeZones } from './iana-time-zones.js'
export { purchaseOperationKey } from './purchase-operation-key.js'
export { confirmationProof } from './confirmation-proof.js'
export type { ConfirmationProof } from './confirmation-proof.js'

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

/** All new purchase prices are EUR, independent of the billing country. */
export function currencyForCountry(_country: string): 'eur' {
  return 'eur'
}

/** Who is paying: a company (may hold a VAT ID) or a person (a full name, never a VAT ID). */
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

/** A refusal of a new paid purchase, never a restriction on free Basic. */
export const payerRefusalRule = z.enum(['company_required', 'vat_id_required', 'vat_id_invalid'])
export type PayerRefusalRule = z.infer<typeof payerRefusalRule>

export const viesPendingReason = z.enum(['vies_unavailable', 'vies_unverified', 'vies_identifier_missing'])
export type ViesPendingReason = z.infer<typeof viesPendingReason>

/** Internal decision input; the complete direct response stays in protected Finance storage. */
export type ViesVerdict =
  | { status: 'valid'; requestIdentifier?: string | null }
  | { status: 'invalid' | 'unavailable' | 'unverified' }

export const vatDecision = z.discriminatedUnion('state', [
  z.object({ state: z.literal('eligible'), treatment: vatTreatment, rate_percent: z.number().int().min(0).max(100) }).strict(),
  z.object({ state: z.literal('pending'), reason: viesPendingReason }).strict(),
  z.object({ state: z.literal('refused'), rule: payerRefusalRule }).strict(),
])
export type VatDecision = z.infer<typeof vatDecision>

/**
 * New paid purchase VAT classification. `vies: null` means no VAT ID;
 * unverified/unavailable means an ID was supplied but has no definitive evidence.
 * Only a direct, current-buyer VIES verdict with an identifier permits reverse charge.
 * Cloud separately validates complete purchase details and the current email policy,
 * and binds the evidence to the buyer and quote under its charge lock.
 */
export function vatFor(input: { kind: PayerKind; country: string; vies: ViesVerdict | null }): VatDecision {
  const { kind, country, vies } = input
  if (kind !== 'company') return { state: 'refused', rule: 'company_required' }
  if (country === SELLER_COUNTRY) return { state: 'eligible', treatment: 'de_standard', rate_percent: DE_VAT_RATE_PERCENT }
  if (!isEuCountry(country)) return { state: 'eligible', treatment: 'outside_eu', rate_percent: 0 }
  if (vies === null) return { state: 'refused', rule: 'vat_id_required' }
  if (vies.status === 'invalid') return { state: 'refused', rule: 'vat_id_invalid' }
  if (vies.status === 'valid') {
    return vies.requestIdentifier?.trim()
      ? { state: 'eligible', treatment: 'reverse_charge', rate_percent: 0 }
      : { state: 'pending', reason: 'vies_identifier_missing' }
  }
  return { state: 'pending', reason: vies.status === 'unavailable' ? 'vies_unavailable' : 'vies_unverified' }
}

/** VIES's member-state code: `EL` for `GR`, the country otherwise. */
export function viesCountry(country: string): string {
  return country === 'GR' ? 'EL' : country
}

/**
 * Upper-case, without spaces, dots and dashes, and without a leading
 * country prefix: the VIES code (`EL` for Greece) or, for Greece only, the
 * address code `GR` as well, since a payer is as likely to type that. `null` for an
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

function priceKeyFor(cycle: BillingCycle, currency: 'eur'): keyof PlanPrices {
  if (currency !== 'eur') throw new Error('billing: new prices require EUR; read historical amounts from their recorded snapshots')
  return `eur_${cycle === 'monthly' ? 'month' : 'year'}`
}

function planPriceCentsFor(plan: PlanId, cycle: BillingCycle, currency: 'eur'): number {
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
export function periodNetCents(input: { plan: PlanId; addons: OrgAddons; cycle: BillingCycle; currency: 'eur' }): number {
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
 * — increases are charged at once, decreases wait for the period's end,
 * nothing is credited. Three branches, in this order:
 *
 * 1. **Monthly → yearly**: the full yearly price of `to` (plan plus
 *    add-ons, Pro only) minus the unused share of `from`'s monthly price,
 *    floored at 0. The period restarts today with a new anchor, so this
 *    is the only branch that prices `to` and `from` on different cycles.
 * 2. **Yearly → monthly**: the reverse is a cycle *decrease* — charged 0
 *    now, stored as `next_cycle` and applied at the period's end, like
 *    every other decrease.
 * 3. **Same cycle**: the increase only — the plan difference when `to` is
 *    the higher plan (`PLAN_ORDER`), plus each add-on's added units × its
 *    unit price, summed and prorated once over the remaining days. A plan
 *    decrease and fewer add-ons contribute 0; add-ons count only when
 *    `to.plan` is `pro`, and units held on a plan other than Pro count as
 *    none.
 */
export function changeNetCents(input: {
  from: BillingState
  to: BillingState
  currency: 'eur'
  periodStart: Date
  periodEnd: Date
  now: Date
}): number {
  const { from, to, currency, periodStart, periodEnd, now } = input
  priceKeyFor(to.cycle, currency) // Also reject a non-EUR zero-charge change.
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
  currency: 'eur'
  cycle: BillingCycle
}

/**
 * The first charge of a checkout: one full period of `plan` + `addons`.
 * One line for the plan, then one line per add-on actually bought
 * (quantity 0 is omitted, not a zero-amount line).
 *
 * The VAT is rounded once, over the whole net amount, because that is what
 * is charged. Rounding it per line can land a cent off that total, so the
 * plan line absorbs the difference: the gross lines always add up to
 * `gross_cents`, and the amount a person sees is the amount charged.
 */
export function checkoutQuote(input: {
  plan: 'plus' | 'pro'
  addons: OrgAddons
  cycle: BillingCycle
  currency: 'eur'
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
  const total = chargeAmounts(netCents, rate_percent)
  lines[0]!.gross_cents += total.gross_cents - lines.reduce((sum, line) => sum + line.gross_cents, 0)
  return { ...total, lines, rate_percent, currency, cycle }
}

/** Dunning after a failed renewal: retries on these days after the charge's due date. */
export const BILLING_RETRY_DAYS = [3, 7] as const

/** The day, after the charge's due date, the org is locked when still unpaid. */
export const BILLING_LOCK_DAY = 14

/*
 * ---------------------------------------------------------------------------
 * Billing shapes: checkout, the billing account, invoices and the owner's
 * self-service changes (2026-10-04, fleetless/fleetless#104, I-2).
 *
 * The wire shapes for `src/routes.ts`'s `billing` section
 * (`GET /api/billing`, `POST /api/billing/*`). Money is the same
 * integer-cents discipline as everything above; every price still comes
 * from `plans.ts`'s catalogue through `periodNetCents` / `changeNetCents` —
 * nothing here invents a cent amount of its own.
 * ---------------------------------------------------------------------------
 */

/** Historical address read and owner edit shape; purchase validation is stricter. */
export const billingAddress = z.object({
  line1: z.string().trim().min(1).max(200).meta({ description: 'Street and number, or the first address line.' }),
  line2: z.string().trim().max(200).nullable().meta({ description: 'A second address line, or `null` when there is none.' }),
  postal_code: z.string().trim().min(1).max(20).meta({ description: 'Postal or ZIP code.' }),
  city: z.string().trim().min(1).max(100).meta({ description: 'City or town.' }),
  country: countryCode.meta({ description: "The billing country, used for purchase eligibility and VAT." }),
  state: z.string().trim().min(1).max(100).optional().meta({ description: "State or region. A new US purchase requires a two-letter state code; historical addresses may omit it." }),
}).strict()
export type BillingAddress = z.infer<typeof billingAddress>

/**
 * Who is paying: a `company` (may hold a VAT
 * ID, checked through VIES) or a `person` (full name, never a VAT ID — only
 * a company can be VAT-registered). The discriminant decides which other
 * fields exist at all, so a person cannot even send `vat_id` or
 * `company_name` — there is no field for `.strict()` to refuse, the shape
 * itself has none.
 */
export const billingDetails = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('company').meta({ description: 'Billed as a company.' }),
    company_name: z.string().trim().min(1).max(200).meta({ description: "The company's legal name, printed on the invoice." }),
    vat_id: z.string().trim().max(20).nullable().meta({
      description: "The company's VAT ID, or `null` for none. Required for a new purchase in another EU country; direct VIES must confirm it with an identifier.",
    }),
    tax_id: z.string().trim().max(100).nullable().optional().meta({ description: "Free-text Tax ID. Required for a new non-EU purchase; historical records may omit it." }),
    address: billingAddress.meta({ description: 'The billing address.' }),
    invoice_email: z.email().meta({ description: 'Where invoices and billing mail are sent.' }),
  }).strict().meta({ description: "A company: name and an optional VAT ID, never 'full name'." }),
  z.object({
    kind: z.literal('person').meta({ description: 'Billed as a person.' }),
    full_name: z.string().trim().min(1).max(200).meta({ description: "The person's full name, printed on the invoice." }),
    address: billingAddress.meta({ description: 'The billing address.' }),
    invoice_email: z.email().meta({ description: 'Where invoices and billing mail are sent.' }),
  }).strict().meta({ description: 'A person: a full name, never a VAT ID — only a company can be VAT-registered.' }),
])
export type BillingDetails = z.infer<typeof billingDetails>

/** New paid write shape. Historical payer reads keep using `billingDetails`. */
export const purchaseBillingDetails = billingDetails.options[0].superRefine((payer, ctx) => {
  const country = payer.address.country
  if (isEuCountry(country) && country !== SELLER_COUNTRY && !payer.vat_id?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['vat_id'], message: 'vat_id_required' })
  }
  if (!isEuCountry(country) && !payer.tax_id?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['tax_id'], message: 'tax_id_required' })
  }
  if (country === 'US' && !/^[A-Z]{2}$/.test(payer.address.state ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['address', 'state'], message: 'us_state_required' })
  }
}).meta({ description: 'New company purchase. Other EU countries require VAT ID; non-EU requires Tax ID; US requires two-letter state. Cloud additionally checks the versioned public-email policy and current VIES evidence.' })
export type PurchaseBillingDetails = z.infer<typeof purchaseBillingDetails>

/** Generate before POST; unique within the authenticated org. A checkout or paid change takes a fresh key per press. */
export const purchaseOperation = z.enum(['checkout', 'paid_change', 'invoice_payment', 'payment_method_invoice', 'mandate_setup'])
export type PurchaseOperation = z.infer<typeof purchaseOperation>
const chargeOperation = purchaseOperation.exclude(['mandate_setup'])

/** Starting a checkout records an intent; only confirming its current quote may create a payment. */
export const checkoutRequest = z.object({
  operation_key: purchaseOperationKey,
  plan: z.enum(['plus', 'pro']).meta({ description: 'The paid plan to buy; Basic requires no checkout.' }),
  cycle: billingCycle.meta({ description: 'Monthly, or yearly at 15 percent off.' }),
  addons: orgAddons.partial().strict().optional().meta({ description: 'Add-on units to buy; Pro only. Cloud refuses add-ons on Plus.' }),
  billing: purchaseBillingDetails.meta({ description: 'The company buying the plan. Country requirements, current VIES and the email policy must pass before charging.' }),
  accept_terms: z.literal(true).optional().meta({ description: 'Deprecated draft input. It is not evidence of a displayed C.4 declaration and never confirms an order.' }),
}).strict()
export type CheckoutRequest = z.infer<typeof checkoutRequest>

const purchaseCents = z.number().int().nonnegative()
/** Current amount to confirm. Issued USD invoices must be held, never relabelled EUR. */
export const purchaseQuote = z.object({
  currency: z.literal('eur').meta({ description: 'Every new quote is in EUR.' }),
  net_cents: purchaseCents.meta({ description: 'Current charge excluding VAT, in cents.' }),
  vat_cents: purchaseCents.meta({ description: 'VAT on the current charge, in cents.' }),
  gross_cents: purchaseCents.meta({ description: 'Total to confirm, including VAT, in cents.' }),
  rate_percent: z.number().int().min(0).max(100).meta({ description: 'VAT rate in whole percent.' }),
}).strict()
export type PurchaseQuote = z.infer<typeof purchaseQuote>

const quoteIdentity = {
  quote_revision: z.string().trim().min(1).max(200).meta({ description: 'Opaque revision of the displayed quote; echo it when confirming.' }),
  buyer_fingerprint: z.string().trim().min(1).max(200).meta({ description: 'Opaque revision of buyer details and email policy; never full VIES evidence.' }),
}

/** Cloud issues a display only for an eligible, current customer decision. */
export const billingDecisionDisplayRequest = z.object({
  operation_key: purchaseOperationKey,
  operation: z.enum(['checkout', 'paid_change']),
}).strict()
export type BillingDecisionDisplayRequest = z.infer<typeof billingDecisionDisplayRequest>

const selectionBase = {
  plan: z.enum(['basic', 'plus', 'pro']),
  cycle: billingCycle,
  addons: orgAddons,
}
const purchaseSelection = z.object(selectionBase).strict()
const planChangeSelection = z.object({ ...selectionBase, keep: planChangeKeep.nullable() }).strict()
const addonLine = z.object({ addon: addonKey, quantity: z.number().int().positive(), net_cents: purchaseCents }).strict()

const treatmentRules = [
  { if: { properties: { vat_treatment: { const: 'de_standard' } }, required: ['vat_treatment'] }, then: { properties: { quote: { properties: { rate_percent: { const: 19 } } } } } },
  { if: { properties: { vat_treatment: { const: 'reverse_charge' } }, required: ['vat_treatment'] }, then: { properties: { quote: { properties: { rate_percent: { const: 0 }, vat_cents: { const: 0 } } }, period_vat_cents: { const: 0 }, vat_treatment_line: { const: 'Reverse charge — VAT payable by the recipient' } } } },
  { if: { properties: { vat_treatment: { const: 'outside_eu' } }, required: ['vat_treatment'] }, then: { properties: { quote: { properties: { rate_percent: { const: 0 }, vat_cents: { const: 0 } } }, period_vat_cents: { const: 0 }, vat_treatment_line: { const: 'Not taxable in Germany' } } } },
]

export const billingDecisionAmounts = z.object({
  currency: z.literal('eur'),
  quote: purchaseQuote,
  plan_net_cents: purchaseCents,
  addon_lines: z.array(addonLine),
  period_net_cents: purchaseCents,
  period_vat_cents: purchaseCents,
  period_gross_cents: purchaseCents,
  vat_treatment: vatTreatment,
  vat_treatment_line: z.string().min(1),
  due_today_gross_cents: purchaseCents,
  prorated_net_cents: purchaseCents.nullable(),
  renewal_net_cents: purchaseCents,
}).strict().superRefine((value, ctx) => {
  const invalid = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: [field], message })
  if (value.quote.gross_cents !== value.quote.net_cents + value.quote.vat_cents) invalid('quote', 'Quote gross must equal net plus VAT.')
  if (value.period_gross_cents !== value.period_net_cents + value.period_vat_cents) invalid('period_gross_cents', 'Period gross must equal net plus VAT.')
  if (value.period_net_cents !== value.plan_net_cents + value.addon_lines.reduce((sum, line) => sum + line.net_cents, 0)) invalid('period_net_cents', 'Plan and add-on lines must reconcile.')
  if (value.due_today_gross_cents !== value.quote.gross_cents) invalid('due_today_gross_cents', 'Due today must equal the quote gross.')
  if (value.vat_treatment === 'de_standard') {
    if (value.quote.rate_percent !== 19 || !value.vat_treatment_line.startsWith('19% German VAT: ')) invalid('vat_treatment', 'German VAT requires 19 percent and its display line.')
  } else if (value.quote.rate_percent !== 0 || value.quote.vat_cents !== 0 || value.period_vat_cents !== 0 || value.vat_treatment_line !== (value.vat_treatment === 'reverse_charge' ? 'Reverse charge — VAT payable by the recipient' : 'Not taxable in Germany')) {
    invalid('vat_treatment', 'Zero-rated treatment, rate, VAT and line must agree.')
  }
}).meta({ allOf: treatmentRules })
export type BillingDecisionAmounts = z.infer<typeof billingDecisionAmounts>

const utcInstant = z.iso.datetime().regex(/Z$/)
const ianaTimeZone = z.enum(ianaTimeZones)
function localDate(instant: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch { return null }
}
const existingBillingPeriod = z.object({
  anchor: z.literal('existing_period'),
  display_time_zone: ianaTimeZone,
  starts_on: z.iso.date(),
  starts_at: utcInstant.nullable(),
  current_period_ends_at: utcInstant,
  renews_at: utcInstant,
  effective: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('on_confirmation'), quoted_as_of_at: utcInstant, local_date: z.iso.date() }).strict(),
    z.object({ mode: z.literal('scheduled'), at: utcInstant, at_period_end: z.boolean() }).strict(),
  ]),
}).strict().superRefine((period, ctx) => {
  if (period.starts_at && localDate(period.starts_at, period.display_time_zone) !== period.starts_on) ctx.addIssue({ code: 'custom', path: ['starts_on'], message: 'Start date must match the instant in the display zone.' })
  if (period.effective.mode === 'scheduled' && period.effective.at_period_end && period.effective.at !== period.current_period_ends_at) ctx.addIssue({ code: 'custom', path: ['effective', 'at'], message: 'Period-end effect must equal the current period boundary.' })
  if (period.effective.mode === 'on_confirmation' && localDate(period.effective.quoted_as_of_at, period.display_time_zone) !== period.effective.local_date) ctx.addIssue({ code: 'custom', path: ['effective', 'local_date'], message: 'Quoted local date must match the display zone.' })
})
const firstPaymentPeriod = z.discriminatedUnion('cycle', [
  z.strictObject({
    anchor: z.literal('on_first_successful_payment'), cycle: z.literal('monthly'),
    start_statement: z.literal('Starts when your first payment succeeds'),
    period_statement: z.literal('First billing period: one full month from successful payment; renews at the end of that period'),
  }),
  z.strictObject({
    anchor: z.literal('on_first_successful_payment'), cycle: z.literal('yearly'),
    start_statement: z.literal('Starts when your first payment succeeds'),
    period_statement: z.literal('First billing period: one full year from successful payment; renews at the end of that period'),
  }),
])
export const billingDecisionPeriod = z.union([existingBillingPeriod, firstPaymentPeriod])
export type BillingDecisionPeriod = z.infer<typeof billingDecisionPeriod>

/*
 * ---------------------------------------------------------------------------
 * The C.4 declaration: one consent sentence and one button label per action
 * (2026-11-18, fleetless/fleetless#1168).
 *
 * A decision display names what the button above it does. The sentence and
 * the label are built here from the snapshot's own amounts, plan, cycle and
 * organization, so the cloud that issues a display and every client that
 * renders one write the same words, and a snapshot whose words do not match
 * its decision does not parse.
 * ---------------------------------------------------------------------------
 */

/**
 * Euro cents the way the console writes money: `de-DE` digits, whole euros
 * without `,00`, a plain space before the sign — `34,51 €`, `29 €`,
 * `1.234,56 €`. Throws for anything but a safe integer.
 */
export function formatEur(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`formatEur: ${cents} is not a whole number of cents`)
  const abs = Math.abs(cents)
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const rest = abs % 100
  return `${cents < 0 ? '-' : ''}${euros}${rest === 0 ? '' : `,${String(rest).padStart(2, '0')}`} €`
}

/**
 * What the owner's one click does: buy a first plan, pay now and switch,
 * switch at no charge, switch from yearly to monthly at the period end,
 * schedule a lower plan (or fewer add-ons), cancel to Basic, or stay on
 * Basic and delete what was not kept.
 */
export const C4_ACTIONS = ['checkout', 'pay_and_switch', 'switch', 'schedule_switch', 'schedule_downgrade', 'cancel', 'keep_basic'] as const
export type C4Action = (typeof C4_ACTIONS)[number]

/** The approved sentence of each action, by id, in the order of `C4_ACTIONS`. */
export const C4_TEXT_IDS = [
  'C4-1168-checkout', 'C4-1168-pay-and-switch', 'C4-1168-switch', 'C4-1168-schedule-switch', 'C4-1168-schedule-downgrade', 'C4-1168-cancel',
  'C4-1168-keep-basic',
] as const
export type C4TextId = (typeof C4_TEXT_IDS)[number]

/** The single sentence and button of the displays issued before one existed per action. Readable in stored snapshots only. */
const LEGACY_C4_TEXT_ID = 'DR-1374-draft-3-C.4'
const legacyC4Text = (org: string) => `By selecting “Order and pay”, you agree to the Terms of Service and the Data Processing Agreement for ${org}.`

/** The words of one decision display. */
export interface C4DeclarationText {
  text_id: C4TextId
  text: string
  action_label: string
}

/** What a sentence is written from: the organization, the plan it names, the amount due now, the period's gross and its cycle. */
export interface C4DeclarationValues {
  org: string
  /** The plan ordered; for `cancel`, the plan cancelled; unused by `keep_basic`. */
  plan: PlanId
  dueCents: number
  periodGrossCents: number
  cycle: BillingCycle
}

/** The consent sentence, the button label and the text id of `action`. Money is `formatEur`. */
export function c4Declaration(action: C4Action, v: C4DeclarationValues): C4DeclarationText {
  const plan = PLANS[v.plan].name
  const due = formatEur(v.dueCents)
  const gross = formatEur(v.periodGrossCents)
  const period = v.cycle === 'monthly' ? 'month' : 'year'
  const legal = 'agree to the Terms of Service and the Data Processing Agreement'
  const [label, rest] = ((): [string, string] => {
    switch (action) {
      case 'checkout':
        return [`Pay ${due} with Mollie`, `you order ${plan} for ${v.org} as a business, ${legal}, and authorise Fleetless to charge ${gross} every ${period} until you cancel.`]
      case 'pay_and_switch':
        return [`Pay ${due} and switch`, `you order ${plan} for ${v.org} as a business from today, ${legal}, and authorise Fleetless to charge ${due} now and ${gross} every ${period} after that until you cancel.`]
      case 'switch':
        return [`Switch to ${plan}`, `you order ${plan} for ${v.org} as a business from today, ${legal}, and authorise Fleetless to charge ${gross} every ${period} from the next renewal until you cancel.`]
      case 'schedule_switch':
        return ['Switch to monthly at period end', `you order ${plan} monthly for ${v.org} as a business from the end of the current period, ${legal}, and authorise Fleetless to charge ${gross} every month from then until you cancel.`]
      case 'schedule_downgrade':
        return [`Schedule downgrade to ${plan}`, `you order ${plan} for ${v.org} as a business from the end of the current period, ${legal}, and authorise Fleetless to charge ${gross} every ${period} from then until you cancel.`]
      case 'cancel':
        return ['Cancel at period end', `you cancel ${plan} for ${v.org} at the end of the current period; ${v.org} then stays on Basic under the Terms of Service and the Data Processing Agreement, and nothing more is charged.`]
      case 'keep_basic':
        return ['Delete the rest and stay on Basic', `${v.org} stays on Basic under the Terms of Service and the Data Processing Agreement; what you did not keep is deleted, and nothing is charged.`]
    }
  })()
  return { text_id: C4_TEXT_IDS[C4_ACTIONS.indexOf(action)]!, text: `By selecting “${label}”, ${rest}`, action_label: label }
}

/** The parts of a decision snapshot its action is read from. */
export interface C4Decision {
  decision_kind: 'checkout' | 'paid_change' | 'plan_change'
  amounts: { due_today_gross_cents: number }
  period: { anchor: 'existing_period'; effective: { mode: 'on_confirmation' | 'scheduled' } } | { anchor: 'on_first_successful_payment' }
  selection: { plan: PlanId; cycle: BillingCycle }
}

/** Where the org stands before the decision: its plan, and its cycle where known. */
export type C4From = PlanId | { plan: PlanId; cycle?: BillingCycle }

/**
 * The action of a decision. `checkout` for a first purchase; a paid change
 * charging now is `pay_and_switch`, one taking effect now at no charge
 * `switch`; a plan change to another plan is `schedule_downgrade`, to Basic
 * `cancel` from Plus or Pro and `keep_basic` from Basic or Enterprise (a
 * grandfathered plan): that needs `from`, and throws without it. A scheduled paid change is `schedule_downgrade` for a
 * lower plan or fewer add-ons and `schedule_switch` for yearly to monthly on
 * the same plan: that needs `from` when the target is monthly, and throws
 * without it.
 */
export function c4ActionOf(s: C4Decision, from?: C4From): C4Action {
  if (s.decision_kind === 'checkout') return 'checkout'
  if (s.decision_kind === 'plan_change') {
    if (s.selection.plan !== 'basic') return 'schedule_downgrade'
    if (from === undefined) throw new Error('c4ActionOf: a plan change to Basic needs the current plan to tell a cancellation from keeping Basic')
    const current = typeof from === 'string' ? from : from.plan
    return current === 'plus' || current === 'pro' ? 'cancel' : 'keep_basic'
  }
  if (s.amounts.due_today_gross_cents > 0) return 'pay_and_switch'
  if (s.period.anchor !== 'existing_period' || s.period.effective.mode === 'on_confirmation') return 'switch'
  if (s.selection.cycle === 'yearly') return 'schedule_downgrade'
  if (from === undefined) throw new Error('c4ActionOf: a scheduled monthly paid change needs the current plan to tell a downgrade from a cycle switch')
  const current = typeof from === 'string' ? { plan: from } : from
  if (PLAN_ORDER.indexOf(s.selection.plan) < PLAN_ORDER.indexOf(current.plan)) return 'schedule_downgrade'
  return current.cycle === 'monthly' ? 'schedule_downgrade' : 'schedule_switch'
}

/** Every action a snapshot can carry when the plan it starts from is not known. */
function c4ActionsOf(s: C4Decision): C4Action[] {
  if (s.decision_kind === 'plan_change' && s.selection.plan === 'basic') return ['cancel', 'keep_basic']
  if (s.decision_kind !== 'paid_change' || s.amounts.due_today_gross_cents > 0
    || s.period.anchor !== 'existing_period' || s.period.effective.mode === 'on_confirmation') return [c4ActionOf(s)]
  return s.selection.cycle === 'monthly' ? ['schedule_switch', 'schedule_downgrade'] : ['schedule_downgrade']
}

const separateLegalLinks = (value: { terms: { url: string }; dpa: { url: string } }, ctx: z.RefinementCtx) => {
  if (value.terms.url === value.dpa.url) ctx.addIssue({ code: 'custom', path: ['dpa'], message: 'Terms and DPA require separate version URLs.' })
}
const legalLinks = { terms: legalDocumentReference, dpa: legalDocumentReference }
const labelRules: Record<C4TextId, object> = {
  'C4-1168-checkout': { pattern: '^Pay \\S.* with Mollie$' },
  'C4-1168-pay-and-switch': { pattern: '^Pay \\S.* and switch$' },
  'C4-1168-switch': { pattern: '^Switch to \\S.*$' },
  'C4-1168-schedule-switch': { const: 'Switch to monthly at period end' },
  'C4-1168-schedule-downgrade': { pattern: '^Schedule downgrade to \\S.*$' },
  'C4-1168-cancel': { const: 'Cancel at period end' },
  'C4-1168-keep-basic': { const: 'Delete the rest and stay on Basic' },
}
const declaration = z.object({
  text_id: z.enum(C4_TEXT_IDS).meta({ description: 'The approved sentence this display shows, one per action.' }),
  text: z.string().min(1).regex(/^By selecting “/).meta({ description: 'The consent sentence shown directly above the button, naming the button.' }),
  action_label: z.string().min(1).meta({ description: 'The label of the one button that confirms this decision.' }),
  ...legalLinks,
}).strict().superRefine(separateLegalLinks).meta({
  allOf: C4_TEXT_IDS.map(textId => ({
    if: { properties: { text_id: { const: textId } }, required: ['text_id'] },
    then: { properties: { action_label: labelRules[textId] } },
  })),
})
const legacyDeclaration = z.object({
  text_id: z.literal(LEGACY_C4_TEXT_ID),
  text: z.string().min(1),
  ...legalLinks,
}).strict().superRefine(separateLegalLinks)

const snapshotBase = z.object({
  snapshot_id: z.uuid(),
  decision_id: z.uuid(),
  operation_key: purchaseOperationKey,
  owner_id: z.uuid(),
  organization_id: z.uuid(),
  organization_name: z.string().min(1),
  ...quoteIdentity,
  amounts: billingDecisionAmounts,
  period: billingDecisionPeriod,
  future_price_replacement: z.strictObject({ agreement_id: z.uuid(), text: z.string().min(1).regex(/\S/) }).nullable(),
  declaration,
  expires_at: utcInstant,
}).strict()
const snapshotVariants = [
  snapshotBase.extend({ decision_kind: z.literal('checkout'), selection: purchaseSelection }).strict(),
  snapshotBase.extend({ decision_kind: z.literal('paid_change'), selection: purchaseSelection, period: existingBillingPeriod }).strict(),
  snapshotBase.extend({ decision_kind: z.literal('plan_change'), selection: planChangeSelection, period: existingBillingPeriod }).strict(),
] as const
const storedDeclaration = z.union([declaration, legacyDeclaration])
const storedSnapshotVariants = z.discriminatedUnion('decision_kind', [
  snapshotVariants[0].extend({ declaration: storedDeclaration }).strict(),
  snapshotVariants[1].extend({ declaration: storedDeclaration }).strict(),
  snapshotVariants[2].extend({ declaration: storedDeclaration }).strict(),
])
type StoredSnapshotShape = z.infer<typeof storedSnapshotVariants>

/** The declaration must be the one its decision, amounts, plan and organization write; a legacy one only its own sentence. */
function checkDeclaration(value: StoredSnapshotShape, ctx: z.RefinementCtx) {
  const declared = value.declaration
  if (declared.text_id === LEGACY_C4_TEXT_ID) {
    if (declared.text !== legacyC4Text(value.organization_name)) ctx.addIssue({ code: 'custom', path: ['declaration', 'text'], message: 'Declaration must match the approved C.4 sentence and organization.' })
    return
  }
  const action = C4_ACTIONS[C4_TEXT_IDS.indexOf(declared.text_id)]!
  if (!c4ActionsOf(value).includes(action)) {
    ctx.addIssue({ code: 'custom', path: ['declaration', 'text_id'], message: 'Declaration must be the sentence of the action this decision is.' })
    return
  }
  const plans: PlanId[] = action === 'cancel' ? ['plus', 'pro'] : [value.selection.plan]
  const matches = plans.some(plan => {
    const expected = c4Declaration(action, {
      org: value.organization_name, plan, cycle: value.selection.cycle,
      dueCents: value.amounts.due_today_gross_cents, periodGrossCents: value.amounts.period_gross_cents,
    })
    return expected.text === declared.text && expected.action_label === declared.action_label
  })
  if (!matches) ctx.addIssue({ code: 'custom', path: ['declaration', 'text'], message: 'Declaration must match the approved sentence and button of its action, amounts, plan and organization.' })
}

function refineSnapshot(value: StoredSnapshotShape, ctx: z.RefinementCtx) {
  if (value.period.anchor === 'on_first_successful_payment' && value.period.cycle !== value.selection.cycle) {
    ctx.addIssue({ code: 'custom', path: ['period', 'cycle'], message: 'First-payment period must match the selected cycle.' })
  }
  checkDeclaration(value, ctx)
  if (value.amounts.vat_treatment === 'de_standard') {
    const euro = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(cents / 100)
    const period = value.selection.cycle === 'monthly' ? 'month' : 'year'
    const line = `19% German VAT: ${euro(value.amounts.period_vat_cents)}; total ${euro(value.amounts.period_gross_cents)} per ${period}`
    if (value.amounts.vat_treatment_line !== line) ctx.addIssue({ code: 'custom', path: ['amounts', 'vat_treatment_line'], message: 'German VAT line must match the displayed period amounts and cycle.' })
  }
  const lines = value.amounts.addon_lines
  const expectedAddons = addonKey.options.filter((key) => value.selection.addons[key] > 0)
  if (lines.length !== expectedAddons.length || lines.some((line, i) => line.addon !== expectedAddons[i] || line.quantity !== value.selection.addons[line.addon])) ctx.addIssue({ code: 'custom', path: ['amounts', 'addon_lines'], message: 'Add-on lines must match absolute selection in catalogue order.' })
}
const snapshotRules = { allOf: ['monthly', 'yearly'].map(cycle => ({
  if: { properties: { period: { properties: { anchor: { const: 'on_first_successful_payment' }, cycle: { const: cycle } }, required: ['anchor', 'cycle'] } }, required: ['period'] },
  then: { properties: { selection: { properties: { cycle: { const: cycle } }, required: ['cycle'] } }, required: ['selection'] },
})) }

/** What a C.4 display shows the owner. The declaration is the sentence and button of the decision's own action. */
export const billingDecisionSnapshot = z.discriminatedUnion('decision_kind', snapshotVariants).superRefine(refineSnapshot).meta(snapshotRules)
export type BillingDecisionSnapshot = z.infer<typeof billingDecisionSnapshot>

/**
 * A snapshot as the cloud stored it: also a display issued before each action
 * had its own sentence, with the single legacy declaration and no button label.
 * Never issued anew; for reading and replaying stored decisions only.
 */
export const storedBillingDecisionSnapshot = storedSnapshotVariants.superRefine(refineSnapshot).meta(snapshotRules)
export type StoredBillingDecisionSnapshot = z.infer<typeof storedBillingDecisionSnapshot>

export const billingDecisionDisplayResponse = z.object({
  confirmation_proof: confirmationProof,
  expires_at: utcInstant,
  snapshot: billingDecisionSnapshot,
}).strict().superRefine((value, ctx) => {
  if (value.expires_at !== value.snapshot.expires_at) ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'Display and snapshot expiry must match.' })
})
export type BillingDecisionDisplayResponse = z.infer<typeof billingDecisionDisplayResponse>

/** A prepared downward plan change carries the same Cloud-issued display. */
export const planChangePrepareResponse = z.object({
  change_id: z.uuid(),
  display: billingDecisionDisplayResponse,
}).strict().superRefine((value, ctx) => {
  if (value.display.snapshot.decision_kind !== 'plan_change') ctx.addIssue({ code: 'custom', path: ['display', 'snapshot', 'decision_kind'], message: 'Prepared plan changes require a plan-change display.' })
  if (value.display.snapshot.decision_id !== value.change_id) ctx.addIssue({ code: 'custom', path: ['display', 'snapshot', 'decision_id'], message: 'Display must refer to the prepared change.' })
}).meta({ allOf: [{ properties: { display: { properties: { snapshot: { properties: { decision_kind: { const: 'plan_change' } } } } } } }] })
export type PlanChangePrepareResponse = z.infer<typeof planChangePrepareResponse>

const intentIdentity = {
  intent_id: z.uuid().meta({ description: 'Opaque persisted purchase intent identity.' }),
  operation_key: purchaseOperationKey,
  operation: chargeOperation,
  invoice_id: z.uuid().optional().meta({
    description:
      'For an invoice-paying operation, the due charge or issued invoice being paid. For a confirmed paid_change with ' +
      'payment_started, the charge or invoice created for that decision; when the charge was issued through Lexware ' +
      '(`charged` is `null`), it identifies the matching billing.charges[].id. Absent on a paid_change in any other state.',
  }),
}
/**
 * Why an intent is held. Lexware never holds a purchase: its contact and
 * invoice follow the payment. A checkout or paid change is held only while an
 * issuer cutover runs (`issuer_cutover_in_progress`, minutes, then try again).
 * `mandate_policy_unresolved` is written no more (fleetless/fleetless#1185): it
 * stays for the method changes stored while they were on hold.
 */
export const purchaseHoldReason = z.enum([
  'legacy_usd_invoice', 'legacy_payer_unresolved', 'mandate_policy_unresolved', 'issuer_cutover_in_progress',
])
export const purchaseRefusalRule = z.enum(['company_required', 'vat_id_required', 'vat_id_invalid', 'tax_id_required', 'us_state_required', 'public_email_domain', 'invoice_not_open'])

// Cross-field invariants also travel in JSON Schema so non-TypeScript callers
// cannot treat an invoice payment as an unbound checkout or a mandate setup as a charge.
//
// A mandate setup (fleetless/fleetless#1185) is the 0.00 payment that changes the
// payment method: it is `payment_started` on the hosted page, never quoted, never
// waiting for VIES. `held` with `mandate_policy_unresolved` is only a row stored
// while the change was on hold (2026-10-16 to 17.0.0); the reason still names no
// other operation.
const intentRules = [
  { if: { properties: { operation: { enum: ['invoice_payment', 'payment_method_invoice'] } }, required: ['operation'] }, then: { required: ['invoice_id'] } },
  { if: { properties: { operation: { const: 'mandate_setup' } }, required: ['operation'] }, then: { properties: { state: { enum: ['held', 'payment_started'] } } } },
  { if: { properties: { operation: { const: 'mandate_setup' }, state: { const: 'held' } }, required: ['operation', 'state'] }, then: { properties: { reason: { const: 'mandate_policy_unresolved' } }, required: ['reason'] } },
  { if: { properties: { reason: { const: 'mandate_policy_unresolved' } }, required: ['reason'] }, then: { properties: { operation: { const: 'mandate_setup' } } } },
  { if: { properties: { payment: { properties: { kind: { const: 'mandate' } }, required: ['kind'] } }, required: ['payment'] }, then: { properties: { operation: { const: 'paid_change' } } } },
]
function validateIntent(intent: { operation: string; invoice_id?: string; state: string; reason?: string; payment?: { kind: string } }, ctx: z.RefinementCtx) {
  if (['invoice_payment', 'payment_method_invoice'].includes(intent.operation) && !intent.invoice_id) {
    ctx.addIssue({ code: 'custom', path: ['invoice_id'], message: 'An invoice-paying intent must name the invoice or due charge.' })
  }
  if (intent.operation === 'mandate_setup' && intent.state !== 'held' && intent.state !== 'payment_started') {
    ctx.addIssue({ code: 'custom', path: ['state'], message: 'A mandate setup is a started hosted payment, or a stored hold.' })
  }
  if (intent.operation === 'mandate_setup' && intent.state === 'held' && intent.reason !== 'mandate_policy_unresolved') {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A held mandate setup is the stored mandate_policy_unresolved hold.' })
  }
  if (intent.reason === 'mandate_policy_unresolved' && intent.operation !== 'mandate_setup') {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Only a mandate setup was held as mandate_policy_unresolved.' })
  }
  if (intent.payment?.kind === 'mandate' && intent.operation !== 'paid_change') {
    ctx.addIssue({ code: 'custom', path: ['payment'], message: 'Owner checkout, invoice payment and mandate setup require a hosted payment.' })
  }
}

/** Unaccepted intents. No draft contains a provider redirect or billing decision. */
const draftVariants = [
  z.object({ ...intentIdentity, state: z.literal('awaiting_vies'), reason: viesPendingReason, next_attempt_at: z.iso.datetime() }).strict(),
  z.object({ ...intentIdentity, ...quoteIdentity, state: z.literal('eligible'), quote: purchaseQuote }).strict(),
  z.object({
    ...intentIdentity, operation: purchaseOperation, state: z.literal('held'), reason: purchaseHoldReason,
    original_amount: z.object({ currency: planCurrency, gross_cents: purchaseCents }).strict().optional()
      .meta({ description: 'Recorded balance of a held invoice; not a new quote or authorization.' }),
  }).strict(),
  z.object({ ...intentIdentity, state: z.literal('invalid_vat_id'), field: z.literal('billing.vat_id'), rule: z.literal('vat_id_invalid') }).strict(),
  z.object({ ...intentIdentity, state: z.literal('refused'), field: z.string().min(1), rule: purchaseRefusalRule }).strict(),
] as const
export const purchaseIntentDraft = z.discriminatedUnion('state', draftVariants).superRefine(validateIntent).meta({ allOf: intentRules })
export type PurchaseIntentDraft = z.infer<typeof purchaseIntentDraft>

const paymentStartedVariant = z.object({
    ...intentIdentity, operation: purchaseOperation, state: z.literal('payment_started'), payment_id: z.uuid(),
    payment: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('hosted'), checkout_id: z.uuid(), checkout_url: z.url() }).strict(),
      z.object({ kind: z.literal('mandate') }).strict(),
    ]),
}).strict()
export const purchaseIntentPaymentStarted = paymentStartedVariant.superRefine(validateIntent).meta({ allOf: intentRules })
export type PurchaseIntentPaymentStarted = z.infer<typeof purchaseIntentPaymentStarted>

export const purchaseIntentAcceptedWithoutPayment = z.object({
  intent_id: z.uuid(),
  operation_key: purchaseOperationKey,
  operation: z.literal('paid_change'),
  state: z.literal('accepted_no_payment'),
  ...quoteIdentity,
  quote: purchaseQuote.extend({ net_cents: z.literal(0), vat_cents: z.literal(0), gross_cents: z.literal(0) }).strict(),
  accepted_at: utcInstant,
}).strict()
export type PurchaseIntentAcceptedWithoutPayment = z.infer<typeof purchaseIntentAcceptedWithoutPayment>

/** Public owner read. Accepted zero-charge changes have no provider payment. */
export const purchaseIntent = z.discriminatedUnion('state', [
  ...draftVariants, paymentStartedVariant, purchaseIntentAcceptedWithoutPayment,
]).superRefine(validateIntent).meta({ allOf: intentRules })
export type PurchaseIntent = z.infer<typeof purchaseIntent>

/** Shared by invoice payment and method change. A checkout start answers `checkoutStartResponse`, a paid change its own response. */
const nonChangeOperation = purchaseOperation.exclude(['paid_change'])
const nonChangeChargeOperation = chargeOperation.exclude(['paid_change'])
const nonChangeDraft = z.discriminatedUnion('state', [
  draftVariants[0].safeExtend({ operation: nonChangeChargeOperation }),
  draftVariants[1].safeExtend({ operation: nonChangeChargeOperation }),
  draftVariants[2].safeExtend({ operation: nonChangeOperation }),
  draftVariants[3].safeExtend({ operation: nonChangeChargeOperation }),
  draftVariants[4].safeExtend({ operation: nonChangeChargeOperation }),
]).superRefine(validateIntent).meta({ allOf: intentRules })
// A method change starts its 0.00 hosted payment at once: `mandate_setup` is `payment_started` here, and in no draft but `held`.
const nonChangePaymentStarted = paymentStartedVariant
  .safeExtend({ operation: nonChangeOperation })
  .superRefine(validateIntent).meta({ allOf: intentRules })
const paidChangeOperation = z.literal('paid_change')
// A paid change is decided in its request: it never waits for VIES.
const paidChangeDraft = z.discriminatedUnion('state', [
  draftVariants[1].safeExtend({ operation: paidChangeOperation }),
  draftVariants[2].safeExtend({ operation: paidChangeOperation }),
  draftVariants[3].safeExtend({ operation: paidChangeOperation }),
  draftVariants[4].safeExtend({ operation: paidChangeOperation }),
]).superRefine(validateIntent).meta({ allOf: intentRules })
export const checkoutResponse = z.union([nonChangeDraft, nonChangePaymentStarted])
export type CheckoutResponse = z.infer<typeof checkoutResponse>

const checkoutIntentIdentity = {
  intent_id: z.uuid().meta({ description: 'The persisted checkout intent; confirm it with `POST /api/billing/intents/:id/confirm`.' }),
  operation_key: purchaseOperationKey,
  operation: z.literal('checkout'),
}
const vatIdField = z.literal('billing.vat_id')

/**
 * `POST /api/billing/checkout`'s answer. The start decides in the request:
 * `eligible` carries the frozen quote and its C.4 display, whose proof the
 * one click on `display.snapshot.declaration.action_label` consumes;
 * `vies_unavailable`, `invalid_vat_id` and `refused` store nothing but the
 * checkout draft; `held` only while an issuer cutover runs; `payment_started`
 * replays a key already confirmed.
 */
export const checkoutStartResponse = z.discriminatedUnion('state', [
  z.object({
    ...checkoutIntentIdentity, state: z.literal('eligible'), ...quoteIdentity, quote: purchaseQuote,
    display: billingDecisionDisplayResponse,
  }).strict().meta({ description: 'Eligible: the price is frozen and the display shown; one click on its button confirms.' }),
  z.object({ state: z.literal('vies_unavailable'), field: vatIdField, reason: viesPendingReason }).strict()
    .meta({ description: 'VIES did not confirm the VAT ID within its retries. Nothing is stored; check again.' }),
  z.object({ state: z.literal('invalid_vat_id'), field: vatIdField, rule: z.literal('vat_id_invalid') }).strict()
    .meta({ description: 'VIES says the VAT ID is invalid. Nothing is stored.' }),
  z.object({ state: z.literal('refused'), field: z.string().min(1), rule: purchaseRefusalRule }).strict()
    .meta({ description: 'A field the purchase cannot accept. Nothing is stored.' }),
  z.object({ ...checkoutIntentIdentity, state: z.literal('held'), reason: z.literal('issuer_cutover_in_progress') }).strict()
    .meta({ description: 'An issuer cutover is running; try again in a few minutes.' }),
  z.object({
    ...checkoutIntentIdentity, state: z.literal('payment_started'), payment_id: z.uuid(),
    payment: z.object({ kind: z.literal('hosted'), checkout_id: z.uuid(), checkout_url: z.url() }).strict(),
  }).strict().meta({ description: 'The key was already confirmed: the hosted payment it started.' }),
]).superRefine((value, ctx) => {
  if (value.state !== 'eligible') return
  const snapshot = value.display.snapshot
  const invalid = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  if (snapshot.decision_kind !== 'checkout') invalid(['display', 'snapshot', 'decision_kind'], 'A checkout start displays a checkout decision.')
  if (snapshot.decision_id !== value.intent_id) invalid(['display', 'snapshot', 'decision_id'], 'The display must refer to this intent.')
  if (snapshot.operation_key !== value.operation_key) invalid(['display', 'snapshot', 'operation_key'], 'The display must carry this operation key.')
  if (snapshot.quote_revision !== value.quote_revision || snapshot.buyer_fingerprint !== value.buyer_fingerprint) {
    invalid(['display', 'snapshot', 'quote_revision'], 'The display must show this quote revision and buyer.')
  }
  const quote = snapshot.amounts.quote
  if ((Object.keys(value.quote) as (keyof PurchaseQuote)[]).some(key => quote[key] !== value.quote[key])) {
    invalid(['quote'], 'The quote must be the one the display shows.')
  }
}).meta({ allOf: [{
  if: { properties: { state: { const: 'eligible' } }, required: ['state'] },
  then: { properties: { display: { properties: { snapshot: { properties: { decision_kind: { const: 'checkout' } } } } } } },
}] })
export type CheckoutStartResponse = z.infer<typeof checkoutStartResponse>

const checkoutDraft = z.object({
  plan: z.enum(['plus', 'pro']).meta({ description: 'The plan last chosen on the checkout page.' }),
  cycle: billingCycle.meta({ description: 'The cycle last chosen.' }),
  billing: purchaseBillingDetails.meta({ description: 'The company details last sent to the checkout start.' }),
  updated_at: z.iso.datetime().meta({ description: 'When the draft was last saved.' }),
}).strict()

/**
 * `GET /api/billing/checkout-draft`'s answer: the details the checkout page
 * fills its form from. `draft` is what the last checkout start received,
 * whatever it decided; without one, `prefill` is the org's earlier billing
 * details; both `null` for a first purchase. Never both.
 */
export const checkoutDraftResponse = z.object({
  draft: checkoutDraft.nullable().meta({ description: 'The saved checkout draft, or `null`. Deleted once the checkout is paid.' }),
  prefill: billingDetails.nullable().meta({ description: "The org's earlier billing details when there is no draft, else `null`." }),
}).strict().superRefine((value, ctx) => {
  if (value.draft !== null && value.prefill !== null) ctx.addIssue({ code: 'custom', path: ['prefill'], message: 'A draft answers alone; prefill is null beside it.' })
}).meta({ not: { properties: { draft: { type: 'object' }, prefill: { type: 'object' } }, required: ['draft', 'prefill'] } })
export type CheckoutDraftResponse = z.infer<typeof checkoutDraftResponse>

/** `409 target_state_conflict` details while a first payment of the org is still open: continue it at `checkout_url`. */
export const checkoutOpenDetails = z.object({
  field: z.literal('billing'),
  rule: z.literal('checkout_open'),
  expires_at: z.iso.datetime().nullable().meta({ description: 'When the open payment expires at the provider, or `null` when unknown.' }),
  checkout_url: z.url().nullable().meta({ description: 'Where the open payment continues, or `null` when the provider no longer offers it.' }),
}).strict()
export type CheckoutOpenDetails = z.infer<typeof checkoutOpenDetails>

/** `409 target_state_conflict` details when a paid change or a billing-details edit needs VIES and VIES did not answer. Nothing is stored. */
export const viesUnavailableDetails = z.object({
  field: vatIdField,
  rule: z.literal('vies_unavailable'),
  reason: viesPendingReason,
}).strict()
export type ViesUnavailableDetails = z.infer<typeof viesUnavailableDetails>

/** Lookup needs one identity, plus the expected operation; a mismatch discloses nothing. */
export const purchaseIntentLookupQuery = z.object({
  operation_key: purchaseOperationKey.optional().meta({ description: 'The client operation key; supply this or intent_id, never both.' }),
  intent_id: z.uuid().optional().meta({ description: 'The persisted intent ID; supply this or operation_key, never both.' }),
  operation: purchaseOperation.meta({ description: 'Expected operation; a mismatch returns 404 without disclosure.' }),
}).strict().refine((q) => (q.operation_key !== undefined) !== (q.intent_id !== undefined), {
  message: 'Supply exactly one of operation_key or intent_id.',
}).meta({
  description: 'Owner lookup by exactly one identity and the expected operation.',
  oneOf: [
    { required: ['operation_key'], not: { required: ['intent_id'] } },
    { required: ['intent_id'], not: { required: ['operation_key'] } },
  ],
})
export type PurchaseIntentLookupQuery = z.infer<typeof purchaseIntentLookupQuery>

const provedConfirmation = { operation_key: purchaseOperationKey, ...quoteIdentity, confirmation_proof: confirmationProof }
const invoiceConfirmation = { operation_key: purchaseOperationKey, ...quoteIdentity }
export const purchaseIntentConfirmRequest = z.discriminatedUnion('operation', [
  z.object({ ...provedConfirmation, operation: z.literal('checkout') }).strict(),
  z.object({ ...provedConfirmation, operation: z.literal('paid_change') }).strict(),
  z.object({ ...invoiceConfirmation, operation: z.literal('invoice_payment') }).strict(),
  z.object({ ...invoiceConfirmation, operation: z.literal('payment_method_invoice') }).strict(),
])
export type PurchaseIntentConfirmRequest = z.infer<typeof purchaseIntentConfirmRequest>

/** `409 target_state_conflict` details. Stale confirmation returns the new owner-visible intent. */
export const purchaseConflictDetails = z.discriminatedUnion('rule', [
  z.object({ field: z.literal('operation_key'), rule: z.literal('operation_key_reused') }).strict(),
  z.object({ field: z.literal('confirmation_proof'), rule: z.literal('display_stale') }).strict()
    .meta({ description: 'The display was spent, expired or no longer matches: fetch a fresh one and press again.' }),
  z.object({ field: z.literal('intent'), rule: z.enum(['stale_quote', 'buyer_changed', 'not_eligible', 'invoice_not_open']), current_intent: purchaseIntent }).strict(),
])
export type PurchaseConflictDetails = z.infer<typeof purchaseConflictDetails>
export const invoicePayRequest = z.object({ operation_key: purchaseOperationKey }).strict()
export type InvoicePayRequest = z.infer<typeof invoicePayRequest>

/** `GET /api/billing/checkout/:id`'s answer: the return page's poll. */
export const checkoutStatus = z.object({
  checkout_id: z.uuid().meta({ description: 'The checkout this status is for.' }),
  status: z.enum(['pending', 'paid', 'failed', 'canceled', 'expired']).meta({
    description: "Mollie's payment status, as `reconcilePayment` last read it.",
  }),
  purpose: z.enum(['upgrade', 'payment_method', 'invoice']).meta({
    description: 'What this checkout paid for: a plan upgrade, a payment-method change, or an open invoice.',
  }),
  plan: planId.meta({ description: "The org's plan after applying — unchanged unless `purpose` is `upgrade` and `status` is `paid`." }),
})
export type CheckoutStatus = z.infer<typeof checkoutStatus>

/** VIES's answer to a VAT-ID check: `unverified` when VIES could not be reached in time. */
export const vatIdStatus = z.enum(['valid', 'unverified', 'invalid', 'unavailable'])
export type VatIdStatus = z.infer<typeof vatIdStatus>

/** `POST /api/billing/vat-id/check`'s body: the VAT-ID-on-blur check the checkout and `PATCH /api/billing/details` both use. */
export const vatIdCheckRequest = z.object({
  country: countryCode.meta({ description: "The VAT ID's country." }),
  vat_id: z.string().trim().min(1).max(20).meta({ description: 'The VAT ID as typed; normalized before the VIES lookup (`normalizeVatId`).' }),
}).strict()
export type VatIdCheckRequest = z.infer<typeof vatIdCheckRequest>

/** Public display only: successful full evidence is never returned here. */
const vatCheckIdentity = { vat_id: z.string(), name: z.string().nullable() }
export const vatIdCheckResponse = z.discriminatedUnion('state', [
  z.object({ ...vatCheckIdentity, state: z.literal('eligible'), status: z.literal('valid') }).strict(),
  z.object({ ...vatCheckIdentity, state: z.literal('refused'), status: z.literal('invalid'), rule: z.literal('vat_id_invalid') }).strict(),
  z.object({ ...vatCheckIdentity, state: z.literal('pending'), status: z.enum(['valid', 'unverified', 'unavailable']), reason: viesPendingReason }).strict(),
])
export type VatIdCheckResponse = z.infer<typeof vatIdCheckResponse>

/**
 * `POST /api/billing/change`'s body: the **absolute** target state, never a
 * delta — the route compares it with the org's current state
 * and splits the difference into what is charged now and what is only
 * scheduled. At least one of `plan`, `cycle` or `addons` must be named; the
 * `.refine()` below says so in prose rather than in the JSON Schema this
 * exports as, the same discipline `auditQuery`'s pair already follows —
 * `.refine()` has no JSON Schema rendering.
 */
export const billingChangeRequest = z.object({
  operation_key: purchaseOperationKey,
  plan: z.enum(['plus', 'pro']).optional().meta({ description: 'The target plan. Omitted leaves the plan as it is.' }),
  cycle: billingCycle.optional().meta({ description: 'The target cycle. Omitted leaves the cycle as it is.' }),
  addons: orgAddons.partial().strict().optional().meta({
    description: 'Absolute add-on counts to end up with, not a delta. Omitted leaves add-ons as they are.',
  }),
}).strict().refine((r) => r.plan !== undefined || r.cycle !== undefined || r.addons !== undefined, { message: 'Name a plan, a cycle or add-ons.' })
export type BillingChangeRequest = z.infer<typeof billingChangeRequest>

/** `POST /api/billing/cancel`'s body — optional, hence `requestOptional` on the route entry. */
export const billingCancelRequest = z.object({
  reason: z.string().trim().max(500).optional().meta({ description: 'An optional free-text reason. Shown to nobody but Fleetless.' }),
}).strict()
export type BillingCancelRequest = z.infer<typeof billingCancelRequest>

/** Owner corrections; Cloud revalidates the complete merged buyer before any later charge. */
export const billingDetailsUpdate = z.object({
  company_name: z.string().trim().min(1).max(200).optional(),
  address: billingAddress.optional(),
  tax_id: z.string().trim().max(100).nullable().optional(),
  invoice_email: z.email().optional().meta({ description: 'Replaces the invoice email. Omitted leaves it as it is.' }),
  vat_id: z.string().trim().max(20).nullable().optional().meta({
    description: 'Replaces the VAT ID; `null` clears it. Omitted leaves it as it is. A new ID is re-checked through VIES.',
  }),
}).strict()
export type BillingDetailsUpdate = z.infer<typeof billingDetailsUpdate>

/**
 * `PATCH /api/billing/details`'s `409 target_state_conflict` details
 * (fleetless/fleetless#1185). Nothing is saved in any of them.
 *
 * - A field a purchase would refuse: `field` as the checkout names it
 *   (`billing.kind`, `billing.vat_id`, `billing.tax_id`,
 *   `billing.address.state`, `billing.invoice_email`), `rule` the refusal.
 * - `vies_unavailable` (`viesUnavailableDetails`): the country or the VAT ID
 *   changed and VIES did not answer; check again.
 * - `buyer_changed`: the billing details changed while this edit was decided;
 *   read them again.
 */
export const billingDetailsConflictDetails = z.union([
  z.object({ field: z.string().min(1), rule: purchaseRefusalRule }).strict()
    .meta({ description: 'A field a purchase would refuse. Nothing is saved.' }),
  viesUnavailableDetails,
  z.object({ field: z.literal('billing'), rule: z.literal('buyer_changed') }).strict()
    .meta({ description: 'The billing details changed meanwhile. Nothing is saved.' }),
])
export type BillingDetailsConflictDetails = z.infer<typeof billingDetailsConflictDetails>

/**
 * The payment methods Fleetless takes: card, PayPal and Apple Pay, in EUR and USD, and no others (André, 2026-10-04).
 * Apple Pay is a Mollie method of its own at checkout and for a change, but the mandate it leaves is a card mandate.
 */
export const paymentMethodKind = z.enum(['card', 'paypal', 'applepay'])
export type PaymentMethodKind = z.infer<typeof paymentMethodKind>

/** `POST /api/billing/payment-method`'s body. One operation key names one method: keep the key until its payment is finished. */
export const paymentMethodChangeRequest = z.object({
  operation_key: purchaseOperationKey,
  method: paymentMethodKind.meta({
    description:
      "The new mandate's method. Offer what `billingView.payment_method_options` lists: `applepay` may be refused with " +
      "`400 validation_error` `{ field: 'method', rule: 'applepay_needs_open_invoice' }` unless an invoice is open.",
  }),
}).strict()
export type PaymentMethodChangeRequest = z.infer<typeof paymentMethodChangeRequest>

/** The billing account's own status, distinct from the org's plan: `billing_accounts` holds no plan, currency or period of its own. */
export const billingAccountStatus = z.enum(['pending', 'active', 'past_due', 'canceled'])
export type BillingAccountStatus = z.infer<typeof billingAccountStatus>

/** The payment method on file, read from the active Mollie mandate — never a card or bank number, only its display fields. */
export const paymentMethod = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('card').meta({ description: 'A card mandate.' }),
    brand: z.string().meta({ description: "The card network, as Mollie's mandate reports it, e.g. 'Visa'." }),
    last4: z.string().regex(/^\d{4}$/).meta({ description: 'The last four digits of the card.' }),
    expires: z.string().regex(/^\d{2}\/\d{2}$/).meta({ description: "Expiry as Mollie's mandate shows it, 'MM/YY'." }),
  }),
  z.object({
    kind: z.literal('applepay').meta({ description: "A card mandate from an Apple Pay first payment — Mollie stores it as `creditcard`; Fleetless labels it Apple Pay." }),
    brand: z.string().meta({ description: "The card network, as Mollie's mandate reports it, e.g. 'Mastercard'." }),
    last4: z.string().regex(/^\d{4}$/).meta({ description: 'The last four digits of the card behind Apple Pay.' }),
    expires: z.string().regex(/^\d{2}\/\d{2}$/).meta({ description: "Expiry as Mollie's mandate shows it, 'MM/YY'." }),
  }),
  z.object({
    kind: z.literal('paypal').meta({ description: 'A PayPal mandate.' }),
    account: z.string().meta({ description: "The PayPal account Mollie's mandate names." }),
  }),
])
export type PaymentMethod = z.infer<typeof paymentMethod>

/** An invoice's status: `open` until paid, `cancelled` after a cancellation, or `uncollectible` after an unpaid fallback. */
export const invoiceStatus = z.enum(['open', 'paid', 'uncollectible', 'cancelled'])
export type InvoiceStatus = z.infer<typeof invoiceStatus>

/** One invoice, rendered by the cloud: the number is gapless, `FL-<year>-<seq>`. */
export const billingInvoice = z.object({
  id: z.uuid().meta({ description: "The invoice's id." }),
  number: z.string().regex(/^FL-\d{4}-\d{4,}$/).meta({
    description: 'The invoice number: `FL-<year>-<seq>`, `seq` zero-padded to four digits, gapless per calendar year in `Europe/Berlin`.',
  }),
  issued_at: z.iso.datetime().meta({ description: 'When the invoice was issued.' }),
  status: invoiceStatus.meta({ description: 'This invoice\'s own status.' }),
  cancellation_document_url: z.string().nullable().meta({
    description: 'Cloud always returns `null` for this field, including cancelled historical Cloud invoices. Cancellation documents are held in Lexware.',
  }),
  currency: planCurrency.meta({ description: "The org's billing currency." }),
  net_cents: z.number().int().nonnegative().meta({ description: 'The charge, excluding VAT, in integer cents.' }),
  vat_rate_percent: z.number().int().min(0).max(100).meta({ description: 'The VAT rate applied, in whole percent.' }),
  vat_cents: z.number().int().nonnegative().meta({ description: 'VAT, in integer cents (`vatCents`).' }),
  gross_cents: z.number().int().nonnegative().meta({ description: 'Net plus VAT, in integer cents.' }),
})
export type BillingInvoice = z.infer<typeof billingInvoice>

/** Optional document kind for `GET /api/billing/invoices/:id/pdf`; omitted means the original invoice. */
export const billingInvoicePdfQuery = z.object({
  kind: z.enum(['invoice', 'cancellation']).optional().meta({ description: 'Omitted or `invoice` selects the original invoice PDF. `cancellation` is accepted but returns `404 not_found`: Cloud has no cancellation PDFs.' }),
}).strict()
export type BillingInvoicePdfQuery = z.infer<typeof billingInvoicePdfQuery>

/**
 * The org's billing account: the payer, the VAT treatment, the cycle and
 * period, what is scheduled for the period's end and dunning
 *, when a charge is overdue. `orgs.plan`, `orgs.currency` and
 * `orgs.period_ends_at` stay the single source of truth for the plan itself
 * (#103) — nothing here duplicates them.
 */
export const billingAccount = z.object({
  payer: billingDetails.meta({ description: 'Who is paying, and the invoice address and email.' }),
  vat_id_status: vatIdStatus.nullable().meta({ description: "The payer's VAT ID check, or `null` when no VAT ID was given." }),
  vat: z.object({
    treatment: vatTreatment.meta({ description: 'How the account is taxed.' }),
    rate_percent: z.number().int().meta({ description: 'The VAT rate, in whole percent.' }),
  }).nullable().meta({ description: 'Recorded VAT treatment; null while the current buyer has no eligible decision. Never infer zero rating from a pending account.' }),
  currency: planCurrency.meta({ description: "The org's billing currency, fixed at the first payment." }),
  cycle: billingCycle.meta({ description: 'The current billing cycle.' }),
  status: billingAccountStatus.meta({ description: "The account's own status." }),
  period_starts_at: z.iso.datetime().nullable().meta({ description: "The current period's start. `null` before the first payment." }),
  period_ends_at: z.iso.datetime().nullable().meta({ description: "The current period's end. `null` before the first payment." }),
  next_charge: z.object({
    at: z.iso.datetime().meta({ description: 'When the next charge is due.' }),
    net_cents: z.number().int().meta({ description: 'The next charge, excluding VAT, in integer cents.' }),
    vat_cents: z.number().int().meta({ description: 'VAT on the next charge, in integer cents.' }),
    gross_cents: z.number().int().meta({ description: 'The next charge including VAT, in integer cents.' }),
  }).nullable().meta({ description: '`null` while a cancel is pending or nothing else renews.' }),
  current_price: z.object({
    net_cents: z.number().int().meta({
      description: 'One period of the current plan, cycle and add-ons at the agreed price, excluding VAT, in integer cents.',
    }),
  }).nullable().meta({
    description:
      'What one period (`cycle`) of the current plan costs this organization: the price it agreed, which stays when the ' +
      'catalogue changes. Show this, not the catalogue price, as the price of a billed organization. `null` when no agreed ' +
      'price is recorded for the current plan, cycle and add-ons.',
  }),
  scheduled: z.object({
    cycle: billingCycle.nullable().meta({ description: "A cycle change queued for the period's end, or `null`." }),
    addons: orgAddons.nullable().meta({ description: "Add-on counts queued for the period's end, or `null`." }),
  }).meta({ description: "What takes effect at the period's end." }),
  dunning: z.object({
    invoice_id: z.uuid().meta({
      description:
        'What dunning is chasing: a historical open `FL-…` invoice, or a due charge. Before the issuer cutover a due charge appears ' +
        'here only while the payer\'s VAT ID is unsettled; it has no number yet, is not in `invoices`, and ' +
        '`POST /api/billing/invoices/:id/pay` takes either. After the cutover this is always a due charge (in `charges`): pay it with ' +
        '`POST /api/billing/charges/:id/pay`.',
    }),
    gross_cents: z.number().int().meta({
      description: 'The amount owed, in integer cents — after a partial chargeback only the charged-back part.',
    }),
    due_at: z.iso.datetime().meta({ description: "The charge's due date; retries and the lock count from here." }),
    next_retry_at: z.iso.datetime().nullable().meta({
      description:
        'The next automatic retry, or `null` once retries are exhausted. Always `null` after a chargeback: a charged-back ' +
        'payment is never charged again automatically.',
    }),
    lock_at: z.iso.datetime().meta({ description: 'When the org is locked if still unpaid (`BILLING_LOCK_DAY`).' }),
    failure: z.string().nullable().meta({
      description:
        "Mollie's own reason, e.g. 'card_expired'; 'vat_id_invalid' while a renewal is held because VIES does not confirm the " +
        "VAT ID; 'charged_back' after a chargeback or a lost PayPal dispute.",
    }),
  }).nullable().meta({ description: '`null` while nothing is overdue. During a VAT-ID hold the charge is due but not yet invoiced.' }),
})
export type BillingAccount = z.infer<typeof billingAccount>

/*
 * ---------------------------------------------------------------------------
 * The Lexware issuer cutover: due charges billed and paid individually
 * through Lexware, taking over from the Cloud-issued invoice for every new
 * charge (2026-10-19, fleetless/fleetless#327).
 *
 * `billingAccount.dunning.invoice_id` and `invoicePayRequest`/
 * `checkoutResponse` already describe a due charge with no number of its
 * own; `billingCharge` is the shape of that charge, read in
 * `billingView.charges`, with its own Lexware invoice link
 * (`billingChargeInvoice`) and its own pay route
 * (`POST /api/billing/charges/:id/pay`, `chargePayRequest`).
 * ---------------------------------------------------------------------------
 */

/** Which system issues an org's charges: `cloud` before the issuer cutover (invoices only, in `invoices`) or `lexware` after it (due charges, in `charges`). */
export const billingIssuer = z.enum(['cloud', 'lexware'])
export type BillingIssuer = z.infer<typeof billingIssuer>

/**
 * Whether a due charge already has a confirmed Lexware invoice: `not_issued`
 * while the charge is not collected (`due`, a failed retry, or
 * `uncollectible` — there is nothing to invoice yet); `pending` once
 * collected but before Lexware confirms the invoice, in any intent state
 * short of a linked document; `issued` once Lexware's invoice is linked,
 * naming the document `GET /api/billing/documents/:id` reads.
 */
export const billingChargeInvoice = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_issued').meta({ description: 'Not collected (due, a failed retry, or uncollectible): no invoice exists.' }) }).strict(),
  z.object({ state: z.literal('pending').meta({ description: 'Collected; the Lexware invoice is not yet confirmed.' }) }).strict(),
  z.object({
    state: z.literal('issued').meta({ description: 'Lexware has confirmed the invoice.' }),
    document_id: z.uuid().meta({ description: "The Lexware document's id — read it with `GET /api/billing/documents/:id`." }),
  }).strict(),
])
export type BillingChargeInvoice = z.infer<typeof billingChargeInvoice>

// The same invariant in JSON Schema, so non-TypeScript callers see it too.
const chargeInvoiceRules = [
  { if: { properties: { status: { const: 'paid' } }, required: ['status'] }, then: { properties: { invoice: { properties: { state: { enum: ['pending', 'issued'] } } } } } },
  { if: { properties: { status: { enum: ['due', 'uncollectible', 'cancelled'] } }, required: ['status'] }, then: { properties: { invoice: { properties: { state: { const: 'not_issued' } } } } } },
]

/** Refused when `status` and `invoice.state` disagree: a paid charge has an invoice (pending or issued); every other status has none yet. */
function refuseChargeInvoiceMismatch(charge: { status: string; invoice: { state: string } }, ctx: z.RefinementCtx): void {
  const notIssued = charge.invoice.state === 'not_issued'
  if ((charge.status === 'paid') === notIssued) {
    ctx.addIssue({ code: 'custom', path: ['invoice'], message: 'A paid charge has an invoice (pending or issued); every other status has none yet.' })
  }
}

/**
 * One due charge billed through Lexware after the issuer cutover, read in
 * `billingView.charges`. `id` is the charge's own id — never a Cloud
 * invoice number — and the one `POST /api/billing/charges/:id/pay` takes.
 */
export const billingCharge = z.object({
  id: z.uuid().meta({ description: "The due charge's id — never a Cloud invoice number. Pay it with `POST /api/billing/charges/:id/pay`." }),
  kind: z.enum(['first', 'renewal', 'change']).meta({ description: 'What caused the charge: the first charge after checkout, a scheduled renewal, or a mid-period plan change.' }),
  status: z.enum(['due', 'paid', 'uncollectible', 'cancelled']).meta({
    description:
      "The charge's own status. A charged back or manually refunded charge stays `paid` — refunds and chargebacks are handled in " +
      "Mollie or Lexware by hand; this status and the invoice it names are unchanged, and the resulting Lexware credit note appears " +
      'under `GET /api/billing/documents` instead.',
  }),
  currency: z.literal('eur').meta({ description: 'Every charge billed through Lexware is EUR.' }),
  net_cents: z.number().int().nonnegative().meta({ description: 'The charge, excluding VAT, in integer cents.' }),
  vat_rate_percent: z.number().int().min(0).max(100).meta({ description: 'The VAT rate applied, in whole percent.' }),
  vat_cents: z.number().int().nonnegative().meta({ description: 'VAT, in integer cents (`vatCents`).' }),
  gross_cents: z.number().int().nonnegative().meta({ description: 'Net plus VAT, in integer cents.' }),
  period_start: z.iso.datetime().meta({ description: "The covered period's start." }),
  period_end: z.iso.datetime().meta({ description: "The covered period's end." }),
  due_at: z.iso.datetime().meta({ description: 'When this charge is due.' }),
  paid_at: z.iso.datetime().nullable().meta({ description: 'When this charge was paid, or `null` while unpaid.' }),
  invoice: billingChargeInvoice.meta({ description: 'Whether a Lexware invoice exists for this charge yet, and which document it names once it does.' }),
}).strict().superRefine(refuseChargeInvoiceMismatch).meta({ allOf: chargeInvoiceRules })
export type BillingCharge = z.infer<typeof billingCharge>

/** `POST /api/billing/charges/:id/pay`'s body — the same shape as `invoicePayRequest`: a stable `operation_key`. */
export const chargePayRequest = invoicePayRequest
export type ChargePayRequest = z.infer<typeof chargePayRequest>

/** `GET /api/billing`'s answer, and what every other billing route hands back after a change. */
export const billingView = z.object({
  available: z.boolean().meta({ description: 'Whether this cloud takes payments at all — `false` when no Mollie key is configured.' }),
  account: billingAccount.nullable().meta({ description: '`null` before the org has ever checked out.' }),
  payment_method: paymentMethod.nullable().meta({ description: 'The payment method on file, or `null`.' }),
  payment_method_options: z.array(z.object({
    method: paymentMethodKind.meta({ description: 'A method `POST /api/billing/payment-method` accepts now.' }),
    pays_invoice: z.boolean().meta({ description: 'Whether changing to it also pays the open invoice — `true` only for `applepay` when a zero-amount Apple Pay payment is not available.' }),
  })).meta({
    description:
      'What a payment-method change may offer right now, so a client offers exactly what the cloud accepts. `applepay` is absent when ' +
      'it needs an open invoice and none is open; `[]` when the org has no billing account.',
  }),
  issuer: billingIssuer.meta({ description: "Which system issues this org's charges: `cloud` before the issuer cutover, or `lexware` after it." }),
  invoices: z.array(billingInvoice).meta({ description: 'Cloud-issued invoices from before the issuer cutover; read-only, never grows after it. Newest first, at most 24.' }),
  charges: z.array(billingCharge).meta({
    description:
      'Newest first, at most 24. Lists only due charges with issuer `lexware` — never a pre-cutover charge, a legacy payment ' +
      '(legacy_issued/legacy_held/legacy_person/legacy_usd) or a late USD collection: none of those carry a Lexware intent, and they ' +
      'stay in `invoices` or nowhere. `[]` while `issuer` is `cloud`.',
  }),
})
export type BillingView = z.infer<typeof billingView>

/*
 * ---------------------------------------------------------------------------
 * Billing documents: a read-only view of the Lexware vouchers issued to
 * the org's company (2026-10-19, fleetless/fleetless#544).
 *
 * `GET /api/billing/documents`, `GET /api/billing/documents/:id` and
 * `GET /api/billing/documents/:id/file` in `src/routes.ts`. Cloud resolves
 * the org's own Lexware contact itself; the contact is never supplied by the
 * caller. Only finalized vouchers of the five kinds below ever appear — a
 * draft, a quotation, an order confirmation, a delivery note or a purchase
 * voucher never does, and a voided one still does.
 * ---------------------------------------------------------------------------
 */

/**
 * A document's kind, narrowed from Lexware's own `voucherType`: `invoice` ←
 * `invoice`, `credit_note` ← `creditnote`, `down_payment_invoice` ←
 * `downpaymentinvoice`, `bookkeeping_invoice` ← `salesinvoice`,
 * `bookkeeping_credit_note` ← `salescreditnote`.
 */
export const billingDocumentKind = z.enum(['invoice', 'credit_note', 'down_payment_invoice', 'bookkeeping_invoice', 'bookkeeping_credit_note'])
export type BillingDocumentKind = z.infer<typeof billingDocumentKind>

/** A document's own status, read from the Lexware voucher as it stands today. */
export const billingDocumentStatus = z.enum(['open', 'overdue', 'paid', 'paidoff', 'voided', 'transferred', 'sepadebit'])
export type BillingDocumentStatus = z.infer<typeof billingDocumentStatus>

/**
 * The electronic-invoice profile of an `invoice`, `down_payment_invoice` or
 * `credit_note`: `NONE` is a plain PDF and never an e-invoice; `EN16931`
 * (ZUGFeRD) is a PDF with an embedded XML, and that PDF is itself the
 * e-invoice; `XRechnung` is an XML that is the e-invoice, with a PDF that is
 * only a preview. `null` on a bookkeeping voucher — it has no profile at all.
 */
export const billingDocumentProfile = z.enum(['NONE', 'EN16931', 'XRechnung'])
export type BillingDocumentProfile = z.infer<typeof billingDocumentProfile>

/** A file format a document's bytes may be read in. */
export const billingDocumentFormat = z.enum(['pdf', 'xml'])
export type BillingDocumentFormat = z.infer<typeof billingDocumentFormat>

/**
 * The fields shared by `billingDocument` and `billingDocumentDetail`, kept
 * unrefined so `billingDocumentDetail` can `.extend()` it without depending
 * on whether a `.superRefine()` survives an `.extend()` call. The sign rule
 * below (`refuseWrongGrossSign`) is therefore applied separately to each of
 * the two exports, sharing the one function rather than the one schema.
 */
const billingDocumentBase = z.object({
  id: z.uuid().meta({ description: 'The Lexware voucher id. Opaque; read the document or its file by this id, never a locally invented one.' }),
  kind: billingDocumentKind.meta({ description: "The document's kind." }),
  status: billingDocumentStatus.meta({ description: "The document's own status." }),
  number: z.string().nullable().meta({ description: "The Lexware voucher number, for display only — never a key to read by. `null` for a voucher Lexware has not numbered." }),
  document_date: z.iso.datetime({ offset: true }).meta({ description: 'The date printed on the document.' }),
  currency: z.literal('EUR').meta({ description: 'Every Lexware voucher this reads is EUR; nothing here reads a foreign-currency voucher.' }),
  gross_cents: z.number().int().meta({
    description:
      'The gross amount, in integer cents, signed by `kind` and never by the sign Lexware itself reports: `credit_note` and ' +
      '`bookkeeping_credit_note` are zero or negative, every other kind is zero or positive.',
  }),
  file: z.enum(['available', 'unavailable']).meta({ description: 'Whether Lexware holds a file for this document at all.' }),
})

/** Refused on a sign that disagrees with `kind`, regardless of what Lexware itself reported. */
function refuseWrongGrossSign(doc: { kind: BillingDocumentKind; gross_cents: number }, ctx: z.RefinementCtx): void {
  const isCredit = doc.kind === 'credit_note' || doc.kind === 'bookkeeping_credit_note'
  if (isCredit && doc.gross_cents > 0) {
    ctx.addIssue({ code: 'custom', path: ['gross_cents'], message: 'A credit note is zero or negative.' })
  }
  if (!isCredit && doc.gross_cents < 0) {
    ctx.addIssue({ code: 'custom', path: ['gross_cents'], message: 'Only a credit note is negative.' })
  }
}

/** One Lexware document, as `GET /api/billing/documents` lists it. */
export const billingDocument = billingDocumentBase.strict().superRefine(refuseWrongGrossSign)
export type BillingDocument = z.infer<typeof billingDocument>

/** `GET /api/billing/documents`'s answer. */
export const billingDocumentList = z.object({
  available: z.boolean().meta({ description: 'Whether this cloud can list Lexware documents at all for this org — `false` when this cloud has no Lexware configured, its Lexware account failed the account check, or the org has no Lexware contact.' }),
  complete: z.boolean().meta({ description: '`false` when a document of an unsupported type or status was skipped rather than listed, counted in `unsupported_count`.' }),
  unsupported_count: z.number().int().nonnegative().meta({ description: 'How many documents of an unsupported type or status were skipped; `complete` is `false` whenever this is above zero.' }),
  documents: z.array(billingDocument).meta({ description: 'Every supported document this org has, complete or not — never a truncated page.' }),
}).strict().superRefine((list, ctx) => {
  if (!list.available && (list.documents.length > 0 || !list.complete || list.unsupported_count > 0)) {
    ctx.addIssue({ code: 'custom', path: ['available'], message: 'available: false carries no documents, is complete and has no unsupported document.' })
  }
})
export type BillingDocumentList = z.infer<typeof billingDocumentList>

/** Which role a file plays for a document: the e-invoice itself, a preview rendered alongside it, or the plain document. */
export const billingDocumentFileRole = z.enum(['e_invoice', 'preview', 'document'])
export type BillingDocumentFileRole = z.infer<typeof billingDocumentFileRole>

const billingDocumentFormatEntry = z.object({ format: billingDocumentFormat, role: billingDocumentFileRole }).strict()

function sameFormats(a: readonly { format: string; role: string }[], b: readonly { format: string; role: string }[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.format === b[i]!.format && entry.role === b[i]!.role)
}

/** Refused on any `formats` that disagrees with `electronic_document_profile` (or, for `null`, with `file`). */
function refuseWrongFormats(
  doc: { electronic_document_profile: BillingDocumentProfile | null; file: 'available' | 'unavailable'; formats: { format: string; role: string }[] },
  ctx: z.RefinementCtx,
): void {
  const expected =
    doc.electronic_document_profile === 'NONE' ? [{ format: 'pdf', role: 'document' }]
      : doc.electronic_document_profile === 'EN16931' ? [{ format: 'pdf', role: 'e_invoice' }]
        : doc.electronic_document_profile === 'XRechnung' ? [{ format: 'xml', role: 'e_invoice' }, { format: 'pdf', role: 'preview' }]
          : doc.file === 'available' ? [{ format: 'pdf', role: 'document' }] : []
  if (!sameFormats(doc.formats, expected)) {
    ctx.addIssue({ code: 'custom', path: ['formats'], message: 'formats must match electronic_document_profile (or, for a bookkeeping voucher, file) exactly.' })
  }
}

/** `GET /api/billing/documents/:id`'s answer: `billingDocument` plus the e-invoice profile and the files this document offers. */
export const billingDocumentDetail = billingDocumentBase
  .extend({
    electronic_document_profile: billingDocumentProfile.nullable().meta({ description: 'The e-invoice profile, or `null` for a bookkeeping voucher — it has none.' }),
    formats: z.array(billingDocumentFormatEntry).meta({
      description:
        '`NONE`: `[{ format: "pdf", role: "document" }]`. `EN16931`: `[{ format: "pdf", role: "e_invoice" }]`. `XRechnung`: ' +
        '`[{ format: "xml", role: "e_invoice" }, { format: "pdf", role: "preview" }]`. `null` profile: `[{ format: "pdf", role: "document" }]` ' +
        'when `file` is `available`, otherwise `[]`.',
    }),
  })
  .strict()
  .superRefine((doc, ctx) => {
    refuseWrongGrossSign(doc, ctx)
    refuseWrongFormats(doc, ctx)
  })
export type BillingDocumentDetail = z.infer<typeof billingDocumentDetail>

/** `GET /api/billing/documents/:id/file`'s query: which format to read the file in. */
export const billingDocumentFileQuery = z.object({
  format: billingDocumentFormat.default('pdf').meta({ description: 'The file format to read. `xml` answers `404` unless the document is `XRechnung`.' }),
}).strict()
export type BillingDocumentFileQuery = z.infer<typeof billingDocumentFileQuery>

/** Accepted paid changes retain their provider identity; accepted no-payment changes have none. */
const acceptedBillingFields = {
  billing: billingView.meta({ description: 'The billing view after the change.' }),
  charged: billingInvoice.nullable().meta({
    description:
      'The Fleetless invoice charged now, or `null` when nothing was charged now (a change scheduled for the period end, ' +
      'or an increase that cost nothing) or the change was charged through Lexware (then the charge is in `billing.charges`).',
  }),
}
const acceptedPaidChange = z.object({
  ...acceptedBillingFields,
  intent: paymentStartedVariant.safeExtend({ operation: z.literal('paid_change') }),
}).strict()
const acceptedNoPaymentChange = z.object({
  billing: billingView,
  charged: z.null().meta({
    description: 'Always `null`: nothing was charged now (a scheduled change or an increase that cost nothing).',
  }),
  intent: purchaseIntentAcceptedWithoutPayment,
}).strict()
export const billingChangeResponse = z.union([
  z.object({ intent: paidChangeDraft }).strict(),
  acceptedPaidChange,
  acceptedNoPaymentChange,
])
export type BillingChangeResponse = z.infer<typeof billingChangeResponse>

/** Confirmation/lookup recover the original decision, never a bare accepted change. */
export const purchaseIntentResponse = z.union([
  purchaseIntentDraft,
  nonChangePaymentStarted,
  acceptedPaidChange,
  acceptedNoPaymentChange,
])
export type PurchaseIntentResponse = z.infer<typeof purchaseIntentResponse>
