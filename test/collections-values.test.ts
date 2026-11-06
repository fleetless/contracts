// SPDX-License-Identifier: Apache-2.0
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import {
  COLLECTION_JSON_TEMPLATES,
  COLLECTION_LIMITS,
  checkCollectionValue,
  collectionField,
  normalizeCollectionValue,
  type CollectionField,
} from '../src/index.js'

/** A field as an author writes it, parsed the way a document is. */
const field = (definition: Record<string, unknown>): CollectionField => collectionField.parse(definition)

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const select = (extra: Record<string, unknown> = {}) =>
  field({ type: 'select', options: [{ value: 'note' }, { value: 'fault', label: 'Fault' }], ...extra })

type Row = [name: string, field: CollectionField, value: unknown, code: string | null]

const rows: Row[] = [
  // text
  ['text: a word', field({ type: 'text' }), 'Charger 1', null],
  ['text: an empty string', field({ type: 'text' }), '', null],
  ['text: 255 characters', field({ type: 'text' }), 'a'.repeat(255), null],
  ['text: 256 characters', field({ type: 'text' }), 'a'.repeat(256), 'max_length'],
  ['text: 256 characters with max_length raised', field({ type: 'text', max_length: 300 }), 'a'.repeat(256), null],
  ['text: past a lowered max_length', field({ type: 'text', max_length: 5 }), 'abcdef', 'max_length'],
  ['text: 1000 characters at the highest max_length', field({ type: 'text', max_length: 1000 }), 'a'.repeat(1000), null],
  ['text: 1001 characters at the highest max_length', field({ type: 'text', max_length: 1000 }), 'a'.repeat(1001), 'max_length'],
  ['text: counts characters, not UTF-16 units', field({ type: 'text', max_length: 3 }), '😀😀😀', null],
  ['text: four emoji against three', field({ type: 'text', max_length: 3 }), '😀😀😀😀', 'max_length'],
  ['text: a newline', field({ type: 'text' }), 'one\ntwo', 'type'],
  ['text: a carriage return', field({ type: 'text' }), 'one\rtwo', 'type'],
  ['text: a line separator', field({ type: 'text' }), 'one\u2028two', 'type'],
  ['text: a number', field({ type: 'text' }), 5, 'type'],
  ['text: null', field({ type: 'text' }), null, 'type'],
  ['text: undefined', field({ type: 'text' }), undefined, 'type'],
  ['text: matches its pattern', field({ type: 'text', pattern: '^[A-Z]{2}-\\d+$' }), 'AB-12', null],
  ['text: misses its pattern', field({ type: 'text', pattern: '^[A-Z]{2}-\\d+$' }), 'ab-12', 'pattern'],
  ['text: a pattern is not anchored for you', field({ type: 'text', pattern: 'cell' }), 'a cell here', null],
  ['text: a pattern with unicode classes', field({ type: 'text', pattern: '^\\p{Lu}' }), 'Éclair', null],
  ['text: a pattern that cannot compile never matches', field({ type: 'text', pattern: '(' }), 'x', 'pattern'],

  // long_text
  ['long_text: a paragraph', field({ type: 'long_text' }), 'line one\nline two', null],
  ['long_text: 10000 characters', field({ type: 'long_text' }), 'a'.repeat(10_000), null],
  ['long_text: 10001 characters', field({ type: 'long_text' }), 'a'.repeat(10_001), 'max_length'],
  ['long_text: 100000 at the highest max_length', field({ type: 'long_text', max_length: 100_000 }), 'a'.repeat(100_000), null],
  ['long_text: 100001 at the highest max_length', field({ type: 'long_text', max_length: 100_000 }), 'a'.repeat(100_001), 'max_length'],
  ['long_text: a list', field({ type: 'long_text' }), ['a'], 'type'],

  // number
  ['number: a decimal', field({ type: 'number' }), 1.5, null],
  ['number: negative zero', field({ type: 'number' }), -0, null],
  ['number: a string', field({ type: 'number' }), '1', 'type'],
  ['number: NaN', field({ type: 'number' }), Number.NaN, 'type'],
  ['number: Infinity', field({ type: 'number' }), Number.POSITIVE_INFINITY, 'type'],
  ['number: a boolean', field({ type: 'number' }), true, 'type'],
  ['number: integer:true accepts 2', field({ type: 'number', integer: true }), 2, null],
  ['number: integer:true refuses 1.5', field({ type: 'number', integer: true }), 1.5, 'integer'],
  ['number: at min', field({ type: 'number', min: 0 }), 0, null],
  ['number: below min', field({ type: 'number', min: 0 }), -0.1, 'min'],
  ['number: at max', field({ type: 'number', max: 1.5 }), 1.5, null],
  ['number: above max', field({ type: 'number', max: 1.5 }), 1.6, 'max'],
  ['number: inside min and max', field({ type: 'number', min: 0, max: 2 }), 1, null],

  // boolean
  ['boolean: true', field({ type: 'boolean' }), true, null],
  ['boolean: false', field({ type: 'boolean' }), false, null],
  ['boolean: the text "true"', field({ type: 'boolean' }), 'true', 'type'],
  ['boolean: 1', field({ type: 'boolean' }), 1, 'type'],

  // select
  ['select: an option', select(), 'note', null],
  ['select: an unknown option', select(), 'other', 'option'],
  ['select: the label instead of the value', select(), 'Fault', 'option'],
  ['select: a list on a single select', select(), ['note'], 'type'],
  ['select: a number', select(), 1, 'type'],
  ['select multiple: two options', select({ multiple: true }), ['note', 'fault'], null],
  ['select multiple: one option', select({ multiple: true }), ['fault'], null],
  ['select multiple: an empty list', select({ multiple: true }), [], null],
  ['select multiple: a duplicate', select({ multiple: true }), ['note', 'note'], 'multiple'],
  ['select multiple: an unknown option', select({ multiple: true }), ['note', 'other'], 'option'],
  ['select multiple: a single value', select({ multiple: true }), 'note', 'multiple'],
  ['select multiple: a non-text element', select({ multiple: true }), ['note', 3], 'type'],

  // date
  ['date: a date', field({ type: 'date' }), '2026-11-04', null],
  ['date: a leap day', field({ type: 'date' }), '2028-02-29', null],
  ['date: 2026-02-30 is not a day', field({ type: 'date' }), '2026-02-30', 'date'],
  ['date: 2026-02-29 is not a day', field({ type: 'date' }), '2026-02-29', 'date'],
  ['date: 1900-02-29 is not a day', field({ type: 'date' }), '1900-02-29', 'date'],
  ['date: 2000-02-29 is a day', field({ type: 'date' }), '2000-02-29', null],
  ['date: month 13', field({ type: 'date' }), '2026-13-01', 'date'],
  ['date: day 0', field({ type: 'date' }), '2026-01-00', 'date'],
  ['date: without zero padding', field({ type: 'date' }), '2026-1-4', 'date'],
  ['date: with a time', field({ type: 'date' }), '2026-11-04T10:00:00Z', 'date'],
  ['date: year 0000', field({ type: 'date' }), '0000-01-01', 'date'],
  ['date: not text', field({ type: 'date' }), 20261104, 'type'],

  // datetime
  ['datetime: without fraction', field({ type: 'datetime' }), '2026-11-04T10:00:00Z', null],
  ['datetime: one fractional digit', field({ type: 'datetime' }), '2026-11-04T10:00:00.5Z', null],
  ['datetime: three fractional digits', field({ type: 'datetime' }), '2026-11-04T10:00:00.123Z', null],
  ['datetime: four fractional digits', field({ type: 'datetime' }), '2026-11-04T10:00:00.1234Z', 'datetime'],
  ['datetime: with an offset', field({ type: 'datetime' }), '2026-11-04T10:00:00+01:00', 'datetime'],
  ['datetime: without a zone', field({ type: 'datetime' }), '2026-11-04T10:00:00', 'datetime'],
  ['datetime: a lowercase z', field({ type: 'datetime' }), '2026-11-04T10:00:00z', 'datetime'],
  ['datetime: a space instead of T', field({ type: 'datetime' }), '2026-11-04 10:00:00Z', 'datetime'],
  ['datetime: hour 24', field({ type: 'datetime' }), '2026-11-04T24:00:00Z', 'datetime'],
  ['datetime: minute 60', field({ type: 'datetime' }), '2026-11-04T10:60:00Z', 'datetime'],
  ['datetime: second 60', field({ type: 'datetime' }), '2026-11-04T10:00:60Z', 'datetime'],
  ['datetime: not a day', field({ type: 'datetime' }), '2026-02-30T10:00:00Z', 'datetime'],
  ['datetime: a date only', field({ type: 'datetime' }), '2026-11-04', 'datetime'],
  ['datetime: a number', field({ type: 'datetime' }), 1_762_250_400_000, 'type'],

  // json
  ['json: an object', field({ type: 'json' }), { a: 1 }, null],
  ['json: a list', field({ type: 'json' }), [1, 2], null],
  ['json: a string', field({ type: 'json' }), 'x', null],
  ['json: false', field({ type: 'json' }), false, null],
  ['json: null clears and is not a value', field({ type: 'json' }), null, 'type'],
  ['json: undefined', field({ type: 'json' }), undefined, 'type'],
  ['json: a template name without a validator accepts anything', field({ type: 'json', schema: 'pose2d' }), { nonsense: true }, null],
  ['json: an inline schema without a validator accepts anything', field({ type: 'json', schema: { type: 'number' } }), 'text', null],
  ['json: a template name that does not exist', field({ type: 'json', schema: 'pose3d' }), {}, 'json_schema'],

  // reference
  ['reference: a uuid', field({ type: 'reference', to: 'locations' }), UUID, null],
  ['reference: the nil uuid', field({ type: 'reference', to: 'locations' }), '00000000-0000-0000-0000-000000000000', null],
  ['reference: a non-uuid', field({ type: 'reference', to: 'locations' }), 'not-a-uuid', 'reference_format'],
  ['reference: an empty string', field({ type: 'reference', to: 'locations' }), '', 'reference_format'],
  ['reference: an uppercase uuid', field({ type: 'reference', to: 'locations' }), UUID.toUpperCase(), null],
  ['reference: a mixed-case uuid', field({ type: 'reference', to: 'locations' }), '3F2504e0-4f89-41D3-9a0c-0305E82C3301', null],
  ['reference: a uuid with a non-hex digit', field({ type: 'reference', to: 'locations' }), UUID.replace('3f25', 'zf25'), 'reference_format'],
  ['reference: a uuid with braces', field({ type: 'reference', to: 'locations' }), `{${UUID}}`, 'reference_format'],
  ['reference: a number', field({ type: 'reference', to: 'locations' }), 5, 'type'],
]

