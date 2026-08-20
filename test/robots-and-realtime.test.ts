import { describe, it, expect } from 'vitest'
import {
  cloudPing,
  bridgePong,
  robot,
  robotToken,
  createRobotRequest,
  createRobotResponse,
  robotListItem,
  datapointValue,
  clientSubscribe,
  subscribeError,
  datapointEvent,
} from '../src/index.js'

const ROBOT = {
  id: '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f',
  name: 'gate-bot',
  created_at: '2026-08-10T12:00:00.000Z',
}

describe('bridge protocol additions', () => {
  it('ping and pong carry the cloud clock', () => {
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1754800000000 }).success).toBe(true)
    expect(bridgePong.safeParse({ type: 'pong', ts_ms: 1754800000000 }).success).toBe(true)
    expect(cloudPing.safeParse({ type: 'ping' }).success).toBe(false)
    expect(bridgePong.safeParse({ type: 'pong', ts_ms: -1 }).success).toBe(false)
  })
})

describe('REST shapes', () => {
  it('robot has uuid id, bounded name, ISO created_at', () => {
    expect(robot.safeParse(ROBOT).success).toBe(true)
    expect(robot.safeParse({ ...ROBOT, id: 'r1' }).success).toBe(false)
    expect(robot.safeParse({ ...ROBOT, name: '' }).success).toBe(false)
    expect(robot.safeParse({ ...ROBOT, created_at: 'yesterday' }).success).toBe(false)
  })

  it('tokens are frt_ + 32 hex and appear only in the create response', () => {
    expect(robotToken.safeParse('frt_' + 'a1'.repeat(16)).success).toBe(true)
    expect(robotToken.safeParse('frt_short').success).toBe(false)
    expect(
      createRobotResponse.safeParse({ robot: ROBOT, token: 'frt_' + 'a1'.repeat(16) }).success,
    ).toBe(true)
  })

  it('create request is just a name', () => {
    expect(createRobotRequest.safeParse({ name: 'gate-bot' }).success).toBe(true)
    expect(createRobotRequest.safeParse({}).success).toBe(false)
  })

  it('list items embed the current bridge-state', () => {
    expect(
      robotListItem.safeParse({ ...ROBOT, bridge_state: { online: false, latency_ms: null } })
        .success,
    ).toBe(true)
    expect(robotListItem.safeParse(ROBOT).success).toBe(false)
  })

  it('datapoint reads always carry slug, value, timestamp_ms', () => {
    expect(
      datapointValue.safeParse({
        slug: 'bridge-state',
        value: { online: true, latency_ms: 12 },
        timestamp_ms: 1754800000000,
      }).success,
    ).toBe(true)
    expect(
      datapointValue.safeParse({ slug: 'bridge-state', value: {} }).success,
    ).toBe(false)
  })
})

describe('realtime client protocol', () => {
  it('subscribe addresses a robot + slug', () => {
    expect(
      clientSubscribe.safeParse({ type: 'subscribe', robot_id: ROBOT.id, slug: 'bridge-state' })
        .success,
    ).toBe(true)
    expect(
      clientSubscribe.safeParse({ type: 'subscribe', robot_id: 'nope', slug: 'bridge-state' })
        .success,
    ).toBe(false)
  })

  it('subscribe errors follow the error culture: stable code + message', () => {
    expect(
      subscribeError.safeParse({
        type: 'subscribe_error',
        robot_id: ROBOT.id,
        slug: 'no-such-thing',
        code: 'unknown_datapoint',
        message: 'This robot has no datapoint "no-such-thing".',
      }).success,
    ).toBe(true)
  })

  it('subscribe errors can echo malformed robot_id and slug (the frame must be constructible exactly then)', () => {
    expect(
      subscribeError.safeParse({
        type: 'subscribe_error',
        robot_id: 'not-a-uuid',
        slug: 'Not A Slug',
        code: 'validation_error',
        message: 'robot_id must be a uuid.',
      }).success,
    ).toBe(true)
  })

  it('datapoint events mirror the REST read shape plus addressing', () => {
    expect(
      datapointEvent.safeParse({
        type: 'datapoint',
        robot_id: ROBOT.id,
        slug: 'bridge-state',
        value: { online: true, latency_ms: 8 },
        timestamp_ms: 1754800000000,
      }).success,
    ).toBe(true)
    expect(
      datapointEvent.safeParse({
        type: 'datapoint',
        slug: 'bridge-state',
        value: {},
        timestamp_ms: 1,
      }).success,
    ).toBe(false)
  })
})
