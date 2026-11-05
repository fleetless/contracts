// SPDX-License-Identifier: Apache-2.0
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import {
  COLLECTION_JSON_TEMPLATES,
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
  ['reference: an uppercase uuid is not the canonical spelling', field({ type: 'reference', to: 'locations' }), UUID.toUpperCase(), 'reference_format'],
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

  it('leaves every other type unchanged', () => {
    expect(normalizeCollectionValue(field({ type: 'text' }), '2026-11-04T10:00:00Z')).toBe('2026-11-04T10:00:00Z')
    expect(normalizeCollectionValue(field({ type: 'date' }), '2026-11-04')).toBe('2026-11-04')
    expect(normalizeCollectionValue(field({ type: 'number' }), 1)).toBe(1)
    const object = { a: 1 }
    expect(normalizeCollectionValue(field({ type: 'json' }), object)).toBe(object)
    expect(normalizeCollectionValue(select({ multiple: true }), ['note'])).toEqual(['note'])
  })
})
