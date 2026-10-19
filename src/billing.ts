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
  type AddonKey,
  type OrgAddons,
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

/** Generate before POST, persist across reloads; unique within the authenticated org. */
export const purchaseOperationKey = z.uuid().meta({ description: 'Client-generated UUID persisted before the start request. Unique per org and reused only for identical input.' })
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
  accept_terms: z.literal(true).meta({ description: 'Confirms the terms of service for this purchase.' }),
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

const intentIdentity = {
  intent_id: z.uuid().meta({ description: 'Opaque persisted purchase intent identity.' }),
  operation_key: purchaseOperationKey,
  operation: chargeOperation,
  invoice_id: z.uuid().optional().meta({ description: 'The due charge or issued invoice, for invoice-paying operations.' }),
}
const quoteIdentity = {
  quote_revision: z.string().trim().min(1).max(200).meta({ description: 'Opaque revision of the displayed quote; echo it when confirming.' }),
  buyer_fingerprint: z.string().trim().min(1).max(200).meta({ description: 'Opaque revision of buyer details and email policy; never full VIES evidence.' }),
}
export const purchaseHoldReason = z.enum([
  'legacy_usd_invoice', 'legacy_payer_unresolved', 'mandate_policy_unresolved',
  // The Lexware issuer cutover (2026-10-19, fleetless/fleetless#327): holds
  // during and after the move from Cloud-issued invoices to charges billed
  // through Lexware.
  'lexware_contact_pending', 'lexware_contact_changed', 'issuer_cutover_in_progress', 'lexware_issuance_paused',
])
export const purchaseRefusalRule = z.enum(['company_required', 'vat_id_required', 'vat_id_invalid', 'tax_id_required', 'us_state_required', 'public_email_domain', 'invoice_not_open'])

// Cross-field invariants also travel in JSON Schema so non-TypeScript callers
// cannot treat an invoice payment as an unbound checkout or a held setup as a charge.
const intentRules = [
  { if: { properties: { operation: { enum: ['invoice_payment', 'payment_method_invoice'] } }, required: ['operation'] }, then: { required: ['invoice_id'] } },
  { if: { properties: { operation: { const: 'mandate_setup' } }, required: ['operation'] }, then: { properties: { state: { const: 'held' }, reason: { const: 'mandate_policy_unresolved' } }, required: ['reason'] } },
  { if: { properties: { reason: { const: 'mandate_policy_unresolved' } }, required: ['reason'] }, then: { properties: { operation: { const: 'mandate_setup' } } } },
  { if: { properties: { payment: { properties: { kind: { const: 'mandate' } }, required: ['kind'] } }, required: ['payment'] }, then: { properties: { operation: { const: 'paid_change' } } } },
]
function validateIntent(intent: { operation: string; invoice_id?: string; state: string; reason?: string; payment?: { kind: string } }, ctx: z.RefinementCtx) {
  if (['invoice_payment', 'payment_method_invoice'].includes(intent.operation) && !intent.invoice_id) {
    ctx.addIssue({ code: 'custom', path: ['invoice_id'], message: 'An invoice-paying intent must name the invoice or due charge.' })
  }
  if ((intent.operation === 'mandate_setup') !== (intent.reason === 'mandate_policy_unresolved')) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Mandate setup remains held until its integration policy is resolved.' })
  }
  if (intent.payment?.kind === 'mandate' && intent.operation !== 'paid_change') {
    ctx.addIssue({ code: 'custom', path: ['payment'], message: 'Owner checkout and invoice payment require a hosted payment.' })
  }
}

/** Public owner read. No unpaid state can contain a provider redirect. */
export const purchaseIntent = z.discriminatedUnion('state', [
  z.object({ ...intentIdentity, state: z.literal('awaiting_vies'), reason: viesPendingReason, next_attempt_at: z.iso.datetime() }).strict(),
  z.object({ ...intentIdentity, ...quoteIdentity, state: z.literal('eligible'), quote: purchaseQuote }).strict(),
  z.object({
    ...intentIdentity, operation: purchaseOperation, state: z.literal('held'), reason: purchaseHoldReason,
    original_amount: z.object({ currency: planCurrency, gross_cents: purchaseCents }).strict().optional()
      .meta({ description: 'Recorded balance of a held invoice; not a new quote or authorization.' }),
  }).strict(),
  z.object({ ...intentIdentity, state: z.literal('invalid_vat_id'), field: z.literal('billing.vat_id'), rule: z.literal('vat_id_invalid') }).strict(),
  z.object({ ...intentIdentity, state: z.literal('refused'), field: z.string().min(1), rule: purchaseRefusalRule }).strict(),
  z.object({
    ...intentIdentity, state: z.literal('payment_started'), payment_id: z.uuid(),
    payment: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('hosted'), checkout_id: z.uuid(), checkout_url: z.url() }).strict(),
      z.object({ kind: z.literal('mandate') }).strict(),
    ]),
  }).strict(),
]).superRefine(validateIntent).meta({ allOf: intentRules })
export type PurchaseIntent = z.infer<typeof purchaseIntent>

