// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * The schema document of an app's collections: the one YAML (or JSON) document
 * that says which collections an app has, what fields their records carry and
 * which roles may touch them.
 *
 * **This file is the document's grammar, nothing more.** Whether the document is
 * *valid* — a reference that points at a collection that exists, a default that
 * fits its field, no more than the allowed number of collections — is a second
 * question that needs the whole document at once, and
 * `collectionsDocumentIssues` in `collections-issues.ts` answers it. A zod
 * schema that tried to be both would refuse a document with one unhelpful
 * sentence where the issue list names every problem and its path.
 *
 * Every object here is `.strict()`. A key the format does not know is almost
 * always a typo or a misremembered option (`maxlength`, `required_if`), and a
 * schema that silently dropped it would publish a document that means less than
 * it says.
 */

/** The document format this package describes. A document names it in `format`. */
export const COLLECTIONS_FORMAT_VERSION = 1

/**
 * Keys a record already uses for itself, so a field may not be called any of
 * them. `robot` is reserved too: `robot.name` in a `display` template names the
 * record's robot, and a field called `robot` would make that ambiguous.
 */
export const COLLECTION_RESERVED_KEYS = [
  'id',
  'robot',
  'robot_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'revision',
] as const

/**
 * Every fixed cap of the collections feature, on every plan. Limits that depend
 * on the plan (records and bytes per organization) are plan limits and live in
 * `plans.ts`.
 */
export const COLLECTION_LIMITS = {
  /** Collections in one document. */
  collections: 50,
  /** Fields in one collection. */
  fields: 100,
  /** One record, as serialized JSON. */
  recordBytes: 1_048_576,
  /** The longest a `text` field may be set to. */
  textMax: 1000,
  /** The length of a `text` field without `max_length`. */
  textDefault: 255,
  /** The longest a `long_text` field may be set to. */
  longTextMax: 100_000,
  /** The length of a `long_text` field without `max_length`. */
  longTextDefault: 10_000,
  /** Options of one `select` field. */
  selectOptions: 500,
  /** Values in one `in` filter condition. */
  inValues: 100,
  /** Levels of nested `and` / `or` in a filter. */
  filterDepth: 3,
  /** Conditions in one filter. */
  filterConditions: 50,
  /** Words in one `search` query. */
  searchWords: 10,
  /** Fields in one `sort`. */
  sortFields: 3,
  /** Records per page when `limit` is not given. */
  pageDefault: 50,
  /** The largest `limit`. */
  pageMax: 500,
  /** The largest import file. */
  importBytes: 10_000_000,
  /** The most rows in one import. */
  importRows: 50_000,
  /** Record writes per minute for one app. An import counts as one. */
  writesPerMinuteApp: 600,
  /** Record writes per minute for one acting user or key. An import counts as one. */
  writesPerMinuteActor: 120,
  /** How long after its restore point a schema version can be restored together with its data. */
  restoreDays: 90,
  /** The history is reported as growing when it holds more than this many times as many revisions as records... */
  growthFactor: 10,
  /** ...and at least this many revisions. */
  growthMinRevisions: 10_000,
  /** The schema document as text, counted in bytes of UTF-8 and not in characters. */
  schemaSourceBytes: 1_000_000,
  /** The longest `pattern` of a `text` field, in characters. */
  patternMax: 1000,
  /** Levels of arrays and objects inside one `json` value. */
  jsonDepth: 32,
  /** The longest column name or value an import error repeats, an ellipsis included. */
  importErrorText: 200,
} as const

const KEY_RULE = /^[a-z][a-z0-9_]{0,62}$/

/**
 * A collection key or a field key. Keys are the API contract (they appear in
 * URLs, filters and record bodies), so they are fixed lowercase identifiers;
 * `label` carries the words a person reads.
 */
export const collectionKey = z
  .string()
  .regex(KEY_RULE, {
    message: 'A key starts with a lowercase letter and continues with lowercase letters, digits or underscores, up to 63 characters in all.',
  })
  .meta({ description: 'A collection key or a field key: `^[a-z][a-z0-9_]{0,62}$`. Keys appear in URLs, filters and record bodies; `label` is the text people read.' })
export type CollectionKey = z.infer<typeof collectionKey>

/**
 * How a collection relates to robots. A property of the collection and not a
 * field type, so a record's robot can neither be left out of a robot-bound
 * collection nor changed afterwards.
 */
export const collectionBinding = z
  .enum(['global', 'per_robot', 'one_per_robot'])
  .meta({
    description:
      '`global`: records belong to the app and no robot. `per_robot`: every record belongs to one robot (system field `robot_id`, fixed when the record is created). `one_per_robot`: every robot of the app has exactly one record, which Fleetless creates itself.',
  })
export type CollectionBinding = z.infer<typeof collectionBinding>

