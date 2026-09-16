// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

/**
 * What a developer is told when the format refuses.
 *
 * Three of zod's own sentences are unusable in front of a developer: a
 * refused map key says `Invalid key in record`, naming neither key nor
 * grammar; a missing required key said `Invalid input: expected object,
 * received undefined`, naming nothing; a pattern violation quoted its
 * regular expression back at the reader.
 *
 * These are what the cloud's 422 carries today and what the console renders
 * on every keystroke — product surface, not a debug detail.
 */

/** The messages a developer actually sees, for the documents that produce them. */
function messagesFor(value: unknown): string[] {
  const result = robotConfigDoc.safeParse(value)
  if (result.success) throw new Error('expected this document to be refused')
  return result.error.issues.map((issue) => issue.message)
}

/** The message on the issue at one dotted path, or `undefined` if there is none. */
function messageAt(value: unknown, path: string): string | undefined {
  const result = robotConfigDoc.safeParse(value)
  if (result.success) throw new Error(`expected this document to be refused (wanted an issue at ${path})`)
  return result.error.issues.find((issue) => issue.path.join('.') === path)?.message
}

describe('a refusal says what is wrong', () => {
  it('names the key and the grammar when a slug is refused', () => {
    const [message] = messagesFor({ fleetless: 1, datapoints: { Battery: { topic: '/b', type: 'a_msgs/msg/B' } } })
    expect(message).toContain('Battery')
    expect(message).not.toBe('Invalid key in record')
    // The rule in words, not as a regex.
    expect(message).not.toContain('^[a-z]')
  })

  it('names the key that is missing', () => {
    const messages = messagesFor({ fleetless: 1, cameras: { front: { width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5 } } })
    expect(messages.some((m) => m.includes('source'))).toBe(true)
  })

  it('states a pattern rule in words', () => {
    const [message] = messagesFor({ fleetless: 1, datapoints: { battery: { topic: 'not-absolute', type: 'a_msgs/msg/B' } } })
    expect(message).not.toContain('must match pattern')
    expect(message.length).toBeGreaterThan(30)
  })
})

/**
 * One rule, one sentence — for **every** pattern, not only for `topic`.
 *
 * `patternErrorMessage` and zod's own message for the same node are two
 * spellings of one rule; nothing consumes `patternErrorMessage` at runtime —
 * it is documentation in a published artifact. An unwatched second spelling
 * of a live rule drifts silently, which is how `buildAcceptUrl` came to mail
 * a URL three ways. So the two are asserted equal at all 24 pattern
 * positions the document has.
 *
 * **Where the two are not byte-identical, and why.** At the ten map-key
 * positions the message must also name the offending key — `Invalid key in
 * record`, naming neither, is the worst message in the format and the
 * commonest beginner mistake. So a key refusal is asserted to contain the
 * rule's sentence **verbatim** plus the key; at the fourteen value positions
 * the sentence is the whole message and equality is exact.
 */
const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>

/**
 * Every node of the exported document, visited once — **one traversal, both
 * callers**.
 *
 * The first round of this task had two walks that disagreed about which
 * keywords exist: the pattern walk followed `propertyNames`, the examples
 * walk did not. An `examples: ['NOT a slug']` on `mapKey` — a map-key
 * position holding a value the format itself refuses — left the whole file
 * green, because the table walk never found the node, so there was no row to
 * parse it. Two walks over one schema disagreeing about which nodes exist is
 * the same defect the missing-key sweep below closes, one level up. One list
 * of keywords now, one place to add to it.
 *
 * `countBlind` is the guard on that list, borrowed from
 * `config-messages.test.ts`: it descends into every object and array there
 * is, knowing no keyword at all, so a node reached only by a keyword nobody
 * thought of (`prefixItems`, a `$defs` behind a `$ref`) makes the two counts
 * disagree. A tally of 24 out of an unknown total looks exactly like 24 out
 * of 24.
 */
