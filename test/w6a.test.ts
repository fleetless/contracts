/**
 * W6a — deletion, and the one channel that reports health.
 *
 * **This file exists because it did not.** Every wave from W2 to W6 carries an
 * `expect(ERROR_CODES).toContain(...)` over its own new codes, and each has
 * tests for the shapes it added. W6a shipped four new shapes — the largest of
 * the wave — with **zero** contract tests, and added `robot_deletion_partial`
 * to a route without adding it to `ERROR_CODES` at all. Five waves of
 * convention, skipped once, and the code added last fell through the gap
 * (Momus, W6a review).
 *
 * The reason it was skipped is worth keeping, because it will recur: a change
 * to an *existing* shape breaks the tests that already cover it, so the author
 * is forced to look. A **new** shape breaks nothing. Additions are not
 * self-policing, and nothing in this repository made anyone notice.
 */
import { describe, it, expect } from 'vitest'
import { ERROR_CODES } from '../src/errors.js'
import {
  robotDeletionSummary,
  resourceHealthState,
  resourceHealthListResponse,
  credentialSummary,
  RESOURCE_HEALTH_STATES,
} from '../src/rest.js'
import { resourceHealthEvent } from '../src/realtime.js'
import { bridgeCameraState, CLOSE_ROBOT_DELETED } from '../src/protocol.js'

const health = {
  robot_id: '11111111-1111-4111-8111-111111111111',
  kind: 'camera' as const,
  ref: 'front',
  state: 'auth_failed' as const,
  reason: 'the camera source refused the configured credentials',
  changed_at_ms: 1786522606705,
}

describe('W6a error codes', () => {
  it('registers every code the wave introduced', () => {
    // The convention this file was written to restore. `robot_in_use` was
    // added correctly and was still unasserted; `robot_deletion_partial` was
    // added later, by a different hand, and reached a route without ever
    // reaching this list.
    for (const code of ['robot_in_use', 'robot_deletion_partial']) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})

describe('W6a deletion', () => {
  it('makes a deletion record say what it destroyed, not merely that it did', () => {
    const summary = {
      slug_count: 4, sample_rows: 182_000, bytes_freed: 59_000_000,
      cameras: ['front', 'yard'], had_live_session: false, had_unpublished_draft: true,
    }
    expect(robotDeletionSummary.parse(summary)).toEqual(summary)
  })

  it('requires every field, because an absent count reads as zero', () => {
    // "Nothing was destroyed" and "nobody counted" are different facts, and a
    // receipt that omits one of them is a receipt for an unknown amount.
    for (const drop of ['slug_count', 'sample_rows', 'bytes_freed', 'cameras', 'had_live_session', 'had_unpublished_draft']) {
      const partial: Record<string, unknown> = {
        slug_count: 0, sample_rows: 0, bytes_freed: 0, cameras: [],
        had_live_session: false, had_unpublished_draft: false,
      }
      delete partial[drop]
      expect(robotDeletionSummary.safeParse(partial).success).toBe(false)
    }
  })

  it('says an unpublished draft went too, separately from the counts', () => {
    // The one field that says anything existed for a robot configured and
    // never published, where every count is legitimately zero.
    const neverPublished = robotDeletionSummary.parse({
      slug_count: 0, sample_rows: 0, bytes_freed: 0, cameras: [],
      had_live_session: false, had_unpublished_draft: true,
    })
    expect(neverPublished.had_unpublished_draft).toBe(true)
  })

  it('gives the bridge its own reason to stop, distinct from an auth failure', () => {
    // A token that was valid a second ago is indistinguishable from a revoked
    // one unless the cloud says which — and without that, a deleted robot
    // reconnects forever.
    expect(CLOSE_ROBOT_DELETED).toBe(4004)
  })
})

describe('W6a health', () => {
  it('describes the snapshot and the push with ONE list of states', () => {
    // These were two literal enums linked by nothing, agreeing only because
    // whoever added `unknown` remembered both places. The artifacts published
    // two independent copies with no `$ref`.
    for (const state of RESOURCE_HEALTH_STATES) {
      expect(resourceHealthState.safeParse({ ...health, state }).success).toBe(true)
      expect(resourceHealthEvent.safeParse({ type: 'resource_health', ...health, state }).success).toBe(true)
    }
    expect(resourceHealthState.safeParse({ ...health, state: 'made_up' }).success).toBe(false)
    expect(resourceHealthEvent.safeParse({ type: 'resource_health', ...health, state: 'made_up' }).success).toBe(false)
  })

  it('carries a word for "wrong, cause unknown"', () => {
    // Without it the mapping table's fallback had to either report `ok`,
    // hiding a failure, or claim `unreachable`, asserting a cause nobody
    // established.
    expect(RESOURCE_HEALTH_STATES).toContain('unknown')
    expect(resourceHealthState.parse({ ...health, state: 'unknown' }).state).toBe('unknown')
  })

  it('allows no reason, but never omits the field', () => {
    expect(resourceHealthState.parse({ ...health, reason: null }).reason).toBeNull()
    const { reason: _dropped, ...withoutReason } = health
    expect(resourceHealthState.safeParse(withoutReason).success).toBe(false)
  })

  it('is the same shape whether it arrives as a snapshot or a push', () => {
    // The two halves are one thing seen at two times. If they can disagree,
    // every consumer has to reconcile them separately, forever.
    const snapshot = resourceHealthListResponse.parse({ resources: [health] })
    const pushed = resourceHealthEvent.parse({ type: 'resource_health', ...health })
    const { type: _t, ...pushedBody } = pushed
    expect(pushedBody).toEqual(snapshot.resources[0])
  })

  it('says why a camera_state frame was sent, and refuses a frame that does not', () => {
    // `{publishing: false, error: null}` meant three unrelated things until
    // `cause` existed; the receiver could only tell them apart by remembering.
    for (const cause of ['command', 'source', 'config_change', 'live_lost']) {
      expect(bridgeCameraState.safeParse(
        { type: 'camera_state', slug: 'front', publishing: false, error: null, cause,
          observed_at_ms: 1786522606705,
          // W6b: `command` frames answer an attempt, the rest answer nothing.
          request_id: cause === 'command' ? 'cs-1' : null }).success).toBe(true)
    }
    expect(bridgeCameraState.safeParse(
      { type: 'camera_state', slug: 'front', publishing: false, error: null, observed_at_ms: 1786522606705, request_id: null }).success).toBe(false)
  })

  it('keeps "a password is stored" apart from "we can still decrypt it"', () => {
    const unreadable = credentialSummary.parse({
      name: 'site-cams', username: 'camuser', set: true, readable: false, used_by: [],
    })
    expect([unreadable.set, unreadable.readable]).toEqual([true, false])
  })
})