/** The nine kinds of value a field can hold. */
export const collectionFieldType = z.enum([
  'text',
  'long_text',
  'number',
  'boolean',
  'select',
  'date',
  'datetime',
  'json',
  'reference',
])
export type CollectionFieldType = z.infer<typeof collectionFieldType>

const label = z.string().max(120).meta({ description: 'A short name for people to read. It may change at any time; the key is what code uses.' })
const description = z.string().max(1000).meta({ description: 'Free text that explains the field to the people who fill it in.' })

/** Options every field type carries. */
const common = {
  label: label.optional(),
  description: description.optional(),
  required: z
    .boolean()
    .meta({ description: 'A new record must set this field, and an update may not clear it.' })
    .optional(),
  unique: z
    .union([z.boolean(), z.literal('collection')])
    .meta({
      description:
        '`true`: no two records hold the same value, within the collection (`global`) or within one robot (`per_robot`, `one_per_robot`). `collection`: on a robot-bound collection, across all robots. Empty values never collide. Not allowed on `boolean` and `json` fields.',
    })
    .optional(),
  default: z
    .unknown()
    .meta({ description: 'The value a record gets when it does not set this field. It must itself be a valid value of the field.' })
    .optional(),
}

const textField = z
  .object({
    type: z.literal('text'),
    ...common,
    max_length: z
      .number()
      .int()
      .min(1)
      .max(COLLECTION_LIMITS.textMax)
      .meta({ description: `Longest value in characters. Default ${COLLECTION_LIMITS.textDefault}, at most ${COLLECTION_LIMITS.textMax}.` })
      .optional(),
    pattern: z
      .string()
      .max(COLLECTION_LIMITS.patternMax)
      .meta({
        description:
          `A regular expression in the RE2 subset, checked in unicode mode: lookahead, lookbehind and backreferences are not supported. At most ${COLLECTION_LIMITS.patternMax.toLocaleString('en-US')} characters, and the cloud may also refuse a pattern as too complex (its compiled size is bounded; counted repeats such as \`{n}\` multiply it), which a document reports as an invalid pattern. The value must match somewhere in it; anchor it with \`^\` and \`$\` to match the whole value.`,
      })
      .optional(),
    searchable: z.boolean().meta({ description: 'Include this field in the `search` of record lists.' }).optional(),
  })
  .strict()

const longTextField = z
  .object({
    type: z.literal('long_text'),
    ...common,
    max_length: z
      .number()
      .int()
      .min(1)
      .max(COLLECTION_LIMITS.longTextMax)
      .meta({ description: `Longest value in characters. Default ${COLLECTION_LIMITS.longTextDefault}, at most ${COLLECTION_LIMITS.longTextMax}.` })
      .optional(),
    searchable: z.boolean().meta({ description: 'Include this field in the `search` of record lists.' }).optional(),
  })
  .strict()

const numberField = z
  .object({
    type: z.literal('number'),
    ...common,
    integer: z.boolean().meta({ description: 'Accept whole numbers only.' }).optional(),
    min: z.number().meta({ description: 'Smallest accepted value.' }).optional(),
    max: z.number().meta({ description: 'Largest accepted value.' }).optional(),
    unit: z.string().meta({ description: 'A unit to show next to the value, such as `m` or `rad/s`. Display only; nothing converts values.' }).optional(),
  })
  .strict()

const booleanField = z.object({ type: z.literal('boolean'), ...common }).strict()

/** One choice of a `select` field. */
const selectOption = z
  .object({
    value: z.string().min(1).max(200).meta({ description: 'What is stored in records and used in filters.' }),
    label: z.string().meta({ description: 'What people see instead of the value.' }).optional(),
  })
  .strict()

const selectField = z
  .object({
    type: z.literal('select'),
    ...common,
    options: z
      .array(selectOption)
      .min(1)
      .max(COLLECTION_LIMITS.selectOptions)
      .meta({ description: `The accepted values, 1 to ${COLLECTION_LIMITS.selectOptions}. Two options may not share a value.` }),
    multiple: z.boolean().meta({ description: 'Hold a list of distinct options instead of one.' }).optional(),
    searchable: z.boolean().meta({ description: 'Include the values and labels of the chosen options in the `search` of record lists.' }).optional(),
  })
  .strict()

const dateField = z.object({ type: z.literal('date'), ...common }).strict()

const datetimeField = z.object({ type: z.literal('datetime'), ...common }).strict()

const jsonField = z
  .object({
    type: z.literal('json'),
    ...common,
    schema: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .meta({
        description:
          'What the value must look like: the name of a built-in template (`pose2d`, `point2d`, `polygon2d`, `range1d`) or an inline JSON Schema (draft 2020-12). Without it any JSON value is accepted.',
      })
      .optional(),
  })
  .strict()

const referenceField = z
  .object({
    type: z.literal('reference'),
    ...common,
    to: collectionKey.meta({ description: 'The key of the collection whose records this field points at. It must be a collection of the same document.' }),
    on_delete: z
      .enum(['prevent', 'clear'])
      .meta({
        description:
          '`prevent` (the default): a record that other records point at cannot be deleted. `clear`: deleting it clears the reference in the records that pointed at it.',
      })
      .optional(),
  })
  .strict()

