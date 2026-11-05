// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { wireSeqCursor } from './common.js'
import {
  COLLECTION_LIMITS,
  COLLECTION_RESERVED_KEYS,
  collectionBinding,
  collectionField,
  collectionKey,
} from './collections.js'

/**
 * The records of a collection as they travel: what a read returns, what a
 * write sends, and the two small languages a list query is written in, the
 * filter and the sort.
 *
 * **A record is an envelope, not a flat object.** The record's own values sit
 * under `values`, next to the system fields that describe the record (`id`,
 * who created it, its revision) and the answers the cloud works out for the
 * reader (`display`, `missing_required`). A flat object would have to share one
 * namespace between a developer's field keys and ours, and every system field
 * added later would be a chance to collide with a field somebody already has.
 *
 * **The filter is parsed, not described.** Its grammar (nesting, a count of
 * conditions, one operator per condition) cannot be written as a zod schema
 * without losing the one thing a person typing a filter needs, which is to be
 * told where it is wrong. `parseCollectionFilter` returns every problem with
 * the path of the object that has it. It judges the *shape* of a filter; whether
 * a field exists and whether a value suits its type needs the document, and is
 * the cloud's to answer.
 */

/** The cap on problems reported for one filter: enough to fix a filter in one go, few enough to read. */
const MAX_FILTER_ISSUES = 20

const timestamp = z.iso.datetime()
const count = z.number().int().min(0)
const schemaVersion = z.number().int().min(1)

/**
 * Who made a change. `fleetless` is the platform itself (a schema change, an
 * automatic record) and always carries the nil id. `label` is worked out when
 * the record is read, so a user who has since been deleted reads `Deleted user`
 * instead of leaving the record with a dangling id.
 */
export const collectionActor = z
  .object({
    kind: z.enum(['developer', 'app_user', 'server_key', 'fleetless']).meta({
      description: 'What made the change: a developer, a user of the app, a server key of the app, or the platform itself.',
    }),
    id: z.uuid().meta({ description: 'The id of the developer, app user or server key. The nil id for the platform.' }),
    label: z.string().min(1).max(200).meta({ description: 'A name to show: an email address, a key name, `Fleetless`, or `Deleted user` when the user no longer exists.' }),
  })
  .meta({ description: 'Who or what made a change to a record.' })
export type CollectionActor = z.infer<typeof collectionActor>

/**
 * One record. `display` is the collection's display template rendered for this
 * record, so a list can name its rows without knowing the template.
 */
export const collectionRecord = z
  .object({
    id: z.uuid(),
    robot_id: z.uuid().nullable().meta({
      description: 'The robot a record of a `per_robot` or `one_per_robot` collection belongs to; null in a `global` collection.',
    }),
    created_at: timestamp,
    created_by: collectionActor,
    updated_at: timestamp,
    updated_by: collectionActor,
    revision: z.number().int().min(1).meta({ description: 'Starts at 1 and grows by one with every change. Send it as `expected_revision` to refuse a write that would overwrite a newer one.' }),
    display: z.string().meta({ description: 'The collection\'s display template filled in for this record.' }),
    missing_required: z
      .array(z.string())
      .meta({
        description:
          'Required fields that are empty because the schema changed after the record was written. The record can still be updated in its other fields. Absent when nothing is missing.',
      })
      .optional(),
    values: z.record(z.string(), z.unknown()).meta({
      description:
        'The record\'s fields by key. A field without a value is absent. With `expand`, a reference field holds the referenced record in this same shape instead of its id, when the caller may read that collection.',
    }),
  })
  .meta({ description: 'A record of a collection: its system fields and its values.' })
export type CollectionRecord = z.infer<typeof collectionRecord>

// ---------------------------------------------------------------------------
// The filter and the sort
// ---------------------------------------------------------------------------

/** The operators a filter condition can use. */
export const COLLECTION_FILTER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in', 'empty'] as const
export type CollectionFilterOp = (typeof COLLECTION_FILTER_OPS)[number]

/**
 * The system fields a filter or sort may name. The other system values
 * (`revision`, `updated_by`, `robot`) are not filterable; a robot is chosen
 * with the `robot` parameter of a list.
 */
