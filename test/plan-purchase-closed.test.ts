// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { ERROR_CODES, PLANS, ROUTES, orgPlan } from '../src/index.js'

const GATED = [
  'POST /api/billing/checkout',
  'POST /api/billing/intents/:id/display',
  'POST /api/billing/intents/:id/confirm',
  'POST /api/billing/change',
  'POST /api/org/plan/change/prepare',
  'PUT /api/org/plan/change',
]

const row = (key: string) => {
  const [method, path] = key.split(' ')
  return ROUTES.find((r) => r.method === method && r.path === path)
}

const plan = {
  plan: 'basic',
  currency: 'eur',
  period_ends_at: '2026-11-30T23:59:59.999Z',
  addons: { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 },
  limits: PLANS.basic.limits,
  features: PLANS.basic.features,
  usage: { seats: 1, robots: 0, apps: 0, app_users: 0, live_video_ms_this_month: 0, asset_bytes: 0 },
  pending_change: null,
  lock: null,
  switch: null,
}

describe('open beta: paid plans unlocked per organization', () => {
  it('registers plan_purchase_closed as a refusal code, distinct from forbidden and signup_closed', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).toContain('plan_purchase_closed')
    expect(codes).toContain('forbidden')
    expect(codes).toContain('signup_closed')
  })

  it('lists plan_purchase_closed on exactly the six purchase routes', () => {
    const listing = ROUTES
      .filter((r) => (r.errors as readonly string[]).includes('plan_purchase_closed'))
      .map((r) => `${r.method} ${r.path}`)
    expect(listing.sort()).toEqual([...GATED].sort())
  })

  it.each([
    'GET /api/billing',
    'GET /api/billing/intents',
    'GET /api/billing/checkout/:id',
    'POST /api/billing/cancel',
    'POST /api/billing/resume',
    'PATCH /api/billing/details',
    'POST /api/billing/payment-method',
    'POST /api/billing/invoices/:id/pay',
    'POST /api/billing/charges/:id/pay',
    'POST /api/billing/mollie/webhook',
    'DELETE /api/org/plan/change',
    'GET /api/org/plan',
  ])('never refuses %s with it', (key) => {
    const route = row(key)
    expect(route).toBeDefined()
    expect(route?.errors).not.toContain('plan_purchase_closed')
  })

  it('says on the billing family when the gate applies and what it never refuses', () => {
    const notes = row('GET /api/billing')?.notes ?? ''
    expect(notes).toMatch(/403 plan_purchase_closed/)
    expect(notes).toMatch(/paid_plans/)
    expect(notes).toMatch(/Basic/)
    for (const spared of ['cancel', 'details', 'payment method', 'invoices']) expect(notes).toContain(spared)
  })

  it('orgPlan carries paid_plans, open or closed, and requires it', () => {
    expect(orgPlan.safeParse({ ...plan, paid_plans: 'open' }).success).toBe(true)
    expect(orgPlan.safeParse({ ...plan, paid_plans: 'closed' }).success).toBe(true)
    expect(orgPlan.safeParse(plan).success).toBe(false)
    expect(orgPlan.safeParse({ ...plan, paid_plans: 'unlocked' }).success).toBe(false)
    expect(orgPlan.shape.paid_plans.description).toMatch(/403 plan_purchase_closed/)
  })
})
