// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import {
  COLLECTION_LIMITS,
  COLLECTION_RESERVED_KEYS,
  type CollectionDefinition,
  type CollectionField,
  type CollectionsDocument,
} from './collections.js'
import { COLLECTION_JSON_TEMPLATES, parseDisplayTemplate } from './collections-templates.js'
import { checkCollectionValue } from './collections-values.js'

/**
 * Everything wrong with a collections document that only the whole document
 * can tell: the questions a zod schema cannot ask because they compare one
 * part with another (does the reference point at a collection? does the
 * default fit?) or count (how many collections?).
 *
 * It lives in contracts, as a pure function, so the cloud that refuses a
 * document, the console that shows its problems while someone types, and the
 * tools that write documents give the same answer in the same words.
 */

/** One finding about a document. */
export const collectionsIssue = z
  .object({
    path: z.string().min(1).meta({ description: 'Where in the document, with dots between the keys: `collections.chargers.fields.location.to`.' }),
    code: z.string().meta({ description: 'A stable name for the kind of finding, for code to branch on.' }),
    message: z.string().meta({ description: 'What is wrong, in a sentence for a person.' }),
    severity: z.enum(['error', 'warning', 'info']).meta({
      description: 'An error makes the document invalid and it cannot be saved or published. A warning and information leave it valid.',
    }),
  })
  .meta({ description: 'One finding about a collections document.' })
export type CollectionsIssue = z.infer<typeof collectionsIssue>

export type CollectionsDocumentIssuesOptions = {
  /**
   * Returns what is wrong with an inline JSON Schema, or `null` when it is a
   * usable JSON Schema (draft 2020-12). Contracts carries no JSON Schema
   * validator, so a caller that has one passes it; without it inline schemas
   * are not judged.
   */
  validateJsonSchema?: (schema: unknown) => string | null
  /** Checks a value against a JSON Schema, as for `checkCollectionValue`. Needed to judge a `default` on a `json` field. */
  validateJsonValue?: (schema: unknown, value: unknown) => string | null
  /** Matches a text against a `pattern`, as for `checkCollectionValue`. Used to judge a `default` the way a write is judged. */
  matchPattern?: (pattern: string, value: string) => boolean
}

/** The keys every record has, for display placeholders and references. */
const SYSTEM_KEYS: readonly string[] = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'revision']
const RESERVED_KEYS: readonly string[] = COLLECTION_RESERVED_KEYS
const ACTIONS = ['read', 'create', 'update', 'delete'] as const

const isRobotBound = (collection: CollectionDefinition): boolean => collection.binding !== 'global'

/** A piece of the document for a message: a very long one is cut, so a message never repeats a megabyte back. */
const clip = (text: string): string => (text.length > 80 ? `${text.slice(0, 80)}…` : text)

/** Does a record of `collection` have a field or system value called `key`? */
function hasKey(collection: CollectionDefinition, key: string): boolean {
  return (
    Object.hasOwn(collection.fields, key) ||
    SYSTEM_KEYS.includes(key) ||
    (key === 'robot_id' && isRobotBound(collection))
  )
}

/**
 * Why a pattern cannot be used, or `null`.
 *
 * Patterns are written in the RE2 subset, and the server matches values with
 * an RE2 engine, whose running time does not depend on the pattern (see
 * `matchPattern` in `checkCollectionValue`). This function reads a pattern with
 * the JavaScript engine in unicode mode, which agrees with RE2 on everything an
 * author normally writes, and refuses the constructs RE2 lacks so that a
 * pattern means the same in both: lookahead, lookbehind and backreferences.
 * Finding them means reading the pattern the way the engine does, because the
 * same characters are plain text inside a character class or after a backslash.
 *
 * It does not make matching with the JavaScript engine safe: a pattern such as
 * `(a+)+$` is valid RE2 and slow there.
 */
function patternProblem(pattern: string): string | null {
  let inClass = false
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!
    if (char === '\\') {
      const next = pattern[i + 1]
      if (!inClass && next !== undefined) {
        if (next >= '1' && next <= '9') return 'The pattern uses a backreference, which is not supported.'
        if (next === 'k' && pattern[i + 2] === '<') return 'The pattern uses a named backreference, which is not supported.'
      }
      i += 1
    } else if (inClass) {
      if (char === ']') inClass = false
    } else if (char === '[') {
      inClass = true
    } else if (char === '(' && pattern[i + 1] === '?') {
      const kind = pattern.slice(i + 2, i + 4)
      if (kind.startsWith('=') || kind.startsWith('!')) return 'The pattern uses lookahead, which is not supported.'
      if (kind === '<=' || kind === '<!') return 'The pattern uses lookbehind, which is not supported.'
    }
  }
  try {
    new RegExp(pattern, 'u')
  } catch (error) {
    return `The pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`
  }
  return null
}

