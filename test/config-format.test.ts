import { describe, expect, it } from 'vitest'
import { slug, RESERVED_SLUGS, parameterSpec, parameterType, messageBody, messageRef, PLACEHOLDER_RE, placeholderNames, messageMap } from '../src/index.js'

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

  it('reserves three built-in slugs, spelled with underscores', () => {
    expect(RESERVED_SLUGS).toEqual(['bridge_state', 'robot_details', 'bridge_pressure'])
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
    expect(parameterSpec.safeParse({ type: 'bool', enum: [true] }).success).toBe(false)
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
})
