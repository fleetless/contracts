// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  orgEvent, orgEventReplay, orgEventDropped, orgEventSubscribe,
  ORG_EVENT_BUFFER_SIZE, ORG_EVENT_DETAIL_MAX_BYTES,
} from '../src/index.js'

// zod 4's z.uuid() enforces the version and variant nibbles —
// `11111111-1111-1111-1111-111111111111` is refused.
const ROBOT = '22222222-4222-8222-9222-222222222222'

const EVENT = {
  type: 'org_event',
  seq: 1,
  at: '2026-08-20T14:22:07.000Z',
  kind: 'datapoint',
  severity: 'info',
  robot_id: ROBOT,
  subject: 'battery-voltage',
  detail: { value: 48.812, unit: 'V' },
}

describe('orgEvent', () => {
  it('accepts a robot-scoped event', () => {
    expect(orgEvent.parse(EVENT).subject).toBe('battery-voltage')
  })

  // An invite or a quota change belongs to the org, not to any robot.
  it('accepts an org-level event with no robot', () => {
    const orgLevel = { ...EVENT, kind: 'audit', robot_id: null, subject: 'a.kern@example.com' }
    expect(orgEvent.parse(orgLevel).robot_id).toBeNull()
  })

  it('refuses a kind outside the five sources', () => {
    expect(orgEvent.safeParse({ ...EVENT, kind: 'camera' }).success).toBe(false)
  })

  // The `errors` filter cuts across kinds — severity is its own field,
  // not derived from `detail`.
  it('refuses a severity outside the three levels', () => {
    expect(orgEvent.safeParse({ ...EVENT, severity: 'critical' }).success).toBe(false)
  })

  it('accepts a null detail', () => {
    expect(orgEvent.parse({ ...EVENT, detail: null }).detail).toBeNull()
  })

  it('refuses an unknown field rather than ignoring it', () => {
    expect(orgEvent.safeParse({ ...EVENT, text: 'pre-formatted' }).success).toBe(false)
  })
})

describe('orgEventReplay', () => {
  it('carries the events and whether anything is missing above them', () => {
    const parsed = orgEventReplay.parse({ type: 'org_event_replay', events: [EVENT], complete: false })
    expect(parsed.complete).toBe(false)
    expect(parsed.events).toHaveLength(1)
  })

  it('accepts an empty, complete replay — nothing has happened yet', () => {
    expect(orgEventReplay.parse({ type: 'org_event_replay', events: [], complete: true }).events).toEqual([])
  })

  it(`refuses more events than the buffer can hold (${ORG_EVENT_BUFFER_SIZE})`, () => {
    const tooMany = Array.from({ length: ORG_EVENT_BUFFER_SIZE + 1 }, (_, i) => ({ ...EVENT, seq: i + 1 }))
    expect(orgEventReplay.safeParse({ type: 'org_event_replay', events: tooMany, complete: false }).success).toBe(false)
  })
})

describe('orgEventDropped', () => {
  it('says how many were lost and since when', () => {
    const parsed = orgEventDropped.parse({ type: 'org_event_dropped', since_ms: 1755690000000, dropped: 412 })
    expect(parsed.dropped).toBe(412)
  })

  it('refuses a zero drop — a frame that reports nothing lost is noise', () => {
    expect(orgEventDropped.safeParse({ type: 'org_event_dropped', since_ms: 1, dropped: 0 }).success).toBe(false)
  })
})

describe('orgEventSubscribe', () => {
  it('carries nothing but its type — the org comes from the session', () => {
    expect(orgEventSubscribe.parse({ type: 'org_event_subscribe' }).type).toBe('org_event_subscribe')
  })

  it('refuses an org_id, which would be a caller naming its own tenant', () => {
    expect(orgEventSubscribe.safeParse({ type: 'org_event_subscribe', org_id: ROBOT }).success).toBe(false)
  })
})

describe('constants', () => {
  it('bounds a detail to a log line, not a payload', () => {
    expect(ORG_EVENT_DETAIL_MAX_BYTES).toBe(4_096)
  })
})
