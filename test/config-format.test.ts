import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { slug, RESERVED_SLUGS, parameterSpec, parameterType, messageBody, messageRef, PLACEHOLDER_RE, placeholderNames, messageMap } from '../src/index.js'

/**
 * The spec code each refusal carries in `params`, in issue order.
 *
 * Reading the code rather than the message is the whole point of `params`:
 * the cloud maps an issue to one of the thirteen codes and its repair by
 * this field, so a test that asserted the prose instead would pass while the
 * join the cloud actually uses was broken.
 */
const codesOf = (r: { success: false; error: z.ZodError }) =>
  r.error.issues.map((i) => (i as { params?: { code?: string } }).params?.code)

describe('name grammar', () => {
  it('accepts lowercase words joined by single underscores', () => {
    for (const ok of ['battery_soc', 'dock', 'linear_speed', 'stop_twist', 'cam1']) {
      expect(slug.safeParse(ok).success, ok).toBe(true)
    }
  })

  it('refuses dashes, capitals, doubled and edge underscores, and a leading digit', () => {
    for (const bad of ['battery-soc', 'Battery', 'battery__soc', '_soc', 'dock_', '1st_cam', 'a']) {
      expect(slug.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('reserves the three built-in slugs, spelled with underscores, and `history`', () => {
    expect(RESERVED_SLUGS).toEqual(['bridge_state', 'robot_details', 'bridge_pressure', 'history'])
  })
})

describe('parameter', () => {
  it('requires a type from the closed ROS 2 list', () => {
    expect(parameterType.safeParse('float64').success).toBe(true)
    expect(parameterType.safeParse('double').success).toBe(false)
    expect(parameterSpec.safeParse({ min_value: 0 }).success).toBe(false)
  })

  it('allows min_value and max_value on numbers, and refuses regex there', () => {
    expect(parameterSpec.safeParse({ type: 'float64', min_value: -0.5, max_value: 0.5 }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float64', regex: '^a' }).success).toBe(false)
  })

  it('refuses an enum on a float, because equality on floating point is unreliable', () => {
    expect(parameterSpec.safeParse({ type: 'int32', enum: [1, 2] }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float64', enum: [1.5] }).success).toBe(false)
  })

  it('allows enum and regex on strings, and refuses min_value there', () => {
    expect(parameterSpec.safeParse({ type: 'string', enum: ['idle'], regex: '^i' }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'string', min_value: 1 }).success).toBe(false)
  })

  it('gives bool no constraints at all', () => {
    expect(parameterSpec.safeParse({ type: 'bool' }).success).toBe(true)
    // **`enum: [true]` cannot reach the guard.** `enum`'s element type is
    // `string | number`, so a boolean entry fails at `invalid_union` on
    // `enum[0]` and the `superRefine` never runs — the version of this test
    // that used it stayed green with the guard deleted. `['a']` is a
    // well-typed entry and gets that far.
    //
    // `.success` alone still would not be enough: with the guard gone the
    // per-entry type check refuses the same document at `enum.0`. The path
    // and the code are what pin *this* rule, and they are what goes red when
    // the guard is deleted (measured). The float case above is the one only
    // this guard can refuse.
    const r = parameterSpec.safeParse({ type: 'bool', enum: ['a'] })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.map((i) => i.path.join('.'))).toEqual(['enum'])
    expect(!r.success && codesOf(r)).toEqual(['constraint_not_allowed_for_type'])
  })

  it('refuses a default that does not match the declared type', () => {
    expect(parameterSpec.safeParse({ type: 'int32', default: 3 }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'int32', default: 'nope' }).success).toBe(false)
    // 1.5 is not an int32; 1.0 is indistinguishable from 1 in both JSON and
    // YAML, so the check cannot and does not claim to catch that one.
    expect(parameterSpec.safeParse({ type: 'int32', default: 1.5 }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'float64', default: 1.5 }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'string', default: true }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'bool', default: 1 }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'bool', default: false }).success).toBe(true)
  })

  it('refuses an enum entry that does not match the declared type', () => {
    const r = parameterSpec.safeParse({ type: 'int32', enum: ['a'] })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0]!.path).toEqual(['enum', 0])
    expect(parameterSpec.safeParse({ type: 'int32', enum: [1, 2.5] }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'string', enum: ['idle', 3] }).success).toBe(false)
  })

  it('reports a float enum as one mistake, not two', () => {
    // `enum` is not allowed on a float at all, so the per-entry type check is
    // not also run: a document that trips this code must trip exactly it.
    const r = parameterSpec.safeParse({ type: 'float64', enum: ['a'] })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.map((i) => i.path.join('.'))).toEqual(['enum'])
  })

  it('has no `required` field — absence of `default` is what makes it required', () => {
    const parsed = parameterSpec.parse({ type: 'float64' })
    expect('required' in parsed).toBe(false)
    expect(parsed.default).toBeUndefined()
  })

  it('refuses reversed bounds', () => {
    expect(parameterSpec.safeParse({ type: 'int32', min_value: 5, max_value: 1 }).success).toBe(false)
  })
})

