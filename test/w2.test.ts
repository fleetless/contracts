import { describe, it, expect } from 'vitest'
import {
  RESERVED_SLUGS,
  datapointConfig,
  datapointRate,
  robotConfigDoc,
  validationIssue,
  configState,
  rosGraph,
  typeDefinition,
  cloudConfig,
  bridgeConfigApplied,
  cloudIntrospectRequest,
  bridgeIntrospect,
  cloudTypeRequest,
  bridgeTypeDefinitions,
  robotDetailResponse,
  configDraftResponse,
  publishConfigResponse,
  introspectionResponse,
  datapointListResponse,
  robotDetailsDoc,
  valueRule,
  ERROR_CODES,
} from '../src/index.js'

const DATAPOINT = {
  slug: 'battery-percentage',
  topic: '/battery',
  type: 'sensor_msgs/msg/BatteryState',
  field: 'percentage',
  rate: { mode: 'max_hz', hz: 2 },
  unit: '%',
  scale: 100,
  offset: null,
  range: { min: 0, max: 100 },
}

describe('W2 exposure model', () => {
  it('takes one field of a topic, or the whole topic', () => {
    expect(datapointConfig.safeParse(DATAPOINT).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, field: null }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, field: 'pose.position.x' }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, field: 'ranges[0]' }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, field: 'Pose..x' }).success).toBe(false)
  })

  it('insists on absolute ROS names and ROS 2 type names', () => {
    expect(datapointConfig.safeParse({ ...DATAPOINT, topic: 'battery' }).success).toBe(false)
    expect(datapointConfig.safeParse({ ...DATAPOINT, topic: '/ns/battery' }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, type: 'sensor_msgs/BatteryState' }).success).toBe(false)
    expect(datapointConfig.safeParse({ ...DATAPOINT, type: 'custom_msgs/msg/Speed' }).success).toBe(true)
    expect(datapointConfig.safeParse({ ...DATAPOINT, type: 'example/srv/AddTwoInts' }).success).toBe(true)
  })

  it('bounds the send rate and knows the change-only mode', () => {
    expect(datapointRate.safeParse({ mode: 'on_change' }).success).toBe(true)
    expect(datapointRate.safeParse({ mode: 'max_hz', hz: 100 }).success).toBe(true)
    expect(datapointRate.safeParse({ mode: 'max_hz', hz: 0 }).success).toBe(false)
    expect(datapointRate.safeParse({ mode: 'max_hz', hz: 101 }).success).toBe(false)
    expect(datapointRate.safeParse({ mode: 'max_hz' }).success).toBe(false)
  })

  it('W6: retention is a boolean with exactly one spelling of "not recorded"', () => {
    // The W5 placeholder accepted `null`. It is now a boolean, and `false` is
    // the only representation of "not recorded" the contract admits — the
    // cloud normalises a stored `null` on read rather than the contract
    // carrying two spellings of one fact.
    expect(datapointConfig.safeParse({ ...DATAPOINT, retention: true }).success).toBe(true)
    expect(datapointConfig.parse({ ...DATAPOINT }).retention).toBe(false)
    expect(datapointConfig.safeParse({ ...DATAPOINT, retention: null }).success).toBe(false)
    expect(datapointConfig.safeParse({ ...DATAPOINT, retention: { days: 7 } }).success).toBe(false)
  })

  it('names the two built-in slugs', () => {
    expect([...RESERVED_SLUGS]).toEqual(['bridge-state', 'robot-details'])
  })

  it('carries a whole configuration as one document', () => {
    expect(robotConfigDoc.safeParse({ datapoints: [DATAPOINT] }).success).toBe(true)
    expect(robotConfigDoc.safeParse({ datapoints: [] }).success).toBe(true)
    expect(robotConfigDoc.safeParse({}).success).toBe(false)
  })

  it('reports issues with field, rule and a severity that decides publishing', () => {
    const issue = {
      path: 'datapoints[0].field',
      slug: 'battery-percentage',
      code: 'unknown_field_path',
      message: 'sensor_msgs/msg/BatteryState has no field "percentag"',
      severity: 'error',
    }
    expect(validationIssue.safeParse(issue).success).toBe(true)
    expect(validationIssue.safeParse({ ...issue, severity: 'warning', slug: null }).success).toBe(true)
    expect(validationIssue.safeParse({ ...issue, severity: 'info' }).success).toBe(false)
  })

  it('states where a configuration stands, including nothing published yet', () => {
    expect(
      configState.safeParse({
        published_version: null,
        published_at: null,
        draft_updated_at: '2026-08-10T12:00:00.000Z',
        applied_version: null,
        applied_ok: null,
        applied_errors: null,
      }).success,
    ).toBe(true)
    expect(
      configState.safeParse({
        published_version: 2,
        published_at: '2026-08-10T12:00:00.000Z',
        draft_updated_at: '2026-08-10T12:05:00.000Z',
        applied_version: 1,
        applied_ok: false,
        applied_errors: [{ slug: 'battery-percentage', message: 'topic not found' }],
      }).success,
    ).toBe(true)
  })

  it('defines the §4.4 parameter rules without enforcing them yet', () => {
    expect(valueRule.safeParse({}).success).toBe(true)
    expect(valueRule.safeParse({ min: 0, max: 1, required: true }).success).toBe(true)
    expect(valueRule.safeParse({ enum: ['left', 'right'] }).success).toBe(true)
    expect(valueRule.safeParse({ enum: [] }).success).toBe(false)
  })
})

