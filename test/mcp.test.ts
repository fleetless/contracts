import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  actionConfig,
  app,
  cameraConfig,
  createAppRequest,
  datapointConfig,
  ERROR_CODES,
  MCP_OMISSION_REASONS,
  MCP_PROTOCOL_VERSION,
  MCP_ENDPOINT_PATH,
  MCP_TOOL_NAME_MAX,
  mcpRobotKey,
  mcpRobotKeys,
  mcpToolName,
  mcpToolNamePattern,
  mcpToolPreview,
  mcpToolPreviewResponse,
  parameterSpec,
  publisherConfig,
  serviceDescription,
  robotConfigDoc,
  serviceConfig,
  updateAppRequest,
} from '../src/index.js'
import * as contracts from '../src/index.js'

/** A published configuration from before descriptions existed — none anywhere. */
const docWithoutDescriptions = {
  datapoints: [
    {
      slug: 'battery',
      topic: '/battery_state',
      type: 'sensor_msgs/msg/BatteryState',
      field: 'percentage',
      rate: { mode: 'max_hz' as const, hz: 1 },
      unit: '%',
      scale: 100,
      offset: null,
      range: { min: 0, max: 100 },
    },
  ],
  actions: [
    { slug: 'dock', ros_name: '/dock', type: 'rx1_msgs/action/Dock', parameters: [] },
  ],
  services: [],
  publishers: [],
  cameras: [],
}

describe('descriptions on the configuration', () => {
  /**
   * The migration claim, and it is the one that breaks live robots if it is
   * wrong: every configuration published before descriptions existed is
   * jsonb in a column, read on every publish and on every bridge connect.
   */
  it('a configuration document with no description anywhere still parses', () => {
    const parsed = robotConfigDoc.parse(docWithoutDescriptions)
    expect(parsed.datapoints[0]!.description).toBeUndefined()
    expect(parsed.actions[0]!.description).toBeUndefined()
  })

  /**
   * **Asserting the parsed value, not `.success`.** `robotConfigDoc`'s kinds
   * are not `.strict()`, so zod strips an unknown key and a `safeParse`
   * succeeds either way — which is exactly how a contracts test here once
   * came out green after the field it tested had been deleted. `.success` here would
   * pass whether or not `description` exists at all.
   */
  it.each([
    ['datapoint', datapointConfig, { ...docWithoutDescriptions.datapoints[0]! }],
    ['action', actionConfig, { ...docWithoutDescriptions.actions[0]! }],
    ['service', serviceConfig, { slug: 'reset', ros_name: '/reset', type: 'std_srvs/srv/Trigger', parameters: [] }],
    [
      'publisher',
      publisherConfig,
      {
        slug: 'drive',
        topic: '/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        parameters: [],
        timeout_ms: 500,
        failsafe: {},
        quiet_timeout_ms: 2000,
      },
    ],
    [
      'camera',
      cameraConfig,
      {
        slug: 'front',
        source: { kind: 'ros' as const, topic: '/image_raw', type: 'sensor_msgs/msg/Image' },
        width: 640,
        height: 480,
        fps: 10,
        bitrate_kbps: 800,
        snapshot_interval_ms: 1000,
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
    expect(datapointConfig.safeParse({ ...docWithoutDescriptions.datapoints[0]!, description: '' }).success).toBe(false)
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
    const schema = z.toJSONSchema(robotConfigDoc) as {
      properties: Record<string, { items?: { required?: string[] } }>
    }
    for (const kind of ['datapoints', 'actions', 'services', 'publishers', 'cameras']) {
      expect(schema.properties[kind]?.items?.required ?? []).not.toContain('description')
    }
  })
})

describe('the app-level MCP switch is gone (2026-08-29)', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    org_id: '00000000-0000-4000-8000-000000000002',
    name: 'Ops',
    identifier: 'ops',
    group_id: '00000000-0000-4000-8000-00000000000a',
    robot_ids: [],
    accepts_dynamic_clients: false,
    default_role_id: null,
    created_at: '2026-08-18T10:00:00.000Z',
  }

  /**
   * W7c gave an app an `mcp_enabled` switch for the per-app endpoint
   * `/mcp/<identifier>`. The central-MCP cut (D5) deleted that endpoint; the
   * field then gated nothing but one `resource` branch of the legacy OAuth
   * stub, and Andre removed it on 2026-08-29. What gates MCP now is
   * `orgGroup.mcp_enabled` x `orgUser.mcp_access` — a different field with a
   * live door behind it, deliberately not renamed here.
   *
   * These are removal guards, and each one names what would make it red: a
   * re-added field on `app` (first), or a re-added field on either request
   * shape (second).
   */
  it('is not a field on `app` — an app parses without it, and never grows one back', () => {
    const parsed = app.parse(base)
    expect(parsed).not.toHaveProperty('mcp_enabled')
    // `app` is not `.strict()`, so an old client still sending it gets it
    // stripped rather than a 400. Asserting on the PARSED object, not on
    // `safeParse().success`, is the difference between measuring "the field is
    // gone" and measuring "zod strips unknown keys", which it always does.
    expect(app.parse({ ...base, mcp_enabled: true })).not.toHaveProperty('mcp_enabled')
  })

  it('is refused by the two `.strict()` request shapes, which is the honest answer to a removed field', () => {
    const GROUP = '00000000-0000-4000-8000-00000000000a'
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', group_id: GROUP }).success).toBe(true)
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', group_id: GROUP, mcp_enabled: true }).success).toBe(false)
    expect(updateAppRequest.safeParse({ name: 'Ops' }).success).toBe(true)
    expect(updateAppRequest.safeParse({ mcp_enabled: false }).success).toBe(false)
  })
})

