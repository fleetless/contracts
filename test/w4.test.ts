import { describe, it, expect } from 'vitest'
import {
  robotConfigDoc,
  actionConfig,
  publisherConfig,
  parameterSpec,
  datapointConfig,
  job,
  jobEvent,
  busyDetails,
  clientInvoke,
  clientCancel,
  commandResult,
  errorFrame,
  cloudInvoke,
  bridgeJobUpdate,
  bridgeJobLost,
  exposureListResponse,
  ERROR_CODES,
} from '../src/index.js'

const UUID = '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f'
const UUID2 = '7c2f1b40-8e3a-4d51-9f6b-2a1c3d4e5f60'
const NOW = '2026-08-11T06:00:00.000Z'

const ACTION = {
  slug: 'drive-to',
  ros_name: '/drive_to',
  type: 'example/action/DriveTo',
  parameters: [{ name: 'speed', type: 'float32', rule: { min: 0, max: 1.5, required: true } }],
}

describe('W4 config: three new kinds', () => {
  it('carries actions, services and publishers beside datapoints', () => {
    expect(actionConfig.safeParse(ACTION).success).toBe(true)
    expect(parameterSpec.safeParse({ name: 'speed', type: 'float32', rule: {} }).success).toBe(true)
    expect(parameterSpec.safeParse({ name: 'Speed!', type: 'float32', rule: {} }).success).toBe(false)
  })

  it('keeps a W2 document valid — actions/services/publishers default to empty', () => {
    // Stored configurations are jsonb. A required field here would have
    // invalidated every published version of every live robot on first read.
    const w2 = {
      datapoints: [{
        slug: 'battery-percentage', topic: '/battery', type: 'sensor_msgs/msg/BatteryState',
        field: 'percentage', rate: { mode: 'max_hz', hz: 2 }, unit: '%', scale: 100, offset: null, range: null,
      }],
    }
    const parsed = robotConfigDoc.parse(w2)
    expect(parsed.actions).toEqual([])
    expect(parsed.services).toEqual([])
    expect(parsed.publishers).toEqual([])
    expect(parsed.datapoints[0].buffer).toEqual({ enabled: false, max_values: 0 })
  })

  it('gives a datapoint a buffer, because a disconnect otherwise means a gap', () => {
    const dp = { slug: 'buf-test', topic: '/b', type: 'p/msg/T', field: null, rate: { mode: 'on_change' },
      unit: null, scale: null, offset: null, range: null, buffer: { enabled: true, max_values: 500 } }
    expect(datapointConfig.safeParse(dp).success).toBe(true)
    expect(datapointConfig.safeParse({ ...dp, buffer: { enabled: true, max_values: 0 } }).success).toBe(false)
    // A schema whose own default fails its own validation is a trap: the
    // cloud parses a stored document, writes the result back, and the second
    // read refuses it. Caught by running the CLOUD's suite against this pin,
    // not by any test written here.
    const roundTripped = robotConfigDoc.parse({ datapoints: [{ ...dp, buffer: undefined }] })
    expect(robotConfigDoc.safeParse(roundTripped).success).toBe(true)
  })

  it('makes a publisher carry both timeouts — they are different promises', () => {
    const pub = {
      slug: 'drive', topic: '/cmd_vel', type: 'geometry_msgs/msg/Twist', parameters: [],
      timeout_ms: 300, failsafe: { linear: { x: 0 }, angular: { z: 0 } }, quiet_timeout_ms: 2000,
    }
    expect(publisherConfig.safeParse(pub).success).toBe(true)
    // A failsafe with no timeout would be a promise nothing keeps.
    expect(publisherConfig.safeParse({ ...pub, timeout_ms: 0 }).success).toBe(false)
    // Zero quiet timeout is legal: a publisher anyone may take over at once.
    expect(publisherConfig.safeParse({ ...pub, quiet_timeout_ms: 0 }).success).toBe(true)
  })
})