/** Does the role value name at least one role? */
function namesARole(value: string | string[] | undefined): boolean {
  return typeof value === 'string' ? value.length > 0 : value !== undefined && value.length > 0
}

/**
 * Finds every way a document is invalid, and the things worth knowing about a
 * valid one.
 *
 * **Errors** make the document invalid: `too_many_collections`,
 * `too_many_fields`, `reserved_key`, `unknown_reference_target`,
 * `robot_reference_from_global`, `unknown_template`, `invalid_json_schema`,
 * `invalid_pattern`, `display_template_invalid`,
 * `display_placeholder_unresolved`, `duplicate_option`, `invalid_default`,
 * `required_without_default` and `unique_not_allowed`.
 *
 * **Warnings** (`access_ignored`) and **information** (`no_role_has_access`)
 * leave it valid. Nothing about stored data is judged here: a document is
 * never invalid because of the records it would affect.
 *
 * Issues come in document order: each collection's fields, then its display,
 * then its access. A field that is wrong in one way is not also reported for
 * the knock-on effects of that (an unknown template does not also make its
 * default invalid).
 */
export function collectionsDocumentIssues(
  document: CollectionsDocument,
  options: CollectionsDocumentIssuesOptions = {},
): CollectionsIssue[] {
  const issues: CollectionsIssue[] = []
  const add = (severity: CollectionsIssue['severity'], path: string, code: string, message: string) => {
    issues.push({ path, code, message, severity })
  }
  const collections = Object.entries(document.collections)

  function checkField(collectionKey: string, collection: CollectionDefinition, fieldKey: string, field: CollectionField): void {
    const path = `collections.${collectionKey}.fields.${fieldKey}`

    if (RESERVED_KEYS.includes(fieldKey)) {
      add('error', path, 'reserved_key', `"${fieldKey}" is reserved for the record itself and cannot be the key of a field. Reserved keys: ${COLLECTION_RESERVED_KEYS.join(', ')}.`)
    }
    if (field.unique && (field.type === 'boolean' || field.type === 'json')) {
      add('error', `${path}.unique`, 'unique_not_allowed', `A ${field.type} field cannot be unique.`)
    }

    // Set when the field is already reported for something that makes its
    // default meaningless to judge.
    let defaultCheckable = true
    // The field as the default is judged against: a pattern that cannot be used is reported once, as itself.
    let judged: CollectionField = field

    switch (field.type) {
      case 'text': {
        if (field.pattern !== undefined) {
          const why = patternProblem(field.pattern)
          if (why !== null) {
            add('error', `${path}.pattern`, 'invalid_pattern', why)
            const { pattern: _unusable, ...withoutPattern } = field
            judged = withoutPattern
          }
        }
        break
      }
      case 'select': {
        const seen = new Set<string>()
        field.options.forEach((option, index) => {
          if (seen.has(option.value)) {
            add('error', `${path}.options.${index}.value`, 'duplicate_option', `The option value "${option.value}" is used more than once.`)
          }
          seen.add(option.value)
        })
        break
      }
      case 'json': {
        if (typeof field.schema === 'string') {
          if (!Object.hasOwn(COLLECTION_JSON_TEMPLATES, field.schema)) {
            defaultCheckable = false
            add('error', `${path}.schema`, 'unknown_template', `"${field.schema}" is not a JSON template. The templates are ${Object.keys(COLLECTION_JSON_TEMPLATES).join(', ')}; or write an inline JSON Schema.`)
          }
        } else if (field.schema !== undefined && options.validateJsonSchema !== undefined) {
          const why = options.validateJsonSchema(field.schema)
          if (why !== null) {
            defaultCheckable = false
            add('error', `${path}.schema`, 'invalid_json_schema', `The schema is not a valid JSON Schema: ${why}`)
          }
        }
        break
      }
      case 'reference': {
        const hasTarget = Object.hasOwn(document.collections, field.to)
        if (!hasTarget) {
          add('error', `${path}.to`, 'unknown_reference_target', `"${field.to}" is not a collection of this document.`)
        } else if (!isRobotBound(collection) && isRobotBound(document.collections[field.to]!)) {
          add('error', `${path}.to`, 'robot_reference_from_global', `A global collection cannot point at "${field.to}", which holds records of robots. Make ${collectionKey} per_robot, or point at a global collection.`)
        }
        break
      }
      default:
        break
    }

    if (field.default !== undefined && defaultCheckable) {
      const found = checkCollectionValue(judged, field.default, {
        validateJsonValue: options.validateJsonValue,
        matchPattern: options.matchPattern,
      })
      if (found !== null) {
        add('error', `${path}.default`, 'invalid_default', `The default is not a valid value for this ${field.type} field: ${found.message}`)
      }
    }

    if (collection.binding === 'one_per_robot' && field.required === true && field.default === undefined) {
      add('error', `${path}.required`, 'required_without_default', `${fieldKey} is required, but Fleetless creates the records of a one_per_robot collection itself and cannot fill it. Give it a default or make it optional.`)
    }
  }

  function checkDisplay(collectionKey: string, collection: CollectionDefinition): void {
    if (collection.display === undefined) return
    const path = `collections.${collectionKey}.display`
    const parsed = parseDisplayTemplate(collection.display)
    if (!parsed.ok) {
      add('error', path, 'display_template_invalid', parsed.message)
      return
    }
    // A placeholder used again is the same problem again: say it once for each collection.
    const reported = new Set<string>()
    for (const placeholder of parsed.placeholders) {
      if (!resolves(collection, placeholder.path)) {
        const name = placeholder.path.join('.')
        if (reported.has(name)) continue
        reported.add(name)
        const hint =
          placeholder.path[0] === 'robot'
            ? ' robot.name is only available on collections of robots (per_robot and one_per_robot).'
            : ''
        add('error', path, 'display_placeholder_unresolved', `${clip(placeholder.raw)} does not name a field of this collection, a system field or a field reached through a reference.${hint}`)
      }
    }
  }

  /** Can `path` (one or two keys of a display placeholder) be looked up on a record of `collection`? */
  function resolves(collection: CollectionDefinition, path: string[]): boolean {
    const [head, tail] = path as [string, string | undefined]
    if (tail === undefined) return hasKey(collection, head)
    if (head === 'robot') return tail === 'name' && isRobotBound(collection)
    const reference = Object.hasOwn(collection.fields, head) ? collection.fields[head] : undefined
    if (reference === undefined || reference.type !== 'reference') return false
    // A missing target is already an error of its own; reporting the placeholder as well would say it twice.
    if (!Object.hasOwn(document.collections, reference.to)) return true
    return hasKey(document.collections[reference.to]!, tail)
  }

  function checkAccess(collectionKey: string, collection: CollectionDefinition): void {
    const access = collection.access
    const base = `collections.${collectionKey}.access`
    if (collection.binding === 'one_per_robot' && access !== undefined) {
      for (const action of ['create', 'delete'] as const) {
        if (access[action] !== undefined) {
          add('warning', `${base}.${action}`, 'access_ignored', `Records of a one_per_robot collection are never ${action === 'create' ? 'created' : 'deleted'} through the API, so access.${action} grants nothing.`)
        }
      }
    }
    if (!namesARole(access?.read)) {
      add('info', `${base}.read`, 'no_role_has_access', `No role can read ${collectionKey}. Only developers and server keys reach its records.`)
    }
  }

  if (collections.length > COLLECTION_LIMITS.collections) {
    add('error', 'collections', 'too_many_collections', `A document holds at most ${COLLECTION_LIMITS.collections} collections; this one has ${collections.length}.`)
  }

  for (const [collectionKey, collection] of collections) {
    const base = `collections.${collectionKey}`
    const fields = Object.entries(collection.fields)
    if (fields.length > COLLECTION_LIMITS.fields) {
      add('error', `${base}.fields`, 'too_many_fields', `A collection holds at most ${COLLECTION_LIMITS.fields} fields; ${collectionKey} has ${fields.length}.`)
    }

    for (const [fieldKey, field] of fields) {
      checkField(collectionKey, collection, fieldKey, field)
    }
    checkDisplay(collectionKey, collection)
    checkAccess(collectionKey, collection)
  }

  return issues
}

