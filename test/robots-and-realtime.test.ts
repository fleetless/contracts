// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  cloudPing,
  bridgePong,
  robot,
  robotToken,
  createRobotRequest,
  createRobotResponse,
  robotTokenRotateResponse,
  jointStatePutRequest,
  jointStatePutResponse,
  robotListItem,
  robotDetailResponse,
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
  it('ping and pong carry the cloud clock, and the ping what the cloud measured', () => {
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1754800000000, latency_ms: 30, lag_ms: 0 }).success).toBe(true)
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
      robotListItem.safeParse({
        ...ROBOT,
        bridge_state: { online: false, latency_ms: null, low_bandwidth: false },
        exposes: { datapoints: 0, actions: 0, services: 0, publishers: 0, cameras: 0 },
        protocol_status: 'current',
      }).success,
    ).toBe(true)
    expect(robotListItem.safeParse(ROBOT).success).toBe(false)
  })

  it('a listed robot carries protocol_status and the detail carries version and window', () => {
    const item = {
      id: '3f2b6f0e-9b0c-4d1e-8a2f-1c2d3e4f5a6b',
      name: 'edge-bot',
      created_at: '2026-09-21T00:00:00.000Z',
      bridge_state: { online: true, latency_ms: 12, low_bandwidth: false },
      exposes: { datapoints: 0, actions: 0, services: 0, publishers: 0, cameras: 0 },
      protocol_status: 'deprecated',
    }
    expect(robotListItem.safeParse(item).success).toBe(true)
    expect(robotListItem.safeParse({ ...item, protocol_status: 'old' }).success).toBe(false)
    const { protocol_status: _omit, ...withoutStatus } = item
    expect(robotListItem.safeParse(withoutStatus).success).toBe(true)
    expect(
      robotDetailResponse.safeParse({
        ...item,
        bridge_version: '3.0.0',
        last_hello_error: null,
        config: { published_version: null, published_at: null, draft_updated_at: null, applied_version: null, applied_ok: null, applied_errors: null },
        protocol_version: 2,
        protocol: { status: 'deprecated', sunset_at: '2026-12-20' },
      }).success,
    ).toBe(true)
  })

  it('datapoint reads always carry slug, value, timestamp_ms', () => {
    expect(
      datapointValue.safeParse({
        slug: 'bridge_state',
        value: { online: true, latency_ms: 12, low_bandwidth: false },
        timestamp_ms: 1754800000000,
      }).success,
    ).toBe(true)
    expect(
      datapointValue.safeParse({ slug: 'bridge_state', value: {} }).success,
    ).toBe(false)
  })
})

describe('realtime client protocol', () => {
  it('subscribe addresses a robot + slug', () => {
    expect(
      clientSubscribe.safeParse({ type: 'subscribe', robot_id: ROBOT.id, slug: 'bridge_state' })
        .success,
    ).toBe(true)
    expect(
      clientSubscribe.safeParse({ type: 'subscribe', robot_id: 'nope', slug: 'bridge_state' })
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
        slug: 'bridge_state',
        value: { online: true, latency_ms: 8, low_bandwidth: true },
        timestamp_ms: 1754800000000,
      }).success,
    ).toBe(true)
    expect(
      datapointEvent.safeParse({
        type: 'datapoint',
        slug: 'bridge_state',
        value: {},
        timestamp_ms: 1,
      }).success,
    ).toBe(false)
  })
})


describe('the two robot-detail routes', () => {
  const TOKEN = 'frt_' + 'a'.repeat(32)

  it('rotate hands back one token, in the shape the bridge already takes', () => {
    // The same regex `createRobotResponse` uses: a rotated token that parsed
    // by a looser rule would reach the bridge and fail at hello instead.
    expect(robotTokenRotateResponse.safeParse({ token: TOKEN }).success).toBe(true)
    expect(robotTokenRotateResponse.safeParse({ token: 'nope' }).success).toBe(false)
    expect(robotTokenRotateResponse.safeParse({}).success).toBe(false)
  })

  it('the joint-state mapping is set and cleared through one required field', () => {
    // `null` clears it, so the field cannot be optional: an absent `slug` and
    // a cleared one would be the same request and mean different things.
    expect(jointStatePutRequest.safeParse({ slug: null }).success).toBe(true)
    expect(jointStatePutRequest.safeParse({ slug: 'joints' }).success).toBe(true)
    expect(jointStatePutRequest.safeParse({}).success).toBe(false)
    expect(jointStatePutRequest.safeParse({ slug: 'Not A Slug' }).success).toBe(false)
    expect(jointStatePutResponse.safeParse({ joint_state_slug: null }).success).toBe(true)
    expect(jointStatePutResponse.safeParse({ joint_state_slug: 'joints' }).success).toBe(true)
    expect(jointStatePutResponse.safeParse({}).success).toBe(false)
  })
})