describe('message template', () => {
  it('accepts an arbitrary tree of literals', () => {
    expect(messageBody.safeParse({ linear: { x: 0.0, y: 0.0 }, frame_id: 'map' }).success).toBe(true)
  })

  it('accepts a reference to a shared message, and only in the exact ${name} form', () => {
    expect(messageRef.safeParse('${stop_twist}').success).toBe(true)
    expect(messageRef.safeParse('stop_twist').success).toBe(false)
    expect(messageRef.safeParse('${Stop-Twist}').success).toBe(false)
  })

  it('finds every placeholder in a tree, at any depth', () => {
    const tree = { linear: { x: '${linear_speed}', y: 0.0 }, angular: { z: '${angular_speed}' } }
    expect([...placeholderNames(tree)].sort()).toEqual(['angular_speed', 'linear_speed'])
  })

  it('finds placeholders in arrays, including arrays nested in objects', () => {
    // Array at top level with placeholder
    const treeWithTopArray = ['${speed_1}', 0.0, '${speed_2}']
    expect([...placeholderNames(treeWithTopArray)].sort()).toEqual(['speed_1', 'speed_2'])

    // Arrays nested inside objects
    const treeWithNestedArray = {
      speeds: ['${speed_x}', '${speed_y}', 0.0],
      nested: { array: ['${speed_z}'] }
    }
    expect([...placeholderNames(treeWithNestedArray)].sort()).toEqual(['speed_x', 'speed_y', 'speed_z'])
  })

  /**
   * `safeParse`'s contract is to return, not to throw. The recursive version
   * of `placeholderNames` broke it: 20 000 levels raised
   * `RangeError: Maximum call stack size exceeded` and `publisherConfig`
   * propagated it, so wave 1b's draft PUT would answer 500 where it meant
   * 400. A flow-style YAML one-liner reaches that depth in ~120 KB.
   */
  it('walks a body far deeper than a call stack goes, without throwing', () => {
    const deep = (levels: number) => {
      let node: unknown = '${deep_speed}'
      for (let i = 0; i < levels; i++) node = { nested: node }
      return node
    }
    expect([...placeholderNames(deep(20_000))]).toEqual(['deep_speed'])
    const r = publisherConfig.safeParse({
      topic: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      message: deep(20_000),
      failsafe: { timeout_ms: 500, message: deep(20_000) },
      quiet_timeout_ms: 2000,
    })
    // It returns rather than throws, and it still sees the placeholder it
    // had to walk 20 000 levels to find: the failsafe body carries one.
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.map((i) => (i as { params?: { code?: string } }).params?.code)).toEqual([
      'failsafe_has_parameters',
    ])
  })

  it('terminates on a cyclic body, which YAML anchors can express', () => {
    // `&a { b: *a }` resolves to an object holding itself. Trading recursion
    // for an explicit stack turns an overflow into a hang unless the walk
    // remembers where it has been, and a hang is the worse of the two.
    const cyclic: Record<string, unknown> = { speed: '${linear_speed}' }
    cyclic.self = cyclic
    cyclic.list = [cyclic, { deeper: cyclic }]
    expect([...placeholderNames(cyclic)]).toEqual(['linear_speed'])
  })

  it('treats a bare word as a literal, never as a placeholder', () => {
    expect([...placeholderNames({ mode: 'linear_speed' })]).toEqual([])
    expect(PLACEHOLDER_RE.test('linear_speed')).toBe(false)
  })

  it('only matches anchored placeholders; embedded placeholders in longer text are literals', () => {
    // messageRef must reject embedded placeholders
    expect(messageRef.safeParse('prefix ${speed} suffix').success).toBe(false)
    expect(messageRef.safeParse('${speed} suffix').success).toBe(false)
    expect(messageRef.safeParse('prefix ${speed}').success).toBe(false)

    // placeholderNames must not extract embedded placeholders
    expect([...placeholderNames('prefix ${speed} suffix')]).toEqual([])
    expect([...placeholderNames({ text: 'before ${speed} after' })]).toEqual([])
  })

  it('(break test: messageRef regex guard) refuses strings that do not match the placeholder pattern', () => {
    // Test that the regex guard actually rejects invalid placeholder references
    expect(messageRef.safeParse('${invalid-name}').success).toBe(false)
    expect(messageRef.safeParse('${123}').success).toBe(false)
    expect(messageRef.safeParse('${_underscore}').success).toBe(false)
    expect(messageRef.safeParse('${}').success).toBe(false)
  })

  it('(break test: messageMap 200-message limit) refuses more than 200 shared messages', () => {
    // Create a message map with 201 entries to test the limit guard
    const tooMany: Record<string, unknown> = {}
    for (let i = 0; i < 201; i++) {
      tooMany[`msg_${i}`] = { value: i }
    }
    expect(messageMap.safeParse(tooMany).success).toBe(false)

    // Create a map with exactly 200 entries to verify the boundary
    const maxOk: Record<string, unknown> = {}
    for (let i = 0; i < 200; i++) {
      maxOk[`msg_${i}`] = { value: i }
    }
    expect(messageMap.safeParse(maxOk).success).toBe(true)
  })
})