function eachNode(node: any, visit: (path: string, node: any) => void, path = '') {
  if (!node || typeof node !== 'object') return
  visit(path, node)
  for (const [key, value] of Object.entries<any>(node.properties ?? {})) eachNode(value, visit, `${path}.${key}`)
  if (node.additionalProperties && typeof node.additionalProperties === 'object') eachNode(node.additionalProperties, visit, `${path}.<slug>`)
  if (node.propertyNames && typeof node.propertyNames === 'object') eachNode(node.propertyNames, visit, `${path}{key}`)
  if (node.items && typeof node.items === 'object') eachNode(node.items, visit, `${path}[]`)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) (node[kw] ?? []).forEach((b: any, i: number) => eachNode(b, visit, `${path}#${i}`))
}

/** The same tally, reached by descending into everything and knowing nothing. */
function countBlind(node: any, out = { patterns: 0, examples: 0 }) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.pattern === 'string') out.patterns += 1
  if (Array.isArray(node.examples)) out.examples += 1
  for (const value of Object.values(node)) countBlind(value, out)
  return out
}

const patternNodes = new Map<string, any>()
const exampledPaths: string[] = []
eachNode(schema, (path, node) => {
  if (typeof node.pattern === 'string') patternNodes.set(path, node)
  if (Array.isArray(node.examples)) exampledPaths.push(path)
})

