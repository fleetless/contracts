// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  cameraConfig,
  cameraDescriptor,
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
  it('keeps a document written before cameras existed valid — the section is simply absent', () => {
    const withoutCameras = { fleetless: 1 as const }
    expect(robotConfigDoc.parse(withoutCameras).cameras).toBeUndefined()
  })

  it('puts bandwidth in the configuration, not in a viewer request', () => {
    // The developer owns bandwidth; a viewer can't ask for more, so it
    // lives in config, not a viewer request.
    expect(cameraConfig.safeParse(CAM).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, fps: 0 }).success).toBe(false)
    expect(cameraConfig.safeParse({ ...CAM, bitrate_kbps: 0 }).success).toBe(false)
  })

  it('refuses a snapshot interval that is really a video stream', () => {
    // Snapshot is the cheap mode; sub-second is live in disguise — whole
    // seconds only, so 1 is the floor.
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_seconds: 1 }).success).toBe(true)
    expect(cameraConfig.safeParse({ ...CAM, snapshot_interval_seconds: 0 }).success).toBe(false)
  })

  it('reads the snapshot interval back in the unit the document writes it in', () => {
    // The descriptor still said `snapshot_interval_ms` after the document
    // moved to seconds — the cloud converted this descriptor's unit but not
    // `datapointDescriptor` beside it, silently. Both now reuse the document's
    // own bound, which is where the range assertions come from: no second 1
    // or 3600 anywhere else.
    const DESC = { slug: 'front', width: 1280, height: 720, fps: 15, snapshot_interval_seconds: 5 }
    expect(cameraDescriptor.safeParse(DESC).success).toBe(true)
    expect(cameraDescriptor.safeParse({ ...DESC, snapshot_interval_seconds: 3600 }).success).toBe(true)
    expect(cameraDescriptor.safeParse({ ...DESC, snapshot_interval_seconds: 3601 }).success).toBe(false)
    expect(cameraDescriptor.safeParse({ ...DESC, snapshot_interval_seconds: 0 }).success).toBe(false)
    const { snapshot_interval_seconds, ...noInterval } = DESC
    expect(cameraDescriptor.safeParse({ ...noInterval, snapshot_interval_ms: 5000 }).success).toBe(false)
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
    // `{publishing: false, error: null}` once meant camera_stop's answer, a
    // config-change stop, or a recovered source — indistinguishable except by
    // the cloud remembering what it saw before. A config-change stop is not a
    // failure and must not be logged as one.
    const of = (cause: string) => bridgeCameraState.safeParse(
      { type: 'camera_state', slug: 'front', publishing: false, error: null, cause,
        observed_at_ms: 1786522606705, request_id: cause === 'command' ? 'cs-1' : null })
    for (const c of ['command', 'source', 'config_change', 'live_lost']) {
      expect(of(c).success).toBe(true)
    }
    // Absent isn't valid: it would default to whatever the reader assumes,
    // and every sender already knows its reason.
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
