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
  bridgeHello,
  bridgeJobUpdate,
  bridgeJobLost,
  typeDefinition,
  parameterFieldsOf,
  exposureListResponse,
  parameterViolation,
  parameterInvalidDetails,
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

  it('lets a realtime refusal carry the same details REST does', () => {
    // Without this the socket broke §11.1's parity promise: the same
    // parameter_invalid was actionable over HTTP and opaque over the socket,
    // because there was nowhere on the frame to put the violations.
    const r = {
      type: 'command_result', request_id: 'r9', ok: false, job: null,
      code: 'parameter_invalid', message: '1 parameter invalid',
      details: { violations: [{ field: 'order', rule: 'max', message: 'too big' }] },
    }
    const parsed = commandResult.parse(r)
    expect(parameterInvalidDetails.safeParse(parsed.details).success).toBe(true)
    // Still optional — most refusals carry none.
    expect(commandResult.safeParse({ ...r, details: undefined }).success).toBe(true)
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

  it('tells a reconnect from a restart, which look identical otherwise', () => {
    // Same token, same version, same frame — the only thing that differs is
    // what the bridge still has. So it says so, and the cloud reconciles:
    // a running job not named here is lost.
    const hello = { type: 'hello', protocol_version: 1, token: 'frt_x', bridge_version: '0.4.0' }
    const live = bridgeHello.parse({ ...hello, active_job_ids: [UUID] })
    expect(live.active_job_ids).toEqual([UUID])

    // A bridge that just restarted has no jobs to name — and that empty list
    // is precisely the fact the cloud needs, not a missing field.
    expect(bridgeHello.parse({ ...hello, active_job_ids: [] }).active_job_ids).toEqual([])

    // A pre-W4 bridge omits it entirely; it had no jobs, so empty is correct
    // for it too, and the default direction is the safe one (lost, not
    // "still running because nobody said otherwise").
    expect(bridgeHello.parse(hello).active_job_ids).toEqual([])
  })

  it('lets a connected bridge admit a job it lost mid-session', () => {
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

describe('W4 type trees', () => {
  const F = { name: 'x', type: 'float64', array: false, fields: null }

  it('resolves services and actions, not only messages', () => {
    // A parameterSpec has to resolve against something, and an action has no
    // flat field list — it has three trees.
    expect(typeDefinition.safeParse({ name: 'p/msg/T', kind: 'msg', fields: [F] }).success).toBe(true)
    expect(typeDefinition.safeParse({ name: 'p/srv/T', kind: 'srv', request: [F], response: [] }).success).toBe(true)
    expect(
      typeDefinition.safeParse({ name: 'p/action/T', kind: 'action', goal: [F], result: [], feedback: [] }).success,
    ).toBe(true)
    // W2's stored `msg` shape is unchanged, so nothing needs migrating.
    expect(typeDefinition.safeParse({ name: 'p/msg/T', kind: 'msg' }).success).toBe(false)
  })

  it('points a parameter at the one tree it may name', () => {
    // goal, request, fields — never result/feedback/response: nobody passes
    // a result in. One helper, so three repos cannot pick three fields.
    expect(parameterFieldsOf({ name: 'p/action/T', kind: 'action', goal: [F], result: [], feedback: [] })).toEqual([F])
    expect(parameterFieldsOf({ name: 'p/srv/T', kind: 'srv', request: [F], response: [] })).toEqual([F])
    expect(parameterFieldsOf({ name: 'p/msg/T', kind: 'msg', fields: [F] })).toEqual([F])
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

describe('W4 parameter refusals', () => {
  it('pins the shape of a parameter_invalid, so nobody has to sniff for it', () => {
    // Left as `unknown` on the envelope, three consumers each guessed a
    // different shape and each was right in its own tests.
    const details = {
      violations: [
        { field: 'order', rule: 'required', message: 'order is required' },
        { field: 'speed', rule: 'max', message: 'speed must be at most 1.5' },
      ],
    }
    expect(parameterInvalidDetails.safeParse(details).success).toBe(true)
    // A refusal naming no violation leaves the caller nothing to fix.
    expect(parameterInvalidDetails.safeParse({ violations: [] }).success).toBe(false)
    // `field` is the flat key as sent — the same string as the spec it broke.
    expect(parameterViolation.safeParse({ field: 'target_pose.position.x', rule: 'min', message: 'too small' }).success).toBe(true)
  })
})
