import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { ValidationIssue } from '../src/config.js'
import { robotConfigDoc } from '../src/config.js'
import { configSchemaHash, formatPath, schemaIssues, splitFormatPath, DOCUMENT_ROOT_PATH } from '../src/config-issues.js'

/**
 * **The fixtures below came from `cloud/test/validation.test.ts`** — the
 * suite that covered `schemaIssues` where it used to live — and they moved
 * with the code rather than being rewritten here. A test written against
 * code one has just read tests the reading; these test what it did. They are
 * also the "do the two agree" proof the plan asks for: the expectations are
 * the cloud's own, unchanged.
 *
 * Two adjustments, both forced and neither about behaviour:
 *
 * - The cloud writes its fixtures as YAML text and runs them through
 *   `parseConfigYaml` + `readConfigDoc`. Contracts has no `yaml` dependency
 *   and no reason for one, so each fixture is the object that parse produced
 *   and the harness calls `robotConfigDoc.safeParse` directly — which is
 *   exactly what `readConfigDoc` does with the value it is handed.
 * - `ValidationIssue` is imported from `../src/config.js` rather than from
 *   the package.
 *
 * The cloud's own note on why these fixtures are shaped as they are, kept
 * because it is the reason each one asserts a path:
 *
 * > The seven codes the schema decides are only reachable through the parse —
 * > a document that trips them never becomes a `RobotConfigDoc` — so a fixture
 * > built as an object could not reach them at all.
 * >
 * > Each fixture asserts the code **and the path**. `.success` alone, or a code
 * > alone, would stay green if a check fired for the wrong reason; the path is
 * > what makes that fail. And each fixture produces exactly one issue: a
 * > fixture that also tripped a neighbour would stay green if the check it
 * > names were deleted and the neighbour widened.
 */

/** The issues a fixture written to be refused by the schema produces. */
function refusalIssues(value: unknown): ValidationIssue[] {
  const result = robotConfigDoc.safeParse(value)
  if (result.success) throw new Error('this fixture parsed, but it was written to be refused by the schema')
  return schemaIssues(value, result.error.issues)
}

const ONE = (code: string, path: string, severity: 'error' | 'warning' = 'error') => [
  expect.objectContaining({ code, path, severity }),
]

describe('the seven codes the schema decides, mapped rather than re-checked', () => {
  it('unknown_key: a key the format does not define', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        datapoints: {
          battery_soc: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage', nope: 1 },
        },
      }),
    ).toEqual(ONE('unknown_key', 'datapoints.battery_soc.nope'))
  })

  it('explicit_null: a section set to null instead of omitted', () => {
    expect(refusalIssues({ fleetless: 1, datapoints: null })).toEqual(ONE('explicit_null', 'datapoints'))
  })

  /**
   * The other half of the same code, and it arrives by the other route: a
   * message position is the one bare `z.unknown()` in the format, so
   * contracts refuses `null` there itself and tags it `params.code`. The
   * section above carries no such tag and is recognised by navigating to the
   * value — never by the message's "received null" prose.
   */
  it('explicit_null: a message body set to null', () => {
    expect(refusalIssues({ fleetless: 1, messages: { stop_now: null } })).toEqual(
      ONE('explicit_null', 'messages.stop_now'),
    )
  })

  it('constraint_not_allowed_for_type: min_value on a string parameter', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        services: {
          add_two: {
            ros_name: '/add_two',
            type: 'example/srv/AddTwoInts',
            message: { left: '${left}' },
            parameters: { left: { type: 'string', min_value: 1 } },
          },
        },
      }),
    ).toEqual(ONE('constraint_not_allowed_for_type', 'services.add_two.parameters.left.min_value'))
  })

  it('value_type_mismatch: a fractional default on an integer parameter', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        services: {
          add_two: {
            ros_name: '/add_two',
            type: 'example/srv/AddTwoInts',
            message: { left: '${left}' },
            parameters: { left: { type: 'int32', default: 1.5 } },
          },
        },
      }),
    ).toEqual(ONE('value_type_mismatch', 'services.add_two.parameters.left.default'))
  })

  it('requires_single_field: numeric without a field', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        datapoints: {
          battery_soc: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', numeric: { unit: '%' } },
        },
      }),
    ).toEqual(ONE('requires_single_field', 'datapoints.battery_soc.numeric'))
  })

  it('invalid_condition: resolve_at equal to fire_at', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        datapoints: {
          battery_soc: {
            topic: '/battery',
            type: 'sensor_msgs/msg/BatteryState',
            field: 'percentage',
            alerts: { low: { condition: { fire_at: 20, resolve_at: 20 } } },
          },
        },
      }),
    ).toEqual(ONE('invalid_condition', 'datapoints.battery_soc.alerts.low.condition.resolve_at'))
  })

  it('failsafe_has_parameters: a placeholder written inline into the failsafe', () => {
    expect(
      refusalIssues({
        fleetless: 1,
        publishers: {
          drive: {
            topic: '/cmd_vel',
            type: 'geometry_msgs/msg/Twist',
            quiet_timeout_ms: 0,
            message: {},
            failsafe: { timeout_ms: 300, message: { linear: { x: '${speed}' } } },
          },
        },
      }),
    ).toEqual(ONE('failsafe_has_parameters', 'publishers.drive.failsafe.message'))
  })
})

