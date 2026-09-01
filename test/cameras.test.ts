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
  source: { kind: 'ros', topic: '/image_raw', type: 'sensor_msgs/msg/Image' },
  width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5,
}

describe('cameras', () => {
  it('keeps a document written before cameras existed valid — they default to empty', () => {
    const withoutCameras = { datapoints: [], actions: [], services: [], publishers: [] }
    expect(robotConfigDoc.parse(withoutCameras).cameras).toEqual([])
  })

  it('puts bandwidth in the configuration, not in a viewer request', () => {
    // The developer governs the robot's bandwidth. A viewer never gets
    // to make a robot send more, so these live in the config document.
    expect(cameraConfig.safeParse(CAM).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, fps: 0 }).success).toBe(false)
    expect(cameraConfig.safeParse({ ...CAM, bitrate_kbps: 0 }).success).toBe(false)
  })

  it('refuses a snapshot interval that is really a video stream', () => {
    // Snapshot is the cheap mode by design; sub-second is live in disguise —
    // and the unit is whole seconds, so there is nothing smaller than the floor.
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_seconds: 1 }).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_seconds: 0 }).success).toBe(false)
  })

  it('carries capture time on a snapshot, so its age can always be stated', () => {
    expect(snapshotHeader.safeParse({
      type: 'snapshot', slug: 'front', mime: 'image/jpeg',
      width: 1280, height: 720, timestamp_ms: 1786440000000,
    }).success).toBe(true)
    // A picture that cannot say when it was taken is the same defect as a
    // job that reads "running" when nobody knows.
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
      request_id: 'cs-1',
    }).success).toBe(true)
    expect(cloudCameraStart.safeParse({ type: 'camera_start', slug: 'front', url: 'x', room: 'r' }).success).toBe(false)
  })

  it('makes a camera that cannot start say so', () => {
    expect(bridgeCameraState.safeParse({
      type: 'camera_state', slug: 'front', publishing: false, cause: 'command',
      observed_at_ms: 1786522606705, request_id: 'cs-1',
      error: { code: 'camera_offline', message: 'no frames on /image_raw' },
    }).success).toBe(true)
  })

  it('says WHY it is not publishing, because three different things looked identical', () => {
    // `{publishing: false, error: null}` was once sent for an answer to
    // camera_stop, for a stream a config change stopped, and for a source
    // that recovered — and the cloud could only tell them apart by
    // remembering what it saw before. A config-change stop is not a failure
    // and must not be logged as one.
    const of = (cause: string) => bridgeCameraState.safeParse(
      { type: 'camera_state', slug: 'front', publishing: false, error: null, cause,
        observed_at_ms: 1786522606705, request_id: cause === 'command' ? 'cs-1' : null })
    for (const c of ['command', 'source', 'config_change', 'live_lost']) {
      expect(of(c).success).toBe(true)
    }
    // Absent is not a valid reading: it would default to whichever meaning
    // the reader happens to assume, and every sender knows its own reason.
    expect(bridgeCameraState.safeParse(
      { type: 'camera_state', slug: 'front', publishing: false, error: null, observed_at_ms: 1786522606705, request_id: null }).success).toBe(false)
  })

  it('bounds a live hold in time, because a client can die without releasing', () => {
    expect(liveSessionResponse.safeParse({
      session_id: '9c3f0f6a-6a1e-4f0f-9d2b-2f6a1e4f0f9d',
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