describe('W4 jobs', () => {
  const J = { id: UUID, robot_id: UUID2, slug: 'drive-to', state: 'running', started_at: NOW, updated_at: NOW, result: null, error: null }

  it('knows lost as a real outcome, not an absence of news', () => {
    for (const state of ['running', 'succeeded', 'failed', 'cancelled', 'lost']) {
      expect(job.safeParse({ ...J, state }).success).toBe(true)
    }
    expect(job.safeParse({ ...J, state: 'unknown' }).success).toBe(false)
  })

  it('stamps job updates with bridge capture time, like any datapoint', () => {
    expect(
      jobEvent.safeParse({
        type: 'job', robot_id: UUID2, slug: 'drive-to', job: J,
        feedback: { distance: 2.5 }, progress: 0.4, timestamp_ms: 1786400000000,
      }).success,
    ).toBe(true)
    expect(
      jobEvent.safeParse({ type: 'job', robot_id: UUID2, slug: 'drive-to', job: J, feedback: null, progress: 1.5, timestamp_ms: 1 }).success,
    ).toBe(false)
  })

  it('makes a busy refusal say what is running', () => {
    // "busy" alone forces the caller to guess whether to wait or give up.
    expect(busyDetails.safeParse({ running: J }).success).toBe(true)
  })
})

describe('W4 command parity', () => {
  it('correlates every command with its reply', () => {
    expect(clientInvoke.safeParse({ type: 'invoke', request_id: 'r1', robot_id: UUID2, slug: 'drive-to', params: { speed: 0.5 } }).success).toBe(true)
    expect(clientInvoke.safeParse({ type: 'invoke', robot_id: UUID2, slug: 'drive-to', params: {} }).success).toBe(false)
    expect(clientCancel.safeParse({ type: 'cancel', request_id: 'r2', robot_id: UUID2, slug: 'drive-to' }).success).toBe(true)
    expect(
      commandResult.safeParse({ type: 'command_result', request_id: 'r1', ok: false, job: null, code: 'busy', message: 'already running' }).success,
    ).toBe(true)
  })

  it('answers an unknown frame instead of closing the socket', () => {
    expect(errorFrame.safeParse({ type: 'error', code: 'unknown_command', message: 'this cloud does not know "invoke2"' }).success).toBe(true)
  })
})

describe('W4 bridge protocol', () => {
  it('has the cloud mint the job id before the bridge is asked', () => {
    // A job that exists only once the bridge answers cannot be reported lost.
    expect(cloudInvoke.safeParse({ type: 'invoke', job_id: UUID, slug: 'drive-to', params: { speed: 1 } }).success).toBe(true)
    expect(cloudInvoke.safeParse({ type: 'invoke', slug: 'drive-to', params: {} }).success).toBe(false)
  })

  it('lets a restarted bridge admit what it lost', () => {
    expect(bridgeJobLost.safeParse({ type: 'job_lost', job_ids: [UUID] }).success).toBe(true)
    expect(bridgeJobLost.safeParse({ type: 'job_lost', job_ids: [] }).success).toBe(true)
    expect(
      bridgeJobUpdate.safeParse({
        type: 'job_update', job_id: UUID, slug: 'drive-to', state: 'succeeded',
        feedback: null, progress: 1, result: { ok: true }, error: null, timestamp_ms: 1786400000000,
      }).success,
    ).toBe(true)
  })
})

describe('W4 exposures and errors', () => {
  it('names the kind of every grantable slug', () => {
    expect(
      exposureListResponse.safeParse({
        exposures: [
          { slug: 'bridge-state', kind: 'datapoint', builtin: true },
          { slug: 'drive-to', kind: 'action', builtin: false },
          { slug: 'drive', kind: 'publisher', builtin: false },
        ],
      }).success,
    ).toBe(true)
  })

  it('names the refusals the command path brings', () => {
    for (const code of ['busy', 'parameter_invalid', 'job_lost', 'publisher_busy', 'unknown_command']) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})