/**
 * The three properties of the mapping that the fixtures above exercise but do
 * not name, kept from the cloud's module comments: the slug an issue belongs
 * to, the prototype hole the null branch would otherwise fall into, and the
 * codes that stay zod's own.
 */
describe('what the mapping attaches to an issue besides its code', () => {
  it('names the entry a refusal belongs to, and nothing outside the five exposure sections', () => {
    const inSection = refusalIssues({
      fleetless: 1,
      datapoints: {
        battery_soc: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage', nope: 1 },
      },
    })
    expect(inSection[0]!.slug).toBe('battery_soc')

    // `messages:` is not in the slug namespace — its names are their own.
    const outside = refusalIssues({ fleetless: 1, messages: { stop_now: null } })
    expect(outside[0]!.slug).toBeNull()
  })

  it('keeps zod\'s own code where FL-002 has none', () => {
    // A reversed bounds pair is a refusal with no `params.code`, and inventing
    // a fourteenth code for it would put a code on the wire no table
    // documents.
    const issues = refusalIssues({ fleetless: 1, datapoints: 42 })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('invalid_type')
  })

  it('reports an entry named for a prototype key as the entry it is', () => {
    // `constructor` is the one `Object.prototype` key the slug grammar admits
    // — the others carry a capital, and are refused as names before anything
    // here sees them — so it is the one that can reach `valueAt`'s walk as a
    // path segment.
    //
    // **This does not guard `valueAt`'s `Object.hasOwn`, and saying that it
    // did would be the worse mistake.** Measured by deleting that line: the
    // whole suite stays green. The guard can only change an answer if the
    // prototype hands back `null`, and every `Object.prototype` value is a
    // function — so through `schemaIssues` the two spellings are
    // indistinguishable. `hasOwn` stays because the walk is one edit away
    // from a caller for which it does matter (that is what `sectionGet` was
    // written for: a lookup that answered 202 and dispatched a real job
    // against an action no document declared), and because a bare index here
    // would be the same shape a second time. What this test asserts is the
    // part that is observable: the entry is named, and the refusal is about
    // its missing `type`, not about the prototype.
    expect(refusalIssues({ fleetless: 1, datapoints: { constructor: { topic: '/t' } } })).toEqual(
      ONE('invalid_type', 'datapoints.constructor.type'),
    )
    expect(refusalIssues({ fleetless: 1, datapoints: { constructor: { topic: '/t' } } })[0]!.slug).toBe('constructor')
  })
})