/**
 * The role keys in an access value, in the order they are written.
 * `{ all, own }` is flattened, so a role named in both is one role.
 */
function rolesIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((role): role is string => typeof role === 'string')
  if (value !== null && typeof value === 'object') {
    const { all, own } = value as { all?: unknown; own?: unknown }
    return [...rolesIn(all), ...rolesIn(own)]
  }
  return []
}

/**
 * One warning for each role key in `access` that the app does not have, per
 * collection and action. The document stays valid: renaming or deleting a role
 * never makes a published document fail, and a key that names no role grants
 * nothing. `roleKeys` is the set of the app's role keys.
 */
export function collectionsAccessWarnings(document: CollectionsDocument, roleKeys: ReadonlySet<string>): CollectionsIssue[] {
  const warnings: CollectionsIssue[] = []
  for (const [collectionKey, collection] of Object.entries(document.collections)) {
    if (collection.access === undefined) continue
    for (const action of ACTIONS) {
      const unknown = new Set(rolesIn(collection.access[action]).filter((role) => !roleKeys.has(role)))
      for (const role of unknown) {
        warnings.push({
          path: `collections.${collectionKey}.access.${action}`,
          code: 'unknown_role',
          message: `The role "${role}" is not a role of this app, so it grants nothing.`,
          severity: 'warning',
        })
      }
    }
  }
  return warnings
}