describe('W2 introspection', () => {
  it('lists topics, services and actions with their types', () => {
    const graph = {
      topics: [{ name: '/battery', types: ['sensor_msgs/msg/BatteryState'] }],
      services: [{ name: '/add', types: ['example/srv/AddTwoInts'] }],
      actions: [{ name: '/drive', types: ['example/action/Drive'] }],
      captured_at_ms: 1754800000000,
    }
    expect(rosGraph.safeParse(graph).success).toBe(true)
    expect(rosGraph.safeParse({ ...graph, topics: [{ name: '/battery', types: [] }] }).success).toBe(false)
  })

  it('nests field trees to arbitrary depth and marks arrays', () => {
    const def = {
      name: 'sensor_msgs/msg/BatteryState',
      kind: 'msg',
      fields: [
        { name: 'percentage', type: 'float32', array: false, fields: null },
        { name: 'cell_voltage', type: 'float32', array: true, fields: null },
        {
          name: 'header',
          type: 'std_msgs/msg/Header',
          array: false,
          fields: [
            {
              name: 'stamp',
              type: 'builtin_interfaces/msg/Time',
              array: false,
              fields: [{ name: 'sec', type: 'int32', array: false, fields: null }],
            },
          ],
        },
      ],
    }
    expect(typeDefinition.safeParse(def).success).toBe(true)
  })

  it('resolves messages only in W2', () => {
    expect(
      typeDefinition.safeParse({ name: 'example/srv/AddTwoInts', kind: 'srv', fields: [] }).success,
    ).toBe(false)
  })
})

describe('W2 bridge protocol', () => {
  it('pushes the published configuration, with version 0 meaning nothing published', () => {
    expect(cloudConfig.safeParse({ type: 'config', version: 1, doc: { datapoints: [DATAPOINT] } }).success).toBe(true)
    expect(cloudConfig.safeParse({ type: 'config', version: 0, doc: { datapoints: [] } }).success).toBe(true)
    expect(cloudConfig.safeParse({ type: 'config', version: -1, doc: { datapoints: [] } }).success).toBe(false)
  })

  it('reports what was applied, with per-slug errors that do not fail the frame', () => {
    expect(bridgeConfigApplied.safeParse({ type: 'config_applied', version: 1, ok: true, errors: [] }).success).toBe(true)
    expect(
      bridgeConfigApplied.safeParse({
        type: 'config_applied',
        version: 1,
        ok: false,
        errors: [{ slug: 'battery-percentage', message: 'type not resolvable in this workspace' }],
      }).success,
    ).toBe(true)
  })

  it('correlates introspection and type requests by request_id', () => {
    expect(cloudIntrospectRequest.safeParse({ type: 'introspect_request', request_id: 'r1' }).success).toBe(true)
    expect(
      bridgeIntrospect.safeParse({
        type: 'introspect',
        request_id: 'r1',
        graph: { topics: [], services: [], actions: [], captured_at_ms: 1 },
      }).success,
    ).toBe(true)
    expect(cloudIntrospectRequest.safeParse({ type: 'introspect_request', request_id: '' }).success).toBe(false)
  })

  it('fetches type definitions in bounded batches and answers unresolved names', () => {
    expect(
      cloudTypeRequest.safeParse({
        type: 'type_request',
        request_id: 'r2',
        type_names: ['sensor_msgs/msg/BatteryState'],
      }).success,
    ).toBe(true)
    expect(cloudTypeRequest.safeParse({ type: 'type_request', request_id: 'r2', type_names: [] }).success).toBe(false)
    expect(
      cloudTypeRequest.safeParse({
        type: 'type_request',
        request_id: 'r2',
        type_names: Array.from({ length: 51 }, () => 'sensor_msgs/msg/BatteryState'),
      }).success,
    ).toBe(false)
    expect(
      bridgeTypeDefinitions.safeParse({
        type: 'type_definitions',
        request_id: 'r2',
        definitions: [],
        unresolved: ['custom_msgs/msg/Speed'],
      }).success,
    ).toBe(true)
  })
})