/**
 * One field definition, discriminated on `type`. A union and not one object
 * with every option optional: `max_length` on a `number` would otherwise parse
 * and mean nothing.
 */
export const collectionField = z.discriminatedUnion('type', [
  textField,
  longTextField,
  numberField,
  booleanField,
  selectField,
  dateField,
  datetimeField,
  jsonField,
  referenceField,
])
export type CollectionField = z.infer<typeof collectionField>

/** The key of an organization role, as the organization spells it. A key that names no role grants nothing and is a warning. */
export const collectionAccessValue = z
  .union([z.string().min(1).max(63), z.array(z.string().min(1).max(63))])
  .meta({ description: 'The key of an organization role, or a list of keys. A key that names no role grants nothing.' })
export type CollectionAccessValue = z.infer<typeof collectionAccessValue>

const allOwn = z
  .object({
    all: collectionAccessValue.meta({ description: 'Roles that may do this to every record.' }).optional(),
    own: collectionAccessValue.meta({ description: 'Roles that may do this only to records they created themselves.' }).optional(),
  })
  .strict()

/**
 * Which roles may do what with a collection's records. A key that is missing,
 * or a collection without `access`, grants that action to nobody; developers
 * and the app's server keys always may. A role key the organization does not
 * have is a warning (see `collectionsAccessWarnings`), never a reason to
 * refuse the document.
 */
export const collectionAccess = z
  .object({
    read: collectionAccessValue.meta({ description: 'Roles that may read records.' }).optional(),
    create: collectionAccessValue.meta({ description: 'Roles that may create records. Has no effect on `one_per_robot` collections, whose records Fleetless creates.' }).optional(),
    update: z
      .union([collectionAccessValue, allOwn])
      .meta({ description: 'Roles that may change records: a role key, a list, or `{ all, own }` to tell every record from the ones a role created itself.' })
      .optional(),
    delete: z
      .union([collectionAccessValue, allOwn])
      .meta({ description: 'Roles that may delete records: a role key, a list, or `{ all, own }`. Has no effect on `one_per_robot` collections, whose records are never deleted through the API.' })
      .optional(),
  })
  .strict()
  .meta({ description: 'Which roles may read, create, update and delete the records of this collection. A missing key grants that action to nobody; developers and server keys can always do everything.' })
export type CollectionAccess = z.infer<typeof collectionAccess>

/** One collection: its binding, how its records are named, who may use it and its fields. */
export const collectionDefinition = z
  .object({
    label: z.string().meta({ description: 'A name for people to read. It may change at any time; the key is what code uses.' }).optional(),
    description: z.string().meta({ description: 'Free text that explains the collection to people.' }).optional(),
    binding: collectionBinding,
    display: z
      .string()
      .meta({
        description:
          'A template that names a record in lists, references and titles, for example `{{name}} ({{location.name}})`. A placeholder is a field of this collection, a system field (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `revision`, and `robot_id` on robot-bound collections), `robot.name` on robot-bound collections, or `<reference field>.<field of the target>`.',
      })
      .optional(),
    access: collectionAccess.optional(),
    fields: z
      .record(collectionKey, collectionField)
      .meta({ description: `The fields of a record, at most ${COLLECTION_LIMITS.fields}. Their order is the order of the record form.` }),
  })
  .strict()
export type CollectionDefinition = z.infer<typeof collectionDefinition>

/**
 * The document itself. The caps on collections and fields are validity rules of
 * `collectionsDocumentIssues` rather than zod limits, so a document one
 * collection over still parses and is told exactly which rule it breaks.
 *
 * `collections:` with nothing under it, which YAML reads as `null`, is the
 * same as `collections: {}`: a document that has no collections yet, which is
 * what a template for a new app looks like. Anything else that is not a map is
 * still refused.
 */
export const collectionsDocument = z.preprocess(
  // Done on the whole document and not on the `collections` property, so that the JSON Schema still lists `collections` as required.
  (input) =>
    typeof input === 'object' && input !== null && !Array.isArray(input) && (input as { collections?: unknown }).collections === null
      ? { ...input, collections: {} }
      : input,
  z
    .object({
      format: z.literal(COLLECTIONS_FORMAT_VERSION).meta({ description: `The document format version. Always ${COLLECTIONS_FORMAT_VERSION}.` }),
      collections: z
        .record(collectionKey, collectionDefinition)
        .meta({ description: `The collections of the app by key, at most ${COLLECTION_LIMITS.collections}. Nothing under \`collections:\` (null) means none.` }),
    })
    .strict()
    .meta({ description: 'The data model of an app: its collections, their fields, and who may use them.' }),
)
export type CollectionsDocument = z.infer<typeof collectionsDocument>
