// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import * as formatsModule from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  C4_ACTIONS, C4_TEXT_IDS, PLANS, ROUTES,
  billingChangeResponse, billingDecisionSnapshot, c4ActionOf, c4Declaration, chargeAmounts,
  checkoutDraftResponse, checkoutOpenDetails, checkoutStartResponse, formatEur,
  purchaseConflictDetails, purchaseHoldReason, storedBillingDecisionSnapshot, viesUnavailableDetails,
  type BillingCycle, type C4Action, type VatTreatment,
} from '../src/index.js'
import { company, eligibleIntent, intentBase, operationKey, pendingIntent, startedIntent } from './purchase-fixtures.js'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const addFormats = formatsModule.default as unknown as (validator: Ajv2020) => void
addFormats(ajv)
const artifact = (name: string) => ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))

const id = '039172ce-712c-4ec8-897c-15492a7eeb76'
const proof = 'x'.repeat(43)
const terms = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/terms/v1.0/' }
const dpa = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/dpa/v1.0/' }
const zeroAddons = { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 }
const org = 'Acme Robotics'
const euroUs = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const RATE: Record<VatTreatment, number> = { de_standard: 19, reverse_charge: 0, outside_eu: 0 }

type Paid = 'plus' | 'pro'
interface Case { action: C4Action; plan: Paid; cycle: BillingCycle; treatment: VatTreatment }

/** A snapshot the cloud could issue for this action, with the declaration c4Declaration writes for it. */
function snapshotFor({ action, plan, cycle, treatment }: Case) {
  const rate = RATE[treatment]
  const target = action === 'cancel' || action === 'keep_basic' ? 'basic' : plan
  const planNet = PLANS[target].prices![cycle === 'monthly' ? 'eur_month' : 'eur_year']
  const period = chargeAmounts(planNet, rate)
  const quoteNet = action === 'checkout' ? planNet : action === 'pay_and_switch' ? 1500 : 0
  const quote = { currency: 'eur' as const, ...chargeAmounts(quoteNet, rate), rate_percent: rate }
  const periodName = cycle === 'monthly' ? 'month' : 'year'
  const amounts = {
    currency: 'eur', quote, plan_net_cents: planNet, addon_lines: [], period_net_cents: planNet,
    period_vat_cents: period.vat_cents, period_gross_cents: period.gross_cents, vat_treatment: treatment,
    vat_treatment_line: treatment === 'de_standard'
      ? `19% German VAT: ${euroUs(period.vat_cents)}; total ${euroUs(period.gross_cents)} per ${periodName}`
      : treatment === 'reverse_charge' ? 'Reverse charge — VAT payable by the recipient' : 'Not taxable in Germany',
    due_today_gross_cents: quote.gross_cents,
    prorated_net_cents: action === 'pay_and_switch' ? quoteNet : null, renewal_net_cents: planNet,
  }
  const existing = (mode: 'on_confirmation' | 'scheduled') => ({
    anchor: 'existing_period', display_time_zone: 'Europe/Berlin', starts_on: '2026-10-01', starts_at: '2026-09-30T22:00:00Z',
    current_period_ends_at: '2026-10-25T01:30:00Z', renews_at: '2026-10-25T01:30:00Z',
    effective: mode === 'scheduled'
      ? { mode, at: '2026-10-25T01:30:00Z', at_period_end: true }
      : { mode, quoted_as_of_at: '2026-10-12T08:00:00Z', local_date: '2026-10-12' },
  })
  const kind = action === 'checkout' ? 'checkout' : action === 'cancel' || action === 'keep_basic' || (action === 'schedule_downgrade' && plan === 'plus') ? 'plan_change' : 'paid_change'
  const selection = { plan: target, cycle, addons: zeroAddons, ...(kind === 'plan_change' ? { keep: null } : {}) }
  const snapshot = {
    snapshot_id: id, decision_kind: kind, decision_id: '88791f9a-fae3-4f4b-87c0-b204e45d6a90', operation_key: operationKey,
    owner_id: 'fa87ac72-a398-4b55-b343-993d4b297a29', organization_id: '0d5c9e93-bfce-4d2f-90dc-31eb82c02c94',
    organization_name: org, quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2', selection, amounts,
    period: action === 'checkout'
      ? { anchor: 'on_first_successful_payment', cycle, start_statement: 'Starts when your first payment succeeds',
        period_statement: `First billing period: one full ${periodName} from successful payment; renews at the end of that period` }
      : existing(action === 'pay_and_switch' || action === 'switch' ? 'on_confirmation' : 'scheduled'),
    future_price_replacement: null,
    declaration: {
      ...c4Declaration(action, { org, plan, dueCents: quote.gross_cents, periodGrossCents: period.gross_cents, cycle }),
      terms, dpa,
    },
    expires_at: '2026-10-25T01:20:00Z',
  }
  return snapshot
}