describe('checkCollectionValue', () => {
  it.each(rows)('%s', (_name, definition, value, code) => {
    const problem = checkCollectionValue(definition, value)
    expect(problem?.code ?? null).toBe(code)
    if (problem) expect(problem.message.length).toBeGreaterThan(0)
  })

  it('covers every problem code', () => {
    const codes = new Set(rows.map((row) => row[3]).filter((code): code is string => code !== null))
    expect([...codes].sort()).toEqual(
      ['date', 'datetime', 'integer', 'json_schema', 'max', 'max_length', 'min', 'multiple', 'option', 'pattern', 'reference_format', 'type'].sort(),
    )
  })

  it('does not echo a long value in its message', () => {
    const problem = checkCollectionValue(select(), 'x'.repeat(5000))
    expect(problem?.code).toBe('option')
    expect(problem!.message.length).toBeLessThan(200)
  })
})

describe('checkCollectionValue with an injected matchPattern', () => {
  const text = field({ type: 'text', pattern: '^[A-Z]+$' })

  it('lets the matcher decide: its answer wins over the built-in one', () => {
    // The built-in engine would accept 'ABC' and refuse 'abc'; the matcher says the opposite.
    expect(checkCollectionValue(text, 'ABC', { matchPattern: () => false })?.code).toBe('pattern')
    expect(checkCollectionValue(text, 'abc', { matchPattern: () => true })).toBeNull()
  })

  it('hands the matcher the pattern and the value as they are', () => {
    const matchPattern = vi.fn(() => true)
    checkCollectionValue(text, 'ABC', { matchPattern })
    expect(matchPattern).toHaveBeenCalledTimes(1)
    expect(matchPattern).toHaveBeenCalledWith('^[A-Z]+$', 'ABC')
  })

  it('names the pattern in the message when the matcher refuses', () => {
    const problem = checkCollectionValue(text, 'abc', { matchPattern: () => false })
    expect(problem?.message).toContain('^[A-Z]+$')
  })

  it('is not asked for a field without a pattern, or about a value an earlier check refused', () => {
    const matchPattern = vi.fn(() => true)
    expect(checkCollectionValue(field({ type: 'text' }), 'abc', { matchPattern })).toBeNull()
    expect(checkCollectionValue(text, 'AB\nC', { matchPattern })?.code).toBe('type')
    expect(checkCollectionValue(field({ type: 'text', pattern: '^A', max_length: 3 }), 'AAAA', { matchPattern })?.code).toBe('max_length')
    expect(checkCollectionValue(text, 5, { matchPattern })?.code).toBe('type')
    expect(matchPattern).not.toHaveBeenCalled()
  })

  it('reports a pattern the matcher cannot compile like one the built-in engine cannot', () => {
    const matchPattern = () => {
      throw new Error('invalid expression')
    }
    const problem = checkCollectionValue(text, 'ABC', { matchPattern })
    expect(problem?.code).toBe('pattern')
    expect(problem).toEqual(checkCollectionValue(field({ type: 'text', pattern: '(' }), 'ABC'))
  })

  it('leaves behaviour as it was without a matcher', () => {
    expect(checkCollectionValue(text, 'ABC')).toBeNull()
    expect(checkCollectionValue(text, 'abc')?.code).toBe('pattern')
    expect(checkCollectionValue(text, 'abc', {})?.code).toBe('pattern')
  })
})

