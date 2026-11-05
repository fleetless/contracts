// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_KINDS,
  ENTRY_KINDS,
  MAX_ORG_ROLES,
  ROLE_KEY_PATTERN,
  ROLE_NAME_MAX,
  SEED_DEFAULTS,
  SEED_ROLES,
  accessKind,
  collectRoleRefs,
  findCycle,
  listExposures,
  matchRosGlob,
  requirementOf,
  robotConfigDoc,
  roleClosure,
  roleIssues,
  roleKey,
  roleRef,
  roleSatisfies,
  validationIssue,
} from '../src/index.js'
import type { ExposureSection, RobotConfigDoc, RoleDefaults, RoleGraph, RoleRef, RoleRefUse } from '../src/index.js'

/** A role graph from `{ key: [parents] }`; the display name is not under test. */
const graphOf = (edges: Record<string, string[]>): RoleGraph =>
  new Map(Object.entries(edges).map(([key, inherits]) => [key, { name: key, inherits }]))

const SEEDED = graphOf({ observe: [], operate: ['observe'], admin: ['operate'] })

describe('role keys', () => {
  it.each([
    ['operate', true],
    ['night_shift', true],
    ['a', true],
    ['r2d2', true],
    ['a'.repeat(63), true],
    ['a'.repeat(64), false],
    ['Operate', false],
    ['2fast', false],
    ['_hidden', false],
    ['night-shift', false],
    ['night shift', false],
    ['', false],
    // `defaults` is the path of the organization's defaults, so no role may have it as its key.
    ['defaults', false],
    ['default', true],
    ['defaultsx', true],
    ['defaults_2', true],
    ['my_defaults', true],
  ])('%j is %s', (key, ok) => {
    expect(ROLE_KEY_PATTERN.test(key)).toBe(ok)
    expect(roleKey.safeParse(key).success).toBe(ok)
  })

  it('names the rule in words when it refuses one', () => {
    const refused = roleKey.safeParse('Bad Key')
    expect(refused.success).toBe(false)
    if (refused.success) return
    expect(refused.error.issues[0]!.message).toContain('lower-case')
    expect(refused.error.issues[0]!.message).not.toContain('^[a-z]')
  })

  it('says that `defaults` is reserved when it refuses it', () => {
    const refused = roleKey.safeParse('defaults')
    expect(refused.success).toBe(false)
    if (refused.success) return
    expect(refused.error.issues[0]!.message).toContain('`defaults` is reserved')
    expect(roleRef.safeParse('defaults').success).toBe(false)
    expect(roleRef.safeParse(['operate', 'defaults']).success).toBe(false)
  })

  it('takes one key or a non-empty list of at most fifty', () => {
    expect(roleRef.safeParse('operate').success).toBe(true)
    expect(roleRef.safeParse(['operate', 'admin']).success).toBe(true)
    expect(roleRef.safeParse([]).success).toBe(false)
    expect(roleRef.safeParse(Array.from({ length: MAX_ORG_ROLES }, (_, i) => `r${i}`)).success).toBe(true)
    expect(roleRef.safeParse(Array.from({ length: MAX_ORG_ROLES + 1 }, (_, i) => `r${i}`)).success).toBe(false)
    expect(roleRef.safeParse(['operate', 'Bad']).success).toBe(false)
    expect(roleRef.safeParse(7).success).toBe(false)
    expect(roleRef.safeParse(null).success).toBe(false)
  })
})

describe('the retired per-app role vocabulary', () => {
  // The old capability name, the id-based default role and the per-role permission shapes are gone from the
  // package without an alias; a source file that names one again is a regression however it got there.
  const RETIRED = ['action_history', 'default_role_id', 'rolePermissions']
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const sources = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(30)
  })

  it('is named by no file under src', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const word of RETIRED) expect(text.includes(word), `${file} names ${word}`).toBe(false)
    }
  })
})

