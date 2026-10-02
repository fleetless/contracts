// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { ADDONS, PLANS, PLAN_ORDER, nextPlanRaising, pricesFromEurMonth, requiredPlanFor, usdCentsFromEurCents, yearlyEurCents } from '../src/plans.js'

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
  it('prices in cents, EU and elsewhere, monthly and yearly', () => {
    expect(PLANS.basic.prices).toEqual({ eur_month: 0, usd_month: 0, eur_year: 0, usd_year: 0 })
    expect(PLANS.plus.prices).toEqual({ eur_month: 2900, usd_month: 3400, eur_year: 29580, usd_year: 34100 })
    expect(PLANS.pro.prices).toEqual({ eur_month: 14900, usd_month: 17200, eur_year: 151980, usd_year: 174800 })
    expect(PLANS.enterprise.prices).toBeNull()
  })
  it('add-ons', () => {
    expect(ADDONS.seats).toMatchObject({ raises: 'seats', per_unit: 1, prices: { eur_month: 900, usd_month: 1100, eur_year: 9180, usd_year: 10600 } })
    expect(ADDONS.robots).toMatchObject({ raises: 'robots', per_unit: 1, prices: { eur_month: 1900, usd_month: 2200, eur_year: 19380, usd_year: 22300 } })
    expect(ADDONS.apps).toMatchObject({ raises: 'apps', per_unit: 1, prices: { eur_month: 900, usd_month: 1100, eur_year: 9180, usd_year: 10600 } })
    expect(ADDONS.app_user_packs).toMatchObject({ raises: 'app_users', per_unit: 5, prices: { eur_month: 1000, usd_month: 1200, eur_year: 10200, usd_year: 11800 } })
    expect(ADDONS.live_video_packs).toMatchObject({ raises: 'live_video_ms_per_month', per_unit: 900_000_000, prices: { eur_month: 900, usd_month: 1100, eur_year: 9180, usd_year: 10600 } })
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
    expect(pricesFromEurMonth(1000)).toEqual({ eur_month: 1000, usd_month: 1200, eur_year: 10200, usd_year: 11800 })
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
