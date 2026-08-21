import { describe, it, expect } from 'vitest'
import { auditQuery, bridgeConfigApplied, exposureCounts, robotListItem, PROTOCOL_VERSION } from '../src/index.js'

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
    // bridge_state is otherwise fully valid here, so this isolates the
    // absence of `exposes` as the only reason parsing fails — the brief's
    // original fixture used bridge_state.since_ms, a field that does not
    // exist on bridgeState (it is latency_ms), so it failed validation for
    // an unrelated reason and could never have gone green even if `exposes`
    // were wrongly made optional. See task-1-report.md.
    const withoutExposes = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: '22222222-2222-4222-8222-222222222222',
      name: 'gate-bot',
      created_at: '2026-08-21T00:00:00.000Z',
      bridge_state: { online: false, latency_ms: null },
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
  const base = { slug: 'front-camera', kind: 'camera' as const, code: 'unknown', message: 'boom' }

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

  it('announces protocol 2, because the wire changed', () => {
    expect(PROTOCOL_VERSION).toBe(2)
  })
})