/** A minimal entry of each kind that the format accepts as it stands. */
const DATAPOINT = { topic: '/battery', type: 'sensor_msgs/msg/BatteryState' }
const ACTION = { ros_name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose' }
const SERVICE = { ros_name: '/reset_odometry', type: 'std_srvs/srv/Trigger' }
const PUBLISHER = {
  topic: '/cmd_vel',
  type: 'geometry_msgs/msg/Twist',
  message: { linear: { x: 0 } },
  quiet_timeout_ms: 2000,
  failsafe: { timeout_ms: 500, message: { linear: { x: 0 } } },
}
const CAMERA = { source: { kind: 'v4l2', device: '/dev/video0' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 }
const PARAMETER = { type: 'float64' }
const ALERT = { condition: { fire_at: 15, resolve_at: 18 } }

/** A document breaking exactly one pattern, and where the issue for it lands. */
type Row = { doc: unknown, at: string }

const BAD_KEY = 'Battery'
const BAD_ROS_NAME = 'not-absolute'
const BAD_ROS_TYPE = 'sensor_msgs/BatteryState'

const doc = (body: Record<string, unknown>) => ({ fleetless: 1, ...body })
const entry = <T extends object>(base: T, override: Record<string, unknown>) => ({ ...base, ...override })

/**
 * One row per pattern position. The set of keys is asserted against the walk
 * above, so a pattern added to the format without a row here goes red rather
 * than passing unexamined.
 */
const VIOLATIONS: Record<string, Row> = {
  '.messages{key}': { doc: doc({ messages: { [BAD_KEY]: { linear: { x: 0 } } } }), at: `messages.${BAD_KEY}` },
  '.datapoints{key}': { doc: doc({ datapoints: { [BAD_KEY]: DATAPOINT } }), at: `datapoints.${BAD_KEY}` },
  '.datapoints.<slug>.topic': { doc: doc({ datapoints: { battery: entry(DATAPOINT, { topic: BAD_ROS_NAME }) } }), at: 'datapoints.battery.topic' },
  '.datapoints.<slug>.type': { doc: doc({ datapoints: { battery: entry(DATAPOINT, { type: BAD_ROS_TYPE }) } }), at: 'datapoints.battery.type' },
  '.datapoints.<slug>.field': { doc: doc({ datapoints: { battery: entry(DATAPOINT, { field: 'ranges[0][1]' }) } }), at: 'datapoints.battery.field' },
  '.datapoints.<slug>.alerts{key}': { doc: doc({ datapoints: { battery: entry(DATAPOINT, { field: 'percentage', alerts: { [BAD_KEY]: ALERT } }) } }), at: `datapoints.battery.alerts.${BAD_KEY}` },
  '.actions{key}': { doc: doc({ actions: { [BAD_KEY]: ACTION } }), at: `actions.${BAD_KEY}` },
  '.actions.<slug>.ros_name': { doc: doc({ actions: { navigate: entry(ACTION, { ros_name: BAD_ROS_NAME }) } }), at: 'actions.navigate.ros_name' },
  '.actions.<slug>.type': { doc: doc({ actions: { navigate: entry(ACTION, { type: BAD_ROS_TYPE }) } }), at: 'actions.navigate.type' },
  '.actions.<slug>.parameters{key}': { doc: doc({ actions: { navigate: entry(ACTION, { parameters: { [BAD_KEY]: PARAMETER } }) } }), at: `actions.navigate.parameters.${BAD_KEY}` },
  '.services{key}': { doc: doc({ services: { [BAD_KEY]: SERVICE } }), at: `services.${BAD_KEY}` },
  '.services.<slug>.ros_name': { doc: doc({ services: { reset: entry(SERVICE, { ros_name: BAD_ROS_NAME }) } }), at: 'services.reset.ros_name' },
  '.services.<slug>.type': { doc: doc({ services: { reset: entry(SERVICE, { type: BAD_ROS_TYPE }) } }), at: 'services.reset.type' },
  '.services.<slug>.parameters{key}': { doc: doc({ services: { reset: entry(SERVICE, { parameters: { [BAD_KEY]: PARAMETER } }) } }), at: `services.reset.parameters.${BAD_KEY}` },
  '.publishers{key}': { doc: doc({ publishers: { [BAD_KEY]: PUBLISHER } }), at: `publishers.${BAD_KEY}` },
  '.publishers.<slug>.topic': { doc: doc({ publishers: { drive: entry(PUBLISHER, { topic: BAD_ROS_NAME }) } }), at: 'publishers.drive.topic' },
  '.publishers.<slug>.type': { doc: doc({ publishers: { drive: entry(PUBLISHER, { type: BAD_ROS_TYPE }) } }), at: 'publishers.drive.type' },
  '.publishers.<slug>.parameters{key}': { doc: doc({ publishers: { drive: entry(PUBLISHER, { parameters: { [BAD_KEY]: PARAMETER } }) } }), at: `publishers.drive.parameters.${BAD_KEY}` },
  '.cameras{key}': { doc: doc({ cameras: { [BAD_KEY]: CAMERA } }), at: `cameras.${BAD_KEY}` },
  '.cameras.<slug>.source#0.topic': { doc: doc({ cameras: { front: entry(CAMERA, { source: { kind: 'ros', topic: BAD_ROS_NAME, type: 'sensor_msgs/msg/Image' } }) } }), at: 'cameras.front.source.topic' },
  '.cameras.<slug>.source#0.type': { doc: doc({ cameras: { front: entry(CAMERA, { source: { kind: 'ros', topic: '/camera/image_raw', type: BAD_ROS_TYPE } }) } }), at: 'cameras.front.source.type' },
  '.cameras.<slug>.source#1.url': { doc: doc({ cameras: { front: entry(CAMERA, { source: { kind: 'rtsp', url: 'file:///etc/passwd' } }) } }), at: 'cameras.front.source.url' },
  '.cameras.<slug>.source#2.url': { doc: doc({ cameras: { front: entry(CAMERA, { source: { kind: 'mjpeg', url: 'ftp://cam-1/video.mjpg' } }) } }), at: 'cameras.front.source.url' },
  '.cameras.<slug>.source#3.device': { doc: doc({ cameras: { front: entry(CAMERA, { source: { kind: 'v4l2', device: '/etc/passwd' } }) } }), at: 'cameras.front.source.device' },
}

describe('one rule, one sentence', () => {
  it('has a violating document for every pattern the document declares', () => {
    expect([...patternNodes.keys()].sort()).toEqual(Object.keys(VIOLATIONS).sort())
    expect(patternNodes.size).toBe(24)
  })

  for (const [path, node] of patternNodes) {
    const isKey = path.endsWith('{key}')
    it(`${path} reads identically in the schema and from the parser`, () => {
      const row = VIOLATIONS[path]
      const seen = messageAt(row.doc, row.at)
      expect(seen, `no issue at ${row.at}; the document does not break ${path}`).toBeTypeOf('string')
      expect(typeof node.patternErrorMessage, `${path} carries no patternErrorMessage`).toBe('string')
      if (isKey) {
        // A key refusal names the offending key and then states the rule.
        expect(seen).toContain(node.patternErrorMessage)
        expect(seen).toContain(BAD_KEY)
      } else {
        expect(seen).toBe(node.patternErrorMessage)
      }
    })
  }
})

/**
 * Every required key of the document, deleted one at a time.
 *
 * **The guard the first round of this task did not write, and whose absence
 * is how the defect it now catches shipped.** The pattern and examples
 * requirements were each guarded by a walk over the exported schema; the
 * missing-key requirement was guarded by one hand-picked document — the
 * camera from the brief — which happened to sit on the part of the format
 * that worked. Green over a fraction, unable to say so. Six objects in
 * `src/config.ts` were written `z\n  .strictObject({`, so a `grep` for
 * `z.strictObject` on one line found only the comments; twelve conversions
 * read as eighteen, and eleven required keys — including
 * `datapoints.<slug>.topic` and `.type`, the commonest entry in the format —
 * still said `Invalid input: expected string, received undefined`, the
 * string this file's own header calls unusable.
 *
 * So the count is not typed here: it falls out of the enumeration — a walk
 * of the exported schema's `required` arrays paired with a fully-populated
 * document, `oneOf` branches resolved by their discriminator so all four
 * camera sources are reached. A required key added later is swept the day it
 * exists.
 */

/**
 * A document with every section, every optional field, and one camera per
 * source kind — so that deleting any single required key is the only thing
 * wrong with it.
 */
const PARAMETER_FULL = { type: 'float64', min_value: -0.5, max_value: 0.5, default: 0, description: 'What a caller is choosing when they set this.' }
const CAMERA_REST = { width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5, description: 'Forward-facing camera on the mast.' }
const FIXTURE: Record<string, any> = {
  fleetless: 1,
  messages: { stop: { linear: { x: 0 } } },
  datapoints: {
    battery: {
      topic: '/battery',
      type: 'sensor_msgs/msg/BatteryState',
      field: 'percentage',
      rate_throttle_hz: 2,
      description: 'What this value is, for whoever meets it in the console.',
      numeric: { scale: 100, offset: 0, unit: '%', decimals: 1 },
      retention: { enabled: true, interval_seconds: 300, max_buffer_values: 5000 },
      chart: { y_min: 0, y_max: 100, style: 'line', default_window_minutes: 60 },
      alerts: { low: { condition: { fire_at: 15, resolve_at: 18 }, severity: 'warning', name: 'Battery low', enabled: true } },
    },
  },
  actions: { navigate: { ...ACTION, message: { pose: '\\${speed}' }, parameters: { speed: PARAMETER_FULL }, description: 'Drives to a target pose on the map.' } },
  services: { reset: { ...SERVICE, message: { a: '\\${speed}' }, parameters: { speed: PARAMETER_FULL }, description: 'Resets odometry to the origin.' } },
  publishers: { drive: { ...PUBLISHER, parameters: { speed: PARAMETER_FULL }, description: 'Velocity command. If sending stops, the robot stops.' } },
  cameras: {
    cam_ros: { source: { kind: 'ros', topic: '/camera/image_raw', type: 'sensor_msgs/msg/Image' }, ...CAMERA_REST },
    cam_rtsp: { source: { kind: 'rtsp', url: 'rtsp://cam-1.plant.local/stream1', transport: 'tcp', credentials: { username: 'ops', password: 'secret' } }, ...CAMERA_REST },
    cam_mjpeg: { source: { kind: 'mjpeg', url: 'http://cam-1.plant.local/video.mjpg', credentials: { username: 'ops', password: 'secret' } }, ...CAMERA_REST },
    cam_v4l2: { source: { kind: 'v4l2', device: '/dev/video0' }, ...CAMERA_REST },
  },
}

/**
 * The branch of a union the document actually took, found by its discriminator.
 *
 * A union of scalars — `parameters.<slug>.default`, an `enum` entry — has no
 * discriminator and no required key below it, so `{}` is the honest answer.
 * A union that *does* hold a required key, and that nothing matched, is a
 * hole in this walk and throws rather than being skipped: a required key the
 * sweep silently never reached would be exactly the failure this block
 * exists to close.
 */
function branchTaken(node: any, value: unknown): any {
  const branches = node.oneOf ?? node.anyOf
  if (!Array.isArray(branches)) return node
  for (const branch of branches)
    for (const [key, sub] of Object.entries<any>(branch.properties ?? {}))
      if (sub.const !== undefined && (value as any)?.[key] === sub.const) return branch
  if (branches.some((b: any) => Array.isArray(b.required) && b.required.length > 0))
    throw new Error(`a union with required keys that the fixture does not enter: ${JSON.stringify(value).slice(0, 80)}`)
  return {}
}

/** Every required key of the document, as the path of the object holding it. */
function requiredPositions(node: any, value: any, path: string[] = [], out: Array<{ path: string[], key: string }> = []) {
  if (!node || typeof node !== 'object' || value === undefined) return out
  const here = branchTaken(node, value)
  for (const key of here.required ?? []) out.push({ path, key })
  for (const [key, sub] of Object.entries<any>(here.properties ?? {})) requiredPositions(sub, value?.[key], [...path, key], out)
  if (here.additionalProperties && typeof here.additionalProperties === 'object')
    for (const key of Object.keys(value ?? {})) requiredPositions(here.additionalProperties, value[key], [...path, key], out)
  return out
}

const REQUIRED = requiredPositions(schema, FIXTURE)

/** The fixture with exactly one key removed. */
function without(path: string[], key: string): unknown {
  const copy = structuredClone(FIXTURE)
  let here: any = copy
  for (const step of path) here = here[step]
  delete here[key]
  return copy
}

describe('a required key that is absent names itself', () => {
  it('the fixture is accepted before anything is deleted', () => {
    // Without this the sweep below could be measuring a document that was
    // already refused, and every row would pass for the wrong reason.
    const parsed = robotConfigDoc.safeParse(FIXTURE)
    expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([])
  })

  it('found the required-key positions the document has', () => {
    // Not a number anybody typed: it falls out of the walk. It is asserted so
    // that a walk which came back empty — or which stopped entering a section —
    // fails here rather than passing vacuously over nothing.
    expect(REQUIRED.length).toBe(52)
    expect(new Set(REQUIRED.map((r) => r.path.join('.'))).size).toBe(19)
  })

  for (const { path, key } of REQUIRED) {
    const at = [...path, key].join('.')
    it(`${at} says its own name`, () => {
      const parsed = robotConfigDoc.safeParse(without(path, key))
      expect(parsed.success, `${at} is not actually required`).toBe(false)
      if (parsed.success) return
      // The issue can land on the key itself or on the object that wanted it;
      // both are the same finding, and a union reports at the discriminator.
      const mine = parsed.error.issues.filter((issue) => {
        const p = issue.path.join('.')
        return p === at || p === path.join('.')
      })
      expect(mine.length, `no issue at ${at}`).toBeGreaterThan(0)
      expect(
        mine.some((issue) => issue.message.includes(key)),
        `${at} is refused with: ${mine.map((i) => `[${i.code}] ${i.message}`).join(' || ')}`,
      ).toBe(true)
    })
  }
})

/**
 * Every `examples` in the format, by path, with its entries parsed.
 *
 * Item 3 of the design run had **no assertion at any layer**, and the standing
 * browser sweep structurally cannot supply one: it derives both its expectation
 * and its subject from the live schema, so deleting an `examples` deletes the
 * expectation with it and the position reads as legitimately silent. Green.
 *
 * So this table is addressed **by path** and never by searching for a key. A
 * deleted `.meta({ examples })` fails the row that names it; an `examples` the
 * format would itself refuse fails too, so an example cannot be decoration.
 */

/** Walk to a node by the path a value takes: `.key`, `.<slug>`, `#branch`. */
function nodeAt(path: string): Record<string, any> {
  let here: any = schema
  for (const step of path.replace(/\{key\}/g, '.{key}').split('.').slice(1)) {
    const [name, ...branches] = step.split('#')
    if (name === '<slug>') here = here.additionalProperties
    else if (name === '{key}') here = here.propertyNames
    else here = here.properties?.[name]
    if (here === undefined) throw new Error(`no schema node at ${path} (stopped at "${step}")`)
    for (const branch of branches) here = (here.oneOf ?? here.anyOf)[Number(branch)]
    if (here === undefined) throw new Error(`no schema branch at ${path} (stopped at "${step}")`)
  }
  return here
}

/** The zod schema at the same path, so an example can be parsed by the format itself. */
function zodAt(path: string): any {
  const unwrap = (s: any): any => {
    const def = s?._zod?.def
    if (def === undefined) return s
    if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default' || def.type === 'nonoptional' || def.type === 'readonly') return unwrap(def.innerType)
    if (def.type === 'pipe') return unwrap(def.in)
    return s
  }
  let here: any = unwrap(robotConfigDoc)
  for (const step of path.replace(/\{key\}/g, '.{key}').split('.').slice(1)) {
    const [name, ...branches] = step.split('#')
    const def = here._zod.def
    here = unwrap(name === '<slug>' ? def.valueType : name === '{key}' ? def.keyType : def.shape[name])
    if (here === undefined) throw new Error(`no zod node at ${path} (stopped at "${step}")`)
    for (const branch of branches) here = unwrap(here._zod.def.options[Number(branch)])
  }
  return here
}

/**
 * Every path in the format that carries an `examples`. The list is compared
 * against a walk of the whole document below, so it cannot fall behind.
 */
const EXAMPLED = [
  '.datapoints.<slug>.topic',
  '.datapoints.<slug>.type',
  '.datapoints.<slug>.field',
  '.datapoints.<slug>.rate_throttle_hz',
  '.datapoints.<slug>.description',
  '.datapoints.<slug>.numeric.scale',
  '.datapoints.<slug>.numeric.offset',
  '.datapoints.<slug>.numeric.unit',
  '.datapoints.<slug>.numeric.decimals',
  '.datapoints.<slug>.retention.interval_seconds',
  '.datapoints.<slug>.retention.max_buffer_values',
  '.datapoints.<slug>.chart.y_min',
  '.datapoints.<slug>.chart.y_max',
  '.datapoints.<slug>.chart.default_window_minutes',
  '.datapoints.<slug>.alerts.<slug>.condition.fire_at',
  '.datapoints.<slug>.alerts.<slug>.condition.resolve_at',
  '.datapoints.<slug>.alerts.<slug>.name',
  '.actions.<slug>.ros_name',
  '.actions.<slug>.type',
  '.actions.<slug>.description',
  '.actions.<slug>.parameters.<slug>.min_value',
  '.actions.<slug>.parameters.<slug>.max_value',
  '.actions.<slug>.parameters.<slug>.regex',
  '.actions.<slug>.parameters.<slug>.description',
  '.services.<slug>.ros_name',
  '.services.<slug>.type',
  '.services.<slug>.description',
  '.services.<slug>.parameters.<slug>.min_value',
  '.services.<slug>.parameters.<slug>.max_value',
  '.services.<slug>.parameters.<slug>.regex',
  '.services.<slug>.parameters.<slug>.description',
  '.publishers.<slug>.topic',
  '.publishers.<slug>.type',
  '.publishers.<slug>.description',
  '.publishers.<slug>.quiet_timeout_ms',
  '.publishers.<slug>.failsafe.timeout_ms',
  '.publishers.<slug>.parameters.<slug>.min_value',
  '.publishers.<slug>.parameters.<slug>.max_value',
  '.publishers.<slug>.parameters.<slug>.regex',
  '.publishers.<slug>.parameters.<slug>.description',
  '.cameras.<slug>.width',
  '.cameras.<slug>.height',
  '.cameras.<slug>.fps',
  '.cameras.<slug>.bitrate_kbps',
  '.cameras.<slug>.snapshot_interval_seconds',
  '.cameras.<slug>.description',
  '.cameras.<slug>.source#0.topic',
  '.cameras.<slug>.source#0.type',
  '.cameras.<slug>.source#1.url',
  '.cameras.<slug>.source#1.credentials.username',
  '.cameras.<slug>.source#2.url',
  '.cameras.<slug>.source#2.credentials.username',
  '.cameras.<slug>.source#3.device',
]

describe('every example the editor offers', () => {
  it('the table names exactly the positions that carry one', () => {
    expect([...exampledPaths].sort()).toEqual([...EXAMPLED].sort())
  })

  it('the keyword walker reached every pattern and every example there is', () => {
    const blind = countBlind(schema)
    expect(blind.patterns, 'a pattern sits behind a keyword `eachNode` does not follow').toBe(patternNodes.size)
    expect(blind.examples, 'an examples sits behind a keyword `eachNode` does not follow').toBe(exampledPaths.length)
  })

  for (const path of EXAMPLED) {
    it(`${path} offers something the format accepts`, () => {
      const node = nodeAt(path)
      expect(Array.isArray(node.examples), `no examples at ${path}`).toBe(true)
      expect(node.examples.length, `an empty examples at ${path}`).toBeGreaterThan(0)
      const field = zodAt(path)
      for (const example of node.examples) {
        const parsed = field.safeParse(example)
        expect(parsed.success, `${path} offers ${JSON.stringify(example)}, which the format refuses`).toBe(true)
      }
    })
  }
})

/**
 * A message change must not be a rule change. These are documents the format
 * accepted before this task and must accept after it, and documents it refused
 * before and must refuse after.
 */
describe('the accepted language is unchanged', () => {
  const ACCEPTED = [
    { fleetless: 1 },
    { fleetless: 1, datapoints: { battery_state: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage' } } },
    { fleetless: 1, cameras: { front: { source: { kind: 'v4l2', device: '/dev/video0' }, width: 640, height: 480, fps: 10, bitrate_kbps: 500, snapshot_interval_seconds: 5 } } },
    { fleetless: 1, actions: { navigate: ACTION } },
    { fleetless: 1, services: { reset: SERVICE } },
    { fleetless: 1, publishers: { drive: PUBLISHER } },
    { fleetless: 1, messages: { stop: { linear: { x: 0 } } } },
  ]
  const REFUSED = [
    { fleetless: 2 },
    { fleetless: 1, datapoints: { Battery: { topic: '/b', type: 'a_msgs/msg/B' } } },
    { fleetless: 1, datapoints: { battery: { topic: 'relative', type: 'a_msgs/msg/B' } } },
    { fleetless: 1, datapoints: { battery: { topic: null, type: 'a_msgs/msg/B' } } },
    { fleetless: 1, cameras: { front: { source: { kind: 'v4l2', url: 'rtsp://x/y' }, width: 1, height: 1, fps: 1, bitrate_kbps: 1, snapshot_interval_seconds: 1 } } },
    { fleetless: 1, datapoints: { b: { topic: '/b', type: 'a_msgs/msg/B' } } },
    { fleetless: 1, publishers: { drive: { ...PUBLISHER, failsafe: undefined } } },
    { fleetless: 1, cameras: { front: { source: { kind: 'v4l2', device: '/etc/passwd' }, width: 1, height: 1, fps: 1, bitrate_kbps: 1, snapshot_interval_seconds: 1 } } },
  ]
  for (const [i, value] of ACCEPTED.entries()) it(`accepts #${i}`, () => expect(robotConfigDoc.safeParse(value).success).toBe(true))
  for (const [i, value] of REFUSED.entries()) it(`refuses #${i}`, () => expect(robotConfigDoc.safeParse(value).success).toBe(false))

  /**
   * **The one input whose verdict this task moved, recorded rather than
   * smuggled — and the reasoning that made it acceptable, so that a later
   * reader can re-run it rather than take it on trust.**
   *
   * `message` is `z.unknown()`, which accepts `undefined`, so zod raises its
   * own `expected nonoptional, received undefined` — attributed to neither
   * the field nor the object, so no error map can name the key.
   * `z.nonoptional` puts a schema there that can carry a sentence, but it
   * also refuses a key *present* holding `undefined`, which zod's own check
   * accepted — a change to what the format accepts, inside a task whose
   * whole constraint was not to make one. Deliberate, on the strength of the
   * three measurements below: the alternative is two of the worst messages
   * in the format on a field developers write by hand.
   *
   * **The premise, stated so it can be checked rather than assumed.** A
   * document reaches `robotConfigDoc` by three routes, and none can carry a key
   * that is present holding `undefined`:
   *
   * | route | measurement |
   * |---|---|
   * | JSON, over HTTP | `JSON.stringify` drops an undefined-valued key — asserted below, not described |
   * | YAML, from the editor | `yaml` 2.9.0 parses `message:` to `null`, which `explicit_null` refused before this task and refuses after it |
   * | jsonb, read back from Postgres | jsonb's value types are exactly the six JSON ones — `array, boolean, null, number, object, string` — and `'{"a": undefined}'::jsonb` is a parse error, *Token "undefined" is invalid*. An absent key reads back as SQL `NULL`, which is not a jsonb value at all. Checked against PostgreSQL 16.14 |
   *
   * **What would make this false.** A fourth entry point that can carry a
   * present-but-undefined key — today that's an in-process TypeScript caller
   * building the document by hand, for which refusal is correct: a
   * publisher with no template is what the required key exists to prevent.
   * If such a route ever appears, **these assertions are the thing to
   * re-decide, not the thing to delete** — they are the recorded basis of a
   * ruling, and a puzzling assertion with no premise beside it is one
   * somebody removes.
   */
  it('refuses a required key present as an explicit undefined', () => {
    expect(robotConfigDoc.safeParse({ fleetless: 1, publishers: { drive: { ...PUBLISHER, message: undefined } } }).success).toBe(false)
  })

  it('and no route into the format can carry one', () => {
    const built = { fleetless: 1, publishers: { drive: { ...PUBLISHER, message: undefined } } }
    // JSON, which is also how the document is written to and read from jsonb:
    // `undefined` is not a JSON value, so the key does not survive the trip.
    const shipped = JSON.parse(JSON.stringify(built))
    expect(Object.hasOwn(shipped.publishers.drive, 'message')).toBe(false)
    // And what does survive is a document the format still accepts or refuses
    // for its own reasons — never for this one.
    expect(robotConfigDoc.safeParse(shipped).success).toBe(false)
    expect(robotConfigDoc.safeParse(JSON.parse(JSON.stringify({ ...built, publishers: { drive: PUBLISHER } }))).success).toBe(true)
  })
})