describe('checkCollectionValue refuses a NUL character', () => {
  const NUL = '\u0000'

  it.each([
    ['text', field({ type: 'text' })],
    ['long_text', field({ type: 'long_text' })],
  ])('in a %s value, as a type problem that names it', (_name, definition) => {
    for (const value of [`a${NUL}b`, NUL, `abc${NUL}`]) {
      const problem = checkCollectionValue(definition, value)
      expect(problem?.code, JSON.stringify(value)).toBe('type')
      expect(problem?.message).toContain('NUL')
    }
    expect(checkCollectionValue(definition, 'a b')).toBeNull()
  })

  it('in a text value that also has a pattern, before the pattern is asked', () => {
    const matchPattern = vi.fn(() => true)
    expect(checkCollectionValue(field({ type: 'text', pattern: '.' }), `a${NUL}`, { matchPattern })?.code).toBe('type')
    expect(matchPattern).not.toHaveBeenCalled()
  })

  describe('in a json value', () => {
    const json = field({ type: 'json' })

    it.each([
      ['a string', `a${NUL}b`],
      ['a string in a list', ['ok', `a${NUL}`]],
      ['a string in an object', { note: `a${NUL}b` }],
      ['a key of an object', { [`a${NUL}`]: 1 }],
      ['a string far down', { a: [{ b: { c: [`x${NUL}`] } }] }],
    ])('%s', (_name, value) => {
      const problem = checkCollectionValue(json, value)
      expect(problem?.code).toBe('type')
      expect(problem?.message).toContain('NUL')
    })

    it('but accepts the escaped text of a NUL and every other value', () => {
      expect(checkCollectionValue(json, { a: '\\u0000', b: [1, null, true, 'x'], c: {} })).toBeNull()
      expect(checkCollectionValue(json, 'plain')).toBeNull()
      expect(checkCollectionValue(json, [])).toBeNull()
    })

    it('before the JSON schema is asked', () => {
      const validateJsonValue = vi.fn(() => null)
      const pose = field({ type: 'json', schema: 'pose2d' })
      const problem = checkCollectionValue(pose, { x: 1, y: 2, yaw: 0, frame_id: `map${NUL}` }, { validateJsonValue })
      expect(problem?.code).toBe('type')
      expect(validateJsonValue).not.toHaveBeenCalled()
    })

    it('in a value nested too deep for recursion', () => {
      let deep: unknown = `x${NUL}`
      for (let i = 0; i < 200_000; i += 1) deep = [deep]
      expect(checkCollectionValue(json, deep)?.code).toBe('type')
    })
  })

  describe('in a json value that nests arrays and objects', () => {
    const json = field({ type: 'json' })
    const nested = (levels: number, innermost: unknown = 'x', wrap: (inner: unknown) => unknown = (inner) => [inner]): unknown => {
      let value = innermost
      for (let i = 0; i < levels; i += 1) value = wrap(value)
      return value
    }

    it('accepts 32 levels and refuses the 33rd, for lists and objects alike, with a type problem', () => {
      expect(COLLECTION_LIMITS.jsonDepth).toBe(32)
      expect(checkCollectionValue(json, nested(32))).toBeNull()
      expect(checkCollectionValue(json, nested(32, 'x', (inner) => ({ a: inner })))).toBeNull()
      for (const wrap of [(inner: unknown) => [inner], (inner: unknown) => ({ a: inner })]) {
        const problem = checkCollectionValue(json, nested(33, 'x', wrap))
        expect(problem?.code).toBe('type')
        expect(problem?.message).toMatch(/32 levels/)
      }
    })

    it('counts levels of containers, not the width, and lets any number of siblings through', () => {
      expect(checkCollectionValue(json, [nested(31), nested(31), { a: nested(30) }])).toBeNull()
      expect(checkCollectionValue(json, Array.from({ length: 100_000 }, () => [1]))).toBeNull()
      expect(checkCollectionValue(json, { a: [nested(31), nested(32)] })).not.toBeNull()
    })

    it('refuses a value that contains itself instead of looping', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      expect(checkCollectionValue(json, cyclic)?.code).toBe('type')
    })

    it('asks for the depth before the JSON Schema, which then never meets a value it cannot read', () => {
      const validateJsonValue = vi.fn(() => null)
      expect(checkCollectionValue(field({ type: 'json', schema: { type: 'array' } }), nested(40), { validateJsonValue })?.code).toBe('type')
      expect(validateJsonValue).not.toHaveBeenCalled()
    })
  })

  it('does not look at values that are not text', () => {
    expect(checkCollectionValue(field({ type: 'number' }), 1)).toBeNull()
    expect(checkCollectionValue(field({ type: 'boolean' }), true)).toBeNull()
  })
})

