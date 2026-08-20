import { describe, expect, it } from 'vitest'

import { resourceHealthState } from '../src/rest.js'
import {
  liveSessionEndReason,
  liveSessionEvent,
  resourceHealthCleared,
  resourceHealthEvent,
} from '../src/realtime.js'

const health = {
  robot_id: '11111111-1111-4111-8111-111111111111',
  kind: 'camera' as const,
  ref: 'front',
  facet: 'source' as const,
  state: 'auth_failed' as const,
  reason: null,
  changed_at_ms: 1786522606705,
}

describe('the two questions one health entry used to answer', () => {
  it('accepts both facets and refuses a third', () => {
    for (const facet of ['source', 'publish'] as const) {
      expect(resourceHealthState.safeParse({ ...health, facet }).success).toBe(true)
      expect(resourceHealthEvent.safeParse({ type: 'resource_health', ...health, facet }).success).toBe(true)
    }
    expect(resourceHealthState.safeParse({ ...health, facet: 'both' }).success).toBe(false)
  })

  it('requires the facet rather than defaulting it', () => {
    // A default would let a producer stay silent and land in whichever facet
    // the contract happened to prefer — which is the conflation this field
    // exists to end, moved one layer down.
    const { facet: _dropped, ...withoutFacet } = health
    expect(resourceHealthState.safeParse(withoutFacet).success).toBe(false)
  })

  it('lets one camera be readable and unpublishable at the same moment', () => {
    // The pair is the point: both facts once shared a key and each overwrote
    // the other, so a developer saw whichever arrived last.
    const source = resourceHealthState.parse({ ...health, facet: 'source', state: 'ok' })
    const publish = resourceHealthState.parse({ ...health, facet: 'publish', state: 'publish_failed' })
    expect(source.state).toBe('ok')
    expect(publish.state).toBe('publish_failed')
    expect(source.ref).toBe(publish.ref)
  })
})

describe('a viewer learns why its own session ended', () => {
  const ended = {
    type: 'live_session' as const,
    robot_id: '11111111-1111-4111-8111-111111111111',
    slug: 'front',
    session_id: '22222222-2222-4222-8222-222222222222',
    state: 'ended' as const,
    reason: 'config_changed' as const,
    detail: null,
    ended_at_ms: 1786522606705,
  }

  it('names the session it is about', () => {
    // `liveSessionResponse` carries a session_id precisely so a session can
    // be addressed; an event that ends one without naming it would send the
    // console back to guessing which tab lost what.
    expect(liveSessionEvent.safeParse(ended).success).toBe(true)
    const { session_id: _dropped, ...unaddressed } = ended
    expect(liveSessionEvent.safeParse(unaddressed).success).toBe(false)
  })

  it('can say that it does not know', () => {
    // A channel that cannot say "I cannot tell" says something false instead.
    expect(liveSessionEndReason.options).toContain('unknown')
    expect(liveSessionEvent.parse({ ...ended, reason: 'unknown' }).reason).toBe('unknown')
  })

  it('distinguishes a peer release from a config change', () => {
    // These two once shipped as one message because the client could not
    // tell them apart, and the fix then reported wrongly because it read a
    // sticky state after the fact instead of carrying the reason with the
    // ending.
    expect(liveSessionEndReason.options).toContain('released_by_peer')
    expect(liveSessionEndReason.options).toContain('config_changed')
  })

  it('refuses a reason nobody defined', () => {
    expect(liveSessionEvent.safeParse({ ...ended, reason: 'because' }).success).toBe(false)
  })
})

describe('a withdrawn health entry is its own event', () => {
  it('is a distinct type rather than a nullable state', () => {
    // So a consumer's switch has to name it: an unhandled variant fails tsc,
    // where a nullable field only invites `if (state)` and fails silently.
    const cleared = {
      type: 'resource_health_cleared' as const,
      robot_id: '11111111-1111-4111-8111-111111111111',
      kind: 'camera' as const,
      ref: 'front',
      facet: 'source' as const,
      cleared_at_ms: 1786522606705,
    }
    expect(resourceHealthCleared.safeParse(cleared).success).toBe(true)
    expect(resourceHealthEvent.safeParse(cleared).success).toBe(false)
  })
})
