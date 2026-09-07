// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  actionConfig,
  app,
  cameraConfig,
  datapointNumeric,
  createAppRequest,
  datapointConfig,
  ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  MCP_ENDPOINT_PATH,
  mcpAppEndpointPath,
  parameterSpec,
  publisherConfig,
  serviceDescription,
  robotConfigDoc,
  serviceConfig,
  updateAppRequest,
} from '../src/index.js'
import * as contracts from '../src/index.js'
import {
  mcpExposure,
  mcpRobotDatasheet,
  mcpRolePreviewResponse,
  MCP_ASSET_LINK_PATH,
  MCP_ASSET_LINK_TTL_MS,
} from '../src/mcp.js'

/** A published configuration from before descriptions existed — none anywhere. */
const docWithoutDescriptions = {
  fleetless: 1 as const,
  datapoints: {
    battery_state: {
      topic: '/battery_state',
      type: 'sensor_msgs/msg/BatteryState',
      field: 'percentage',
      rate_throttle_hz: 1,
      numeric: { scale: 100, unit: '%' },
    },
  },
  actions: {
    dock: { ros_name: '/dock', type: 'robot_msgs/action/Dock' },
  },
}

describe('descriptions on the configuration', () => {
  /**
   * The migration claim, and it is the one that breaks live robots if it is
   * wrong: every configuration published before descriptions existed is
   * jsonb in a column, read on every publish and on every bridge connect.
   */
  it('a configuration document with no description anywhere still parses', () => {
    const parsed = robotConfigDoc.parse(docWithoutDescriptions)
    expect(parsed.datapoints!.battery_state!.description).toBeUndefined()
    expect(parsed.actions!.dock!.description).toBeUndefined()
  })

  /**
   * **Asserting the parsed value, not `.success`.** `description` is optional
   * on every kind, so a document without one parses whether or not the field
   * still exists in the schema — which is exactly how a contracts test here
   * once came out green after the field it tested had been deleted. Reading
   * the parsed property is what tells those two apart.
   *
   * Not because unknown keys are stripped: every kind is `z.strictObject` as
   * of this wave (`config-format.test.ts` pins the refusal), which makes
   * `.success` say less rather than more — a `false` under `strictObject`
   * cannot distinguish an unknown key from a missing required one, and a
   * `true` still cannot mean the field was recognised.
   */
  it.each([
    ['datapoint', datapointConfig, { ...docWithoutDescriptions.datapoints.battery_state }],
    ['action', actionConfig, { ...docWithoutDescriptions.actions.dock }],
    ['service', serviceConfig, { ros_name: '/reset', type: 'std_srvs/srv/Trigger' }],
    [
      'publisher',
      publisherConfig,
      {
        topic: '/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        message: { linear: { x: 0 }, angular: { z: 0 } },
        failsafe: { timeout_ms: 500, message: { linear: { x: 0 }, angular: { z: 0 } } },
        quiet_timeout_ms: 2000,
      },
    ],
    [
      'camera',
      cameraConfig,
      {
        source: { kind: 'ros' as const, topic: '/image_raw', type: 'sensor_msgs/msg/Image' },
        width: 640,
        height: 480,
        fps: 10,
        bitrate_kbps: 800,
        snapshot_interval_seconds: 1,
      },
    ],
  ])('%s carries a description through the parse', (_name, schema, base) => {
    const parsed = (schema as z.ZodType).parse({ ...base, description: 'What this is, for a model.' })
    expect((parsed as { description?: string }).description).toBe('What this is, for a model.')
  })

  it('a parameter carries its own description', () => {
    const parsed = parameterSpec.parse({
      type: 'float64',
      min_value: 0,
      max_value: 1.5,
      description: 'Metres per second. Above 1.0 the robot will not take corners.',
    })
    expect(parsed.description).toContain('Metres per second')
  })

  /** The empty string would be a second spelling of "not described". */
  it('refuses an empty description rather than storing a second spelling of absent', () => {
    expect(datapointConfig.safeParse({ ...docWithoutDescriptions.datapoints.battery_state, description: '' }).success).toBe(false)
  })

  /**
   * **The reason this field is `.optional()` and not `.default(null)`.**
   * `.default()` publishes as `required` in the generated artifact — recorded
   * four times over in `scripts/export-schemas.ts` — and the bridge validates
   * incoming config frames against exactly this document. A fifth instance
   * would mean the published schema demands a field the source of truth calls
   * optional. This test is the claim, so it fails if anyone "tidies" the
   * field into a default later.
   */
  it('the generated JSON Schema does not make description required', () => {
    // Each section is now a record keyed by name — `additionalProperties`
    // carries the entry schema, where `items` used to when sections were
    // arrays.
    const schema = z.toJSONSchema(robotConfigDoc) as {
      properties: Record<string, { additionalProperties?: { required?: string[] } }>
    }
    for (const kind of ['datapoints', 'actions', 'services', 'publishers', 'cameras']) {
      expect(schema.properties[kind]?.additionalProperties?.required ?? []).not.toContain('description')
    }
  })
})

