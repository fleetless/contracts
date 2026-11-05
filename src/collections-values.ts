// SPDX-License-Identifier: Apache-2.0
import { COLLECTION_LIMITS, type CollectionField } from './collections.js'
import { COLLECTION_JSON_TEMPLATES } from './collections-templates.js'

/**
 * Whether a value fits a field, written once for everyone who has to ask.
 *
 * The cloud asks it for every record write and import row, and the document
 * asks it of a field's `default` (`collectionsDocumentIssues`). One function
 * answers both, so a default the document accepts is a value a write accepts.
 *
 * It judges **a value**, and `null` is not one: in a write `null` clears a
 * field, so a caller handles it before asking. Whether an empty value is
 * allowed (`required`) and whether it repeats (`unique`) are record questions,
 * not value questions, and are decided by the caller.
 */

/** What is wrong with a value: a stable code to branch on, and a sentence for a person. */
export type CollectionValueProblem = { code: string; message: string }

export type CollectionValueOptions = {
  /**
   * Checks a JSON value against a JSON Schema and returns what is wrong with
   * it, or `null`. Contracts has no JSON Schema validator of its own, so the
   * caller supplies one; without it a `json` value is accepted as it is. It is
   * handed the schema itself: for a template name, the template's schema.
   */
  validateJsonValue?: (schema: unknown, value: unknown) => string | null
  /**
   * Whether `value` matches the regular expression `pattern` of a `text`
   * field. Patterns are written in the RE2 subset and the server matches them
   * with an RE2 engine, whose time grows with the text and not with the
   * pattern. Contracts has no such engine, and the JavaScript one can take
   * exponential time for a pattern such as `(a+)+$`, so the server passes its
   * own. Without one the JavaScript engine is used, which suits feedback on an
   * author's own pattern in a browser and not matching what other people send.
   * It throws for a pattern it cannot compile; that is reported like a pattern
   * the JavaScript engine cannot compile.
   */
  matchPattern?: (pattern: string, value: string) => boolean
}

const problem = (code: string, message: string): CollectionValueProblem => ({ code, message })

