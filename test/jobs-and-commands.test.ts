import { describe, it, expect } from 'vitest'
import {
  robotConfigDoc,
  actionConfig,
  publisherConfig,
  parameterSpec,
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
  publisherBusyDetails,
  ERROR_CODES,
} from '../src/index.js'

const UUID = '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f'
const UUID2 = '7c2f1b40-8e3a-4d51-9f6b-2a1c3d4e5f60'
const NOW = '2026-08-11T06:00:00.000Z'

const ACTION = {
  ros_name: '/drive_to',
  type: 'example/action/DriveTo',
  parameters: { speed: { type: 'float32', min_value: 0, max_value: 1.5 } },
}

describe('config: three new kinds', () => {
  it('carries actions, services and publishers beside datapoints', () => {
    expect(actionConfig.safeParse(ACTION).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float32', min_value: 0, max_value: 1.5 }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float32' }).success).toBe(true)
  })

  it('keeps a datapoints-only document valid — absent sections stay absent, not defaulted', () => {
    // An absent section is `undefined`, never a default. `capped().optional()`
    // means "not configured", and there is no live deployment to migrate.
    const w2 = {
      fleetless: 1 as const,
      datapoints: {
        battery_percentage: {
          topic: '/battery', type: 'sensor_msgs/msg/BatteryState',
          field: 'percentage', rate_throttle_hz: 2, numeric: { scale: 100, unit: '%' },
        },
      },
    }
    const parsed = robotConfigDoc.parse(w2)
    expect(parsed.actions).toBeUndefined()
    expect(parsed.services).toBeUndefined()
    expect(parsed.publishers).toBeUndefined()
  })

  it('makes a publisher carry both timeouts — they are different promises', () => {
    const pub = {
      topic: '/cmd_vel', type: 'geometry_msgs/msg/Twist',
      message: { linear: { x: 0 }, angular: { z: 0 } },
      failsafe: { timeout_ms: 300, message: { linear: { x: 0 }, angular: { z: 0 } } },
      quiet_timeout_ms: 2000,
    }
    expect(publisherConfig.safeParse(pub).success).toBe(true)
    // A failsafe with no timeout would be a promise nothing keeps.
    expect(
      publisherConfig.safeParse({ ...pub, failsafe: { ...pub.failsafe, timeout_ms: 0 } }).success,
    ).toBe(false)
    // Zero quiet timeout is legal: a publisher anyone may take over at once.
    expect(publisherConfig.safeParse({ ...pub, quiet_timeout_ms: 0 }).success).toBe(true)
  })
})

describe('jobs', () => {
  const J = { id: UUID, robot_id: UUID2, slug: 'drive_to', state: 'running', started_at: NOW, updated_at: NOW,
    seq: 1, result: null, error: null }

  it('knows lost as a real outcome, not an absence of news', () => {
    for (const state of ['running', 'succeeded', 'failed', 'cancelled', 'lost']) {
      expect(job.safeParse({ ...J, state }).success).toBe(true)
    }
    expect(job.safeParse({ ...J, state: 'unknown' }).success).toBe(false)
  })

  it('stamps job updates with bridge capture time, like any datapoint', () => {
    expect(
      jobEvent.safeParse({
        type: 'job', robot_id: UUID2, slug: 'drive_to', job: J,
        feedback: { distance: 2.5 }, progress: 0.4, timestamp_ms: 1786400000000,
      }).success,
    ).toBe(true)
    expect(
      jobEvent.safeParse({ type: 'job', robot_id: UUID2, slug: 'drive_to', job: J, feedback: null, progress: 1.5, timestamp_ms: 1 }).success,
    ).toBe(false)
  })

  it('makes a busy refusal say what is running', () => {
    // "busy" alone forces the caller to guess whether to wait or give up.
    expect(busyDetails.safeParse({ running: J }).success).toBe(true)
  })
})