export const COLLECTION_FILTER_SYSTEM_KEYS = ['id', 'robot_id', 'created_at', 'updated_at', 'created_by'] as const

/** A filter on the wire: a JSON object. Its grammar is checked by `parseCollectionFilter`. */
export const collectionFilter = z.record(z.string(), z.unknown()).meta({
  description:
    'A filter is a JSON object. A condition names a field and one operator: `{ "location.name": { "eq": "XTD1" } }`. The operators are `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `contains` (case-insensitive text search), `in` (a list of at most 100 values) and `empty` (`true` or `false`). Conditions are combined with `{ "and": [ ... ] }` and `{ "or": [ ... ] }`, nested at most 3 levels deep, 50 conditions in all. A field is a field key, `reference.field` to go one hop through a reference field, or one of the system fields `id`, `robot_id`, `created_at`, `updated_at` and `created_by`.',
})
export type CollectionFilter = z.infer<typeof collectionFilter>

/** A filter once its shape has been checked. */
export type CollectionFilterNode =
  | { kind: 'and' | 'or'; children: CollectionFilterNode[] }
  | { kind: 'condition'; field: string; op: CollectionFilterOp; value: unknown }

/** One thing wrong with a filter: `path` is a JSON Pointer (RFC 6901) into it, empty for the filter as a whole. */
export type CollectionFilterIssue = { path: string; message: string }

export type CollectionFilterParse =
  | { ok: true; node: CollectionFilterNode }
  | { ok: false; issues: CollectionFilterIssue[] }

