import { describe, it, expect } from 'vitest'
import { latencyBucket, orgLatencyResponse, LATENCY_BUCKET_MS } from '../src/index.js'

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
