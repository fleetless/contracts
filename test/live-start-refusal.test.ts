// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import * as barrel from '../src/index.js'
import { cameraOfflineDetails, LIVE_START_REFUSALS, liveStartRefusal } from '../src/live-start-refusal.js'
import { liveSessionEndReason, liveSessionEvent, resourceHealthEvent } from '../src/realtime.js'
import { RESOURCE_HEALTH_STATES, resourceHealthState } from '../src/rest.js'

/** fleetless/fleetless#1126: a live start the robot refuses ends the viewer's session with a reason. */
const ended = {
  type: 'live_session' as const,
  robot_id: '11111111-1111-4111-8111-111111111111',
  slug: 'front',
  session_id: '22222222-2222-4222-8222-222222222222',
  state: 'ended' as const,
  reason: 'start_refused' as const,
  detail: 'The robot\'s link is weak, so live video is paused. Snapshots go on.',
  refusal: 'low_bandwidth' as const,
  ended_at_ms: 1786522606705,
}

describe('a refused start is its own ending', () => {
  it('is a reason beside publish_failed, not a new name for it', () => {
    // An app tells "never started" from "stopped after starting" by the reason alone.
    expect(liveSessionEndReason.options).toContain('start_refused')
    expect(liveSessionEndReason.options).toContain('publish_failed')
  })

  it('carries the refusal as a class from a closed set', () => {
    expect(liveSessionEvent.parse(ended).refusal).toBe('low_bandwidth')
    for (const refusal of LIVE_START_REFUSALS) {
      expect(liveSessionEvent.safeParse({ ...ended, refusal }).success).toBe(true)
    }
    expect(liveSessionEvent.safeParse({ ...ended, refusal: 'source_auth_failed' }).success).toBe(false)
  })

  it('leaves refusal out of every other ending', () => {
    // Absent and `null` both parse, so a frame from before this field still does.
    const { refusal: _dropped, ...withoutRefusal } = ended
    expect(liveSessionEvent.safeParse({ ...withoutRefusal, reason: 'released_by_peer', detail: null }).success).toBe(true)
    expect(liveSessionEvent.safeParse({ ...ended, reason: 'expired', detail: null, refusal: null }).success).toBe(true)
  })

  it('names the five classes and keeps unknown', () => {
    expect(liveStartRefusal.options).toEqual(['low_bandwidth', 'source_auth', 'source_unreachable', 'not_startable', 'unknown'])
  })
})

describe('the 409 a joiner gets names the refusal', () => {
  it('has refusal as its one field', () => {
    expect(cameraOfflineDetails.parse({ refusal: 'source_auth' })).toEqual({ refusal: 'source_auth' })
    expect(cameraOfflineDetails.safeParse({}).success).toBe(false)
    expect(cameraOfflineDetails.safeParse({ refusal: 'because' }).success).toBe(false)
  })

  it('is published as a schema with the same enum', () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'schema', 'camera-offline-details.schema.json'), 'utf8'))
    expect(schema.required).toEqual(['refusal'])
    expect(schema.properties.refusal.enum).toEqual([...LIVE_START_REFUSALS])
  })

  it('is exported from the package root', () => {
    expect(barrel.cameraOfflineDetails).toBe(cameraOfflineDetails)
    expect(barrel.liveStartRefusal).toBe(liveStartRefusal)
    expect(barrel.LIVE_START_REFUSALS).toBe(LIVE_START_REFUSALS)
  })
})

describe('a weak link is a camera state', () => {
  it('is low_bandwidth, not unknown', () => {
    expect(RESOURCE_HEALTH_STATES).toContain('low_bandwidth')
    const health = {
      robot_id: '11111111-1111-4111-8111-111111111111',
      kind: 'camera' as const,
      ref: 'front',
      facet: 'publish' as const,
      state: 'low_bandwidth' as const,
      reason: 'The robot\'s link is weak, so live video is paused. Snapshots go on. (low_bandwidth)',
      changed_at_ms: 1786522606705,
    }
    expect(resourceHealthState.safeParse(health).success).toBe(true)
    expect(resourceHealthEvent.safeParse({ type: 'resource_health', ...health }).success).toBe(true)
  })
})
