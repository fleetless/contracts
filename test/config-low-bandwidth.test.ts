// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { robotConfigDoc, datapointConfig, lowBandwidthSection, LOW_BANDWIDTH_DEFAULTS, RESERVED_SLUGS, FLEETLESS_FORMAT_VERSION } from '../src/index.js'

const DOC = { fleetless: FLEETLESS_FORMAT_VERSION, datapoints: { battery: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage' } } }

describe('the low_bandwidth section', () => {
  it('is optional, every key optional, unknown keys refused', () => {
    expect(robotConfigDoc.safeParse(DOC).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, low_bandwidth: { mode: 'on', datapoint_max_hz: 0.5, camera: 'stop' } }).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, low_bandwidth: { modee: 'on' } }).success).toBe(false)
    expect(lowBandwidthSection.safeParse({ mode: 'sometimes' }).success).toBe(false)
    expect(lowBandwidthSection.safeParse({ datapoint_max_hz: 0 }).success).toBe(false)
    expect(lowBandwidthSection.safeParse({ camera_bitrate_kbps: 10 }).success).toBe(false)
  })
  it('a datapoint may opt out of the cap with keep', () => {
    expect(datapointConfig.safeParse({ topic: '/t', type: 'std_msgs/msg/Float64', field: 'data', low_bandwidth: 'keep' }).success).toBe(true)
    expect(datapointConfig.safeParse({ topic: '/t', type: 'std_msgs/msg/Float64', field: 'data', low_bandwidth: 'drop' }).success).toBe(false)
  })
  it('ships the defaults to constants.json for the bridge', () => {
    const constants = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(constants.LOW_BANDWIDTH_DEFAULTS).toEqual(LOW_BANDWIDTH_DEFAULTS)
    expect(LOW_BANDWIDTH_DEFAULTS.enter_lag_ms).toBe(2000)
  })
  it('bridge_pressure is no longer reserved', () => {
    expect(RESERVED_SLUGS).toEqual(['bridge_state', 'robot_details', 'history'])
    expect(datapointConfig.safeParse({ topic: '/t', type: 'std_msgs/msg/Float64', field: 'data' }).success).toBe(true)
  })
})