// Keeping Basic names no plan: one case per cycle and treatment is enough.
const plansFor = (action: C4Action): Paid[] => action === 'keep_basic' ? ['plus'] : ['plus', 'pro']
const cyclesFor = (action: C4Action): BillingCycle[] => action === 'schedule_switch' ? ['monthly'] : ['monthly', 'yearly']
const CASES: Case[] = C4_ACTIONS.flatMap(action => plansFor(action).flatMap(plan => cyclesFor(action).flatMap(cycle =>
  (['de_standard', 'reverse_charge', 'outside_eu'] as const).map(treatment => ({ action, plan, cycle, treatment })))))
// Where the org stands before each decision. A Pro downgrade on the same plan is fewer add-ons.
const fromOf = ({ action, plan, cycle }: Case) => action === 'checkout' || action === 'keep_basic' ? 'basic' as const
  : action === 'schedule_downgrade' && plan === 'plus' ? 'pro' as const
  : action === 'schedule_downgrade' ? { plan, cycle }
  : action === 'schedule_switch' ? { plan, cycle: 'yearly' as const }
  : action === 'pay_and_switch' || action === 'switch' ? 'plus' as const : plan

describe('formatEur writes money the way the console does', () => {
  it('drops whole cents and keeps the rest, with a plain space before the sign', () => {
    expect(formatEur(3451)).toBe('34,51 €')
    expect(formatEur(2900)).toBe('29 €')
    expect(formatEur(29580)).toBe('295,80 €')
    expect(formatEur(0)).toBe('0 €')
    expect(formatEur(5)).toBe('0,05 €')
    expect(formatEur(123456)).toBe('1.234,56 €')
    expect(formatEur(177480000)).toBe('1.774.800 €')
    expect([...formatEur(3451)].map(c => c.codePointAt(0))).toEqual([0x33, 0x34, 0x2c, 0x35, 0x31, 0x20, 0x20ac])
  })

  it('agrees with the de-DE number format the console builds it from', () => {
    const console = (cents: number) => {
      const hasCents = cents % 100 !== 0
      return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 }).format(cents / 100)} €`
    }
    for (const cents of [1, 99, 100, 999, 1000, 3451, 9999, 10000, 99999, 100000, 1234567, 17748000, 99999999]) {
      expect(formatEur(cents), String(cents)).toBe(console(cents))
    }
  })

  it('refuses what is not a whole number of cents', () => {
    for (const cents of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => formatEur(cents)).toThrow()
  })
})

describe('the C.4 declaration: one sentence and one button label per action', () => {
  it('names seven actions, each with its own text id', () => {
    expect(C4_ACTIONS).toEqual(['checkout', 'pay_and_switch', 'switch', 'schedule_switch', 'schedule_downgrade', 'cancel', 'keep_basic'])
    expect(C4_TEXT_IDS).toEqual(['C4-1168-checkout', 'C4-1168-pay-and-switch', 'C4-1168-switch', 'C4-1168-schedule-switch', 'C4-1168-schedule-downgrade', 'C4-1168-cancel', 'C4-1168-keep-basic'])
    for (const [i, action] of C4_ACTIONS.entries()) {
      expect(c4Declaration(action, { org, plan: 'plus', dueCents: 3451, periodGrossCents: 3451, cycle: 'monthly' }).text_id).toBe(C4_TEXT_IDS[i])
    }
  })

  it('writes the approved checkout sentence and the button it names', () => {
    expect(c4Declaration('checkout', { org, plan: 'plus', dueCents: 3451, periodGrossCents: 3451, cycle: 'monthly' })).toEqual({
      text_id: 'C4-1168-checkout',
      action_label: 'Pay 34,51 € with Mollie',
      text: 'By selecting “Pay 34,51 € with Mollie”, you order Plus for Acme Robotics as a business, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 34,51 € every month until you cancel.',
    })
    expect(c4Declaration('checkout', { org, plan: 'pro', dueCents: 151980, periodGrossCents: 151980, cycle: 'yearly' }).text)
      .toBe('By selecting “Pay 1.519,80 € with Mollie”, you order Pro for Acme Robotics as a business, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 1.519,80 € every year until you cancel.')
  })

  it('writes the plan-change sentences and labels', () => {
    const v = { org, plan: 'pro' as const, dueCents: 9500, periodGrossCents: 17731, cycle: 'monthly' as const }
    expect(c4Declaration('pay_and_switch', v)).toMatchObject({
      action_label: 'Pay 95 € and switch',
      text: 'By selecting “Pay 95 € and switch”, you order Pro for Acme Robotics as a business from today, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 95 € now and 177,31 € every month after that until you cancel.',
    })
    expect(c4Declaration('switch', { ...v, dueCents: 0 })).toMatchObject({
      action_label: 'Switch to Pro',
      text: 'By selecting “Switch to Pro”, you order Pro for Acme Robotics as a business from today, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 177,31 € every month from the next renewal until you cancel.',
    })
    expect(c4Declaration('schedule_downgrade', { ...v, plan: 'plus', dueCents: 0, periodGrossCents: 35200, cycle: 'yearly' })).toMatchObject({
      action_label: 'Schedule downgrade to Plus',
      text: 'By selecting “Schedule downgrade to Plus”, you order Plus for Acme Robotics as a business from the end of the current period, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 352 € every year from then until you cancel.',
    })
    expect(c4Declaration('schedule_switch', { ...v, dueCents: 0 })).toMatchObject({
      action_label: 'Switch to monthly at period end',
      text: 'By selecting “Switch to monthly at period end”, you order Pro monthly for Acme Robotics as a business from the end of the current period, agree to the Terms of Service and the Data Processing Agreement, and authorise Fleetless to charge 177,31 € every month from then until you cancel.',
    })
    expect(c4Declaration('cancel', { ...v, dueCents: 0, periodGrossCents: 0 })).toMatchObject({
      action_label: 'Cancel at period end',
      text: 'By selecting “Cancel at period end”, you cancel Pro for Acme Robotics at the end of the current period; Acme Robotics then stays on Basic under the Terms of Service and the Data Processing Agreement, and nothing more is charged.',
    })
  })

  it('writes the keep-Basic sentence and label, whatever plan and amounts it is given', () => {
    const expected = {
      text_id: 'C4-1168-keep-basic',
      action_label: 'Delete the rest and stay on Basic',
      text: 'By selecting “Delete the rest and stay on Basic”, Acme Robotics stays on Basic under the Terms of Service and the Data Processing Agreement; what you did not keep is deleted, and nothing is charged.',
    }
    expect(c4Declaration('keep_basic', { org, plan: 'basic', dueCents: 0, periodGrossCents: 0, cycle: 'monthly' })).toEqual(expected)
    expect(c4Declaration('keep_basic', { org, plan: 'enterprise', dueCents: 0, periodGrossCents: 0, cycle: 'yearly' })).toEqual(expected)
  })

  it.each(CASES)('$action, $plan $cycle, $treatment: the snapshot parses and names its action', (c) => {
    const snapshot = snapshotFor(c)
    const parsed = billingDecisionSnapshot.safeParse(snapshot)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(storedBillingDecisionSnapshot.safeParse(snapshot).success).toBe(true)
    expect(c4ActionOf(parsed.data!, fromOf(c))).toBe(c.action)
    expect(snapshot.declaration.text.startsWith(`By selecting “${snapshot.declaration.action_label}”, ${c.action === 'keep_basic' ? org : 'you'} `)).toBe(true)
  })

  it('derives the action from the decision and the plan it starts from', () => {
    const at = (c: Case) => snapshotFor(c) as unknown as Parameters<typeof c4ActionOf>[0]
    const base = { plan: 'pro', cycle: 'monthly', treatment: 'de_standard' } as const
    expect(c4ActionOf(at({ ...base, action: 'checkout' }))).toBe('checkout')
    expect(c4ActionOf(at({ ...base, action: 'pay_and_switch' }))).toBe('pay_and_switch')
    expect(c4ActionOf(at({ ...base, action: 'switch' }))).toBe('switch')
    // A plan change to Basic cancels a Plus or Pro plan, unchanged ...
    const toBasic = at({ ...base, action: 'cancel' })
    expect(c4ActionOf(toBasic, 'plus')).toBe('cancel')
    expect(c4ActionOf(toBasic, 'pro')).toBe('cancel')
    expect(c4ActionOf(toBasic, { plan: 'pro', cycle: 'yearly' })).toBe('cancel')
    // ... and keeps Basic for an org already on Basic or coming from Enterprise or a grandfathered plan.
    expect(c4ActionOf(toBasic, 'basic')).toBe('keep_basic')
    expect(c4ActionOf(toBasic, 'enterprise')).toBe('keep_basic')
    expect(c4ActionOf(toBasic, { plan: 'enterprise', cycle: 'yearly' })).toBe('keep_basic')
    expect(c4ActionOf(at({ ...base, action: 'keep_basic' }), 'basic')).toBe('keep_basic')
    // Without the current plan, a plan change to Basic is ambiguous, and says so.
    expect(() => c4ActionOf(toBasic)).toThrow(/current plan/)
    // A downward plan change prepared on its own route never needs the current plan.
    expect(c4ActionOf(at({ ...base, plan: 'plus', action: 'schedule_downgrade' }))).toBe('schedule_downgrade')
    // A scheduled paid change: a lower plan downgrades, the same plan on a monthly cycle switches the cycle.
    const scheduled = at({ ...base, action: 'schedule_switch' })
    expect(c4ActionOf(scheduled, 'pro')).toBe('schedule_switch')
    const lower = { ...scheduled, selection: { ...scheduled.selection, plan: 'plus' } } as typeof scheduled
    expect(c4ActionOf(lower, 'pro')).toBe('schedule_downgrade')
    expect(c4ActionOf(scheduled, { plan: 'pro', cycle: 'yearly' })).toBe('schedule_switch')
    // The same plan on the same cycle is fewer add-ons, which is no cycle switch.
    expect(c4ActionOf(scheduled, { plan: 'pro', cycle: 'monthly' })).toBe('schedule_downgrade')
    // The same plan on a yearly cycle can only be fewer add-ons too.
    const yearly = at({ ...base, cycle: 'yearly', action: 'schedule_downgrade' })
    expect(c4ActionOf(yearly, 'pro')).toBe('schedule_downgrade')
    expect(c4ActionOf(yearly)).toBe('schedule_downgrade')
    // Monthly and scheduled without the current plan is ambiguous, and says so.
    expect(() => c4ActionOf(scheduled)).toThrow(/current plan/)
  })

  it('refuses a wrong sentence, a wrong label or a sentence of another action', () => {
    const snapshot = snapshotFor({ action: 'checkout', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    const declaration = snapshot.declaration
    // The amounts come from the catalogue through `snapshotFor`, so the wrong ones are derived from the snapshot, never typed: a
    // typed price that the catalogue has moved away from replaces nothing, and the "wrong" variant would be the right declaration.
    const gross = formatEur(snapshot.amounts.due_today_gross_cents), net = formatEur(snapshot.amounts.plan_net_cents)
    expect(gross).not.toBe(net)
    expect(declaration.text).toContain(gross)
    const variants = [
      { ...declaration, text: declaration.text.replace(gross, net) },
      { ...declaration, text: declaration.text.replace('Acme Robotics', 'Other GmbH') },
      { ...declaration, text: declaration.text.replace('every month', 'every year') },
      { ...declaration, action_label: 'Order and pay' },
      { ...declaration, action_label: `Pay ${net} with Mollie` },
      { ...declaration, text_id: 'C4-1168-pay-and-switch' },
      { ...c4Declaration('pay_and_switch', { org, plan: 'plus', dueCents: snapshot.amounts.due_today_gross_cents, periodGrossCents: snapshot.amounts.period_gross_cents, cycle: 'monthly' }), terms, dpa },
      { ...declaration, text_id: 'DR-1374-draft-3-C.4' },
      { ...declaration, action_label: undefined },
      { ...declaration, extra: true },
    ]
    for (const wrong of variants) {
      expect(billingDecisionSnapshot.safeParse({ ...snapshot, declaration: wrong }).success, JSON.stringify(wrong)).toBe(false)
      expect(storedBillingDecisionSnapshot.safeParse({ ...snapshot, declaration: wrong }).success, JSON.stringify(wrong)).toBe(false)
    }
    // A cancellation names the plan it cancels, never Basic.
    const cancel = snapshotFor({ action: 'cancel', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    const asBasic = c4Declaration('cancel', { org, plan: 'basic', dueCents: 0, periodGrossCents: 0, cycle: 'monthly' })
    expect(billingDecisionSnapshot.safeParse({ ...cancel, declaration: { ...asBasic, terms, dpa } }).success).toBe(false)
    // Keeping Basic: exactly its own sentence and label, only on a plan change to Basic.
    const keep = snapshotFor({ action: 'keep_basic', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    expect(billingDecisionSnapshot.safeParse(keep).success).toBe(true)
    const keepWrong = [
      { ...keep.declaration, text: keep.declaration.text.replace('Acme Robotics', 'Other GmbH') },
      { ...keep.declaration, text: keep.declaration.text.replace('nothing is charged', 'nothing more is charged') },
      { ...keep.declaration, text: keep.declaration.text.replace(/[“”]/g, '"') },
      { ...keep.declaration, action_label: 'Cancel at period end' },
      { ...keep.declaration, action_label: 'Delete the rest and stay on basic' },
      { ...c4Declaration('cancel', { org, plan: 'plus', dueCents: 0, periodGrossCents: 0, cycle: 'monthly' }), text_id: 'C4-1168-keep-basic', terms, dpa },
    ]
    for (const wrong of keepWrong) {
      expect(billingDecisionSnapshot.safeParse({ ...keep, declaration: wrong }).success, JSON.stringify(wrong)).toBe(false)
      expect(storedBillingDecisionSnapshot.safeParse({ ...keep, declaration: wrong }).success, JSON.stringify(wrong)).toBe(false)
    }
    const keepDeclaration = { ...c4Declaration('keep_basic', { org, plan: 'basic', dueCents: 0, periodGrossCents: 0, cycle: 'monthly' }), terms, dpa }
    for (const action of ['checkout', 'pay_and_switch', 'switch', 'schedule_downgrade'] as const) {
      const other = snapshotFor({ action, plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
      expect(billingDecisionSnapshot.safeParse({ ...other, declaration: keepDeclaration }).success, action).toBe(false)
    }
    // A cycle switch is only ever to monthly.
    const yearlySwitch = snapshotFor({ action: 'schedule_downgrade', plan: 'pro', cycle: 'yearly', treatment: 'de_standard' })
    const asSwitch = c4Declaration('schedule_switch', { org, plan: 'pro', dueCents: 0, periodGrossCents: yearlySwitch.amounts.period_gross_cents, cycle: 'yearly' })
    expect(billingDecisionSnapshot.safeParse({ ...yearlySwitch, declaration: { ...asSwitch, terms, dpa } }).success).toBe(false)
  })

  it('publishes the text ids and the label each one allows in JSON Schema', () => {
    const validate = artifact('billing-decision-snapshot')
    const snapshot = snapshotFor({ action: 'checkout', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    expect(validate(snapshot), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate({ ...snapshot, declaration: { ...snapshot.declaration, action_label: 'Order and pay' } })).toBe(false)
    expect(validate({ ...snapshot, declaration: { ...snapshot.declaration, text_id: 'DR-1374-draft-3-C.4' } })).toBe(false)
    const keep = snapshotFor({ action: 'keep_basic', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    expect(validate(keep), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate({ ...keep, declaration: { ...keep.declaration, action_label: 'Cancel at period end' } })).toBe(false)
    const { action_label: _label, ...withoutLabel } = snapshot.declaration
    expect(validate({ ...snapshot, declaration: withoutLabel })).toBe(false)
  })
})

describe('stored snapshots stay readable', () => {
  const current = snapshotFor({ action: 'schedule_downgrade', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
  const legacy = {
    ...current,
    declaration: {
      text_id: 'DR-1374-draft-3-C.4',
      text: 'By selecting “Order and pay”, you agree to the Terms of Service and the Data Processing Agreement for Acme Robotics.',
      terms, dpa,
    },
  }

  it('reads a legacy declaration only through storedBillingDecisionSnapshot', () => {
    expect(storedBillingDecisionSnapshot.safeParse(legacy).success).toBe(true)
    expect(billingDecisionSnapshot.safeParse(legacy).success).toBe(false)
  })

  it('still checks the legacy sentence and shape', () => {
    for (const declaration of [
      { ...legacy.declaration, text: legacy.declaration.text.replace('Acme Robotics', 'Other GmbH') },
      { ...legacy.declaration, action_label: 'Order and pay' },
      { ...legacy.declaration, dpa: terms },
    ]) expect(storedBillingDecisionSnapshot.safeParse({ ...legacy, declaration }).success).toBe(false)
    expect(storedBillingDecisionSnapshot.safeParse({ ...legacy, amounts: { ...legacy.amounts, period_gross_cents: 1 } }).success).toBe(false)
  })
})

describe('checkoutStartResponse: the start decides in the request', () => {
  const snapshot = snapshotFor({ action: 'checkout', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
  const display = { confirmation_proof: proof, expires_at: snapshot.expires_at, snapshot: { ...snapshot, decision_id: intentBase.intent_id } }
  const eligible = {
    intent_id: intentBase.intent_id, operation_key: operationKey, operation: 'checkout', state: 'eligible',
    quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2', quote: snapshot.amounts.quote, display,
  }
  const variants = {
    eligible,
    vies_unavailable: { state: 'vies_unavailable', field: 'billing.vat_id', reason: 'vies_unavailable' },
    invalid_vat_id: { state: 'invalid_vat_id', field: 'billing.vat_id', rule: 'vat_id_invalid' },
    refused: { state: 'refused', field: 'billing.invoice_email', rule: 'public_email_domain' },
    held: { intent_id: intentBase.intent_id, operation_key: operationKey, operation: 'checkout', state: 'held', reason: 'issuer_cutover_in_progress' },
    payment_started: startedIntent,
  }
  const validate = artifact('checkout-start-response')

  it.each(Object.entries(variants))('%s parses, and the JSON Schema agrees', (_state, value) => {
    const parsed = checkoutStartResponse.safeParse(value)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('refuses what the start never answers', () => {
    const otherSnapshot = snapshotFor({ action: 'pay_and_switch', plan: 'plus', cycle: 'monthly', treatment: 'de_standard' })
    const refusedEverywhere = [
      { ...eligible, operation: 'paid_change' },
      { ...eligible, display: { ...display, snapshot: otherSnapshot, expires_at: otherSnapshot.expires_at } },
      { ...eligible, display: undefined },
      { ...variants.held, reason: 'lexware_contact_pending' },
      { ...variants.held, reason: 'legacy_usd_invoice' },
      { ...variants.vies_unavailable, intent_id: intentBase.intent_id },
      { ...variants.vies_unavailable, field: 'billing.tax_id' },
      pendingIntent,
      { ...startedIntent, payment: { kind: 'mandate' } },
      { ...startedIntent, operation: 'invoice_payment', invoice_id: id },
    ]
    for (const value of refusedEverywhere) {
      expect(checkoutStartResponse.safeParse(value).success, JSON.stringify(value)).toBe(false)
      expect(validate(value), JSON.stringify(value)).toBe(false)
    }
    // Cross-field identity the schema language cannot say: the display belongs to this intent.
    for (const value of [
      { ...eligible, intent_id: '11111111-1111-4111-8111-111111111111' },
      { ...eligible, operation_key: '0c15bc92-c26c-4a56-aac8-0046ff758392' },
      { ...eligible, quote_revision: 'quote-3' },
      { ...eligible, buyer_fingerprint: 'buyer-3' },
      { ...eligible, quote: { ...eligible.quote, gross_cents: eligible.quote.gross_cents + 1, vat_cents: eligible.quote.vat_cents + 1 } },
    ]) expect(checkoutStartResponse.safeParse(value).success, JSON.stringify(value)).toBe(false)
  })
})

describe('the hold reasons a customer can still meet', () => {
  it('shrink to the cutover freeze and the legacy reasons', () => {
    expect(purchaseHoldReason.options).toEqual(['legacy_usd_invoice', 'legacy_payer_unresolved', 'mandate_policy_unresolved', 'issuer_cutover_in_progress'])
    for (const gone of ['lexware_contact_pending', 'lexware_contact_changed', 'lexware_issuance_paused', 'frozen_price_missing']) {
      expect(purchaseHoldReason.safeParse(gone).success, gone).toBe(false)
    }
  })

  it('a paid change no longer waits for VIES', () => {
    const waiting = { intent: { ...pendingIntent, operation: 'paid_change' } }
    expect(billingChangeResponse.safeParse(waiting).success).toBe(false)
    expect(artifact('billing-change-response')(waiting)).toBe(false)
    expect(billingChangeResponse.safeParse({ intent: { ...eligibleIntent, operation: 'paid_change' } }).success).toBe(true)
    const held = { intent: { ...intentBase, operation: 'paid_change', state: 'held', reason: 'issuer_cutover_in_progress' } }
    expect(billingChangeResponse.safeParse(held).success).toBe(true)
  })
})

describe('the checkout draft, the open payment and the conflicts', () => {
  const draft = { plan: 'plus', cycle: 'yearly', billing: { ...company, address: { ...company.address, line2: 'Floor 2' } }, updated_at: '2026-11-18T09:00:00Z' }
  const prefill = { ...company, kind: 'company' }

  it('answers the draft, else the earlier details, else nothing', () => {
    const validate = artifact('checkout-draft-response')
    for (const value of [{ draft, prefill: null }, { draft: null, prefill }, { draft: null, prefill: null }]) {
      expect(checkoutDraftResponse.safeParse(value).success, JSON.stringify(value)).toBe(true)
      expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
    }
    for (const value of [
      { draft, prefill },
      { draft: { ...draft, plan: 'basic' }, prefill: null },
      { draft: { ...draft, updated_at: undefined }, prefill: null },
      { draft: null },
    ]) {
      expect(checkoutDraftResponse.safeParse(value).success, JSON.stringify(value)).toBe(false)
      expect(validate(value), JSON.stringify(value)).toBe(false)
    }
    // A draft is a complete purchase: another EU country without a VAT ID was never saved.
    expect(checkoutDraftResponse.safeParse({ draft: { ...draft, billing: { ...draft.billing, vat_id: null } }, prefill: null }).success).toBe(false)
  })

  it('names the open payment to continue', () => {
    const open = { field: 'billing', rule: 'checkout_open', expires_at: '2026-11-18T09:30:00Z', checkout_url: 'https://checkout.example/pay/1' }
    expect(checkoutOpenDetails.safeParse(open).success).toBe(true)
    expect(checkoutOpenDetails.safeParse({ ...open, expires_at: null, checkout_url: null }).success).toBe(true)
    expect(checkoutOpenDetails.safeParse({ ...open, checkout_url: undefined }).success).toBe(false)
    expect(checkoutOpenDetails.safeParse({ ...open, checkout_url: 'not a url' }).success).toBe(false)
    expect(artifact('checkout-open-details')(open)).toBe(true)
  })

  it('says VIES did not answer on a paid change', () => {
    const details = { field: 'billing.vat_id', rule: 'vies_unavailable', reason: 'vies_unavailable' }
    expect(viesUnavailableDetails.safeParse(details).success).toBe(true)
    expect(viesUnavailableDetails.safeParse({ ...details, reason: 'vies_down' }).success).toBe(false)
    expect(artifact('vies-unavailable-details')(details)).toBe(true)
  })

  it('refuses a spent or stale proof as display_stale', () => {
    const stale = { field: 'confirmation_proof', rule: 'display_stale' }
    expect(purchaseConflictDetails.safeParse(stale).success).toBe(true)
    expect(artifact('purchase-conflict-details')(stale)).toBe(true)
    expect(purchaseConflictDetails.safeParse({ ...stale, field: 'intent' }).success).toBe(false)
  })
})

describe('the checkout routes', () => {
  const route = (method: string, path: string) => ROUTES.find(r => r.method === method && r.path === path)

  it('registers the draft read for the Owner tier', () => {
    expect(route('GET', '/api/billing/checkout-draft')).toMatchObject({
      section: 'billing', audience: 'developer', auth: 'developer', ownerTier: true, rateLimited: false, status: 200,
      params: [], query: null, request: null, response: checkoutDraftResponse,
      errors: ['unauthorized', 'token_expired', 'token_revoked', 'tier_required'],
    })
  })

  it('answers the start with its display and says what it stores', () => {
    const start = route('POST', '/api/billing/checkout')!
    expect(start.response).toBe(checkoutStartResponse)
    expect(start.notes).toMatch(/vies_unavailable/)
    expect(start.notes).toMatch(/nothing is stored/i)
    expect(start.notes).toMatch(/billing\.checkout_start/)
    expect(start.notes).not.toMatch(/Persist operation_key|accept_terms is deprecated/)
    const confirm = route('POST', '/api/billing/intents/:id/confirm')!
    expect(confirm.notes).toMatch(/display_stale/)
    expect(confirm.notes).toMatch(/checkout_url/)
    expect(route('POST', '/api/billing/change')!.notes).toMatch(/purchase_eligibility_pending/)
    expect(route('POST', '/api/billing/change')!.notes).toMatch(/vies_unavailable/)
    expect(route('POST', '/api/billing/intents/:id/display')!.notes).toMatch(/action_label/)
  })
})
