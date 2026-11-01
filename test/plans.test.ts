// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { ADDONS, PLANS, PLAN_ORDER, nextPlanRaising, pricesFromEurMonth, requiredPlanFor, usdCentsFromEurCents, yearlyEurCents } from '../src/plans.js'
import { adminPlanChangeRequest, planChangeRequest, planChangePrepareRequest, planChangeDecisionLookupQuery, planChangeDecisionStatusResponse } from '../src/plans.js'
import { ERROR_CODES, planLimitDetails, assetPlanLimitDetails } from '../src/errors.js'
import { liveSessionEndReason } from '../src/realtime.js'
import { auditActor } from '../src/audit.js'

describe('the plan catalogue matches the decision table (2026-09-30)', () => {
  it('limits', () => {
    expect(PLANS.basic.limits).toEqual({ seats: 1, robots: 1, apps: 1, app_users: 10, live_video_ms_per_month: 36_000_000, asset_bytes_per_robot: 1_000_000_000, history_days: 7, audit_days: 7 })
    expect(PLANS.plus.limits).toEqual({ seats: 3, robots: 3, apps: 3, app_users: 25, live_video_ms_per_month: 360_000_000, asset_bytes_per_robot: 2_000_000_000, history_days: 30, audit_days: 30 })
    expect(PLANS.pro.limits).toEqual({ seats: 5, robots: 5, apps: 5, app_users: 50, live_video_ms_per_month: 900_000_000, asset_bytes_per_robot: 3_000_000_000, history_days: 90, audit_days: 90 })
    expect(Object.values(PLANS.enterprise.limits).every((v) => v === null)).toBe(true)
  })
  it('features', () => {
    expect(PLANS.basic.features).toEqual({ app_mcp: false, two_factor: false, require_two_factor: false, app_oidc: false, hosted_logo: false, audit_export: false, addons: false })
    expect(PLANS.plus.features).toEqual({ app_mcp: true, two_factor: true, require_two_factor: false, app_oidc: true, hosted_logo: true, audit_export: false, addons: false })
    expect(PLANS.pro.features).toEqual({ app_mcp: true, two_factor: true, require_two_factor: true, app_oidc: true, hosted_logo: true, audit_export: true, addons: true })
    expect(Object.values(PLANS.enterprise.features).every(Boolean)).toBe(true)
  })
  it('worldwide EUR prices in cents, monthly and yearly', () => {
    expect(PLANS.basic.prices).toEqual({ eur_month: 0, eur_year: 0 })
    expect(PLANS.plus.prices).toEqual({ eur_month: 2900, eur_year: 29580 })
    expect(PLANS.pro.prices).toEqual({ eur_month: 14900, eur_year: 151980 })
    expect(PLANS.enterprise.prices).toBeNull()
  })
  it('add-ons', () => {
    expect(ADDONS.seats).toMatchObject({ raises: 'seats', per_unit: 1, prices: { eur_month: 900, eur_year: 9180 } })
    expect(ADDONS.robots).toMatchObject({ raises: 'robots', per_unit: 1, prices: { eur_month: 1900, eur_year: 19380 } })
    expect(ADDONS.apps).toMatchObject({ raises: 'apps', per_unit: 1, prices: { eur_month: 900, eur_year: 9180 } })
    expect(ADDONS.app_user_packs).toMatchObject({ raises: 'app_users', per_unit: 5, prices: { eur_month: 1000, eur_year: 10200 } })
    expect(ADDONS.live_video_packs).toMatchObject({ raises: 'live_video_ms_per_month', per_unit: 900_000_000, prices: { eur_month: 900, eur_year: 9180 } })
  })
})

describe('the USD rule: EUR × 1.15, up to the next whole dollar', () => {
  it.each([[2900, 3400], [14900, 17200], [900, 1100], [1900, 2200], [1000, 1200], [29580, 34100], [151980, 174800], [2000, 2300], [0, 0]])('%i → %i', (eur, usd) => {
    expect(usdCentsFromEurCents(eur)).toBe(usd)
  })
  it('an exact whole dollar is not rounded up again', () => expect(usdCentsFromEurCents(2000)).toBe(2300))
  it('yearly is 15 % off twelve months', () => {
    expect(yearlyEurCents(2900)).toBe(29580)
    expect(yearlyEurCents(14900)).toBe(151980)
    expect(pricesFromEurMonth(1000)).toEqual({ eur_month: 1000, eur_year: 10200 })
  })
})

describe('helpers', () => {
  it('order and gates', () => {
    expect(PLAN_ORDER).toEqual(['basic', 'plus', 'pro', 'enterprise'])
    expect(requiredPlanFor('app_mcp')).toBe('plus')
    expect(requiredPlanFor('require_two_factor')).toBe('pro')
    expect(requiredPlanFor('audit_export')).toBe('pro')
  })
  it('the next plan that raises a limit', () => {
    expect(nextPlanRaising('basic', 'robots')).toBe('plus')
    expect(nextPlanRaising('pro', 'robots')).toBe('enterprise')
    expect(nextPlanRaising('enterprise', 'robots')).toBeNull()
  })
})