import { datapointConfig, alertCondition } from '../src/index.js'

const base = { topic: '/battery', type: 'sensor_msgs/msg/BatteryState' }

describe('datapoint', () => {
  it('caps the throttle at 20 Hz and treats absence as no throttling', () => {
    expect(datapointConfig.safeParse({ ...base, field: 'percentage', rate_throttle_hz: 20 }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...base, field: 'percentage', rate_throttle_hz: 21 }).success).toBe(false)
    expect(datapointConfig.parse({ ...base }).rate_throttle_hz).toBeUndefined()
  })

  it('accepts 0 — zero and omitted both mean no throttling, not a refused value', () => {
    expect(datapointConfig.safeParse({ ...base, field: 'percentage', rate_throttle_hz: 0 }).success).toBe(true)
    const zero = datapointConfig.parse({ ...base, field: 'percentage', rate_throttle_hz: 0 })
    const omitted = datapointConfig.parse({ ...base, field: 'percentage' })
    expect(zero.rate_throttle_hz).toBe(0)
    expect(omitted.rate_throttle_hz).toBeUndefined()
  })

  it('refuses numeric, chart and alerts when field is omitted', () => {
    const whole = { ...base }
    expect(datapointConfig.safeParse({ ...whole, numeric: { scale: 2 } }).success).toBe(false)
    expect(datapointConfig.safeParse({ ...whole, chart: { y_min: 0 } }).success).toBe(false)
    expect(datapointConfig.safeParse({ ...whole, alerts: { hot: { condition: { fire_at: true } } } }).success).toBe(false)
    expect(datapointConfig.safeParse(whole).success).toBe(true)
  })

  it('has no expected_range', () => {
    expect(datapointConfig.safeParse({ ...base, field: 'percentage', expected_range: { min: 0, max: 1 } }).success).toBe(false)
  })

  it('derives an alert direction from the two values and refuses an equal pair', () => {
    expect(alertCondition.safeParse({ fire_at: 80, resolve_at: 75 }).success).toBe(true)
    expect(alertCondition.safeParse({ fire_at: 15, resolve_at: 18 }).success).toBe(true)
    expect(alertCondition.safeParse({ fire_at: true }).success).toBe(true)
    expect(alertCondition.safeParse({ fire_at: 3 }).success).toBe(true)
    expect(alertCondition.safeParse({ fire_at: 15, resolve_at: 15 }).success).toBe(false)
  })

  it('refuses resolve_at on a non-numeric fire_at', () => {
    expect(alertCondition.safeParse({ fire_at: true, resolve_at: 1 }).success).toBe(false)
    expect(alertCondition.safeParse({ fire_at: 'err', resolve_at: 'ok' }).success).toBe(false)
  })

  it('refuses a reversed chart axis, the way a parameter refuses reversed bounds', () => {
    // `invalid_range` was deleted with `expected_range`, so nothing
    // downstream catches this any more. `{y_min: 10, y_max: 1}` used to parse
    // and reach a chart that renders empty.
    const chart = (c: object) => datapointConfig.safeParse({ ...base, field: 'percentage', chart: c })
    expect(chart({ y_min: 0, y_max: 100 }).success).toBe(true)
    expect(chart({ y_min: 10, y_max: 10 }).success).toBe(true)
    expect(chart({ y_min: 10 }).success).toBe(true)
    expect(chart({ y_min: 10, y_max: 1 }).success).toBe(false)
  })

  it('carries no recipients, cooldown or notify_on_resolve on an alert', () => {
    const withAlert = {
      ...base, field: 'percentage',
      alerts: { low: { condition: { fire_at: 15, resolve_at: 18 }, recipients: ['a@b.de'] } },
    }
    expect(datapointConfig.safeParse(withAlert).success).toBe(false)
  })
})