describe('the app-level MCP switch, gone and back', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    org_id: '00000000-0000-4000-8000-000000000002',
    name: 'Ops',
    identifier: 'ops',
    robot_ids: [],
    default_role_id: null,
    created_at: '2026-08-18T10:00:00.000Z',
  }

  /**
   * An app once had an `mcp_enabled` switch for a per-app endpoint
   * `/mcp/<identifier>`. That endpoint is deleted, so the switch
   * removed the field on 2026-08-29. The app-user-auth design brings the
   * per-app endpoint back (D7) — and puts the switch on `appAuthConfig`, not
   * back on `app`.
   *
   * **That placement is what this pair pins.** `app` is a shape every app list
   * carries; the auth settings are a sub-resource fetched when somebody opens
   * the Auth tab. A switch on `app` would also be settable through the app's
   * own PATCH, which is a rename route, and re-open the question of whether a
   * rename may arrive carrying an MCP change.
   */
  it('is still not a field on `app`, and an offered one is stripped rather than stored', () => {
    const parsed = app.parse(base)
    expect(parsed).not.toHaveProperty('mcp_enabled')
    // `app` is not `.strict()`, so an old client still sending it gets it
    // stripped rather than a 400. Asserting on the PARSED object, not on
    // `safeParse().success`, is the difference between measuring "the field is
    // gone" and measuring "zod strips unknown keys", which it always does.
    expect(app.parse({ ...base, mcp_enabled: true })).not.toHaveProperty('mcp_enabled')
  })

  it('is refused by the two `.strict()` app request shapes, which is the honest answer', () => {
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops' }).success).toBe(true)
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', mcp_enabled: true }).success).toBe(false)
    expect(updateAppRequest.safeParse({ name: 'Ops' }).success).toBe(true)
    expect(updateAppRequest.safeParse({ mcp_enabled: false }).success).toBe(false)
  })

  /**
   * The other half, so this is not a sweep asserting an empty world: the switch
   * exists, on the shape that owns the app's auth settings.
   */
  it('lives on the app auth config, where the rest of the auth settings are', () => {
    expect('mcp_enabled' in contracts.appAuthConfig.shape).toBe(true)
    expect('mcp_enabled' in contracts.putAppAuthConfigRequest.shape).toBe(true)
  })
})

describe('the central endpoint', () => {
  it('speaks the revision the stable SDK ships', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-11-25')
  })

  /**
   * **Two audiences, two paths, and neither is built from the other.** The
   * central endpoint serves Fleetless users and takes no argument; an app's
   * users reach `/mcp/<identifier>`. The old `mcpEndpointPath(appIdentifier)`
   * was deleted when the per-app endpoint was, and stayed deleted while the
   * console still offered a copy button for a URL that answered `404` — which
   * is why the new helper is named differently and arrives **with** its route
   * in the manifest.
   */
  it('names the central path unparameterised, and the app path by identifier', () => {
    expect(MCP_ENDPOINT_PATH).toBe('/mcp')
    expect(Object.keys(contracts)).toContain('MCP_ENDPOINT_PATH')
    expect(mcpAppEndpointPath('warehouse_ops')).toBe('/mcp/warehouse_ops')
    // The retired helper stays gone under its old name: an export nobody
    // imports today is an export somebody imports tomorrow, and that name
    // meant a route that answered `404` for a release.
    expect(Object.keys(contracts)).not.toContain('mcpEndpointPath')
  })

  /**
   * A path, not a URL. The cloud mints every OAuth issuer and audience from
   * `PUBLIC_API_BASE_URL` and compares a token's `aud` against that string, so
   * a helper returning an absolute URL built from the friendly alias would hand
   * out a value the token check rejects.
   */
  it('returns a path rather than an absolute URL', () => {
    expect(mcpAppEndpointPath('ops').startsWith('/')).toBe(true)
    expect(mcpAppEndpointPath('ops')).not.toContain('://')
  })
})

