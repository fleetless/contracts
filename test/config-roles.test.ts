// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { accessRule, accessSection, publishConfigResponse, robotConfigDoc } from '../src/index.js'

/**
 * `role` on the five kinds of entry, and the `access` section: what the format
 * accepts, what it refuses, and that it says why in words. The pattern, enum,
 * required-key and snippet sweeps in the neighbouring files cover these fields
 * too; this file is about the meaning of the values.
 */

const DATAPOINT = { topic: '/battery', type: 'sensor_msgs/msg/BatteryState' }
const ACTION = { ros_name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose' }
const SERVICE = { ros_name: '/arm/home', type: 'std_srvs/srv/Trigger' }
const PUBLISHER = {
  topic: '/cmd_vel',
  type: 'geometry_msgs/msg/Twist',
  message: { linear: { x: 0 } },
  quiet_timeout_ms: 2000,
  failsafe: { timeout_ms: 500, message: { linear: { x: 0 } } },
}
const CAMERA = { source: { kind: 'v4l2', device: '/dev/video0' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 }

const doc = (body: Record<string, unknown>) => ({ fleetless: 1, ...body })
const SECTIONS = {
  datapoints: DATAPOINT,
  actions: ACTION,
  services: SERVICE,
  publishers: PUBLISHER,
  cameras: CAMERA,
} as const

/** The issues a refused document raises, as `path: message`. */
function refusals(value: unknown): string[] {
  const parsed = robotConfigDoc.safeParse(value)
  if (parsed.success) throw new Error('expected this document to be refused')
  return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('role on an entry', () => {
  for (const [section, entry] of Object.entries(SECTIONS)) {
    it(`is optional on ${section}, one key or a list`, () => {
      expect(robotConfigDoc.safeParse(doc({ [section]: { thing: entry } })).success).toBe(true)
      expect(robotConfigDoc.safeParse(doc({ [section]: { thing: { ...entry, role: 'operate' } } })).success).toBe(true)
      expect(robotConfigDoc.safeParse(doc({ [section]: { thing: { ...entry, role: ['operate', 'admin'] } } })).success).toBe(true)
    })

    it(`refuses a bad key, an empty list and a non-string on ${section}`, () => {
      for (const role of ['Bad Key', ['operate', 'Bad Key'], [], 7, null, { key: 'operate' }, [['operate']]]) {
        expect(robotConfigDoc.safeParse(doc({ [section]: { thing: { ...entry, role } } })).success, JSON.stringify(role)).toBe(false)
      }
    })
  }

  it('keeps the value it was given, a string a string and a list a list', () => {
    const parsed = robotConfigDoc.parse(doc({ services: { one: { ...SERVICE, role: 'operate' }, many: { ...SERVICE, role: ['operate'] } } }))
    expect(parsed.services!.one!.role).toBe('operate')
    expect(parsed.services!.many!.role).toEqual(['operate'])
  })

  it('names the rule when a key is refused', () => {
    expect(refusals(doc({ services: { arm: { ...SERVICE, role: 'Bad Key' } } }))).toEqual([
      expect.stringMatching(/^services\.arm\.role: A role key is lower-case/),
    ])
    expect(refusals(doc({ services: { arm: { ...SERVICE, role: ['operate', 'Bad Key'] } } }))).toEqual([
      expect.stringMatching(/^services\.arm\.role\.1: A role key is lower-case/),
    ])
  })

  it('says what a role is when the value is neither a key nor a list', () => {
    expect(refusals(doc({ services: { arm: { ...SERVICE, role: 7 } } }))).toEqual([
      'services.arm.role: A role is one key, `operate`, or a list of keys, `[operate, admin]`.',
    ])
  })

  it('does not accept more than fifty keys in a list', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `r${i}`)
    expect(robotConfigDoc.safeParse(doc({ services: { arm: { ...SERVICE, role: fifty } } })).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc({ services: { arm: { ...SERVICE, role: [...fifty, 'r50'] } } })).success).toBe(false)
  })
})