import { publisherConfig, cameraConfig } from '../src/index.js'

describe('publisher', () => {
  const ok = {
    topic: '/cmd_vel',
    type: 'geometry_msgs/msg/Twist',
    message: { linear: { x: '${linear_speed}' } },
    parameters: { linear_speed: { type: 'float64', min_value: -0.5, max_value: 0.5 } },
    failsafe: { timeout_ms: 500, message: { linear: { x: 0.0 } } },
    quiet_timeout_ms: 2000,
  }

  it('groups the timeout with the message it triggers', () => {
    expect(publisherConfig.safeParse(ok).success).toBe(true)
    const { failsafe, ...noFailsafe } = ok
    expect(publisherConfig.safeParse(noFailsafe).success).toBe(false)
    expect(publisherConfig.safeParse({ ...ok, timeout_ms: 500 }).success).toBe(false)
  })

  it('refuses a placeholder in the failsafe message', () => {
    const bad = { ...ok, failsafe: { timeout_ms: 500, message: { linear: { x: '${linear_speed}' } } } }
    expect(publisherConfig.safeParse(bad).success).toBe(false)
  })
})

describe('camera', () => {
  const base = { width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5 }

  it('takes the snapshot interval in seconds, 1 to 3600', () => {
    const src = { kind: 'ros', topic: '/cam', type: 'sensor_msgs/msg/Image' }
    expect(cameraConfig.safeParse({ source: src, ...base }).success).toBe(true)
    expect(cameraConfig.safeParse({ source: src, ...base, snapshot_interval_seconds: 3601 }).success).toBe(false)
    expect(cameraConfig.safeParse({ source: src, ...base, snapshot_interval_ms: 5000 }).success).toBe(false)
  })

  it('carries credentials inline and no longer knows credentials_ref', () => {
    const rtsp = { kind: 'rtsp', url: 'rtsp://cam/1', credentials: { username: 'ops', password: 'x' } }
    expect(cameraConfig.safeParse({ source: rtsp, ...base }).success).toBe(true)
    const ref = { kind: 'rtsp', url: 'rtsp://cam/1', credentials_ref: 'site' }
    expect(cameraConfig.safeParse({ source: ref, ...base }).success).toBe(false)
  })
})

import { robotConfigDoc, FLEETLESS_FORMAT_VERSION } from '../src/index.js'