describe('command parity', () => {
  it('correlates every command with its reply', () => {
    expect(clientInvoke.safeParse({ type: 'invoke', request_id: 'r1', robot_id: UUID2, slug: 'drive_to', params: { speed: 0.5 } }).success).toBe(true)
    expect(clientInvoke.safeParse({ type: 'invoke', robot_id: UUID2, slug: 'drive_to', params: {} }).success).toBe(false)
    expect(clientCancel.safeParse({ type: 'cancel', request_id: 'r2', robot_id: UUID2, slug: 'drive_to', job_id: null }).success).toBe(true)
    expect(
      commandResult.safeParse({ type: 'command_result', request_id: 'r1', ok: false, job: null, kind: 'action', code: 'busy', message: 'already running' }).success,
    ).toBe(true)
  })

  it('lets a realtime refusal carry the same details REST does', () => {
    // Without this the socket broke the parity promise: the same
    // parameter_invalid was actionable over HTTP and opaque over the socket,
    // because there was nowhere on the frame to put the violations.
    const r = {
      type: 'command_result', request_id: 'r9', ok: false, job: null, kind: 'action',
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

describe('bridge protocol', () => {
  it('has the cloud mint the job id before the bridge is asked', () => {
    // A job that exists only once the bridge answers cannot be reported lost.
    expect(cloudInvoke.safeParse({ type: 'invoke', job_id: UUID, slug: 'drive_to', params: { speed: 1 }, patience_ms: 15_000 }).success).toBe(true)
    expect(cloudInvoke.safeParse({ type: 'invoke', slug: 'drive_to', params: {}, patience_ms: 15_000 }).success).toBe(false)
  })

  it('tells a reconnect from a restart, which look identical otherwise', () => {
    // Same token, same version, same frame — the only thing that differs is
    // what the bridge still has. So it says so, and the cloud reconciles:
    // a running job not named here is lost.
    //
    // The entries were widened from bare uuids to `{job_id, slug, state}` and
    // the field renamed with them. The old name is gone rather than kept as
    // an alias — see `bridgeHello.active_jobs`.
    const hello = { type: 'hello', protocol_version: 1, token: 'frt_x', bridge_version: '0.4.0' }
    const entry = { job_id: UUID, slug: 'drive_to', state: 'running' }
    const live = bridgeHello.parse({ ...hello, active_jobs: [entry] })
    expect(live.active_jobs).toEqual([entry])

    // A bridge that just restarted has no jobs to name — and that empty list
    // is precisely the fact the cloud needs, not a missing field.
    expect(bridgeHello.parse({ ...hello, active_jobs: [] }).active_jobs).toEqual([])

    // A bridge older than jobs omits it entirely; it had no jobs, so empty is correct
    // for it too, and the default direction is the safe one (lost, not
    // "still running because nobody said otherwise").
    expect(bridgeHello.parse(hello).active_jobs).toEqual([])
  })

  it('lets a connected bridge admit a job it lost mid-session', () => {
    expect(bridgeJobLost.safeParse({ type: 'job_lost', job_ids: [UUID] }).success).toBe(true)
    expect(bridgeJobLost.safeParse({ type: 'job_lost', job_ids: [] }).success).toBe(true)
    expect(
      bridgeJobUpdate.safeParse({
        type: 'job_update', job_id: UUID, slug: 'drive_to', state: 'succeeded',
        feedback: null, progress: 1, result: { ok: true }, error: null, timestamp_ms: 1786400000000,
      }).success,
    ).toBe(true)
  })
})

describe('type trees', () => {
  const F = { name: 'x', type: 'float64', array: false, fields: null }

  it('resolves services and actions, not only messages', () => {
    // A parameterSpec has to resolve against something, and an action has no
    // flat field list — it has three trees.
    expect(typeDefinition.safeParse({ name: 'p/msg/T', kind: 'msg', fields: [F] }).success).toBe(true)
    expect(typeDefinition.safeParse({ name: 'p/srv/T', kind: 'srv', request: [F], response: [] }).success).toBe(true)
    expect(
      typeDefinition.safeParse({ name: 'p/action/T', kind: 'action', goal: [F], result: [], feedback: [] }).success,
    ).toBe(true)
    // The stored `msg` shape is unchanged, so nothing needs migrating.
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

describe('exposures and errors', () => {
  it('names the kind of every grantable slug', () => {
    expect(
      exposureListResponse.safeParse({
        exposures: [
          { slug: 'bridge_state', kind: 'datapoint', builtin: true },
          { slug: 'drive_to', kind: 'action', builtin: false },
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

describe('parameter refusals', () => {
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

describe('review fixes', () => {
  it('tells a client which kind it just commanded', () => {
    // Invoke and call share a route; only a *client* distinguishes them. With
    // no kind coming back, a service helper aimed at an action slug starts the
    // real action and then blames the robot for not finishing.
    const base = { type: 'command_result', request_id: 'k', ok: true, job: null, code: null, message: null }
    expect(commandResult.safeParse({ ...base, kind: 'service' }).success).toBe(true)
    // Null when the slug never resolved — a forbidden refusal names no kind.
    expect(commandResult.safeParse({ ...base, kind: null }).success).toBe(true)
    expect(commandResult.safeParse(base).success).toBe(false)
  })

  it('makes publisher_busy say how much longer, not just that it is busy', () => {
    // "has not been quiet long enough" names a state and no action: the caller
    // cannot read quiet_timeout_ms, so without a number they busy-loop — on
    // the one verb that moves a machine.
    expect(publisherBusyDetails.safeParse({ quiet_timeout_ms: 3000, retry_after_ms: 1200 }).success).toBe(true)
    expect(publisherBusyDetails.safeParse({ quiet_timeout_ms: 3000 }).success).toBe(false)
  })
})