describe('checkCollectionValue refuses half of a surrogate pair', () => {
  // A database that keeps records as JSON refuses a code unit from U+D800 to U+DFFF that is not part of a pair.
  const HIGH = '\ud83d'
  const LOW = '\ude00'
  const PAIR = HIGH + LOW

  const lone: [string, string][] = [
    ['a high half alone', HIGH],
    ['a low half alone', LOW],
    ['a high half at the end', `abc${HIGH}`],
    ['a high half before a letter', `a${HIGH}b`],
    ['a low half at the start', `${LOW}abc`],
    ['a low half after a letter', `a${LOW}b`],
    ['two high halves in a row', `${HIGH}${HIGH}`],
    ['two low halves in a row', `${LOW}${LOW}`],
    ['the halves in the wrong order', `${LOW}${HIGH}`],
    ['a pair and then a stray half', `${PAIR}${HIGH}`],
    ['a stray half and then a pair', `${LOW}${PAIR}`],
  ]

  it.each([
    ['text', field({ type: 'text' })],
    ['long_text', field({ type: 'long_text' })],
  ])('in a %s value, as a type problem that names it', (_name, definition) => {
    for (const [what, value] of lone) {
      const problem = checkCollectionValue(definition, value)
      expect(problem?.code, what).toBe('type')
      expect(problem?.message, what).toContain('surrogate')
    }
  })

  it.each([
    ['text', field({ type: 'text' })],
    ['long_text', field({ type: 'long_text' })],
  ])('but accepts a whole pair in a %s value, wherever it is', (_name, definition) => {
    for (const value of [PAIR, `a${PAIR}b`, `${PAIR}${PAIR}`, `${PAIR} end`, 'start \u{1F600}', '\u{10FFFF}', '\u{10000}x']) {
      expect(checkCollectionValue(definition, value), JSON.stringify(value)).toBeNull()
    }
  })

  it('before the pattern is asked, as for a NUL character', () => {
    const matchPattern = vi.fn(() => true)
    expect(checkCollectionValue(field({ type: 'text', pattern: '.' }), `a${HIGH}`, { matchPattern })?.code).toBe('type')
    expect(matchPattern).not.toHaveBeenCalled()
  })

  describe('in a json value', () => {
    const json = field({ type: 'json' })

    it.each([
      ['a string', `a${HIGH}b`],
      ['a low half as a string', LOW],
      ['a string in a list', ['ok', `a${LOW}`]],
      ['a string in an object', { note: `a${HIGH}` }],
      ['a key of an object', { [`a${HIGH}`]: 1 }],
      ['a key that is a low half', { [LOW]: 1 }],
      ['a string far down', { a: [{ b: { c: [`x${HIGH}`] } }] }],
    ])('%s', (_name, value) => {
      const problem = checkCollectionValue(json, value)
      expect(problem?.code).toBe('type')
      expect(problem?.message).toContain('surrogate')
    })

    it('but accepts whole pairs, and the escaped text of a half', () => {
      expect(checkCollectionValue(json, { [PAIR]: PAIR, list: [PAIR, `a${PAIR}b`] })).toBeNull()
      expect(checkCollectionValue(json, { a: '\\ud800', b: 'plain' })).toBeNull()
    })

    it('before the JSON schema is asked', () => {
      const validateJsonValue = vi.fn(() => null)
      const pose = field({ type: 'json', schema: 'pose2d' })
      expect(checkCollectionValue(pose, { x: 1, y: 2, yaw: 0, frame_id: `map${HIGH}` }, { validateJsonValue })?.code).toBe('type')
      expect(validateJsonValue).not.toHaveBeenCalled()
    })

    it('in a value nested too deep for recursion', () => {
      let deep: unknown = `x${HIGH}`
      for (let i = 0; i < 200_000; i += 1) deep = [deep]
      expect(checkCollectionValue(json, deep)?.code).toBe('type')
    })
  })

  it('reads a long text in one pass', () => {
    const longText = field({ type: 'long_text', max_length: 100_000 })
    const started = performance.now()
    expect(checkCollectionValue(longText, 'a'.repeat(100_000))).toBeNull()
    expect(checkCollectionValue(longText, `${'a'.repeat(99_999)}${HIGH}`)?.code).toBe('type')
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('checkCollectionValue on json fields', () => {
  it('json with a template name calls validateJsonValue with the template schema', () => {
    const validateJsonValue = vi.fn(() => null)
    const value = { x: 1, y: 2, yaw: 0, frame_id: 'map' }
    expect(checkCollectionValue(field({ type: 'json', schema: 'pose2d' }), value, { validateJsonValue })).toBeNull()
    expect(validateJsonValue).toHaveBeenCalledTimes(1)
    expect(validateJsonValue).toHaveBeenCalledWith(COLLECTION_JSON_TEMPLATES.pose2d, value)
  })

  it('hands an inline schema to validateJsonValue as it is', () => {
    const schema = { type: 'object', required: ['a'] }
    const validateJsonValue = vi.fn(() => null)
    checkCollectionValue(field({ type: 'json', schema }), { a: 1 }, { validateJsonValue })
    expect(validateJsonValue).toHaveBeenCalledWith(schema, { a: 1 })
  })

  it('reports what the validator says as json_schema', () => {
    const validateJsonValue = () => 'must have required property yaw'
    const problem = checkCollectionValue(field({ type: 'json', schema: 'pose2d' }), {}, { validateJsonValue })
    expect(problem).toEqual({ code: 'json_schema', message: 'must have required property yaw' })
  })

  it('does not call the validator for a field without a schema, or for a value that failed an earlier check', () => {
    const validateJsonValue = vi.fn(() => null)
    expect(checkCollectionValue(field({ type: 'json' }), { a: 1 }, { validateJsonValue })).toBeNull()
    expect(checkCollectionValue(field({ type: 'json', schema: 'pose2d' }), null, { validateJsonValue })?.code).toBe('type')
    expect(validateJsonValue).not.toHaveBeenCalled()
  })

  it('works with a real JSON Schema validator', () => {
    const ajv = new Ajv2020({ strict: false })
    const validateJsonValue = (schema: unknown, value: unknown) => {
      const validate = ajv.compile(schema as object)
      return validate(value) ? null : ajv.errorsText(validate.errors)
    }
    const pose = field({ type: 'json', schema: 'pose2d' })
    expect(checkCollectionValue(pose, { x: 1, y: 2, yaw: 0, frame_id: 'map' }, { validateJsonValue })).toBeNull()
    expect(checkCollectionValue(pose, { x: 1, y: 2, yaw: 0 }, { validateJsonValue })?.code).toBe('json_schema')
    expect(checkCollectionValue(pose, { x: 1, y: 2, yaw: 0, frame_id: 'map', z: 3 }, { validateJsonValue })?.code).toBe('json_schema')
    const inline = field({ type: 'json', schema: { type: 'array', items: { type: 'string' }, maxItems: 2 } })
    expect(checkCollectionValue(inline, ['a', 'b'], { validateJsonValue })).toBeNull()
    expect(checkCollectionValue(inline, ['a', 'b', 'c'], { validateJsonValue })?.code).toBe('json_schema')
  })
})

describe('normalizeCollectionValue', () => {
  const datetime = field({ type: 'datetime' })

  it.each([
    ['2026-11-04T10:00:00Z', '2026-11-04T10:00:00.000Z'],
    ['2026-11-04T10:00:00.5Z', '2026-11-04T10:00:00.500Z'],
    ['2026-11-04T10:00:00.12Z', '2026-11-04T10:00:00.120Z'],
    ['2026-11-04T10:00:00.123Z', '2026-11-04T10:00:00.123Z'],
  ])('datetime %s becomes %s', (value, expected) => {
    expect(normalizeCollectionValue(datetime, value)).toBe(expected)
    // What it produces is always acceptable.
    expect(checkCollectionValue(datetime, normalizeCollectionValue(datetime, value))).toBeNull()
  })

  it('leaves a datetime it does not understand alone', () => {
    expect(normalizeCollectionValue(datetime, 'tomorrow')).toBe('tomorrow')
    expect(normalizeCollectionValue(datetime, '2026-11-04T10:00:00+01:00')).toBe('2026-11-04T10:00:00+01:00')
    expect(normalizeCollectionValue(datetime, 5)).toBe(5)
  })

  describe('reference ids', () => {
    const reference = field({ type: 'reference', to: 'locations' })

    it('are stored in lowercase, whatever case they arrive in', () => {
      expect(normalizeCollectionValue(reference, UUID.toUpperCase())).toBe(UUID)
      expect(normalizeCollectionValue(reference, '3F2504e0-4f89-41D3-9a0c-0305E82C3301')).toBe(UUID)
      expect(normalizeCollectionValue(reference, UUID)).toBe(UUID)
    })

    it('make an uppercase and a lowercase spelling one value', () => {
      expect(normalizeCollectionValue(reference, UUID.toUpperCase())).toBe(normalizeCollectionValue(reference, UUID))
      // What it produces is always acceptable.
      expect(checkCollectionValue(reference, normalizeCollectionValue(reference, UUID.toUpperCase()))).toBeNull()
    })

    it('leave something that is not an id alone', () => {
      expect(normalizeCollectionValue(reference, 'NOT-A-UUID')).toBe('NOT-A-UUID')
      expect(normalizeCollectionValue(reference, `{${UUID.toUpperCase()}}`)).toBe(`{${UUID.toUpperCase()}}`)
      expect(normalizeCollectionValue(reference, 5)).toBe(5)
    })

    it('are the only text that changes case: a text field keeps its capitals', () => {
      expect(normalizeCollectionValue(field({ type: 'text' }), UUID.toUpperCase())).toBe(UUID.toUpperCase())
    })
  })

  it('leaves every other type unchanged', () => {
    expect(normalizeCollectionValue(field({ type: 'text' }), '2026-11-04T10:00:00Z')).toBe('2026-11-04T10:00:00Z')
    expect(normalizeCollectionValue(field({ type: 'date' }), '2026-11-04')).toBe('2026-11-04')
    expect(normalizeCollectionValue(field({ type: 'number' }), 1)).toBe(1)
    const object = { a: 1 }
    expect(normalizeCollectionValue(field({ type: 'json' }), object)).toBe(object)
    expect(normalizeCollectionValue(select({ multiple: true }), ['note'])).toEqual(['note'])
  })
})
