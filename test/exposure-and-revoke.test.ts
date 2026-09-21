// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { auditQuery, bridgeConfigApplied, configState, exposureCounts, robotListItem, PROTOCOL_VERSION } from '../src/index.js'

describe('exposure counts', () => {
  it('carries one non-negative integer per kind', () => {
    const ok = exposureCounts.safeParse({ datapoints: 3, actions: 0, services: 1, publishers: 0, cameras: 2 })
    expect(ok.success).toBe(true)
  })

  it('refuses a negative or fractional count — a count is neither', () => {
    for (const bad of [-1, 1.5]) {
      expect(exposureCounts.safeParse({ datapoints: bad, actions: 0, services: 0, publishers: 0, cameras: 0 }).success, String(bad)).toBe(false)
    }
  })

  it('is required on a robot list item, so "no counts" cannot be mistaken for "no exposures"', () => {
    // bridge_state is fully valid here, isolating `exposes` as the only
    // failure reason — the brief's original fixture used
    // bridge_state.since_ms (no such field; it's latency_ms), so it failed
    // for an unrelated reason and could never have gone green even if
    // `exposes` were wrongly made optional. See task-1-report.md.
    const withoutExposes = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'gate-bot',
      created_at: '2026-08-21T00:00:00.000Z',
      bridge_state: { online: false, latency_ms: null, low_bandwidth: false },
    }
    expect(robotListItem.safeParse(withoutExposes).success).toBe(false)
  })
})

describe('the audit prefix filter', () => {
  it('accepts a prefix on its own', () => {
    const q = auditQuery.safeParse({ action_prefix: 'server_key.' })
    expect(q.success && q.data.action_prefix).toBe('server_key.')
  })

  it('accepts an exact action on its own, unchanged', () => {
    expect(auditQuery.safeParse({ action: 'server_key.revoked' }).success).toBe(true)
  })

  it('refuses both together, naming the field — a query that says an exact name AND a prefix is a caller mistake', () => {
    const q = auditQuery.safeParse({ action: 'server_key.revoked', action_prefix: 'server_key.' })
    expect(q.success).toBe(false)
    expect(!q.success && q.error.issues[0]!.path).toEqual(['action_prefix'])
  })
})

describe('structured apply errors', () => {
  const base = { slug: 'front_camera', kind: 'camera' as const, code: 'unknown', message: 'boom' }

  it('carries the kind that failed and a code beside the message', () => {
    const ok = bridgeConfigApplied.safeParse({ type: 'config_applied', version: 3, ok: false, errors: [base] })
    expect(ok.success).toBe(true)
  })

  it('accepts the whole-kind marker slug `*`, which the bridge really sends', () => {
    const ok = bridgeConfigApplied.safeParse({
      type: 'config_applied', version: 3, ok: false,
      errors: [{ ...base, slug: '*', code: 'whole_kind_failed' }],
    })
    expect(ok.success).toBe(true)
  })

  it('passes through a code the cloud has never heard of, rather than refusing the frame', () => {
    const ok = bridgeConfigApplied.safeParse({
      type: 'config_applied', version: 3, ok: false,
      errors: [{ ...base, code: 'a_future_classification' }],
    })
    expect(ok.success).toBe(true) // an enum here would make every new bridge classification a protocol change
  })

  it('refuses a kind that is not one of the five', () => {
    const bad = bridgeConfigApplied.safeParse({
      type: 'config_applied', version: 3, ok: false,
      errors: [{ ...base, kind: 'gadget' }],
    })
    expect(bad.success).toBe(false)
  })

  it('still requires a message — a code without one explains nothing', () => {
    const { message: _dropped, ...noMessage } = base
    expect(bridgeConfigApplied.safeParse({ type: 'config_applied', version: 3, ok: false, errors: [noMessage] }).success).toBe(false)
  })

  it('announces protocol 3, because the wire changed again', () => {
    expect(PROTOCOL_VERSION).toBe(3)
  })
})

describe('the console reads the same apply error the bridge sent', () => {
  it('round-trips kind, code and details through configState.applied_errors, not just slug and message', () => {
    const fullError = {
      slug: '*',
      kind: 'camera' as const,
      code: 'whole_kind_failed',
      message: 'boom',
      details: { attempted: 3 },
    }
    const parsed = configState.safeParse({
      published_version: 2,
      published_at: '2026-08-10T12:00:00.000Z',
      draft_updated_at: '2026-08-10T12:05:00.000Z',
      applied_version: 1,
      applied_ok: false,
      applied_errors: [fullError],
    })
    expect(parsed.success).toBe(true)
    // Not `.toMatchObject`: the point is nothing gets silently stripped, so
    // the parsed error must equal the input exactly, field for field.
    expect(parsed.success && parsed.data.applied_errors).toEqual([fullError])
  })
})
