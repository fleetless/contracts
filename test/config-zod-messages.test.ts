import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

/**
 * What a developer is told when the format refuses.
 *
 * Three of zod's own sentences were measured (design §1.5) to be unusable in
 * front of a developer: a refused map key said `Invalid key in record`, naming
 * neither the key nor the grammar; a missing required key said `Invalid input:
 * expected object, received undefined`, naming nothing; and a pattern violation
 * quoted its regular expression back at the reader.
 *
 * These sentences are what the cloud's 422 carries today and what the console
 * renders on every keystroke from wave 3 (D3), so they are the product surface
 * of the format, not a debug detail.
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
 * The schema's `patternErrorMessage` and zod's own message for the same node
 * are two spellings of one rule, and under D3 nothing consumes
 * `patternErrorMessage` at runtime at all: it is documentation in a published
 * artifact. An unwatched second spelling of a live rule drifts word for word,
 * forever and invisibly, which is how `buildAcceptUrl` came to mail a URL three
 * ways. So the two are asserted equal at all 24 pattern positions the document
 * has.
 *
 * **Where the two are not byte-identical, and why.** At the ten map-key
 * positions the message a developer sees has to name the offending key —
 * `Invalid key in record` naming neither key nor rule is the worst message in
 * the format and the commonest beginner mistake. So a key refusal is the rule's
 * sentence with the key in front of it, and this asserts the sentence appears
 * **verbatim** inside it plus that the key is named. At the fourteen value
 * positions the sentence is the whole message and equality is exact.
 */
const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>

/**
 * Every `pattern` in the document, as a dotted path, with its node — the same
 * walk `config-messages.test.ts` uses, and for the same reason: a hand-kept
 * list of pattern positions has never once been complete on its first try.
 */
function collectPatterns(node: any, path = '', out: Map<string, any> = new Map()) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.pattern === 'string') out.set(path, node)
  for (const [key, value] of Object.entries<any>(node.properties ?? {})) collectPatterns(value, `${path}.${key}`, out)
  if (node.additionalProperties && typeof node.additionalProperties === 'object') collectPatterns(node.additionalProperties, `${path}.<slug>`, out)
  if (node.propertyNames && typeof node.propertyNames === 'object') collectPatterns(node.propertyNames, `${path}{key}`, out)
  if (node.items && typeof node.items === 'object') collectPatterns(node.items, `${path}[]`, out)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) (node[kw] ?? []).forEach((b: any, i: number) => collectPatterns(b, `${path}#${i}`, out))
  return out
}

const patternNodes = collectPatterns(schema)

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
  for (const step of path.split('.').slice(1)) {
    const [name, ...branches] = step.split('#')
    if (name === '<slug>') here = here.additionalProperties
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
  for (const step of path.split('.').slice(1)) {
    const [name, ...branches] = step.split('#')
    const def = here._zod.def
    here = unwrap(name === '<slug>' ? def.valueType : def.shape[name])
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

/** Every path carrying an `examples`, found by walking rather than by listing. */
function collectExamples(node: any, path = '', out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node.examples)) out.push(path)
  for (const [key, value] of Object.entries<any>(node.properties ?? {})) collectExamples(value, `${path}.${key}`, out)
  if (node.additionalProperties && typeof node.additionalProperties === 'object') collectExamples(node.additionalProperties, `${path}.<slug>`, out)
  if (node.items && typeof node.items === 'object') collectExamples(node.items, `${path}[]`, out)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) (node[kw] ?? []).forEach((b: any, i: number) => collectExamples(b, `${path}#${i}`, out))
  return out
}

describe('every example the editor offers', () => {
  it('the table names exactly the positions that carry one', () => {
    expect(collectExamples(schema).sort()).toEqual([...EXAMPLED].sort())
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
})
