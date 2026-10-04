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

/** EUR in the EU, USD elsewhere. */
export function currencyForCountry(country: string): PlanCurrency {
  return isEuCountry(country) ? 'eur' : 'usd'
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
 * Who may pay, and the VAT they pay. `vatIdValid`: `null` = no VAT ID
 * given; `true` = VIES valid **or unverified** (VIES unreachable is
 * accepted); `false` = VIES said invalid.
 *
 * Germany is unconditional — company or person, VAT ID optional, 19 %
 * regardless of whether a given ID checks out. A German VAT ID's validity
 * never gates checkout, only the renewal sweep later (dunning);
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

/** A billing address. `country` gates VAT (`vatFor`) and currency (`currencyForCountry`). */
export const billingAddress = z.object({
  line1: z.string().trim().min(1).max(200).meta({ description: 'Street and number, or the first address line.' }),
  line2: z.string().trim().max(200).nullable().meta({ description: 'A second address line, or `null` when there is none.' }),
  postal_code: z.string().trim().min(1).max(20).meta({ description: 'Postal or ZIP code.' }),
  city: z.string().trim().min(1).max(100).meta({ description: 'City or town.' }),
  country: countryCode.meta({ description: "The billing country. Decides VAT (`vatFor`) and currency (`currencyForCountry`)." }),
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
      description: "The company's VAT ID, or `null` for none. Required, and must check out through VIES, for a company outside Germany.",
    }),
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

/**
 * `POST /api/billing/checkout`'s body: the plan and cycle to buy — Basic is
 * free and never checked out — optional add-ons (Pro only; named on `plus`,
 * or without `planFeature.addons`, is `400 validation_error`), the payer,
 * and the terms and withdrawal confirmations: `accept_terms` is
 * always required; `accept_withdrawal` is required for a person and refused
 * for a company, which has no consumer right of withdrawal to confirm.
 */
export const checkoutRequest = z.object({
  plan: z.enum(['plus', 'pro']).meta({ description: 'The plan to buy.' }),
  cycle: billingCycle.meta({ description: 'Monthly, or yearly at 15 % off.' }),
  addons: orgAddons.partial().strict().optional().meta({
    description: 'Add-on counts to buy alongside the plan. Pro only; named on `plus`, or without the feature, `400 validation_error`.',
  }),
  billing: billingDetails.meta({ description: 'Who is paying, and where the invoice goes.' }),
  accept_terms: z.literal(true).meta({ description: "Confirms Fleetless's terms of service. Always required." }),
  accept_withdrawal: z.literal(true).optional().meta({
    description: "Confirms the plan starts at once and the 14-day right of withdrawal ends with it. Required for a person; a company sending it is `400 validation_error` — it has no withdrawal right to confirm.",
  }),
}).strict()
export type CheckoutRequest = z.infer<typeof checkoutRequest>

/** `POST /api/billing/checkout`'s answer: where to send the caller's browser. */
export const checkoutResponse = z.object({
  checkout_id: z.uuid().meta({ description: 'Identifies this checkout: polled by `GET /api/billing/checkout/:id` and carried on the return URL.' }),
  checkout_url: z.url().meta({ description: "Mollie's hosted checkout page. The caller's browser is sent here." }),
})
export type CheckoutResponse = z.infer<typeof checkoutResponse>

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
export const vatIdStatus = z.enum(['valid', 'unverified', 'invalid'])
export type VatIdStatus = z.infer<typeof vatIdStatus>

/** `POST /api/billing/vat-id/check`'s body: the VAT-ID-on-blur check the checkout and `PATCH /api/billing/details` both use. */
export const vatIdCheckRequest = z.object({
  country: countryCode.meta({ description: "The VAT ID's country." }),
  vat_id: z.string().trim().min(1).max(20).meta({ description: 'The VAT ID as typed; normalized before the VIES lookup (`normalizeVatId`).' }),
}).strict()
export type VatIdCheckRequest = z.infer<typeof vatIdCheckRequest>

/** `POST /api/billing/vat-id/check`'s answer. */
export const vatIdCheckResponse = z.object({
  status: vatIdStatus.meta({ description: "VIES's answer." }),
  vat_id: z.string().meta({ description: 'The normalized VAT ID that was checked.' }),
  name: z.string().nullable().meta({ description: 'The registered holder, when VIES named one; `null` otherwise.' }),
})
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

/** `PATCH /api/billing/details`'s body: the invoice email and the VAT ID, the two fields an owner edits after checkout. */
export const billingDetailsUpdate = z.object({
  invoice_email: z.email().optional().meta({ description: 'Replaces the invoice email. Omitted leaves it as it is.' }),
  vat_id: z.string().trim().max(20).nullable().optional().meta({
    description: 'Replaces the VAT ID; `null` clears it. Omitted leaves it as it is. A new ID is re-checked through VIES.',
  }),
}).strict()
export type BillingDetailsUpdate = z.infer<typeof billingDetailsUpdate>

/** `POST /api/billing/payment-method`'s body. */
export const paymentMethodChangeRequest = z.object({
  method: z.enum(['card', 'paypal', 'sepa']).meta({
    description: "The new mandate's method. `sepa` needs an open invoice to charge a real amount against; without one it is `400 validation_error`.",
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
    kind: z.literal('sepa').meta({ description: 'A SEPA direct-debit mandate.' }),
    holder: z.string().meta({ description: "The account holder's name on the mandate." }),
    iban_last4: z.string().regex(/^[0-9A-Z]{4}$/).meta({ description: 'The last four characters of the IBAN.' }),
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
  }).meta({ description: 'The VAT treatment and rate this account charges at (`vatFor`).' }),
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
    invoice_id: z.uuid().meta({ description: 'The open invoice dunning is chasing.' }),
    gross_cents: z.number().int().meta({ description: 'The amount owed, in integer cents.' }),
    due_at: z.iso.datetime().meta({ description: "The charge's due date; retries and the lock count from here." }),
    next_retry_at: z.iso.datetime().nullable().meta({ description: 'The next retry, or `null` once retries are exhausted.' }),
    lock_at: z.iso.datetime().meta({ description: 'When the org is locked if still unpaid (`BILLING_LOCK_DAY`).' }),
    failure: z.string().nullable().meta({
      description: "Mollie's own reason, e.g. 'card_expired'; 'vat_id_invalid' when VIES turned definitive.",
    }),
  }).nullable().meta({ description: '`null` while nothing is overdue.' }),
})
export type BillingAccount = z.infer<typeof billingAccount>

/** `GET /api/billing`'s answer, and what every other billing route hands back after a change. */
export const billingView = z.object({
  available: z.boolean().meta({ description: 'Whether this cloud takes payments at all — `false` when no Mollie key is configured.' }),
  account: billingAccount.nullable().meta({ description: '`null` before the org has ever checked out.' }),
  payment_method: paymentMethod.nullable().meta({ description: 'The payment method on file, or `null`.' }),
  invoices: z.array(billingInvoice).meta({ description: 'Newest first, at most 24.' }),
})
export type BillingView = z.infer<typeof billingView>

/** `POST /api/billing/change`'s answer: the billing view afterwards, and what was charged right now, if anything. */
export const billingChangeResponse = z.object({
  billing: billingView.meta({ description: 'The billing view after the change.' }),
  charged: billingInvoice.nullable().meta({ description: 'The invoice charged now, or `null` when the change was only scheduled for the period\'s end.' }),
})
export type BillingChangeResponse = z.infer<typeof billingChangeResponse>