describe('document', () => {
  it('requires the format marker and refuses any other value', () => {
    expect(FLEETLESS_FORMAT_VERSION).toBe(1)
    expect(robotConfigDoc.safeParse({ fleetless: 1 }).success).toBe(true)
    expect(robotConfigDoc.safeParse({}).success).toBe(false)
    expect(robotConfigDoc.safeParse({ fleetless: 2 }).success).toBe(false)
  })

  it('keys every section by name', () => {
    const doc = {
      fleetless: 1,
      datapoints: { battery_soc: { topic: '/b', type: 'sensor_msgs/msg/BatteryState', field: 'percentage' } },
    }
    const parsed = robotConfigDoc.parse(doc)
    expect(Object.keys(parsed.datapoints ?? {})).toEqual(['battery_soc'])
  })

  it('refuses an unknown section and an unknown key inside an entry', () => {
    expect(robotConfigDoc.safeParse({ fleetless: 1, datapoint: {} }).success).toBe(false)
    expect(
      robotConfigDoc.safeParse({
        fleetless: 1,
        datapoints: { a_b: { topic: '/b', type: 'std_msgs/msg/Bool', field: 'data', nope: 1 } },
      }).success,
    ).toBe(false)
  })

  it('refuses an explicit null instead of an omission', () => {
    expect(
      robotConfigDoc.safeParse({
        fleetless: 1,
        datapoints: { a_b: { topic: '/b', type: 'std_msgs/msg/Bool', field: null } },
      }).success,
    ).toBe(false)
  })

  it('refuses an explicit null at every message position, not only on a typed field', () => {
    // The four positions a bare `z.unknown()` used to let `null` through, and
    // the reason this test is not one line: omission is the only spelling of
    // "not set", and a message position has no field type to enforce that for
    // it. Each of these parsed before `messageTemplate` refused null.
    const doc = (extra: object) => ({ fleetless: 1, ...extra })
    const pub = (message: unknown, failsafeMessage: unknown) => ({
      publishers: {
        cmd_vel: {
          topic: '/cmd_vel',
          type: 'geometry_msgs/msg/Twist',
          message,
          failsafe: { timeout_ms: 500, message: failsafeMessage },
          quiet_timeout_ms: 2000,
        },
      },
    })
    const stop = { linear: { x: 0 } }
    expect(robotConfigDoc.safeParse(doc(pub(stop, stop))).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc(pub(null, stop))).success).toBe(false)
    expect(robotConfigDoc.safeParse(doc(pub(stop, null))).success).toBe(false)
    expect(
      robotConfigDoc.safeParse(doc({ actions: { dock: { ros_name: '/dock', type: 'rx1_msgs/action/Dock', message: null } } })).success,
    ).toBe(false)
    expect(
      robotConfigDoc.safeParse(doc({ services: { reset: { ros_name: '/reset', type: 'std_srvs/srv/Trigger', message: null } } })).success,
    ).toBe(false)
    expect(robotConfigDoc.safeParse(doc({ messages: { stop_twist: null } })).success).toBe(false)
    expect(robotConfigDoc.safeParse(doc({ messages: { stop_twist: stop } })).success).toBe(true)
  })

  it('says what messageBody actually is: one shape, and messageRef is the predicate over it', () => {
    // The union it used to be could not refuse anything — its second member
    // accepted everything the first did — and published as
    // `anyOf: [{pattern…}, {}]`. Position, not shape, decides whether a
    // `${name}` here is a reference; that is the cloud's call and the
    // artifact no longer implies otherwise.
    expect(messageBody.safeParse('${stop_twist}').success).toBe(true)
    expect(messageBody.safeParse('anything at all').success).toBe(true)
    expect(messageBody.safeParse(null).success).toBe(false)
    expect(messageRef.safeParse('${stop_twist}').success).toBe(true)
    expect(messageRef.safeParse('anything at all').success).toBe(false)
  })
})

import { datapointAlert } from '../src/index.js'