describe('tool naming', () => {
  it('speaks the revision the stable SDK ships', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-11-25')
  })

  /**
   * **The endpoint path takes no argument, and that is the assertion.** The
   * per-app `mcpEndpointPath(appIdentifier)` it replaced returned
   * `/mcp/<identifier>`, a route the cloud deleted in the identity redesign
   * (D5/D6) and which probes live to `404`. A constant cannot be handed an
   * app, so the deleted shape cannot be rebuilt by accident.
   */
  it('names the one central MCP path, unparameterised', () => {
    expect(MCP_ENDPOINT_PATH).toBe('/mcp')
    expect(Object.keys(contracts)).toContain('MCP_ENDPOINT_PATH')
    // The retired helper is gone from the public surface, not merely unused:
    // an export nobody imports today is an export somebody imports tomorrow.
    expect(Object.keys(contracts)).not.toContain('mcpEndpointPath')
  })

  /**
   * The names have to survive the longest legal slug, or the bound is
   * decorative. `slug` is bounded at 63; re-derived here rather than read.
   */
  it('a name built from the longest legal slug stays inside MCP bounds and charset', () => {
    const longest = 'a'.repeat(63)
    const name = mcpToolName(mcpRobotKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), longest)
    expect(name.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX)
    expect(name).toMatch(mcpToolNamePattern)
  })

  it('keys every robot distinctly, and splits back apart', () => {
    const ids = [
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
      'b1de7a55-0000-4000-8000-000000000000',
    ]
    const keys = mcpRobotKeys(ids)
    expect(new Set(keys.values()).size).toBe(3)
    expect(mcpToolName(keys.get(ids[0]!)!, 'dock').split('__')).toEqual([keys.get(ids[0]!), 'dock'])
  })

  /**
   * **The widening branch, exercised rather than asserted about.** Two ids
   * sharing their first twelve hex characters are what the 48-bit argument
   * says will not happen; a claim that cannot be tested is a claim nobody has
   * checked. Constructed deliberately, so the fallback runs.
   */
  it('widens every key together when two twelve-character prefixes collide', () => {
    const a = '3f2504e04f89-41d3-9a0c-0305e82c3301'.replace('3f2504e04f89', '3f2504e0-4f89')
    const collide = ['3f2504e0-4f89-41d3-9a0c-000000000001', '3f2504e0-4f89-41d3-9a0c-000000000002']
    const keys = mcpRobotKeys(collide)
    expect(new Set(keys.values()).size).toBe(2)
    // Widened: not the twelve-character form either of them would have had.
    expect(keys.get(collide[0]!)).not.toBe(mcpRobotKey(collide[0]!))
    expect(keys.get(collide[0]!)!.length).toBe(33)
    expect(a).toBeTruthy()
  })
})