/** A value for a message: long text is cut, so a refusal never repeats a megabyte back. */
const quote = (value: string): string => (value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The text, number and true/false values that conditions compare with. A `null` is not one: `empty` asks for "no value". */
const isPlainValue = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

const kindOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'an object' : `a ${typeof value}`

const RESERVED: readonly string[] = COLLECTION_RESERVED_KEYS
const SYSTEM_FILTER_KEYS: readonly string[] = COLLECTION_FILTER_SYSTEM_KEYS
const isFilterOp = (op: string): op is CollectionFilterOp => (COLLECTION_FILTER_OPS as readonly string[]).includes(op)

/** A segment of a JSON Pointer, with the two characters the syntax reserves escaped. */
const pointerSegment = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * Why `field` cannot be filtered or sorted by, or `null`.
 *
 * A field is a key, or `reference.field`: one hop through a reference field,
 * never two. A key that is reserved for a system value is allowed only where
 * that value can be filtered. A reference field is a developer's field, so a
 * reserved key cannot start a hop; its target's system fields can end one.
 */
function fieldProblem(field: string): string | null {
  const parts = field.split('.')
  if (parts.length > 2) {
    return `${quote(field)} goes through more than one reference. A field can go through one: "location.name".`
  }
  if (!parts.every((part) => collectionKey.safeParse(part).success)) {
    return `${quote(field)} is not a field key. A key is lowercase letters, digits and underscores, starting with a letter, up to 63 characters.`
  }
  const [first, second] = parts as [string, string | undefined]
  const unusable = (key: string): string =>
    `${quote(key)} is a system value that cannot be filtered or sorted by. The system fields that can be: ${COLLECTION_FILTER_SYSTEM_KEYS.join(', ')}.`
  if (second === undefined) return RESERVED.includes(first) && !SYSTEM_FILTER_KEYS.includes(first) ? unusable(first) : null
  if (RESERVED.includes(first)) return `${quote(first)} is not a reference field, so ${quote(field)} cannot go through it.`
  return RESERVED.includes(second) && !SYSTEM_FILTER_KEYS.includes(second) ? unusable(second) : null
}

/**
 * Checks the shape of a filter and turns it into a tree.
 *
 * **What is checked.** An object is either a combination, `{ "and": [...] }`
 * or `{ "or": [...] }`, which has no other keys, or a condition, `{ "<field>":
 * { "<operator>": value } }`, which names one field and holds one operator.
 * Nesting goes at most 3 levels deep and the filter has at most 50 conditions.
 * Every operator checks its value: `eq` and `ne` take text, a number or
 * `true`/`false`, the four order operators take a number or text (dates are
 * text), `contains` takes text, `in` takes 1 to 100 of those values and `empty`
 * takes `true` or `false`. Values keep their type; nothing is coerced.
 *
 * **What is not checked.** Whether the fields exist, and whether a value suits
 * the type of its field, need the document. The tree keeps the field and the
 * value exactly as written for the cloud to judge.
 *
 * `and`/`or` are always combinations, so a field called `and` or `or` cannot
 * be filtered by. An empty object and an empty `and`/`or` list are refused
 * rather than given a meaning; leave the filter out to list everything.
 */
export function parseCollectionFilter(input: unknown): CollectionFilterParse {
  const issues: CollectionFilterIssue[] = []
  let conditions = 0
  const report = (path: readonly string[], message: string): void => {
    if (issues.length < MAX_FILTER_ISSUES) issues.push({ path: path.map((s) => `/${pointerSegment(s)}`).join(''), message })
  }

  /** The value of one condition, checked for its operator. Reports and returns false when it is wrong. */
  const operandIsValid = (op: CollectionFilterOp, operand: unknown, path: readonly string[]): boolean => {
    switch (op) {
      case 'eq':
      case 'ne':
        if (isPlainValue(operand)) return true
        report(
          path,
          `"${op}" compares with text, a number or true/false, not ${kindOf(operand)}.${operand === null ? ' To find records without a value, use { "empty": true }.' : ''}`,
        )
        return false
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        if (typeof operand === 'string' || (typeof operand === 'number' && Number.isFinite(operand))) return true
        report(path, `"${op}" compares with a number or text, not ${kindOf(operand)}.`)
        return false
      case 'contains':
        if (typeof operand === 'string') return true
        report(path, `"contains" searches for text, not ${kindOf(operand)}.`)
        return false
      case 'empty':
        if (typeof operand === 'boolean') return true
        report(path, '"empty" takes true or false.')
        return false
      case 'in': {
        if (!Array.isArray(operand)) {
          report(path, `"in" takes a list of values, not ${kindOf(operand)}.`)
          return false
        }
        if (operand.length === 0) {
          report(path, '"in" needs at least one value.')
          return false
        }
        if (operand.length > COLLECTION_LIMITS.inValues) {
          report(path, `"in" takes at most ${COLLECTION_LIMITS.inValues} values; this list has ${operand.length}.`)
          return false
        }
        let valid = true
        operand.forEach((item, index) => {
          if (isPlainValue(item)) return
          report([...path, String(index)], `A value in the list is ${kindOf(item)}. Lists hold text, numbers and true/false.`)
          valid = false
        })
        return valid
      }
    }
  }

  const walk = (value: unknown, path: readonly string[], depth: number): CollectionFilterNode | null => {
    if (!isObject(value)) {
      report(path, 'A filter is a JSON object, for example { "name": { "eq": "XTD1" } }.')
      return null
    }
    const keys = Object.keys(value)
    if (keys.length === 0) {
      report(path, 'An empty object is not a filter. Leave the filter out to list everything.')
      return null
    }

    const combinator = keys.includes('and') ? 'and' : keys.includes('or') ? 'or' : null
    if (combinator !== null) {
      if (keys.length > 1) {
        report(path, 'An object with "and" or "or" has no other keys. Put the other conditions in its list.')
        return null
      }
      const here = [...path, combinator]
      if (depth >= COLLECTION_LIMITS.filterDepth) {
        report(here, `Nested more than ${COLLECTION_LIMITS.filterDepth} levels of "and" and "or".`)
        return null
      }
      const list = value[combinator]
      if (!Array.isArray(list)) {
        report(here, `"${combinator}" takes a list of filters, not ${kindOf(list)}.`)
        return null
      }
      if (list.length === 0) {
        report(here, `"${combinator}" needs at least one filter in its list.`)
        return null
      }
      const children: CollectionFilterNode[] = []
      let valid = true
      list.forEach((entry, index) => {
        const child = walk(entry, [...here, String(index)], depth + 1)
        if (child === null) valid = false
        else children.push(child)
      })
      return valid ? { kind: combinator, children } : null
    }

    if (keys.length > 1) {
      report(path, 'An object names one field. Combine several conditions with "and" or "or".')
      return null
    }
    const field = keys[0]!
    const here = [...path, field]
    conditions += 1
    const problem = fieldProblem(field)
    if (problem !== null) report(here, problem)

    const condition = value[field]
    if (!isObject(condition)) {
      report(here, 'A condition is an object with one operator, for example { "eq": value }.')
      return null
    }
    const ops = Object.keys(condition)
    if (ops.length !== 1) {
      report(here, `A condition has exactly one operator; this one has ${ops.length === 0 ? 'none' : `${ops.length}: ${ops.map(quote).join(', ')}`}.`)
      return null
    }
    const op = ops[0]!
    if (!isFilterOp(op)) {
      report([...here, op], `Unknown operator ${quote(op)}. Use one of: ${COLLECTION_FILTER_OPS.join(', ')}.`)
      return null
    }
    const operand = condition[op]
    if (!operandIsValid(op, operand, [...here, op]) || problem !== null) return null
    return { kind: 'condition', field, op, value: operand }
  }

  const node = walk(input, [], 0)
  if (conditions > COLLECTION_LIMITS.filterConditions) {
    report([], `The filter has ${conditions} conditions; at most ${COLLECTION_LIMITS.filterConditions} are allowed.`)
  }
  return issues.length === 0 && node !== null ? { ok: true, node } : { ok: false, issues }
}

export type CollectionSortField = { field: string; descending: boolean }

export type CollectionSortParse = { ok: true; sort: CollectionSortField[] } | { ok: false; message: string }

/**
 * Checks the entries of a `sort` and reads them: `name` ascending, `-name`
 * descending. A sort names at most 3 fields, each once, and each follows the
 * rule a filter's field does (a key, `reference.field`, or a system field).
 *
 * The final tie-break on `id` that makes a page boundary exact is the cloud's;
 * a sort need not and does not have to name it.
 */
export function parseCollectionSort(specs: string[]): CollectionSortParse {
  if (specs.length > COLLECTION_LIMITS.sortFields) {
    return { ok: false, message: `A sort names at most ${COLLECTION_LIMITS.sortFields} fields; this one names ${specs.length}.` }
  }
  const sort: CollectionSortField[] = []
  const seen = new Set<string>()
  for (const entry of specs) {
    const descending = entry.startsWith('-')
    const field = descending ? entry.slice(1) : entry
    const problem = fieldProblem(field)
    if (problem !== null) return { ok: false, message: `Sort entry ${quote(entry)} cannot be used. ${problem}` }
    if (seen.has(field)) return { ok: false, message: `${quote(field)} is in the sort twice.` }
    seen.add(field)
    sort.push({ field, descending })
  }
  return { ok: true, sort }
}

// ---------------------------------------------------------------------------
// Reading records
// ---------------------------------------------------------------------------

/**
 * A page size as a **query string** carries it: the same shape as
 * `auditQuery.limit`, a union whose input branch is the wire, because a
 * `z.coerce` cannot be published (the artifact would describe a shape a query
 * string can never carry). The runtime is the authority for the bounds.
 */
const pageLimit = z
  .union([z.string().regex(/^\d{1,4}$/), z.number().int()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive().max(COLLECTION_LIMITS.pageMax))

const wireBoolean = z.enum(['true', 'false'])

/**
 * The query string of a record list. `filter` is the JSON text of a filter,
 * `sort` and `expand` are comma-separated lists; the cloud parses all three
 * (`parseCollectionFilter`, `parseCollectionSort`) and answers a problem with
 * the path of what is wrong.
 */
export const collectionRecordListQuery = z
  .object({
    filter: z.string().min(1).meta({ description: 'A filter as JSON text, for example `{"location.name":{"eq":"XTD1"}}`.' }).optional(),
    search: z
      .string()
      .meta({
        description:
          'Words that must all occur, in any letter case, in at least one searchable field of the record. At most 10 words, separated by whitespace.',
      })
      .optional(),
    sort: z
      .string()
      .min(1)
      .meta({ description: 'Up to 3 fields separated by commas; a leading `-` sorts descending, for example `-position_m,name`. Ties are broken by `id`.' })
      .optional(),
    expand: z
      .string()
      .min(1)
      .meta({ description: 'Reference fields to embed as records, separated by commas. Only one hop is followed.' })
      .optional(),
    limit: pageLimit.meta({ description: `How many records to return, 1 to ${COLLECTION_LIMITS.pageMax}. Default ${COLLECTION_LIMITS.pageDefault}.` }).optional(),
    cursor: z.string().min(1).meta({ description: 'The `next_cursor` of the previous page.' }).optional(),
    count: wireBoolean.meta({ description: '`true` adds `total`, the number of records that match.' }).optional(),
    deleted: wireBoolean
      .meta({ description: '`true` lists deleted records instead, newest deletion first. Needs the right to create records.' })
      .optional(),
    robot: z.uuid().meta({ description: 'Only the records of this robot, in a collection that belongs to robots.' }).optional(),
  })
  .strict()
export type CollectionRecordListQuery = z.infer<typeof collectionRecordListQuery>

export const collectionRecordListResponse = z
  .object({
    records: z.array(collectionRecord),
    next_cursor: z.string().nullable().meta({
      description: 'Send it as `cursor` to read the next page. Null when this is the last page, which a short page does not say on its own.',
    }),
    total: count.meta({ description: 'The number of records that match, sent only when `count=true` was asked for.' }).optional(),
  })
  .meta({ description: 'One page of records.' })
export type CollectionRecordListResponse = z.infer<typeof collectionRecordListResponse>

// ---------------------------------------------------------------------------
// Writing records
// ---------------------------------------------------------------------------

/**
 * A create or an update. Updates have `PATCH` semantics: only the fields sent
 * change, and `null` clears one. `robot_id` is read on create only, because a
 * record never changes its robot.
 */
export const collectionRecordWrite = z
  .object({
    values: z.record(z.string(), z.unknown()).meta({
      description: 'The fields to set by key. A `null` clears a field. On an update, fields that are left out keep their value.',
    }),
    robot_id: z.uuid().meta({ description: 'The robot of a new record in a collection that belongs to robots. Fixed once the record exists.' }).optional(),
    expected_revision: z
      .number()
      .int()
      .min(1)
      .meta({ description: 'The revision you last read. The write is refused with `record_changed` if the record has moved on.' })
      .optional(),
  })
  .strict()
  .meta({ description: 'The body of a record create or update.' })
export type CollectionRecordWrite = z.infer<typeof collectionRecordWrite>

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * One entry of a record's history. `changes` holds each changed field with its
 * old and new value, `null` standing for no value. A `delete` revision carries
 * the whole record so that a deleted record can be seen and brought back.
 */
export const collectionRevision = z
  .object({
    seq: z.number().int().positive().meta({ description: 'The position of this revision in the history. Use it to page (`before_seq`) and to restore (`seq`).' }),
    op: z.enum(['create', 'update', 'delete', 'restore']),
    at: timestamp,
    actor: collectionActor,
    reason: z.string().nullable().meta({ description: 'Why a change was made when it was not an ordinary write: `schema v5`, `import`, `restore v4`. Null otherwise.' }),
    revision: z.number().int().min(1).meta({ description: 'The record\'s revision number after this change.' }),
    changes: z.record(z.string(), z.object({ old: z.unknown(), new: z.unknown() })).meta({
      description: 'The fields this change touched by key, each with its value before and after. `null` means no value.',
    }),
    record: collectionRecord.nullable().meta({ description: 'The whole record, on a `delete` revision. Null on every other operation.' }),
  })
  .meta({ description: 'One change in the history of a record.' })
export type CollectionRevision = z.infer<typeof collectionRevision>

export const collectionRecordHistoryQuery = z
  .object({
    limit: pageLimit.meta({ description: `How many revisions to return, 1 to ${COLLECTION_LIMITS.pageMax}.` }).optional(),
    before_seq: wireSeqCursor.meta({ description: 'Only revisions older than this `seq`: the next page, since the history is read newest first.' }).optional(),
  })
  .strict()
export type CollectionRecordHistoryQuery = z.infer<typeof collectionRecordHistoryQuery>

export const collectionRecordHistoryResponse = z
  .object({
    revisions: z.array(collectionRevision),
    next_before_seq: z.number().int().positive().nullable().meta({
      description: 'Send it as `before_seq` to read older revisions. Null when there are none.',
    }),
    purged: z
      .object({
        before: timestamp.meta({ description: 'Revisions older than this were removed.' }),
        by: collectionActor,
        at: timestamp.meta({ description: 'When they were removed.' }),
      })
      .nullable()
      .meta({ description: 'Set when an organization owner removed the older part of this history: the history then starts with that note.' }),
  })
  .meta({ description: 'A page of a record\'s history, newest first.' })
export type CollectionRecordHistoryResponse = z.infer<typeof collectionRecordHistoryResponse>

/**
 * Restores a record. With `seq` the record gets the values it had after that
 * revision; without it, a deleted record comes back as it was deleted.
 */
export const collectionRecordRestoreRequest = z
  .object({
    seq: z.number().int().positive().meta({ description: 'Put the record back to its state after this revision. Leave it out to restore a deleted record.' }).optional(),
  })
  .strict()
  .meta({ description: 'The body of a record restore.' })
export type CollectionRecordRestoreRequest = z.infer<typeof collectionRecordRestoreRequest>

// ---------------------------------------------------------------------------
// Listing the collections
// ---------------------------------------------------------------------------

/** One collection in the developer's overview, with what it holds and what needs a look. */
export const collectionSummary = z
  .object({
    key: collectionKey,
    label: z.string(),
    binding: collectionBinding,
    records: count.meta({ description: 'Records the collection holds now.' }),
    fields: count,
    read_roles: z.array(z.string()).meta({ description: 'The roles that may read the records.' }),
    warnings: z
      .array(z.enum(['no_role_access', 'history_growing', 'unknown_role']))
      .meta({
        description:
          '`no_role_access`: no role may read these records. `unknown_role`: `access` names a role the app does not have. `history_growing`: the history is far larger than the records, which often means a client writing in a loop.',
      }),
    revisions: count.meta({ description: 'Entries in the history of all the collection\'s records.' }),
    history_bytes: count.meta({ description: 'The size of that history in bytes.' }),
    updated_at: timestamp.nullable().meta({ description: 'When a record of the collection last changed. Null if it never held one.' }),
  })
  .meta({ description: 'A collection as the developer\'s overview shows it.' })
export type CollectionSummary = z.infer<typeof collectionSummary>

export const collectionListResponse = z
  .object({
    version: schemaVersion.nullable().meta({ description: 'The published schema version. Null before anything was published.' }),
    collections: z.array(collectionSummary),
  })
  .meta({ description: 'The collections of an app.' })
export type CollectionListResponse = z.infer<typeof collectionListResponse>

/** What one collection allows the caller to do with its records. */
const collectionCan = z
  .object({
    read: z.boolean(),
    create: z.boolean(),
    update: z.union([z.enum(['all', 'own']), z.literal(false)]).meta({ description: '`all`: any record. `own`: only records the caller created. `false`: none.' }),
    delete: z.union([z.enum(['all', 'own']), z.literal(false)]).meta({ description: '`all`: any record. `own`: only records the caller created. `false`: none.' }),
  })
  .meta({ description: 'What the caller may do with the records of this collection.' })

/** The collections the caller can read, with their fields: what a client needs to build a form. */
export const collectionDefinitionsResponse = z
  .object({
    version: schemaVersion.nullable().meta({ description: 'The published schema version. Null before anything was published.' }),
    collections: z.array(
      z.object({
        key: collectionKey,
        label: z.string(),
        description: z.string(),
        binding: collectionBinding,
        display: z.string().meta({ description: 'The template that names a record of this collection.' }),
        fields: z.record(collectionKey, collectionField),
        can: collectionCan,
      }),
    ),
  })
  .meta({ description: 'The collections the caller may read, with their field definitions and the caller\'s rights.' })
export type CollectionDefinitionsResponse = z.infer<typeof collectionDefinitionsResponse>