describe('every refusal names its spec code', () => {
  /**
   * Wave 1b maps a zod issue to one of the thirteen validation codes and to
   * the repair the editor offers for it. Without `params.code` that mapping
   * has to match the message prose — a join nobody notices breaking. These
   * assertions are what makes it mechanical.
   */
  it.each([
    ['constraint_not_allowed_for_type', () => parameterSpec.safeParse({ type: 'string', min_value: 1 })],
    ['constraint_not_allowed_for_type', () => parameterSpec.safeParse({ type: 'int32', regex: '^a' })],
    ['constraint_not_allowed_for_type', () => parameterSpec.safeParse({ type: 'float64', enum: [1.5] })],
    ['value_type_mismatch', () => parameterSpec.safeParse({ type: 'int32', default: 'nope' })],
    ['value_type_mismatch', () => parameterSpec.safeParse({ type: 'int32', enum: ['a'] })],
    ['invalid_condition', () => alertCondition.safeParse({ fire_at: 15, resolve_at: 15 })],
    ['invalid_condition', () => alertCondition.safeParse({ fire_at: true, resolve_at: 1 })],
    ['requires_single_field', () => datapointConfig.safeParse({ ...base, numeric: { scale: 2 } })],
    ['explicit_null', () => messageBody.safeParse(null)],
    [
      'failsafe_has_parameters',
      () =>
        publisherConfig.safeParse({
          topic: '/cmd_vel',
          type: 'geometry_msgs/msg/Twist',
          message: { linear: { x: 0 } },
          failsafe: { timeout_ms: 500, message: { linear: { x: '${speed}' } } },
          quiet_timeout_ms: 2000,
        }),
    ],
  ])('%s', (code, run) => {
    const r = run()
    expect(r.success).toBe(false)
    expect(!r.success && codesOf(r)).toEqual([code])
  })

  it('leaves exactly one refusal without a code, and it is the one with no code to give', () => {
    // `invalid_range` was deleted with `expected_range`; reversed bounds are
    // not one of the thirteen, and inventing a fourteenth here would put a
    // code in the contracts that the cloud's table does not know.
    const r = parameterSpec.safeParse({ type: 'int32', min_value: 5, max_value: 1 })
    expect(r.success).toBe(false)
    expect(!r.success && codesOf(r)).toEqual([undefined])
  })

  it('exempts a shared-message reference from the failsafe check, and says so', () => {
    // A string at a `message:` position is a reference. Whether *that*
    // message holds a placeholder is a question about another section, which
    // this schema cannot see — so the referenced half of
    // `failsafe_has_parameters` is the cloud's, by position and on purpose.
    const withRef = {
      topic: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      message: { linear: { x: 0 } },
      failsafe: { timeout_ms: 500, message: '${stop_twist}' },
      quiet_timeout_ms: 2000,
    }
    expect(publisherConfig.safeParse(withRef).success).toBe(true)
    expect(datapointAlert.safeParse({ condition: { fire_at: 1 } }).success).toBe(true)
  })
})

import { cameraCredentials, datapointNumeric, datapointRetention, datapointChart } from '../src/index.js'
import type {
  CameraCredentials,
  DatapointAlert,
  DatapointChart,
  DatapointNumeric,
  DatapointRetention,
} from '../src/index.js'
import {
  ALERT_SEVERITY_DEFAULT,
  ALERT_ENABLED_DEFAULT,
  RETENTION_INTERVAL_SECONDS_DEFAULT,
  CHART_WINDOW_MINUTES_DEFAULT,
} from '../src/index.js'

describe('the defaults the format names', () => {
  /**
   * The fields stay `.optional()` — `.default()` would publish them as
   * required in the JSON Schema, and absence is the only spelling of "not
   * set" here. So the number has to live somewhere a consumer can read it,
   * or the cloud and the console each invent one and the two agree only
   * until somebody edits one of them.
   */
  it('exports each one as a constant, and leaves the field optional', () => {
    expect(ALERT_SEVERITY_DEFAULT).toBe('warning')
    expect(ALERT_ENABLED_DEFAULT).toBe(true)
    expect(RETENTION_INTERVAL_SECONDS_DEFAULT).toBe(300)
    expect(CHART_WINDOW_MINUTES_DEFAULT).toBe(60)

    const parsed = datapointConfig.parse({
      ...base,
      field: 'percentage',
      retention: {},
      chart: {},
      alerts: { low: { condition: { fire_at: 15, resolve_at: 18 } } },
    })
    expect(parsed.retention!.interval_seconds).toBeUndefined()
    expect(parsed.chart!.default_window_minutes).toBeUndefined()
    expect(parsed.alerts!.low!.severity).toBeUndefined()
    expect(parsed.alerts!.low!.enabled).toBeUndefined()
  })

  it('keeps each default inside the bound its own field enforces', () => {
    // A constant that its own field would refuse is worse than no constant.
    expect(datapointConfig.safeParse({
      ...base, field: 'percentage',
      retention: { interval_seconds: RETENTION_INTERVAL_SECONDS_DEFAULT },
      chart: { default_window_minutes: CHART_WINDOW_MINUTES_DEFAULT },
      alerts: { low: { condition: { fire_at: 1 }, severity: ALERT_SEVERITY_DEFAULT, enabled: ALERT_ENABLED_DEFAULT } },
    }).success).toBe(true)
  })
})