describe('formatPath and splitFormatPath', () => {
  it('writes a sequence index in brackets and everything else with dots', () => {
    expect(formatPath(['datapoints', 'a', 'enum', 0])).toBe('datapoints.a.enum[0]')
    expect(formatPath([])).toBe(DOCUMENT_ROOT_PATH)
  })

  it('reads back every path formatPath writes from segments containing no . or [', () => {
    // The property that actually holds, asserted over the shapes a real issue
    // path has: section, slug, key, and an index on a sequence.
    const paths: ReadonlyArray<ReadonlyArray<string | number>> = [
      [],
      ['datapoints'],
      ['datapoints', 'battery_soc', 'nope'],
      ['datapoints', 'a', 'enum', 0],
      ['services', 'add_two', 'parameters', 'left', 'min_value'],
      ['publishers', 'drive', 'failsafe', 'message'],
      ['a', 0, 1],
      [0],
      ['messages', 'stop_now'],
    ]
    for (const path of paths) {
      expect(splitFormatPath(formatPath(path))).toEqual([...path])
    }
  })

  it('does not round-trip a name that contains the structure, and this is documented rather than hidden', () => {
    // Both are reachable: an `unrecognized_keys` path ends in a key the
    // developer wrote, and YAML lets that key be anything. The assertion is
    // what the function DOES, not what would read better — a test asserting a
    // round trip here would be asserting a property this has never had.
    expect(splitFormatPath(formatPath(['datapoints', 'x', 'a.b']))).toEqual(['datapoints', 'x', 'a', 'b'])
    expect(splitFormatPath(formatPath(['datapoints', 'x', 'ranges[0]']))).toEqual(['datapoints', 'x', 'ranges', 0])
    expect(splitFormatPath(formatPath([DOCUMENT_ROOT_PATH]))).toEqual([])
  })

  it('leaves a chunk it cannot read as structure alone, rather than guessing', () => {
    expect(splitFormatPath('datapoints.a[x]')).toEqual(['datapoints', 'a[x]'])
    expect(splitFormatPath('datapoints.a[]')).toEqual(['datapoints', 'a[]'])
    expect(splitFormatPath('datapoints.a[01]')).toEqual(['datapoints', 'a', 1])
  })
})

describe('configSchemaHash', () => {
  it('is the same number for the same schema, whatever order its keys were written in', () => {
    const a = { type: 'object', properties: { b: { type: 'string' }, a: { type: 'number' } } }
    const b = { properties: { a: { type: 'number' }, b: { type: 'string' } }, type: 'object' }
    expect(configSchemaHash(a)).toBe(configSchemaHash(b))
  })

  it('changes when anything in the schema changes, at any depth', () => {
    const base = { type: 'object', properties: { a: { type: 'string', description: 'one' } } }
    const deep = { type: 'object', properties: { a: { type: 'string', description: 'two' } } }
    const added = { type: 'object', properties: { a: { type: 'string', description: 'one' }, b: {} } }
    expect(configSchemaHash(deep)).not.toBe(configSchemaHash(base))
    expect(configSchemaHash(added)).not.toBe(configSchemaHash(base))
  })

  it('does not confuse array order with a set', () => {
    // Sorting is for object keys only: `enum: ['a','b']` and `enum: ['b','a']`
    // are different schemas and must hash differently.
    expect(configSchemaHash({ enum: ['a', 'b'] })).not.toBe(configSchemaHash({ enum: ['b', 'a'] }))
  })

  it('hashes the real document schema and says the same thing twice', () => {
    // The gate's actual input is a converted schema, not a hand-built object.
    const schema = JSON.parse(JSON.stringify(z.toJSONSchema(robotConfigDoc, { io: 'input' }))) as unknown
    const hash = configSchemaHash(schema)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(configSchemaHash(schema)).toBe(hash)
  })

  it('answers rather than throwing for the inputs a caller can get wrong', () => {
    expect(configSchemaHash(undefined)).toMatch(/^[0-9a-f]{16}$/)
    expect(configSchemaHash(undefined)).not.toBe(configSchemaHash(null))
  })
})
