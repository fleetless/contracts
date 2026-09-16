// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { latencyBucket, orgLatencyQuery, orgLatencyResponse, LATENCY_BUCKET_MS } from '../src/index.js'

describe('latencyBucket', () => {
  it('accepts a measured minute', () => {
    const parsed = latencyBucket.parse({
      bucket_at: '2026-08-20T14:21:00.000Z',
      min_ms: 18, avg_ms: 24.5, max_ms: 41, samples: 30, online_ms: 60_000,
    })
    expect(parsed.avg_ms).toBe(24.5)
  })

  // The distinction the nullable columns exist for: "offline all minute" is
  // not "0 ms latency".
  it('accepts an offline minute with no latency at all', () => {
    const parsed = latencyBucket.parse({
      bucket_at: '2026-08-20T14:22:00.000Z',
      min_ms: null, avg_ms: null, max_ms: null, samples: 0, online_ms: 0,
    })
    expect(parsed.samples).toBe(0)
    expect(parsed.avg_ms).toBeNull()
  })

  it(`refuses an online_ms above one bucket (${LATENCY_BUCKET_MS})`, () => {
    const over = { bucket_at: '2026-08-20T14:22:00.000Z', min_ms: null, avg_ms: null, max_ms: null, samples: 0, online_ms: LATENCY_BUCKET_MS + 1 }
    expect(latencyBucket.safeParse(over).success).toBe(false)
  })
})

describe('orgLatencyResponse', () => {
  it('names which ceiling truncated it, not merely that something did', () => {
    const parsed = orgLatencyResponse.parse({
      series: [], from_ms: 1755690000000, to_ms: 1755693600000,
      truncated: true, truncated_by: 'limit',
    })
    expect(parsed.truncated_by).toBe('limit')
  })

  it('refuses truncated_by outside the two named causes', () => {
    const bad = { series: [], from_ms: 1, to_ms: 2, truncated: true, truncated_by: 'because' }
    expect(orgLatencyResponse.safeParse(bad).success).toBe(false)
  })
})

describe('orgLatencyQuery', () => {
  // A query string carries text, never numbers — the union's input branch is
  // the wire, so this is the shape a real request has.
  it('accepts the window as the numeric strings a query string carries', () => {
    const parsed = orgLatencyQuery.parse({ from_ms: '1755690000000', to_ms: '1755693600000' })
    expect(parsed.from_ms).toBe(1755690000000)
    expect(parsed.to_ms).toBe(1755693600000)
  })

  it('requires both bounds, because a default window is a response size nobody chose', () => {
    expect(orgLatencyQuery.safeParse({ from_ms: '1755690000000' }).success).toBe(false)
    expect(orgLatencyQuery.safeParse({ to_ms: '1755693600000' }).success).toBe(false)
  })

  it('refuses an inverted window, and an empty one, rather than answering with an empty series', () => {
    // An empty half-open window has no answer; a caller who asked for one has
    // made a mistake, and an empty `series` would read as a quiet fleet.
    expect(orgLatencyQuery.safeParse({ from_ms: 2000, to_ms: 1000 }).success).toBe(false)
    expect(orgLatencyQuery.safeParse({ from_ms: 1000, to_ms: 1000 }).success).toBe(false)
    expect(orgLatencyQuery.safeParse({ from_ms: 1000, to_ms: 1001 }).success).toBe(true)
  })

  it('refuses a non-uuid robot_id here, where the column is one', () => {
    // The `?actor_id=not-a-uuid` -> 500 defect, refused in the
    // same place its fix was: the contract, not a second guard in the route.
    expect(orgLatencyQuery.safeParse({ from_ms: 1000, to_ms: 2000, robot_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('refuses an unknown parameter rather than ignoring it', () => {
    // A silently dropped `form_ms` answers 200 over a window the caller did
    // not ask for — worse than a refusal: it looks like data.
    expect(orgLatencyQuery.safeParse({ from_ms: 1000, to_ms: 2000, form_ms: 5 }).success).toBe(false)
  })
})
