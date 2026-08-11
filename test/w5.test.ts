import { describe, it, expect } from 'vitest'
import {
  cameraConfig,
  robotConfigDoc,
  snapshotHeader,
  cloudCameraStart,
  bridgeCameraState,
  liveSessionResponse,
  snapshotMetaResponse,
  clientSubscribe,
  exposureListResponse,
  ERROR_CODES,
} from '../src/index.js'

const CAM = {
  slug: 'front', topic: '/image_raw', type: 'sensor_msgs/msg/Image',
  width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_ms: 5000,
}

describe('W5 cameras', () => {
  it('keeps every pre-W5 document valid — cameras default to empty', () => {
    const w4 = { datapoints: [], actions: [], services: [], publishers: [] }
    expect(robotConfigDoc.parse(w4).cameras).toEqual([])
  })

  it('puts bandwidth in the configuration, not in a viewer request', () => {
    // §10: the developer governs the robot's bandwidth. A viewer never gets
    // to make a robot send more, so these live in the config document.
    expect(cameraConfig.safeParse(CAM).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, fps: 0 }).success).toBe(false)
    expect(cameraConfig.safeParse({ ...CAM, bitrate_kbps: 0 }).success).toBe(false)
  })

  it('refuses a snapshot interval that is really a video stream', () => {
    // Snapshot is the cheap mode by design; sub-second is live in disguise.
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_ms: 1000 }).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_ms: 200 }).success).toBe(false)
  })

  it('carries capture time on a snapshot, so its age can always be stated', () => {
    expect(snapshotHeader.safeParse({
      type: 'snapshot', slug: 'front', mime: 'image/jpeg',
      width: 1280, height: 720, timestamp_ms: 1786440000000,
    }).success).toBe(true)
    // A picture that cannot say when it was taken is this wave's version of
    // a job that reads "running" when nobody knows.
    expect(snapshotHeader.safeParse({ type: 'snapshot', slug: 'front', mime: 'image/jpeg', width: 1, height: 1 }).success).toBe(false)
  })

  it('lets a snapshot read say "nothing yet" without calling it an error', () => {
    expect(snapshotMetaResponse.safeParse({
      slug: 'front', timestamp_ms: null, age_ms: null, width: null, height: null, mime: null,
    }).success).toBe(true)
  })

  it('has the cloud mint the room and the publisher token', () => {
    // The side that owns the refcount owns the stream's identity — otherwise
    // a robot can end up publishing into a room nobody is watching.
    expect(cloudCameraStart.safeParse({
      type: 'camera_start', slug: 'front', url: 'ws://localhost:7880', room: 'r-1', token: 't',
    }).success).toBe(true)
    expect(cloudCameraStart.safeParse({ type: 'camera_start', slug: 'front', url: 'x', room: 'r' }).success).toBe(false)
  })

  it('makes a camera that cannot start say so', () => {
    expect(bridgeCameraState.safeParse({
      type: 'camera_state', slug: 'front', publishing: false,
      error: { code: 'camera_offline', message: 'no frames on /image_raw' },
    }).success).toBe(true)
  })

  it('bounds a live hold in time, because a client can die without releasing', () => {
    expect(liveSessionResponse.safeParse({
      url: 'ws://localhost:7880', room: 'r-1', token: 't', expires_at: '2026-08-11T12:00:00.000Z',
    }).success).toBe(true)
  })

  it('lets a subscriber say what it expects, so silence stops being the answer', () => {
    expect(clientSubscribe.safeParse({ type: 'subscribe', robot_id: '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f', slug: 'front', kind: 'camera' }).success).toBe(true)
    // Still optional — an older client keeps today's behaviour.
    expect(clientSubscribe.safeParse({ type: 'subscribe', robot_id: '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f', slug: 'front' }).success).toBe(true)
  })

  it('grants a camera the same way it grants anything else', () => {
    expect(exposureListResponse.safeParse({ exposures: [{ slug: 'front', kind: 'camera', builtin: false }] }).success).toBe(true)
  })

  it('names the refusals cameras bring', () => {
    for (const c of ['camera_offline', 'no_snapshot_yet', 'live_unavailable', 'wrong_kind']) {
      expect(ERROR_CODES).toContain(c)
    }
  })
})