/** A value for a message: long text is cut, so a refusal never repeats a megabyte back. */
const quote = (value: string): string => (value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`)

/** The length of a string in characters rather than UTF-16 units, so an emoji counts as one. */
function characters(value: string): number {
  let count = 0
  for (const _ of value) count += 1
  return count
}

const LINE_BREAK = /[\r\n\u2028\u2029]/
const NUL = '\u0000'
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/
/**
 * A record id in either letter case. RFC 4122 treats the two as one id and
 * clients differ in what they print (Swift writes uppercase), so both are
 * accepted; `normalizeCollectionValue` then stores the one lowercase spelling.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isCalendarDay(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]!
}

/**
 * Patterns are compiled once and reused: an import checks the same pattern for
 * every row. A `u` regular expression without the `g` or `y` flag keeps no state
 * between calls, so sharing one is safe. The cache is cleared when it grows, so
 * it cannot hold on to the patterns of a long-running process forever.
 */
const patterns = new Map<string, RegExp | null>()
function compile(pattern: string): RegExp | null {
  const known = patterns.get(pattern)
  if (known !== undefined) return known
  let compiled: RegExp | null
  try {
    compiled = new RegExp(pattern, 'u')
  } catch {
    compiled = null
  }
  if (patterns.size >= 256) patterns.clear()
  patterns.set(pattern, compiled)
  return compiled
}

/**
 * Does a string, or a key of an object, anywhere in `value` hold a NUL
 * character? A database that stores records as JSON cannot hold one, so it is
 * refused here and not left to fail at the write. Walked with a list of what is
 * left to look at and not by recursion, because a value nested a hundred
 * thousand levels deep must be refused, not crash the stack.
 */
function containsNul(value: unknown): boolean {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const item = pending.pop()
    if (typeof item === 'string') {
      if (item.includes(NUL)) return true
    } else if (Array.isArray(item)) {
      for (const child of item) pending.push(child)
    } else if (typeof item === 'object' && item !== null) {
      for (const [key, child] of Object.entries(item)) {
        if (key.includes(NUL)) return true
        pending.push(child)
      }
    }
  }
  return false
}

/**
 * Whether `value` matches `pattern`, by the injected matcher or else by the
 * JavaScript engine. `null` means the pattern cannot be compiled.
 */
function matchesPattern(pattern: string, value: string, options: CollectionValueOptions): boolean | null {
  if (options.matchPattern !== undefined) {
    try {
      return options.matchPattern(pattern, value)
    } catch {
      return null
    }
  }
  const expression = compile(pattern)
  return expression === null ? null : expression.test(value)
}

/**
 * Checks `value` against `field`. Returns `null` when it fits and the first
 * problem when it does not.
 *
 * The codes are `type` (the wrong kind of value, or a line break in `text`),
 * `max_length`, `pattern`, `min`, `max`, `integer`, `option`, `multiple`,
 * `date`, `datetime`, `json_schema` and `reference_format`.
 */
export function checkCollectionValue(
  field: CollectionField,
  value: unknown,
  options: CollectionValueOptions = {},
): CollectionValueProblem | null {
  if (value === null || value === undefined) {
    return problem('type', 'Expected a value. null clears a field and is not itself a value.')
  }
  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return problem('type', 'Expected text.')
      if (value.includes(NUL)) return problem('type', 'The text contains a NUL character (U+0000), which cannot be stored.')
      if (LINE_BREAK.test(value)) return problem('type', 'Expected one line of text. Line breaks belong in long_text fields.')
      const max = Math.min(field.max_length ?? COLLECTION_LIMITS.textDefault, COLLECTION_LIMITS.textMax)
      if (value.length > max && characters(value) > max) {
        return problem('max_length', `Too long: the text has ${characters(value)} characters and the field allows ${max}.`)
      }
      if (field.pattern !== undefined) {
        const matched = matchesPattern(field.pattern, value, options)
        if (matched === null) return problem('pattern', 'The pattern of this field is not a valid regular expression, so no text can match it.')
        if (!matched) return problem('pattern', `The text does not match the pattern ${quote(field.pattern)}.`)
      }
      return null
    }
    case 'long_text': {
      if (typeof value !== 'string') return problem('type', 'Expected text.')
      if (value.includes(NUL)) return problem('type', 'The text contains a NUL character (U+0000), which cannot be stored.')
      const max = Math.min(field.max_length ?? COLLECTION_LIMITS.longTextDefault, COLLECTION_LIMITS.longTextMax)
      if (value.length > max && characters(value) > max) {
        return problem('max_length', `Too long: the text has ${characters(value)} characters and the field allows ${max}.`)
      }
      return null
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return problem('type', 'Expected a number.')
      if (field.integer === true && !Number.isInteger(value)) return problem('integer', `Expected a whole number, got ${value}.`)
      if (field.min !== undefined && value < field.min) return problem('min', `${value} is below the smallest allowed value, ${field.min}.`)
      if (field.max !== undefined && value > field.max) return problem('max', `${value} is above the largest allowed value, ${field.max}.`)
      return null
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : problem('type', 'Expected true or false.')
    case 'select': {
      const allowed = new Set(field.options.map((option) => option.value))
      if (field.multiple !== true) {
        if (typeof value !== 'string') return problem('type', 'Expected the value of one option, as text.')
        return allowed.has(value) ? null : problem('option', `${quote(value)} is not one of the options.`)
      }
      if (!Array.isArray(value)) return problem('multiple', 'Expected a list of option values.')
      const seen = new Set<string>()
      for (const item of value) {
        if (typeof item !== 'string') return problem('type', 'Expected every option in the list as text.')
        if (seen.has(item)) return problem('multiple', `${quote(item)} is in the list twice.`)
        if (!allowed.has(item)) return problem('option', `${quote(item)} is not one of the options.`)
        seen.add(item)
      }
      return null
    }
    case 'date': {
      if (typeof value !== 'string') return problem('type', 'Expected a date as text.')
      const match = DATE.exec(value)
      if (match === null || !isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]))) {
        return problem('date', `${quote(value)} is not a calendar date written as YYYY-MM-DD.`)
      }
      return null
    }
    case 'datetime': {
      if (typeof value !== 'string') return problem('type', 'Expected a date and time as text.')
      const match = DATETIME.exec(value)
      const [, year, month, day, hour, minute, second] = match ?? []
      if (
        match === null ||
        !isCalendarDay(Number(year), Number(month), Number(day)) ||
        Number(hour) > 23 ||
        Number(minute) > 59 ||
        Number(second) > 59
      ) {
        return problem('datetime', `${quote(value)} is not a UTC time written as YYYY-MM-DDTHH:MM:SS.sssZ, with up to three fractional digits.`)
      }
      return null
    }
    case 'json': {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        return problem('type', 'Expected a JSON value.')
      }
      if (containsNul(value)) {
        return problem('type', 'The value contains a NUL character (U+0000) in a string or a key, which cannot be stored.')
      }
      if (field.schema === undefined) return null
      let schema: unknown = field.schema
      if (typeof field.schema === 'string') {
        if (!Object.hasOwn(COLLECTION_JSON_TEMPLATES, field.schema)) {
          return problem('json_schema', `${quote(field.schema)} is not the name of a JSON template.`)
        }
        schema = COLLECTION_JSON_TEMPLATES[field.schema as keyof typeof COLLECTION_JSON_TEMPLATES]
      }
      const refusal = options.validateJsonValue?.(schema, value) ?? null
      return refusal === null ? null : problem('json_schema', refusal)
    }
    case 'reference': {
      if (typeof value !== 'string') return problem('type', 'Expected the id of a record, as text.')
      return UUID.test(value) ? null : problem('reference_format', `${quote(value)} is not a record id. An id is a UUID.`)
    }
  }
}

/**
 * The one spelling a value is stored and compared in. A datetime always has
 * three fractional digits, so `…:00Z`, `…:00.5Z` and `…:00.500Z` are one value
 * for `unique`, filters and sorting; a reference is always a lowercase UUID, so
 * `3F25…` and `3f25…` are one record for `unique`, filters and joins. Every
 * other value is returned unchanged, and so is anything that is not a datetime
 * or an id this module understands.
 */
export function normalizeCollectionValue(field: CollectionField, value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (field.type === 'reference') return UUID.test(value) ? value.toLowerCase() : value
  if (field.type !== 'datetime') return value
  const match = DATETIME.exec(value)
  if (match === null) return value
  return `${value.slice(0, 19)}.${(match[7] ?? '').padEnd(3, '0')}Z`
}