describe('the document shapes the barrel test cannot see', () => {
  /**
   * `barrel.test.ts` compares runtime exports and says in its own header that
   * `export type` is invisible to it. These five values had no type export at
   * all, asymmetric with everything else in `config.ts` and undetectable by
   * that check. Annotating each one here puts them under `pnpm typecheck`,
   * which is the only thing that can see them — and vitest does not
   * typecheck, so this test passing is not the assertion; `pnpm typecheck`
   * accepting the file is.
   */
  it('exports a type beside each value', () => {
    const alert: DatapointAlert = { condition: { fire_at: 1 }, severity: ALERT_SEVERITY_DEFAULT }
    const numeric: DatapointNumeric = { scale: 2, unit: '%' }
    const retention: DatapointRetention = { interval_seconds: RETENTION_INTERVAL_SECONDS_DEFAULT }
    const chart: DatapointChart = { default_window_minutes: CHART_WINDOW_MINUTES_DEFAULT }
    const credentials: CameraCredentials = { username: 'ops', password: 'hunter2' }
    expect(datapointAlert.safeParse(alert).success).toBe(true)
    expect(datapointNumeric.safeParse(numeric).success).toBe(true)
    expect(datapointRetention.safeParse(retention).success).toBe(true)
    expect(datapointChart.safeParse(chart).success).toBe(true)
    expect(cameraCredentials.safeParse(credentials).success).toBe(true)
  })
})

describe('a default must satisfy the constraints it was declared beside', () => {
  // The one way past bounds that are otherwise the enforcement point. The
  // spec calls min_value/max_value the speed limit that actually holds,
  // checked in the cloud before anything reaches the robot — but a caller who
  // omits the parameter gets the default, and the bridge fills it at the
  // template walk without re-checking bounds, deliberately. So an
  // out-of-range default published a value no caller could have sent.
  it('refuses a default outside its numeric bounds', () => {
    expect(parameterSpec.safeParse({ type: 'int32', min_value: -1, max_value: 1, default: 99 }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'float64', min_value: 0, max_value: 1, default: -5 }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'int32', min_value: -1, max_value: 1, default: 1 }).success).toBe(true)
  })

  it('refuses a default outside its enum', () => {
    expect(parameterSpec.safeParse({ type: 'string', enum: ['a', 'b'], default: 'z' }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'string', enum: ['a', 'b'], default: 'a' }).success).toBe(true)
  })

  it('refuses a default its own regex rejects', () => {
    expect(parameterSpec.safeParse({ type: 'string', regex: '^[a-z]+$', default: '123' }).success).toBe(false)
    expect(parameterSpec.safeParse({ type: 'string', regex: '^[a-z]+$', default: 'abc' }).success).toBe(true)
  })

  it('reports the failure at the default, so a repair knows what to touch', () => {
    const result = parameterSpec.safeParse({ type: 'int32', min_value: -1, max_value: 1, default: 99 })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.join('.') === 'default')).toBe(true)
  })
})

describe('an explicit null inside a message body', () => {
  // The hole a previous round measured its way past. Every other field is
  // .optional() rather than .nullable(), so zod refuses null at each for
  // free — but a message body is z.unknown(), so nothing below its top is
  // typed at all. Six cases were tried, all shallow, and the check that
  // would have caught this was deleted on the strength of them.
  it('is refused at depth, not only at the position itself', () => {
    const publisher = (message: unknown) => ({
      fleetless: 1 as const,
      publishers: {
        drive: {
          topic: '/cmd_vel',
          type: 'geometry_msgs/msg/Twist',
          message,
          failsafe: { timeout_ms: 500, message: {} },
          quiet_timeout_ms: 0,
        },
      },
    })
    expect(robotConfigDoc.safeParse(publisher(null)).success).toBe(false)
    expect(robotConfigDoc.safeParse(publisher({ linear: { x: null } })).success).toBe(false)
    expect(robotConfigDoc.safeParse(publisher({ ranges: [1, null] })).success).toBe(false)
    expect(robotConfigDoc.safeParse(publisher({ linear: { x: 0 } })).success).toBe(true)
  })

  it('is refused at depth in a shared message too', () => {
    const doc = { fleetless: 1 as const, messages: { stop: { linear: { x: null } } } }
    expect(robotConfigDoc.safeParse(doc).success).toBe(false)
  })

  it('returns rather than hanging on a cyclic template', () => {
    // A YAML anchor can produce one, and a developer can write it. The walk
    // uses an explicit stack and a seen-set for this; recursion would not
    // return.
    const body: Record<string, unknown> = { x: 0 }
    body.self = body
    const doc = { fleetless: 1 as const, messages: { loop: body } }
    expect(() => robotConfigDoc.safeParse(doc)).not.toThrow()
  })
})