describe('the console preview', () => {
  const tool = {
    name: 'r3f2504e04f89__dock',
    title: 'RX1 · dock',
    description: 'Drives the robot onto its charging dock and waits for contact.',
    robot_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    slug: 'dock',
    kind: 'action' as const,
    input_schema: { type: 'object', properties: {} },
  }

  it('carries the tool, its schema, and the omissions with their reasons', () => {
    const parsed = mcpToolPreviewResponse.parse({
      role_id: '00000000-0000-4000-8000-000000000009',
      tools: [tool],
      omitted: [
        {
          robot_id: tool.robot_id,
          slug: 'battery',
          reason: 'no_description',
          message: 'Grant is in place; the datapoint has no description, so no tool is generated.',
        },
      ],
    })
    expect(parsed.tools[0]!.name).toMatch(mcpToolNamePattern)
    expect(parsed.omitted[0]!.reason).toBe('no_description')
  })

  it('refuses a tool name a client would reject', () => {
    expect(mcpToolPreview.safeParse({ ...tool, name: 'RX1/dock' }).success).toBe(false)
  })

  it('every omission reason is a non-empty known string', () => {
    expect(MCP_OMISSION_REASONS.length).toBeGreaterThan(0)
    for (const r of MCP_OMISSION_REASONS) expect(r).toMatch(/^[a-z_]+$/)
  })
})

/**
 * **The two description bounds are related, and the relationship is the
 * invariant — not either number.** `serviceDescription` bounds what a human
 * writes; `mcpToolPreview.description` bounds what the generator produces from
 * it, which is that text plus folded-in unit, range and camera prose. Both
 * reviewers measured the overflow independently (2036–2068 against a 2000
 * bound), and the route returns its body without parsing, so the cloud served
 * a document its own contract rejected and nothing said a word.
 *
 * This test exists so the next person who notices "two different maxima, that
 * looks untidy" finds out why before making them equal.
 */
describe('the generated description has room to be generated in', () => {
  const humanMax = 2000
  const generated = mcpToolPreview.shape.description

  it('accepts a maximal human description plus what the generator appends', () => {
    const appended = ' Unit: %. Plausible range: 0 to 100.'
    expect(generated.safeParse('x'.repeat(humanMax) + appended).success).toBe(true)
  })

  it('still refuses something no generator could produce', () => {
    expect(generated.safeParse('x'.repeat(8000)).success).toBe(false)
  })

  /** The claim `serviceDescription` itself makes, re-derived rather than read. */
  it('the human bound really is the smaller of the two', () => {
    expect(serviceDescription.safeParse('x'.repeat(humanMax)).success).toBe(true)
    expect(serviceDescription.safeParse('x'.repeat(humanMax + 1)).success).toBe(false)
    expect(generated.safeParse('x'.repeat(humanMax + 1)).success).toBe(true)
  })
})

describe('error codes', () => {
  it('adds the two management-side codes and nothing for the MCP endpoint itself', () => {
    expect(ERROR_CODES).toContain('mcp_disabled')
    expect(ERROR_CODES).toContain('tool_not_available')
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('central MCP gating (D5)', () => {
  it('carries mcp_access_denied — the refusal a gated user meets at the central server', () => {
    // The group flag `mcp_enabled` × the per-user `mcp_access` override
    // decide MCP access (D5); when the answer is "no", the central MCP
    // server refuses with this code, at token issue AND on every request.
    // Produced by the cloud since 0.5.0 (`cloud/src/mcp-access.ts`), at both
    // enforcement points; this pins the code the two of them agree on.
    expect(ERROR_CODES).toContain('mcp_access_denied')
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