describe('the access section', () => {
  const rule = { match: '/arm/**', role: 'admin' }

  it('is optional, and so is everything in it', () => {
    expect(robotConfigDoc.safeParse(doc({})).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc({ access: {} })).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc({ access: { rules: [] } })).success).toBe(true)
  })

  it('takes rules, assets and job_history', () => {
    const parsed = robotConfigDoc.safeParse(doc({
      access: {
        assets: 'observe',
        job_history: ['operate'],
        rules: [
          { match: '/arm/**', role: 'admin' },
          { match: '/diagnostics/*', kinds: ['read'], role: ['wartung', 'admin'] },
        ],
      },
    }))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.access?.rules).toHaveLength(2)
    expect(parsed.data.access?.rules?.[1]?.kinds).toEqual(['read'])
  })

  it('exports the two shapes by name', () => {
    expect(accessRule.safeParse(rule).success).toBe(true)
    expect(accessSection.safeParse({ rules: [rule] }).success).toBe(true)
    expect(accessRule.safeParse({ match: '/arm/**' }).success).toBe(false)
  })

  it('accepts at most one hundred rules', () => {
    const hundred = Array.from({ length: 100 }, () => rule)
    expect(robotConfigDoc.safeParse(doc({ access: { rules: hundred } })).success).toBe(true)
    expect(refusals(doc({ access: { rules: [...hundred, rule] } }))).toEqual(['access.rules: at most 100 rules'])
  })

  it.each([
    ['a key that is not a role key on assets', { assets: 'Bad Key' }],
    ['an empty list on job_history', { job_history: [] }],
    ['a kind that is not an entry kind', { rules: [{ ...rule, kinds: ['assets'] }] }],
    ['a kind of the old vocabulary', { rules: [{ ...rule, kinds: ['presence'] }] }],
    ['an empty list of kinds', { rules: [{ ...rule, kinds: [] }] }],
    ['a key the format does not know in a rule', { rules: [{ ...rule, extra: true }] }],
    ['a key the format does not know in access', { rules: [rule], presence: 'operate' }],
    ['a rule without a match', { rules: [{ role: 'admin' }] }],
    ['a rule without a role', { rules: [{ match: '/arm/**' }] }],
    ['a rule that is not an object', { rules: ['/arm/**'] }],
    ['rules as a map', { rules: { arm: rule } }],
    ['a role that is a key of a bad shape in a rule', { rules: [{ ...rule, role: 'Bad Key' }] }],
  ])('refuses %s', (_what, access) => {
    expect(robotConfigDoc.safeParse(doc({ access })).success).toBe(false)
  })

  it('names the rule of a match that is not absolute, the way a ROS name is refused', () => {
    const issues = refusals(doc({ access: { rules: [{ match: 'arm/**', role: 'admin' }] } }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^access\.rules\.0\.match: A match pattern is an absolute ROS graph name/)
    expect(issues[0]).not.toContain('^')
  })

  it('names the key that is missing from a rule', () => {
    expect(refusals(doc({ access: { rules: [{ role: 'admin' }] } }))).toContain('access.rules.0.match: Missing required key `match`.')
    expect(refusals(doc({ access: { rules: [{ match: '/arm/**' }] } }))).toContain('access.rules.0.role: Missing required key `role`.')
  })
})

describe('the match of a rule', () => {
  const accepts = (match: string) => accessRule.safeParse({ match, role: 'admin' }).success

  it.each([
    '/arm',
    '/arm/home',
    '/arm/**',
    '/diagnostics/*',
    '/joint_*',
    '/*_state',
    '/a*c',
    '/**',
    '/*',
    '/a/**/z',
    '/a/*/z',
    '/_private/**',
    '/arm/joint_1',
  ])('accepts %s', (match) => {
    expect(accepts(match)).toBe(true)
  })

  it.each([
    ['arm/**', 'relative'],
    ['**', 'relative'],
    ['*', 'relative'],
    ['', 'empty'],
    ['/', 'no segment at all'],
    ['/arm/', 'trailing slash'],
    ['/arm//home', 'empty segment'],
    ['/a**b', '** inside a longer segment'],
    ['/a/***', 'three stars'],
    ['/a/**b', '** at the start of a segment'],
    ['/a-b', 'dash'],
    ['/a.b', 'dot'],
    ['/9lives', 'segment starting with a digit'],
    ['/arm home', 'space'],
    ['/' + 'a'.repeat(256), 'longer than a ROS name'],
  ])('refuses %s (%s)', (match) => {
    expect(accepts(match)).toBe(false)
  })
})