describe("the organization's plan: changes, the admin request and plan errors (2026-10-02, fleetless/fleetless#103)", () => {
  const key = '0c15bc92-c26c-4a56-aac8-0046ff758391'
  const id = '039172ce-712c-4ec8-897c-15492a7eeb76'
  const proof = 'x'.repeat(43)
  const final = { change_id: id, operation_key: key, target_plan: 'basic', keep: null, confirmation_proof: proof }

  it('prepares without a reason or mutation, then requires proof on the final choice', () => {
    expect(planChangePrepareRequest.safeParse({ operation_key: key, target_plan: 'basic', keep: null }).success).toBe(true)
    expect(planChangePrepareRequest.safeParse({ operation_key: key, target_plan: 'basic', keep: null, cancellation_reason: 'x' }).success).toBe(false)
    expect(planChangeRequest.safeParse(final).success).toBe(true)
    expect(planChangeRequest.safeParse({ ...final, confirmation_proof: undefined }).success).toBe(false)
    expect(planChangeRequest.safeParse({ ...final, change_id: undefined }).success).toBe(false)
    expect(planChangeRequest.safeParse({ ...final, operation_key: undefined }).success).toBe(false)
  })

  it('accepts a Basic reason up to 500 input characters and rejects it for other plans', () => {
    expect(planChangeRequest.parse({ ...final, cancellation_reason: '  reason  ' })).toMatchObject({ cancellation_reason: 'reason' })
    expect(planChangeRequest.safeParse({ ...final, cancellation_reason: 'x'.repeat(500) }).success).toBe(true)
    expect(planChangeRequest.safeParse({ ...final, cancellation_reason: 'x'.repeat(501) }).success).toBe(false)
    expect(planChangeRequest.safeParse({ ...final, target_plan: 'plus', cancellation_reason: 'x' }).success).toBe(false)
    expect(planChangeRequest.safeParse({ ...final, target_plan: 'plus' }).success).toBe(true)
    expect(planChangeRequest.safeParse({ ...final, keep: { robots: [], apps: [], app_users: [], developers: [], owners: [] } }).success).toBe(false)
  })

  it('looks up only the real owner decision and distinguishes prepared from accepted', () => {
    expect(planChangeDecisionLookupQuery.parse({ operation_key: key })).toEqual({ operation_key: key })
    expect(planChangeDecisionLookupQuery.safeParse({ operation_key: key, owner_id: id }).success).toBe(false)
    expect(planChangeDecisionStatusResponse.parse({ state: 'prepared', change_id: id })).toEqual({ state: 'prepared', change_id: id })
    expect(planChangeDecisionStatusResponse.safeParse({ state: 'accepted', change_id: id }).success).toBe(false)
    const result = {
      plan: 'basic', currency: 'eur', period_ends_at: '2026-11-30T00:00:00Z',
      addons: { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 },
      limits: PLANS.basic.limits, features: PLANS.basic.features,
      usage: { seats: 1, robots: 0, apps: 0, app_users: 0, live_video_ms_this_month: 0, asset_bytes: 0 },
      pending_change: null, lock: null, switch: null,
    }
    expect(planChangeDecisionStatusResponse.safeParse({ state: 'accepted', change_id: id, result }).success).toBe(true)
  })

  it('the admin request takes overrides that clear with null', () => {
    expect(adminPlanChangeRequest.safeParse({ plan: 'enterprise', overrides: { robots: 40, history_days: 365, seats: null } }).success).toBe(true)
    expect(adminPlanChangeRequest.safeParse({ plan: 'pro', addons: { robots: 2 } }).success).toBe(true)
    expect(adminPlanChangeRequest.safeParse({ plan: 'gold' }).success).toBe(false)
  })

  it('plan_limit details carry what lifts the limit', () => {
    expect(planLimitDetails.safeParse({ limit: 'robots', used: 1, max: 1, plan: 'basic', lifted_by: { plan: 'plus', addon: null } }).success).toBe(true)
    expect(planLimitDetails.safeParse({ limit: 'history_days', used: 1, max: 1, plan: 'basic', lifted_by: { plan: 'plus', addon: null } }).success).toBe(false)
    expect(assetPlanLimitDetails.safeParse({ limit: 'asset_bytes_per_robot', used: 9, max: 10, plan: 'basic', lifted_by: { plan: 'plus', addon: null }, store_bytes: 10, used_bytes: 9, size_bytes: 2 }).success).toBe(true)
  })

  it('knows the new codes, reason and actor', () => {
    for (const c of ['plan_limit', 'plan_required', 'org_locked']) expect(ERROR_CODES).toContain(c)
    expect(liveSessionEndReason.options).toContain('plan_limit')
    expect(auditActor.shape.kind.options).toContain('fleetless')
  })
})
