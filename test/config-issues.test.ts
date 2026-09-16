// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { ValidationIssue } from '../src/config.js'
import { robotConfigDoc, validationIssue } from '../src/config.js'
import { configSchemaHash, formatPath, schemaIssues, splitFormatPath, DOCUMENT_ROOT_PATH } from '../src/config-issues.js'

/**
 * **The fixtures below came from the cloud's own validation suite** — the
 * suite that used to cover `schemaIssues` — and moved with the code rather
 * than being rewritten. A test written against code one has just read tests
 * the reading; these test what it did. They are also the "do the two agree"
 * proof the plan asks for: the expectations are the cloud's own, unchanged.
 *
 * Two adjustments, both forced and neither about behaviour:
 *
 * - The cloud writes its fixtures as YAML text and runs them through
 *   `parseConfigYaml` + `readConfigDoc`. Contracts has no `yaml` dependency
 *   and no reason for one, so each fixture is the object that parse produced
 *   and the harness calls `robotConfigDoc.safeParse` directly — exactly what
 *   `readConfigDoc` does with the value it is handed.
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

/** Issues produced by a fixture written to be refused by the schema. */
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

  /**
   * **The commonest way anybody reaches a doc-less draft**: select all,
   * delete, save. The file, a comments-only file, `null` and `~` all parse to
   * the same `null` and all reach `robotConfigDoc` as one `invalid_type` at
   * the empty path — measured, all four, before this was written.
   *
   * The code is right and stays; the sentence was the one for a null *key*,
   * and at this path there is no key. Asserted on the message rather than only
   * on the code, which is the assertion that could not see the defect: the
   * code is `explicit_null` either way, and because the draft store keeps the
   * draft rather than refusing it, this sentence is what the FINDINGS panel
   * shows an emptied editor persistently.
   */
  it('explicit_null at the document root says there is no document, not that a key is null', () => {
    const issues = refusalIssues(null)
    expect(issues).toEqual(ONE('explicit_null', DOCUMENT_ROOT_PATH))
    expect(issues[0]!.message).toContain('There is no document in this file')
    expect(issues[0]!.message).toContain('fleetless: 1')
    // Not the null-key sentence, which tells the developer to remove a key
    // that does not exist. Named against it: the two are only distinguishable
    // if this sentence is not that sentence.
    expect(issues[0]!.message).not.toContain('remove the key instead')

    // `null`, not falsy: `undefined` keeps zod's own `invalid_type`, and that
    // is deliberate rather than an oversight. A YAML parse never produces
    // `undefined` — an empty file, a comments-only file, `null` and `~` all
    // produce `null` — so widening the guard would put this sentence on a
    // state no document reaches.
    expect(refusalIssues(undefined)).toEqual(ONE('invalid_type', DOCUMENT_ROOT_PATH))

    // And a null KEY still gets the key sentence — the split is on the path,
    // so a fix that simply replaced the message would show up here.
    const nulledKey = refusalIssues({ fleetless: 1, datapoints: null })
    expect(nulledKey[0]!.message).toContain('remove the key instead')
    expect(nulledKey[0]!.message).not.toContain('There is no document in this file')
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

  it('keeps zod\'s own code where the format names none', () => {
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

/**
 * A path segment is a key the **developer** wrote, and YAML lets that key be
 * empty or nothing but whitespace. Both used to reach the wire as a path a
 * reader cannot act on, and the empty one at the root reached it as a path
 * the contract itself refuses.
 */
describe('a key that would render as nothing', () => {
  /** Every issue a fixture produces must satisfy the schema the cloud publishes for issues. */
  const satisfiesTheContract = (issues: readonly ValidationIssue[]) => {
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      const parsed = validationIssue.safeParse(issue)
      expect(parsed.success, `validationIssue refused ${JSON.stringify(issue)}`).toBe(true)
    }
  }

  /**
   * The three-line reproduction. `fleetless: 1` and `"": 3` is legal YAML;
   * `robotConfigDoc` is a `z.strictObject`, so it answers `unrecognized_keys`
   * with path `['']` — which used to format to the empty string and be
   * refused by `validationIssue.path`'s `min(1)`.
   *
   * The draft **stores** now, so this issue no longer rides in a 422's
   * `z.unknown()` details where a malformed one passed quietly: it rides in
   * `configDraftResponse`, whose own schema then dropped the entire response
   * and handed the console nothing.
   */
  it('an empty key at the root produces an issue the contract accepts', () => {
    const issues = refusalIssues({ fleetless: 1, '': 3 })
    satisfiesTheContract(issues)
    expect(issues).toEqual(ONE('unknown_key', '""'))
  })

  it('an empty key nested inside an entry names the entry and the key', () => {
    const issues = refusalIssues({
      fleetless: 1,
      datapoints: { battery_soc: { topic: '/battery', type: 'std_msgs/msg/Bool', '': 1 } },
    })
    satisfiesTheContract(issues)
    expect(issues).toEqual(ONE('unknown_key', 'datapoints.battery_soc.""'))
  })

  it('a key that is only whitespace is quoted too, at the root and nested', () => {
    satisfiesTheContract(refusalIssues({ fleetless: 1, ' ': 3 }))
    expect(refusalIssues({ fleetless: 1, ' ': 3 })).toEqual(ONE('unknown_key', '" "'))
    expect(
      refusalIssues({
        fleetless: 1,
        datapoints: { battery_soc: { topic: '/battery', type: 'std_msgs/msg/Bool', ' ': 1 } },
      }),
    ).toEqual(ONE('unknown_key', 'datapoints.battery_soc." "'))
  })

  it('an empty key as a section name still names its section', () => {
    // The key is refused as a *name* rather than as an unknown key, so it
    // arrives by the other branch — and the path is built by the same walk.
    const issues = refusalIssues({ fleetless: 1, datapoints: { '': { topic: '/t', type: 'std_msgs/msg/Bool' } } })
    satisfiesTheContract(issues)
    expect(issues[0]!.path).toBe('datapoints.""')
  })

  /**
   * `slug` is **not** quoted — the asymmetry is the point: `path` is
   * rendered to a human hunting the key in their file, while `slug` is
   * compared against a key in the parsed document, and quoting it would
   * break that comparison for the one entry it is about.
   */
  it('leaves slug as the document\'s own key, because slug is looked up rather than read', () => {
    expect(refusalIssues({ fleetless: 1, datapoints: { '': { topic: '/t', type: 'std_msgs/msg/Bool' } } })[0]!.slug).toBe(
      '',
    )
  })
})

describe('formatPath and splitFormatPath', () => {
  it('writes a sequence index in brackets and everything else with dots', () => {
    expect(formatPath(['datapoints', 'a', 'enum', 0])).toBe('datapoints.a.enum[0]')
    expect(formatPath([])).toBe(DOCUMENT_ROOT_PATH)
  })

  it('quotes a segment that would otherwise render as nothing, and only such a segment', () => {
    // The quoted spelling is the segment's JSON string literal, which is also
    // a valid YAML double-quoted key equal to it — so the path is the text the
    // developer had to write to create the key, and they can search for it.
    expect(formatPath([''])).toBe('""')
    expect(formatPath([' '])).toBe('" "')
    expect(formatPath(['\t'])).toBe('"\\t"')
    expect(formatPath(['datapoints', 'battery_soc', ''])).toBe('datapoints.battery_soc.""')
    expect(formatPath(['datapoints', 'battery_soc', ' '])).toBe('datapoints.battery_soc." "')

    // A first segment used to be detected as "nothing written yet", so an
    // empty one was dropped and the path named a *different* key.
    expect(formatPath(['', 'a'])).toBe('"".a')
    expect(formatPath(['', ''])).toBe('"".""')

    // Nothing else is quoted: quoting is for invisibility, not for every name
    // that needs care. A segment containing `.` or `[` stays unquoted — see
    // the test below.
    expect(formatPath(['datapoints', 'battery_soc'])).toBe('datapoints.battery_soc')
    expect(formatPath([' a '])).toBe(' a ')
  })

  it('counts a zero-width character as rendering as nothing, which `trim` does not', () => {
    // `String.prototype.trim` removes Unicode White_Space, and none of these
    // are White_Space — they are format characters. With `isBlank`
    // spelled `segment.trim() === ''`, the first assertion below fails,
    // because the segment is then written bare and a bare zero-width
    // character is a path segment the developer sees as nothing at all — at
    // the end of a path, as a trailing `.`, which is the exact shape this
    // wave fixed for the empty key.
    //
    // The expectations are written as escapes in the SOURCE too, deliberately:
    // a test whose expected string held a literal U+200B would be a test
    // nobody reviewing it could read, about invisibility.
    expect(formatPath(['\u200b'])).toBe('"\\u200b"')
    expect(formatPath(['datapoints', 'battery_soc', '\ufeff'])).toBe('datapoints.battery_soc."\\ufeff"')

    // Mixed with real whitespace, and mixed with each other. The whitespace
    // stays literal — it is `trim`'s business and it is already spellable.
    expect(formatPath([' \u200b\u2060 '])).toBe('" \\u200b\\u2060 "')

    // The escape, not the bare character, is the point: `"\u200b"` and `""`
    // are the same two visible characters, so a path that merely quoted would
    // say "a blank key" without saying WHICH, and the bar this set itself is
    // that the developer can search their own file for the path. `\uXXXX` is
    // a YAML double-quoted escape as well as a JSON one.
    expect(formatPath(['\u200b'])).not.toBe('"\u200b"')

    // A name with something to read in it stays bare, zero-width neighbours
    // and all: the test is "renders as nothing", not "contains an oddity".
    expect(formatPath(['a\u200bb'])).toBe('a\u200bb')

    // And they round-trip, because `unquoteBlank` asks the same predicate and
    // `JSON.parse` reads the escape back.
    for (const segment of ['\u200b', '\ufeff', ' \u200b\u2060 ']) {
      expect(splitFormatPath(formatPath(['datapoints', 'x', segment]))).toEqual(['datapoints', 'x', segment])
    }
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
      // Blank segments round-trip too: quoting made them visible on the way
      // out, and the split reads a quoted blank back rather than handing the
      // console a key with quote characters in it that no document has.
      [''],
      [' '],
      ['\t'],
      ['', 'a'],
      ['datapoints', 'battery_soc', ''],
      ['datapoints', 'battery_soc', ' '],
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

    // Quoting blank segments opened exactly one more of these, and no more
    // than one: a key literally spelled with quote characters *around blank
    // content*. `"x"` is not affected, because only a quoted blank is
    // unquoted on the way back.
    expect(splitFormatPath(formatPath(['datapoints', 'x', '""']))).toEqual(['datapoints', 'x', ''])
    expect(splitFormatPath(formatPath(['datapoints', 'x', '"x"']))).toEqual(['datapoints', 'x', '"x"'])
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