describe('kinds and the seed', () => {
  it('names the five kinds of access and the three an entry has', () => {
    expect([...ACCESS_KINDS]).toEqual(['read', 'invoke', 'publish', 'assets', 'job_history'])
    expect([...ENTRY_KINDS]).toEqual(['read', 'invoke', 'publish'])
    expect(accessKind.safeParse('job_history').success).toBe(true)
    expect(accessKind.safeParse('presence').success).toBe(false)
  })

  it('limits an organization to fifty roles with names of at most sixty characters', () => {
    expect(MAX_ORG_ROLES).toBe(50)
    expect(ROLE_NAME_MAX).toBe(60)
  })

  it('seeds observe, operate and admin, each inheriting the one before', () => {
    expect(SEED_ROLES).toEqual([
      { key: 'observe', name: 'Observe', inherits: [] },
      { key: 'operate', name: 'Operate', inherits: ['observe'] },
      { key: 'admin', name: 'Admin', inherits: ['operate'] },
    ])
  })

  it('seeds the defaults of the design table', () => {
    expect(SEED_DEFAULTS).toEqual({
      read: ['observe'],
      invoke: ['operate'],
      publish: ['operate'],
      assets: ['observe'],
      job_history: ['operate'],
    })
    // The defaults only name seeded roles; a seed that pointed at nothing would be a warning on day one.
    const seeded = new Set(SEED_ROLES.map((r) => r.key))
    for (const keys of Object.values(SEED_DEFAULTS)) for (const key of keys) expect(seeded.has(key)).toBe(true)
  })
})

/** The ROS name `listExposures` reports for one entry of a section; the entry is not run through the schema, so a malformed one can be tried. */
const rosNameOfEntry = (section: ExposureSection, entry: unknown): string | null =>
  listExposures({ fleetless: 1, [section]: { probe: entry } } as unknown as RobotConfigDoc)[0]?.rosName ?? null

describe('the ROS name of an entry', () => {
  it.each([
    ['datapoints', { topic: '/battery_state' }, '/battery_state'],
    ['publishers', { topic: '/cmd_vel' }, '/cmd_vel'],
    ['services', { ros_name: '/arm/home' }, '/arm/home'],
    ['actions', { ros_name: '/navigate_to_pose' }, '/navigate_to_pose'],
    ['cameras', { source: { kind: 'ros', topic: '/camera/image_raw' } }, '/camera/image_raw'],
    ['cameras', { source: { kind: 'rtsp', url: 'rtsp://cam/stream' } }, null],
    ['cameras', { source: { kind: 'v4l2', device: '/dev/video0' } }, null],
    ['cameras', { source: { kind: 'mjpeg', url: 'http://cam/video.mjpg' } }, null],
    ['cameras', {}, null],
    ['datapoints', {}, null],
    ['datapoints', null, null],
    ['services', 'nonsense', null],
  ] as const)('%s %j gives %j', (section, entry, expected) => {
    expect(rosNameOfEntry(section, entry)).toBe(expected)
  })
})

