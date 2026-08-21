import { describe, it, expect } from 'vitest'
import { orgUsageQuery, orgUsageResponse, usageDay, usageMetric, USAGE_WINDOW_MAX_DAYS } from '../src/index.js'

describe('usage metering shapes', () => {
  it('takes an inclusive day window from a query string', () => {
    const q = orgUsageQuery.safeParse({ from_day: '2026-07-01', to_day: '2026-07-31' })
    expect(q.success && q.data.from_day).toBe('2026-07-01')
    expect(q.success && q.data.to_day).toBe('2026-07-31')
  })

  it('accepts a single-day window, because the window is inclusive on both ends', () => {
    expect(orgUsageQuery.safeParse({ from_day: '2026-07-04', to_day: '2026-07-04' }).success).toBe(true)
  })

  it('refuses an inverted window, naming the field', () => {
    const q = orgUsageQuery.safeParse({ from_day: '2026-07-31', to_day: '2026-07-01' })
    expect(q.success).toBe(false)
    expect(!q.success && q.error.issues[0]!.path).toEqual(['from_day'])
  })

  it('is `.strict()`, so a typo in a parameter is refused rather than ignored', () => {
    expect(orgUsageQuery.safeParse({ from_day: '2026-07-01', to_day: '2026-07-31', from_dya: 'x' }).success).toBe(false)
  })

  it('refuses anything that is not a calendar day', () => {
    for (const bad of ['2026-7-1', '20260701', '2026-07-01T00:00:00Z', '', 'yesterday']) {
      expect(usageDay.safeParse(bad).success, bad).toBe(false)
    }
    expect(usageDay.safeParse('2026-07-01').success).toBe(true)
  })

  it('names exactly the five metrics the meter records', () => {
    expect(usageMetric.options).toEqual(['api_calls', 'live_session_ms', 'retention_bytes', 'asset_bytes', 'robot_online_ms'])
  })

  it('carries a nullable app id and a nullable app name, and a non-negative integer value', () => {
    const ok = orgUsageResponse.safeParse({
      rows: [
        { app_id: '11111111-1111-4111-8111-111111111111', app_name: 'Warehouse', metric: 'api_calls', day: '2026-07-01', value: 12 },
        { app_id: null, app_name: null, metric: 'retention_bytes', day: '2026-07-01', value: 0 },
      ],
      from_day: '2026-07-01',
      to_day: '2026-07-31',
    })
    expect(ok.success).toBe(true)
  })

  it('refuses a negative or fractional value — a meter reading is neither', () => {
    const row = { app_id: null, app_name: null, metric: 'api_calls', day: '2026-07-01' }
    const body = (value: number) => ({ rows: [{ ...row, value }], from_day: '2026-07-01', to_day: '2026-07-01' })
    expect(orgUsageResponse.safeParse(body(-1)).success).toBe(false)
    expect(orgUsageResponse.safeParse(body(1.5)).success).toBe(false)
  })

  it('publishes the window ceiling as a constant, so the cloud and a client cannot disagree about it', () => {
    expect(USAGE_WINDOW_MAX_DAYS).toBe(366)
  })
})