describe('the snippets the editor offers', () => {
  const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>
  const access = schema.properties.access

  /** The editor's own syntax undone, as `config-snippets.test.ts` does it. */
  function fill(node: unknown): unknown {
    if (typeof node === 'string') return node.replace(/\$\{\d+:([^}]*)\}/g, '$1')
    if (Array.isArray(node)) return node.map(fill)
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]))
    return node
  }

  it('offers a skeleton at access, at rules and at every role', () => {
    expect(access.defaultSnippets.length).toBeGreaterThan(0)
    expect(access.properties.rules.defaultSnippets.length).toBeGreaterThan(0)
    for (const section of Object.keys(SECTIONS)) {
      const role = schema.properties[section].additionalProperties.properties.role
      expect(role.defaultSnippets?.length, `${section} role`).toBeGreaterThan(0)
    }
    expect(access.properties.rules.items.properties.role.defaultSnippets.length).toBeGreaterThan(0)
    expect(access.properties.assets.defaultSnippets.length).toBeGreaterThan(0)
    expect(access.properties.job_history.defaultSnippets.length).toBeGreaterThan(0)
  })

  it('are authored from values the format accepts', () => {
    for (const snippet of access.defaultSnippets) {
      expect(robotConfigDoc.safeParse(doc({ access: fill(snippet.body) })).success, snippet.label).toBe(true)
    }
    for (const snippet of access.properties.rules.defaultSnippets) {
      expect(robotConfigDoc.safeParse(doc({ access: { rules: fill(snippet.body) } })).success, snippet.label).toBe(true)
    }
    for (const snippet of access.properties.assets.defaultSnippets) {
      expect(robotConfigDoc.safeParse(doc({ access: { assets: fill(snippet.body) } })).success, snippet.label).toBe(true)
    }
    for (const [section, entry] of Object.entries(SECTIONS)) {
      for (const snippet of schema.properties[section].additionalProperties.properties.role.defaultSnippets) {
        expect(robotConfigDoc.safeParse(doc({ [section]: { thing: { ...entry, role: fill(snippet.body) } } })).success, `${section}: ${snippet.label}`).toBe(true)
      }
    }
  })

  it('describes the fields, and spells the rule of a match once', () => {
    const rule = access.properties.rules.items
    for (const key of ['match', 'kinds', 'role']) expect(rule.properties[key].description, key).toEqual(expect.any(String))
    expect(rule.properties.match.patternErrorMessage).toMatch(/^A match pattern is an absolute ROS graph name/)
    expect(rule.properties.kinds.items.enumDescriptions).toHaveLength(3)
    expect(rule.properties.kinds.items.enum).toEqual(['read', 'invoke', 'publish'])
  })
})

describe('publishing answers its warnings', () => {
  const answer = { version: 3, published_at: '2026-11-05T09:00:00.000Z' }
  const warning = { path: 'services.arm_home.role', slug: 'arm_home', code: 'unknown_role', message: 'services.arm_home names `technik`, which is no role of this organization.', severity: 'warning' }

  it('carries the warnings of the published document, none included', () => {
    expect(publishConfigResponse.safeParse({ ...answer, warnings: [] }).success).toBe(true)
    expect(publishConfigResponse.parse({ ...answer, warnings: [warning] }).warnings).toEqual([warning])
  })

  it('does not leave warnings unsaid', () => {
    expect(publishConfigResponse.safeParse(answer).success).toBe(false)
    expect(publishConfigResponse.safeParse({ ...answer, warnings: [{ ...warning, severity: 'fatal' }] }).success).toBe(false)
    expect(publishConfigResponse.safeParse({ ...answer, warnings: warning }).success).toBe(false)
  })
})