describe('matchRosGlob', () => {
  it.each([
    ['/arm/**', '/arm', true],
    ['/arm/**', '/arm/home', true],
    ['/arm/**', '/arm/a/b', true],
    ['/arm/**', '/armature', false],
    ['/diagnostics/*', '/diagnostics/raw', true],
    ['/diagnostics/*', '/diagnostics/a/b', false],
    ['/diagnostics/*', '/diagnostics', false],
    ['/**', '/x/y', true],
    ['/**', '/x', true],
    ['/a/**/z', '/a/z', true],
    ['/a/**/z', '/a/x/y/z', true],
    ['/a/**/z', '/a/x/y', false],
    ['/joint_*', '/joint_1', true],
    ['/joint_*', '/joint_1/x', false],
    ['/joint_*', '/joints', false],
    ['/arm/park', '/arm/park', true],
    ['/arm/park', '/arm/park/x', false],
    ['/arm/*/home', '/arm/left/home', true],
    ['/arm/*/home', '/arm/home', false],
    ['/*', '/x', true],
    ['/*', '/x/y', false],
    ['/*_state', '/battery_state', true],
    ['/*_state', '/battery_state/raw', false],
    ['/a*c', '/abc', true],
    ['/a*c', '/ac', true],
    ['/a*c', '/abd', false],
    ['arm/**', '/arm/x', false],
    ['/arm/**', 'arm/x', false],
    ['/arm/', '/arm', false],
    ['/arm/**', '', false],
  ])('%s against %s is %s', (pattern, name, expected) => {
    expect(matchRosGlob(pattern, name)).toBe(expected)
  })

  it('stays fast on a pattern built to make a naive matcher backtrack', () => {
    const pattern = `/${Array.from({ length: 20 }, () => '**').join('/')}/z`
    const name = `/${Array.from({ length: 40 }, () => 'a').join('/')}`
    const started = Date.now()
    expect(matchRosGlob(pattern, name)).toBe(false)
    // A backtracking matcher would not finish in any reasonable time on this input, so the bound only has to be generous.
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('roleClosure', () => {
  const graph = graphOf({ observe: [], operate: ['observe'], maintenance: ['observe'], admin: ['operate', 'maintenance', 'gone'] })

  it('is the role and everything it inherits from that exists', () => {
    expect(roleClosure(graph, 'admin').sort()).toEqual(['admin', 'maintenance', 'observe', 'operate'])
    expect(roleClosure(graph, 'observe')).toEqual(['observe'])
  })

  it('is empty for a key that is no role', () => {
    expect(roleClosure(graph, 'nope')).toEqual([])
    expect(roleClosure(graph, 'gone')).toEqual([])
  })

  it('ends on a cycle and names each role once', () => {
    const cyclic = graphOf({ a: ['b'], b: ['c'], c: ['a'] })
    expect(roleClosure(cyclic, 'a').sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('roleSatisfies', () => {
  const graph = graphOf({
    observe: [],
    operate: ['observe'],
    maintenance: ['observe'],
    admin: ['operate', 'maintenance'],
    d1: [],
    d2: ['d1'],
    d3: ['d2'],
    d4: ['d3'],
  })

  it('is met by the role itself, with no via', () => {
    expect(roleSatisfies(graph, 'operate', ['operate'])).toEqual({ satisfied: true, via: null, unknown: [] })
  })

  it('is met through any parent of a role that has several', () => {
    expect(roleSatisfies(graph, 'admin', ['maintenance'])).toEqual({ satisfied: true, via: 'maintenance', unknown: [] })
    expect(roleSatisfies(graph, 'admin', ['operate'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
  })

  it('is met through three levels of inheritance', () => {
    expect(roleSatisfies(graph, 'd4', ['d1'])).toEqual({ satisfied: true, via: 'd1', unknown: [] })
  })

  it('is not met upwards: a parent does not hold what its child is given', () => {
    expect(roleSatisfies(graph, 'observe', ['operate'])).toEqual({ satisfied: false, via: null, unknown: [] })
  })

  it('is met by any one of a list, and reports the nearest ancestor that was, whatever the list order', () => {
    // Closure order from admin is admin, operate, maintenance, observe: operate comes first although the list names maintenance first.
    expect(roleSatisfies(graph, 'admin', ['d1', 'maintenance', 'operate'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
    expect(roleSatisfies(graph, 'admin', ['operate', 'maintenance'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
    expect(roleSatisfies(graph, 'admin', ['maintenance', 'operate'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
    // A parent is nearer than its own parent, even when the list names the grandparent first.
    expect(roleSatisfies(graph, 'admin', ['observe', 'operate'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
  })

  it('has no via when the held role is itself in the list', () => {
    expect(roleSatisfies(graph, 'admin', ['operate', 'admin'])).toEqual({ satisfied: true, via: null, unknown: [] })
    expect(roleSatisfies(graph, 'admin', ['admin', 'operate'])).toEqual({ satisfied: true, via: null, unknown: [] })
  })

  it('is never met by a held role that is unknown or absent', () => {
    expect(roleSatisfies(graph, 'nope', ['observe'])).toEqual({ satisfied: false, via: null, unknown: [] })
    expect(roleSatisfies(graph, null, ['observe'])).toEqual({ satisfied: false, via: null, unknown: [] })
    // The key is the very one that is required, and still no role.
    expect(roleSatisfies(graph, 'nope', ['nope'])).toEqual({ satisfied: false, via: null, unknown: ['nope'] })
  })

  it('skips a required key that is no role, and says which', () => {
    expect(roleSatisfies(graph, 'admin', ['nope', 'operate'])).toEqual({ satisfied: true, via: 'operate', unknown: ['nope'] })
    expect(roleSatisfies(graph, 'admin', ['nope'])).toEqual({ satisfied: false, via: null, unknown: ['nope'] })
  })

  it('is never met by an empty requirement', () => {
    expect(roleSatisfies(graph, 'admin', [])).toEqual({ satisfied: false, via: null, unknown: [] })
  })

  it('keeps the parents that remain when one was deleted', () => {
    const wounded = graphOf({ observe: [], operate: ['observe'], admin: ['operate', 'maintenance'] })
    expect(roleSatisfies(wounded, 'admin', ['operate'])).toEqual({ satisfied: true, via: 'operate', unknown: [] })
    expect(roleSatisfies(wounded, 'admin', ['maintenance'])).toEqual({ satisfied: false, via: null, unknown: ['maintenance'] })
  })

  it('terminates on a cycle in the graph', () => {
    const cyclic = graphOf({ a: ['b'], b: ['a'] })
    expect(roleSatisfies(cyclic, 'a', ['b'])).toEqual({ satisfied: true, via: 'b', unknown: [] })
    expect(roleSatisfies(cyclic, 'a', ['c'])).toEqual({ satisfied: false, via: null, unknown: ['c'] })
  })
})

describe('findCycle', () => {
  it('finds a role that is its own parent', () => {
    expect(findCycle(graphOf({ a: [] }), 'a', ['a'])).toEqual(['a', 'a'])
  })

  it('finds a direct cycle', () => {
    expect(findCycle(graphOf({ a: [], b: ['a'] }), 'a', ['b'])).toEqual(['a', 'b', 'a'])
  })

  it('finds a cycle through three roles', () => {
    const graph = graphOf({ a: [], b: ['a'], c: ['b'], d: ['c'] })
    expect(findCycle(graph, 'a', ['d'])).toEqual(['a', 'd', 'c', 'b', 'a'])
  })

  it('finds the cycle a new role would close through a parent that already points at it', () => {
    // `x` names `fresh`, which does not exist yet; creating `fresh` below `x` closes the loop.
    expect(findCycle(graphOf({ x: ['fresh'] }), 'fresh', ['x'])).toEqual(['fresh', 'x', 'fresh'])
  })

  it('is null when there is none', () => {
    expect(findCycle(SEEDED, 'observe', [])).toBeNull()
    expect(findCycle(SEEDED, 'admin', ['observe', 'operate'])).toBeNull()
    expect(findCycle(graphOf({ a: [] }), 'fresh', ['a', 'nowhere'])).toBeNull()
  })

  it('judges the edit, not the graph as it stands', () => {
    // `a` inherits `b` today; replacing that edit with none opens no cycle, keeping it with `b` pointing back does.
    const graph = graphOf({ a: ['b'], b: ['a'] })
    expect(findCycle(graph, 'a', [])).toBeNull()
    expect(findCycle(graph, 'a', ['b'])).toEqual(['a', 'b', 'a'])
  })

  it('ignores a cycle that does not run through the role being edited', () => {
    const graph = graphOf({ a: [], b: ['c'], c: ['b'] })
    expect(findCycle(graph, 'a', ['b'])).toBeNull()
  })
})

/** A document touching every kind, built through the schema so the fixture is one the format accepts. */
const DOC = robotConfigDoc.parse({
  fleetless: 1,
  datapoints: {
    battery: { topic: '/battery_state', type: 'sensor_msgs/msg/BatteryState' },
    raw_diagnostics: { topic: '/diagnostics/raw', type: 'diagnostic_msgs/msg/DiagnosticArray', role: 'maintenance' },
    diag_summary: { topic: '/diagnostics/summary', type: 'diagnostic_msgs/msg/DiagnosticStatus' },
  },
  actions: {
    navigate: { ros_name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose' },
    arm_pick: { ros_name: '/arm/pick', type: 'example_msgs/action/Pick' },
  },
  services: {
    arm_home: { ros_name: '/arm/home', type: 'std_srvs/srv/Trigger', role: ['admin'] },
    reset: { ros_name: '/reset_odometry', type: 'std_srvs/srv/Trigger' },
    arm_status: { ros_name: '/arm/status', type: 'std_srvs/srv/Trigger' },
  },
  publishers: {
    drive: {
      topic: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      message: { linear: { x: 0 } },
      quiet_timeout_ms: 2000,
      failsafe: { timeout_ms: 500, message: { linear: { x: 0 } } },
    },
  },
  cameras: {
    front: { source: { kind: 'ros', topic: '/camera/front', type: 'sensor_msgs/msg/Image' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 },
    mast: { source: { kind: 'rtsp', url: 'rtsp://cam-1.plant.local/stream1' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 },
  },
  access: {
    assets: 'operate',
    rules: [
      { match: '/arm/**', kinds: ['invoke'], role: 'admin' },
      { match: '/diagnostics/*', role: ['maintenance', 'admin'] },
      { match: '/**', kinds: ['read'], role: 'operate' },
    ],
  },
})

const DEFAULTS: RoleDefaults = { read: ['observe'], invoke: ['operate'], publish: ['operate'], assets: ['observe'], job_history: ['operate'] }

describe('listExposures', () => {
  it('lists every entry section by section with its kind and ROS name', () => {
    expect(listExposures(DOC)).toEqual([
      { slug: 'battery', section: 'datapoints', kind: 'read', rosName: '/battery_state' },
      { slug: 'raw_diagnostics', section: 'datapoints', kind: 'read', rosName: '/diagnostics/raw' },
      { slug: 'diag_summary', section: 'datapoints', kind: 'read', rosName: '/diagnostics/summary' },
      { slug: 'navigate', section: 'actions', kind: 'invoke', rosName: '/navigate_to_pose' },
      { slug: 'arm_pick', section: 'actions', kind: 'invoke', rosName: '/arm/pick' },
      { slug: 'arm_home', section: 'services', kind: 'invoke', rosName: '/arm/home' },
      { slug: 'reset', section: 'services', kind: 'invoke', rosName: '/reset_odometry' },
      { slug: 'arm_status', section: 'services', kind: 'invoke', rosName: '/arm/status' },
      { slug: 'drive', section: 'publishers', kind: 'publish', rosName: '/cmd_vel' },
      { slug: 'front', section: 'cameras', kind: 'read', rosName: '/camera/front' },
      { slug: 'mast', section: 'cameras', kind: 'read', rosName: null },
    ])
  })

  it('does not list the built-in datapoints, which are no entry of the document', () => {
    const slugs = listExposures(DOC).map((e) => e.slug)
    expect(slugs).not.toContain('bridge_state')
    expect(slugs).not.toContain('robot_details')
  })

  it('lists nothing for no document, or for one with no sections', () => {
    expect(listExposures(null)).toEqual([])
    expect(listExposures(robotConfigDoc.parse({ fleetless: 1 }))).toEqual([])
  })
})

describe('requirementOf an entry', () => {
  const req = (slug: string, doc = DOC, defaults = DEFAULTS) => requirementOf(doc, defaults, { slug })

  it('takes the role of the entry first, a single key as a one-element list', () => {
    expect(req('raw_diagnostics')).toEqual({ roles: ['maintenance'], source: { kind: 'entry' } })
  })

  it('takes a list on the entry as it is', () => {
    expect(req('arm_home')).toEqual({ roles: ['admin'], source: { kind: 'entry' } })
    const several = robotConfigDoc.parse({ fleetless: 1, services: { reset: { ros_name: '/r', type: 'std_srvs/srv/Trigger', role: ['operate', 'maintenance'] } } })
    expect(requirementOf(several, DEFAULTS, { slug: 'reset' })).toEqual({ roles: ['operate', 'maintenance'], source: { kind: 'entry' } })
  })

  it('lets the entry override a rule that would fit it', () => {
    // `/diagnostics/*` fits `raw_diagnostics`, but its own role wins.
    expect(req('raw_diagnostics')!.source).toEqual({ kind: 'entry' })
  })

  it('takes the first rule that fits, in the order written', () => {
    // `/diagnostics/summary` fits rule 1 (`/diagnostics/*`) and rule 2 (`/**`, read); rule 1 is earlier.
    expect(req('diag_summary')).toEqual({ roles: ['maintenance', 'admin'], source: { kind: 'rule', index: 1, match: '/diagnostics/*' } })
  })

  it('honours the kinds of a rule', () => {
    // Rule 0 is `invoke` only: it fits the arm service and the arm action, not an arm datapoint.
    expect(req('arm_status')).toEqual({ roles: ['admin'], source: { kind: 'rule', index: 0, match: '/arm/**' } })
    expect(req('arm_pick')).toEqual({ roles: ['admin'], source: { kind: 'rule', index: 0, match: '/arm/**' } })
    const datapointUnderArm = robotConfigDoc.parse({
      fleetless: 1,
      datapoints: { arm_temp: { topic: '/arm/temperature', type: 'sensor_msgs/msg/Temperature' } },
      access: { rules: [{ match: '/arm/**', kinds: ['invoke'], role: 'admin' }] },
    })
    expect(requirementOf(datapointUnderArm, DEFAULTS, { slug: 'arm_temp' })).toEqual({ roles: ['observe'], source: { kind: 'org_default' } })
  })

  it('lets a later, wider rule apply where an earlier one does not fit', () => {
    expect(req('battery')).toEqual({ roles: ['operate'], source: { kind: 'rule', index: 2, match: '/**' } })
  })

  it('falls back to the default of the kind when nothing else fits', () => {
    expect(req('reset')).toEqual({ roles: ['operate'], source: { kind: 'org_default' } })
    expect(req('drive')).toEqual({ roles: ['operate'], source: { kind: 'org_default' } })
    expect(req('navigate')).toEqual({ roles: ['operate'], source: { kind: 'org_default' } })
  })

  it('asks for nobody when the kind has no default', () => {
    expect(req('reset', DOC, {})).toEqual({ roles: [], source: { kind: 'org_default' } })
    expect(req('drive', DOC, { invoke: ['operate'] })).toEqual({ roles: [], source: { kind: 'org_default' } })
    expect(req('reset', DOC, { invoke: [] })).toEqual({ roles: [], source: { kind: 'org_default' } })
  })

  it('never matches a camera that is not a ROS topic against a rule', () => {
    // `/**` for `read` would fit any camera with a ROS name; the RTSP one has none.
    expect(req('mast')).toEqual({ roles: ['observe'], source: { kind: 'org_default' } })
    expect(req('front')).toEqual({ roles: ['operate'], source: { kind: 'rule', index: 2, match: '/**' } })
  })

  it('answers null for a slug the document does not have', () => {
    expect(req('nope')).toBeNull()
    expect(req('bridge_state')).toBeNull()
    expect(req('constructor')).toBeNull()
    expect(req('__proto__')).toBeNull()
    expect(req('hasOwnProperty')).toBeNull()
  })

  it('looks an entry up by its key and does not list the section to find it', () => {
    // Asked once per exposure of a robot, a scan makes a document with thousands of entries quadratic in them.
    let listed = 0
    const datapoints = new Proxy(
      { slot_1: { topic: '/slot/1', type: 'std_msgs/msg/Float32', role: 'operate' }, slot_2: { topic: '/slot/2', type: 'std_msgs/msg/Float32' } },
      { ownKeys(target) { listed += 1; return Reflect.ownKeys(target) } },
    )
    const doc = { fleetless: 1, datapoints } as unknown as RobotConfigDoc
    expect(requirementOf(doc, DEFAULTS, { slug: 'slot_1' })).toEqual({ roles: ['operate'], source: { kind: 'entry' } })
    expect(requirementOf(doc, DEFAULTS, { slug: 'slot_2' })).toEqual({ roles: ['observe'], source: { kind: 'org_default' } })
    expect(requirementOf(doc, DEFAULTS, { slug: 'slot_3' })).toBeNull()
    expect(listed).toBe(0)
  })

  it('answers null for every slug when there is no document', () => {
    expect(requirementOf(null, DEFAULTS, { slug: 'battery' })).toBeNull()
  })
})

describe('requirementOf a capability', () => {
  it('takes the robot-level key over the default', () => {
    expect(requirementOf(DOC, DEFAULTS, { capability: 'assets' })).toEqual({ roles: ['operate'], source: { kind: 'robot' } })
  })

  it('takes the default when the document does not say', () => {
    expect(requirementOf(DOC, DEFAULTS, { capability: 'job_history' })).toEqual({ roles: ['operate'], source: { kind: 'org_default' } })
  })

  it('takes a list at the robot level as it is', () => {
    const doc = robotConfigDoc.parse({ fleetless: 1, access: { job_history: ['operate', 'maintenance'] } })
    expect(requirementOf(doc, DEFAULTS, { capability: 'job_history' })).toEqual({ roles: ['operate', 'maintenance'], source: { kind: 'robot' } })
  })

  it('asks for nobody when there is neither a key nor a default', () => {
    expect(requirementOf(DOC, {}, { capability: 'job_history' })).toEqual({ roles: [], source: { kind: 'org_default' } })
  })

  it('follows the defaults alone when nothing is published', () => {
    expect(requirementOf(null, DEFAULTS, { capability: 'assets' })).toEqual({ roles: ['observe'], source: { kind: 'org_default' } })
    expect(requirementOf(null, DEFAULTS, { capability: 'job_history' })).toEqual({ roles: ['operate'], source: { kind: 'org_default' } })
    expect(requirementOf(null, {}, { capability: 'assets' })).toEqual({ roles: [], source: { kind: 'org_default' } })
  })

  it('does not hand out the defaults it was given to a caller who changes the answer', () => {
    const defaults: RoleDefaults = { assets: ['observe'] }
    const answer = requirementOf(null, defaults, { capability: 'assets' })!
    answer.roles.push('extra')
    expect(defaults.assets).toEqual(['observe'])
  })
})

describe('collectRoleRefs', () => {
  it('names its result type apart from the type of a role field', () => {
    // `RoleRef` is what a `role` field holds (one key or a list); `RoleRefUse` is one place a key is named.
    const field: RoleRef[] = ['operate', ['operate', 'admin']]
    const use: RoleRefUse = collectRoleRefs(DOC)[0]!
    expect(field.every((f) => roleRef.safeParse(f).success)).toBe(true)
    expect(use).toEqual({ key: 'maintenance', path: 'datapoints.raw_diagnostics.role', slug: 'raw_diagnostics' })
  })

  it('finds every key the document names, each with its path', () => {
    expect(collectRoleRefs(DOC)).toEqual([
      { key: 'maintenance', path: 'datapoints.raw_diagnostics.role', slug: 'raw_diagnostics' },
      { key: 'admin', path: 'services.arm_home.role[0]', slug: 'arm_home' },
      { key: 'admin', path: 'access.rules[0].role', slug: null },
      { key: 'maintenance', path: 'access.rules[1].role[0]', slug: null },
      { key: 'admin', path: 'access.rules[1].role[1]', slug: null },
      { key: 'operate', path: 'access.rules[2].role', slug: null },
      { key: 'operate', path: 'access.assets', slug: null },
    ])
  })

  it('reads access.job_history as well', () => {
    const doc = robotConfigDoc.parse({ fleetless: 1, access: { job_history: 'maintenance' } })
    expect(collectRoleRefs(doc)).toEqual([{ key: 'maintenance', path: 'access.job_history', slug: null }])
  })

  it('finds nothing in a document without roles, or in no document', () => {
    expect(collectRoleRefs(robotConfigDoc.parse({ fleetless: 1 }))).toEqual([])
    expect(collectRoleRefs(null)).toEqual([])
  })
})

describe('roleIssues', () => {
  const known = graphOf({ observe: [], operate: ['observe'], admin: ['operate'], maintenance: ['observe'] })
  const doc = (body: Record<string, unknown>) => robotConfigDoc.parse({ fleetless: 1, ...body })
  const SERVICE = { ros_name: '/arm/home', type: 'std_srvs/srv/Trigger' }

  it('says nothing about a document whose roles all exist, through inheritance or not', () => {
    expect(roleIssues(DOC, known)).toEqual([])
  })

  it('says nothing about no document', () => {
    expect(roleIssues(null, new Map())).toEqual([])
  })

  it('warns about an unknown role on an entry, in the sentence of the design', () => {
    const issues = roleIssues(doc({ services: { arm_home: { ...SERVICE, role: 'technik' } } }), known)
    expect(issues).toEqual([{
      path: 'services.arm_home.role',
      slug: 'arm_home',
      code: 'unknown_role',
      message: 'services.arm_home names `technik`, which is no role of this organization.',
      severity: 'warning',
    }])
  })

  it('warns once per unknown key of a list, at the key', () => {
    const issues = roleIssues(doc({ services: { arm_home: { ...SERVICE, role: ['operate', 'technik', 'montage'] } } }), known)
    expect(issues.map((i) => [i.code, i.path, i.slug])).toEqual([
      ['unknown_role', 'services.arm_home.role[1]', 'arm_home'],
      ['unknown_role', 'services.arm_home.role[2]', 'arm_home'],
    ])
    expect(issues[0]!.message).toBe('services.arm_home names `technik`, which is no role of this organization.')
    expect(issues[1]!.message).toBe('services.arm_home names `montage`, which is no role of this organization.')
  })

  it('warns about an unknown role in a rule, naming the rule by its place', () => {
    const issues = roleIssues(doc({
      services: { arm_home: SERVICE },
      access: { rules: [{ match: '/arm/**', role: 'operate' }, { match: '/arm/**', role: ['technik'] }] },
    }), known)
    expect(issues).toEqual([{
      path: 'access.rules[1].role[0]',
      slug: null,
      code: 'unknown_role',
      message: 'access.rules[1] names `technik`, which is no role of this organization.',
      severity: 'warning',
    }])
  })

  it('warns about an unknown role on access.assets and access.job_history', () => {
    const issues = roleIssues(doc({ access: { assets: 'technik', job_history: ['operate', 'montage'] } }), known)
    expect(issues).toEqual([
      { path: 'access.assets', slug: null, code: 'unknown_role', message: 'access.assets names `technik`, which is no role of this organization.', severity: 'warning' },
      { path: 'access.job_history[1]', slug: null, code: 'unknown_role', message: 'access.job_history names `montage`, which is no role of this organization.', severity: 'warning' },
    ])
  })

  it('warns about every key when the organization has no roles at all', () => {
    const issues = roleIssues(DOC, new Map())
    expect(issues.filter((i) => i.code === 'unknown_role')).toHaveLength(collectRoleRefs(DOC).length)
  })

  it('warns about a rule that fits no entry, counting rules from one in the sentence', () => {
    const issues = roleIssues(doc({
      services: { arm_home: SERVICE },
      access: { rules: [{ match: '/arm/**', role: 'operate' }, { match: '/nothing/**', role: 'operate' }] },
    }), known)
    expect(issues).toEqual([{
      path: 'access.rules[1].match',
      slug: null,
      code: 'rule_matches_nothing',
      message: 'Rule 2 matches nothing, so it changes nothing.',
      severity: 'warning',
    }])
  })

  it('does not warn about a rule that fits an existing service', () => {
    expect(roleIssues(doc({ services: { arm_home: SERVICE }, access: { rules: [{ match: '/arm/**', role: 'operate' }] } }), known)).toEqual([])
  })

  it('counts a rule as matching nothing when its kinds exclude everything it would fit', () => {
    const issues = roleIssues(doc({
      datapoints: { battery: { topic: '/battery_state', type: 'sensor_msgs/msg/BatteryState' } },
      access: { rules: [{ match: '/battery_state', kinds: ['publish'], role: 'operate' }] },
    }), known)
    expect(issues.map((i) => i.code)).toEqual(['rule_matches_nothing'])
  })

  it('does not count a rule over a built-in datapoint, which is no entry', () => {
    const issues = roleIssues(doc({ access: { rules: [{ match: '/**', role: 'operate' }] } }), known)
    expect(issues.map((i) => i.code)).toEqual(['rule_matches_nothing'])
  })

  it('never fits an exposure without a ROS name', () => {
    const issues = roleIssues(doc({
      cameras: { mast: { source: { kind: 'rtsp', url: 'rtsp://cam-1.plant.local/stream1' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 } },
      access: { rules: [{ match: '/**', role: 'operate' }] },
    }), known)
    expect(issues.map((i) => i.code)).toEqual(['rule_matches_nothing'])
  })

  it('is always a warning, never an error', () => {
    const issues = roleIssues(doc({
      services: { arm_home: { ...SERVICE, role: 'technik' } },
      access: { rules: [{ match: '/nothing/**', role: 'montage' }], assets: 'technik' },
    }), known)
    expect(issues.length).toBeGreaterThanOrEqual(4)
    expect(new Set(issues.map((i) => i.severity))).toEqual(new Set(['warning']))
  })

  it('produces issues the configuration issue shape accepts', () => {
    const issues = roleIssues(DOC, new Map())
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) expect(validationIssue.safeParse(issue).success).toBe(true)
  })
})