/** Shared by checkout, invoice payment and method change. Mandate-only setup remains held. */
export const checkoutResponse = purchaseIntent
export type CheckoutResponse = z.infer<typeof checkoutResponse>

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

export const purchaseIntentConfirmRequest = z.object({
  operation_key: purchaseOperationKey, operation: chargeOperation, ...quoteIdentity,
}).strict()
export type PurchaseIntentConfirmRequest = z.infer<typeof purchaseIntentConfirmRequest>

/** `409 target_state_conflict` details. Stale confirmation returns the new owner-visible intent. */
export const purchaseConflictDetails = z.discriminatedUnion('rule', [
  z.object({ field: z.literal('operation_key'), rule: z.literal('operation_key_reused') }).strict(),
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
 * The payment methods Fleetless takes: card, PayPal and Apple Pay, in EUR and USD, and no others (André, 2026-10-04).
 * Apple Pay is a Mollie method of its own at checkout and for a change, but the mandate it leaves is a card mandate.
 */
export const paymentMethodKind = z.enum(['card', 'paypal', 'applepay'])
export type PaymentMethodKind = z.infer<typeof paymentMethodKind>

/** `POST /api/billing/payment-method`'s body. */
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

/** An invoice's status: `open` until paid, or `uncollectible` after a fallback to Basic with an unpaid balance. */
export const invoiceStatus = z.enum(['open', 'paid', 'uncollectible'])
export type InvoiceStatus = z.infer<typeof invoiceStatus>

/** One invoice, rendered by the cloud: the number is gapless, `FL-<year>-<seq>`. */
export const billingInvoice = z.object({
  id: z.uuid().meta({ description: "The invoice's id." }),
  number: z.string().regex(/^FL-\d{4}-\d{4,}$/).meta({
    description: 'The invoice number: `FL-<year>-<seq>`, `seq` zero-padded to four digits, gapless per calendar year in `Europe/Berlin`.',
  }),
  issued_at: z.iso.datetime().meta({ description: 'When the invoice was issued.' }),
  status: invoiceStatus.meta({ description: 'This invoice\'s own status.' }),
  currency: planCurrency.meta({ description: "The org's billing currency." }),
  net_cents: z.number().int().nonnegative().meta({ description: 'The charge, excluding VAT, in integer cents.' }),
  vat_rate_percent: z.number().int().min(0).max(100).meta({ description: 'The VAT rate applied, in whole percent.' }),
  vat_cents: z.number().int().nonnegative().meta({ description: 'VAT, in integer cents (`vatCents`).' }),
  gross_cents: z.number().int().nonnegative().meta({ description: 'Net plus VAT, in integer cents.' }),
})
export type BillingInvoice = z.infer<typeof billingInvoice>

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

/** `POST /api/billing/change`'s answer: the billing view afterwards, and what was charged right now, if anything. */
const acceptedBillingChange = z.object({
  billing: billingView.meta({ description: 'The billing view after the change.' }),
  charged: billingInvoice.nullable().meta({ description: 'The invoice charged now, or `null` when the change was only scheduled for the period\'s end.' }),
}).strict()
export const billingChangeResponse = z.union([
  acceptedBillingChange,
  z.object({ intent: purchaseIntent }).strict(),
  z.object({ ...acceptedBillingChange.shape, intent: purchaseIntent.options[5].superRefine(validateIntent).meta({ allOf: intentRules }) }).strict(),
])
export type BillingChangeResponse = z.infer<typeof billingChangeResponse>

/** Confirmation/lookup recovers the same payment, and the resulting view for a paid change. */
export const purchaseIntentResponse = z.union([
  purchaseIntent,
  z.object({ ...acceptedBillingChange.shape, intent: purchaseIntent.options[5].superRefine(validateIntent).meta({ allOf: intentRules }) }).strict(),
])
export type PurchaseIntentResponse = z.infer<typeof purchaseIntentResponse>