describe('W2 REST shapes', () => {
  const ROBOT_BASE = {
    id: '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f',
    name: 'gate-w2',
    created_at: '2026-08-10T12:00:00.000Z',
    bridge_state: { online: true, latency_ms: 2 },
  }
  const CONFIG_STATE = {
    published_version: 1,
    published_at: '2026-08-10T12:01:00.000Z',
    draft_updated_at: '2026-08-10T12:02:00.000Z',
    applied_version: 1,
    applied_ok: true,
    applied_errors: [],
  }

  it('adds bridge version, last refused hello and config state to the detail view', () => {
    expect(
      robotDetailResponse.safeParse({
        ...ROBOT_BASE,
        bridge_version: '1.1.0',
        last_hello_error: null,
        config: CONFIG_STATE,
      }).success,
    ).toBe(true)
    expect(
      robotDetailResponse.safeParse({
        ...ROBOT_BASE,
        bridge_version: null,
        last_hello_error: {
          code: 'protocol_mismatch',
          message: 'bridge speaks protocol 2, cloud speaks 1',
          at: '2026-08-10T11:00:00.000Z',
        },
        config: CONFIG_STATE,
      }).success,
    ).toBe(true)
  })

  it('returns the draft together with its issues', () => {
    expect(
      configDraftResponse.safeParse({
        doc: { datapoints: [DATAPOINT] },
        updated_at: '2026-08-10T12:02:00.000Z',
        issues: [],
      }).success,
    ).toBe(true)
    expect(
      configDraftResponse.safeParse({ doc: { datapoints: [] }, updated_at: null, issues: [] }).success,
    ).toBe(true)
  })

  it('numbers published versions from one', () => {
    expect(publishConfigResponse.safeParse({ version: 1, published_at: '2026-08-10T12:01:00.000Z' }).success).toBe(true)
    expect(publishConfigResponse.safeParse({ version: 0, published_at: '2026-08-10T12:01:00.000Z' }).success).toBe(false)
  })

  it('marks a cached graph as stale while the bridge is away', () => {
    expect(
      introspectionResponse.safeParse({
        graph: { topics: [], services: [], actions: [], captured_at_ms: 1 },
        fetched_at: '2026-08-10T12:00:00.000Z',
        stale: true,
      }).success,
    ).toBe(true)
  })

  it('describes the readable datapoints including the built-ins', () => {
    expect(
      datapointListResponse.safeParse({
        datapoints: [
          { slug: 'bridge-state', builtin: true, unit: null, range: null, rate: null },
          { slug: 'battery-percentage', builtin: false, unit: '%', range: { min: 0, max: 100 }, rate: { mode: 'max_hz', hz: 2 } },
        ],
      }).success,
    ).toBe(true)
  })

  it('bounds robot-details keys and value kinds', () => {
    expect(
      robotDetailsDoc.safeParse({
        model: 'rx1',
        payload_kg: 12.5,
        indoor: true,
        sensors: ['lidar', 'imu'],
        dimensions: { x: 1, y: 2 },
      }).success,
    ).toBe(true)
    expect(robotDetailsDoc.safeParse({ 'Model-Name': 'rx1' }).success).toBe(false)
    expect(robotDetailsDoc.safeParse({ model: null }).success).toBe(false)
  })
})

describe('W2 error vocabulary', () => {
  it('names the refusals this wave introduces', () => {
    for (const code of [
      'duplicate_slug',
      'reserved_slug',
      'unknown_field_path',
      'unknown_type',
      'unknown_topic',
      'invalid_rate',
      'invalid_range',
      'no_data',
      'config_conflict',
      'robot_offline',
      'bridge_timeout',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})