const ROBOT = '0b7d2a4e-1c6f-4d3a-9e8b-2f1a3c4d5e6f'
const ROLE = '1c8e3b5f-2d7a-4e4b-8f9c-3a2b4c5d6e7f'

describe('mcp datasheet contracts', () => {
  it('accepts a datasheet with one exposure of each kind', () => {
    const sheet = mcpRobotDatasheet.parse({
      robot_id: ROBOT,
      robot_name: 'RX1',
      capabilities: { action_history: true, assets: false },
      exposures: [
        { slug: 'battery', kind: 'datapoint', description: 'Battery charge.', unit: '%', decimals: 1, input_schema: null },
        { slug: 'dock', kind: 'action', description: null, unit: null, decimals: null, input_schema: { type: 'object', properties: {} } },
        { slug: 'front', kind: 'camera', description: 'Front camera.', unit: null, decimals: null, input_schema: null },
      ],
    })
    expect(sheet.exposures).toHaveLength(3)
  })

  /** One valid exposure and one valid datasheet, so a test can break exactly one thing. */
  const EXPOSURE = { slug: 'front', kind: 'camera', description: null, unit: null, decimals: null, input_schema: null }
  const datasheet = (overrides: Record<string, unknown> = {}) => ({
    robot_id: ROBOT,
    robot_name: 'RX1',
    capabilities: { action_history: false, assets: false },
    exposures: [EXPOSURE],
    ...overrides,
  })

  /**
   * **The `datapoint` control is what makes this an assertion about `kind`.**
   * Without it the refusal is guarded by nothing: `slug` is bounded at two
   * characters, so a one-character slug made `safeParse` false whatever the
   * kind said. Measured — widening `mcpToolKind` to admit `stream` left the
   * single-`safeParse` version of this test green.
   */
  it('refuses an exposure whose kind is not one of the five', () => {
    const withKind = (kind: string) => datasheet({ exposures: [{ ...EXPOSURE, kind }] })
    expect(mcpRobotDatasheet.safeParse(withKind('stream')).success).toBe(false)
    expect(mcpRobotDatasheet.safeParse(withKind('datapoint')).success).toBe(true)
  })

  /**
   * **The element type, not merely the array.** `robots: []` on its own is a
   * claim about nothing — the first failure mode in this project's own list.
   * Measured: substituting `z.array(z.unknown())` for
   * `z.array(mcpRobotDatasheet)` in `mcpRolePreviewResponse` left every test
   * in this file green.
   *
   * So a valid datasheet must pass and two differently-broken ones must not:
   * a bad `kind`, which is two levels down inside an exposure, and a missing
   * `capabilities`, which is the datasheet's own required object. One example
   * would only prove that *something* is checked at whichever depth it broke.
   */
  it('a role preview is a list of datasheets keyed by role', () => {
    const preview = (robots: unknown[]) => mcpRolePreviewResponse.safeParse({ role_id: ROLE, robots })
    expect(mcpRolePreviewResponse.parse({ role_id: ROLE, robots: [] }).robots).toEqual([])
    expect(preview([datasheet()]).success).toBe(true)
    expect(preview([datasheet({ exposures: [{ ...EXPOSURE, kind: 'stream' }] })]).success).toBe(false)
    const { capabilities: _dropped, ...withoutCapabilities } = datasheet()
    expect(preview([withoutCapabilities]).success).toBe(false)
  })

  /**
   * **`decimals` is required-nullable, like `unit`, and for the same reason.**
   * An optional field lets a producer that has forgotten the datapoint's
   * `numeric.decimals` look identical to one reporting a datapoint that has
   * none — the two states this feature exists to separate. The bounds are the
   * config field's own (`numeric.decimals`, 0..6, integer), re-derived here so
   * that widening one side without the other fails rather than drifting.
   */
  it('carries a datapoint\'s decimals as a required nullable field', () => {
    const dp = (overrides: Record<string, unknown> = {}) =>
      ({ slug: 'battery', kind: 'datapoint', description: null, unit: '%', input_schema: null, decimals: 1, ...overrides })
    expect(mcpExposure.parse(dp()).decimals).toBe(1)
    expect(mcpExposure.parse(dp({ decimals: 0 })).decimals).toBe(0)
    expect(mcpExposure.parse(dp({ decimals: null })).decimals).toBeNull()
    const { decimals: _omitted, ...without } = dp()
    expect(mcpExposure.safeParse(without).success).toBe(false)
    expect(mcpExposure.safeParse(dp({ decimals: 6 })).success).toBe(true)
    expect(mcpExposure.safeParse(dp({ decimals: 7 })).success).toBe(false)
    expect(mcpExposure.safeParse(dp({ decimals: -1 })).success).toBe(false)
    expect(mcpExposure.safeParse(dp({ decimals: 1.5 })).success).toBe(false)
    // The bound this mirrors, read off the config schema rather than retyped.
    expect(datapointNumeric.safeParse({ decimals: 6 }).success).toBe(true)
    expect(datapointNumeric.safeParse({ decimals: 7 }).success).toBe(false)
  })

  it('names the asset-link route and its lifetime', () => {
    expect(MCP_ASSET_LINK_PATH).toBe('/api/asset-links')
    expect(MCP_ASSET_LINK_TTL_MS).toBe(15 * 60 * 1000)
  })

  /**
   * **The two description bounds are now equal, and that is a change of
   * meaning rather than a tidy-up.** The retired `mcpToolPreview.description`
   * was bounded at 4000 because the generator folded a datapoint's unit and
   * range into the developer's own 2000-character text, and the response
   * overflowed its own contract when it did not. An exposure carries the
   * developer's description **verbatim** and `unit` as a field of its own, so
   * there is nothing left to fold in and nothing left to leave room for.
   *
   * The old file warned the next reader not to make these two numbers agree.
   * This test is why they now may — it fails if an exposure ever stops
   * accepting exactly what a developer is allowed to write.
   */
  it('carries a maximal developer description verbatim', () => {
    const exposure = { slug: 'battery', kind: 'datapoint' as const, unit: '%', decimals: null, input_schema: null }
    const longest = 'x'.repeat(2000)
    expect(serviceDescription.safeParse(longest).success).toBe(true)
    // The human bound is the claim this test rests on, so it is re-derived in
    // both directions rather than read off the comment above.
    expect(serviceDescription.safeParse(longest + 'x').success).toBe(false)
    expect(mcpExposure.safeParse({ ...exposure, description: longest }).success).toBe(true)
    expect(mcpExposure.safeParse({ ...exposure, description: longest + 'x' }).success).toBe(false)
  })

  it('no longer exports the per-slug tool-name derivation or the omission taxonomy', () => {
    for (const name of ['mcpRobotKey', 'mcpRobotKeys', 'mcpToolName', 'MCP_TOOL_NAME_SEPARATOR', 'MCP_OMISSION_REASONS', 'mcpToolPreview', 'mcpOmission', 'mcpToolPreviewResponse']) {
      expect((contracts as Record<string, unknown>)[name], name).toBeUndefined()
    }
  })
})

describe('error codes', () => {
  it('adds the two management-side codes and nothing for the MCP endpoint itself', () => {
    expect(ERROR_CODES).toContain('mcp_disabled')
    expect(ERROR_CODES).toContain('tool_not_available')
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('MCP gating after the two-space cut', () => {
  /**
   * **`mcp_access_denied` is gone because both of its inputs are.** It was the
   * refusal from the group flag `orgGroup.mcp_enabled` crossed with the
   * per-user override `orgUser.mcp_access`; groups and the override are deleted
   * with no successor, and every Fleetless user reaches the central endpoint
   * (D1). A code standing for a state nothing can enter is the "documented
   * absence" this repository keeps paying for, so it went with them.
   *
   * What gates MCP now is per app: `appAuthConfig.mcp_enabled`, refused with
   * `mcp_disabled` — a code that stood unproduced for a year while its switch
   * did not exist, and has one again.
   */
  it('has dropped mcp_access_denied and kept mcp_disabled, which now has a switch behind it', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).not.toContain('mcp_access_denied')
    expect(codes).toContain('mcp_disabled')
    expect('mcp_enabled' in contracts.appAuthConfig.shape).toBe(true)
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
