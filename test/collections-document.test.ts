// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  COLLECTIONS_FORMAT_VERSION,
  COLLECTION_LIMITS,
  COLLECTION_RESERVED_KEYS,
  collectionAccess,
  collectionBinding,
  collectionDefinition,
  collectionField,
  collectionFieldType,
  collectionKey,
  collectionsDocument,
} from '../src/index.js'

/** A document that uses every binding, access shape and several field types. */
const exampleDocument = () => ({
  format: 1,
  collections: {
    locations: {
      label: 'Locations',
      binding: 'global',
      display: '{{name}}',
      fields: {
        name: { type: 'text', label: 'Name', required: true, unique: true, searchable: true, max_length: 80 },
        tunnel_from_m: { type: 'number', unit: 'm' },
        tunnel_to_m: { type: 'number', unit: 'm' },
      },
    },
    chargers: {
      label: 'Chargers',
      binding: 'global',
      display: '{{name}} ({{location.name}})',
      fields: {
        name: { type: 'text', required: true, searchable: true },
        location: { type: 'reference', to: 'locations', on_delete: 'prevent', required: true },
        dock_m: { type: 'number', unit: 'm' },
      },
    },
    components: {
      label: 'Components',
      binding: 'global',
      display: '{{name}} ({{code}})',
      access: { read: ['observe', 'operate', 'admin'], create: 'admin', update: 'admin', delete: 'admin' },
      fields: {
        code: { type: 'text', required: true, unique: true, searchable: true },
        name: { type: 'text', required: true, searchable: true },
        type: {
          type: 'select',
          options: [{ value: 'quadrupole', label: 'Quadrupole' }, { value: 'bpm', label: 'BPM' }],
        },
        location: { type: 'reference', to: 'locations', on_delete: 'prevent' },
        position_m: { type: 'number', unit: 'm' },
        approach: { type: 'json', schema: 'pose2d' },
      },
    },
    robot_settings: {
      label: 'Robot settings',
      binding: 'one_per_robot',
      display: '{{robot.name}}',
      access: { read: ['observe', 'operate', 'admin'], update: 'admin' },
      fields: {
        location: { type: 'reference', to: 'locations', on_delete: 'clear' },
        max_linear_speed: { type: 'number', unit: 'm/s', min: 0, max: 1.5, required: true, default: 0.8 },
        max_angular_speed: { type: 'number', unit: 'rad/s', min: 0, max: 2.0, required: true, default: 1.0 },
        undock_wall_distance: { type: 'number', unit: 'm', required: true, default: 0.35 },
      },
    },
    logbook: {
      label: 'Logbook',
      binding: 'per_robot',
      display: '{{created_at}}',
      access: {
        read: ['observe', 'operate', 'admin'],
        create: ['operate', 'admin'],
        update: { all: 'admin' },
        delete: { all: 'admin' },
      },
      fields: {
        text: { type: 'long_text', required: true, searchable: true },
        category: { type: 'select', options: [{ value: 'note' }, { value: 'fault' }, { value: 'maintenance' }] },
        happened_on: { type: 'date' },
        occurred_at: { type: 'datetime' },
        acknowledged: { type: 'boolean', default: false },
      },
    },
  },
})

const minimal = (field: unknown) => ({
  format: 1,
  collections: { things: { binding: 'global', fields: { thing: field } } },
})

describe('the collections document', () => {
  it('accepts a document that uses every binding and field type', () => {
    const parsed = collectionsDocument.safeParse(exampleDocument())
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(Object.keys(parsed.data!.collections)).toEqual(['locations', 'chargers', 'components', 'robot_settings', 'logbook'])
  })

  it('accepts a document without any collection', () => {
    expect(collectionsDocument.safeParse({ format: COLLECTIONS_FORMAT_VERSION, collections: {} }).success).toBe(true)
  })

  it('reads `collections:` with nothing under it (YAML null) as no collections, and nothing else that is not a map', () => {
    const parsed = collectionsDocument.safeParse({ format: COLLECTIONS_FORMAT_VERSION, collections: null })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ format: COLLECTIONS_FORMAT_VERSION, collections: {} })
    // Only a missing or malformed `collections` is still an error, and the input is not changed.
    const input = { format: COLLECTIONS_FORMAT_VERSION, collections: null }
    collectionsDocument.safeParse(input)
    expect(input.collections).toBeNull()
    expect(collectionsDocument.safeParse({ format: COLLECTIONS_FORMAT_VERSION }).success).toBe(false)
    for (const bad of [[], 'none', 0, false]) {
      expect(collectionsDocument.safeParse({ format: COLLECTIONS_FORMAT_VERSION, collections: bad }).success, JSON.stringify(bad)).toBe(false)
    }
    expect(collectionsDocument.safeParse(null).success).toBe(false)
    expect(collectionsDocument.safeParse([]).success).toBe(false)
  })

  it('refuses another format version and a missing format', () => {
    expect(collectionsDocument.safeParse({ format: 2, collections: {} }).success).toBe(false)
    expect(collectionsDocument.safeParse({ collections: {} }).success).toBe(false)
    expect(COLLECTIONS_FORMAT_VERSION).toBe(1)
  })

  it('rejects an unknown key at the root, in a collection, in a field and in access', () => {
    const at = (mutate: (doc: ReturnType<typeof exampleDocument>) => void) => {
      const doc = exampleDocument()
      mutate(doc)
      return collectionsDocument.safeParse(doc)
    }
    const root = at((doc) => Object.assign(doc, { extra: 1 }))
    const collection = at((doc) => Object.assign(doc.collections.locations, { extra: 1 }))
    const field = at((doc) => Object.assign(doc.collections.locations.fields.name, { extra: 1 }))
    const access = at((doc) => Object.assign(doc.collections.components.access, { extra: 'admin' }))
    const accessObject = at((doc) => Object.assign(doc.collections.logbook.access.update, { extra: 'admin' }))
    const option = at((doc) => Object.assign(doc.collections.components.fields.type.options[0]!, { extra: 1 }))
    for (const [where, result] of Object.entries({ root, collection, field, access, option })) {
      expect(result.success, where).toBe(false)
      expect(result.error?.issues[0]?.code, where).toBe('unrecognized_keys')
    }
    // `update` and `delete` are a union of a role value and `{ all, own }`, so zod reports the
    // refusal of the unknown key one level down, inside the union issue.
    expect(accessObject.success).toBe(false)
    const union = accessObject.error?.issues[0] as { code: string; errors?: { code: string }[][] } | undefined
    expect(union?.code).toBe('invalid_union')
    expect(union?.errors?.flat().some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it('refuses an option that does not belong to the type of the field', () => {
    expect(collectionsDocument.safeParse(minimal({ type: 'boolean', max_length: 5 })).success).toBe(false)
    expect(collectionsDocument.safeParse(minimal({ type: 'text', integer: true })).success).toBe(false)
    expect(collectionsDocument.safeParse(minimal({ type: 'number', searchable: true })).success).toBe(false)
    expect(collectionsDocument.safeParse(minimal({ type: 'date', default: '2026-01-01', pattern: 'x' })).success).toBe(false)
  })

  it('refuses a field with an unknown type or no type', () => {
    expect(collectionsDocument.safeParse(minimal({ type: 'file' })).success).toBe(false)
    expect(collectionsDocument.safeParse(minimal({ label: 'No type' })).success).toBe(false)
  })

  it('refuses a binding that is not one of the three', () => {
    const doc = { format: 1, collections: { things: { binding: 'per_app', fields: {} } } }
    expect(collectionsDocument.safeParse(doc).success).toBe(false)
    expect(collectionBinding.options).toEqual(['global', 'per_robot', 'one_per_robot'])
  })

  it('needs a binding and a fields map on every collection', () => {
    expect(collectionsDocument.safeParse({ format: 1, collections: { things: { fields: {} } } }).success).toBe(false)
    expect(collectionsDocument.safeParse({ format: 1, collections: { things: { binding: 'global' } } }).success).toBe(false)
    expect(collectionDefinition.safeParse({ binding: 'global', fields: {} }).success).toBe(true)
  })
})

describe('collection and field keys', () => {
  it('accepts keys a, a_1 and a 63-character key; rejects A, 1a, a-b and a 64-character key', () => {
    for (const key of ['a', 'a_1', 'a'.repeat(63)]) expect(collectionKey.safeParse(key).success, key).toBe(true)
    for (const key of ['A', '1a', 'a-b', 'a'.repeat(64), '', '_a', 'a b', 'ä']) {
      expect(collectionKey.safeParse(key).success, key).toBe(false)
    }
  })

  it('applies to collection keys and to field keys in a document', () => {
    const badCollection = { format: 1, collections: { Things: { binding: 'global', fields: {} } } }
    const badField = { format: 1, collections: { things: { binding: 'global', fields: { 'a-b': { type: 'boolean' } } } } }
    expect(collectionsDocument.safeParse(badCollection).success).toBe(false)
    expect(collectionsDocument.safeParse(badField).success).toBe(false)
  })

  it('says what a key looks like when one is refused', () => {
    const result = collectionKey.safeParse('A')
    expect(result.error?.issues[0]?.message).toContain('lowercase')
  })

  it('does not apply the reserved keys, which are a validity rule of the document', () => {
    expect(collectionKey.safeParse('id').success).toBe(true)
    expect(collectionsDocument.safeParse(minimal({ type: 'boolean' })).success).toBe(true)
    const reserved = { format: 1, collections: { things: { binding: 'global', fields: { revision: { type: 'boolean' } } } } }
    expect(collectionsDocument.safeParse(reserved).success).toBe(true)
  })
})

describe('the published constants', () => {
  it('COLLECTION_RESERVED_KEYS is exactly id, robot, robot_id, created_at, created_by, updated_at, updated_by, revision', () => {
    expect([...COLLECTION_RESERVED_KEYS]).toEqual([
      'id', 'robot', 'robot_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'revision',
    ])
  })

  it('COLLECTION_LIMITS carries every limit with its value', () => {
    expect(COLLECTION_LIMITS).toEqual({
      collections: 50,
      fields: 100,
      recordBytes: 1_048_576,
      textMax: 1000,
      textDefault: 255,
      longTextMax: 100_000,
      longTextDefault: 10_000,
      selectOptions: 500,
      inValues: 100,
      filterDepth: 3,
      filterConditions: 50,
      searchWords: 10,
      sortFields: 3,
      pageDefault: 50,
      pageMax: 500,
      importBytes: 10_000_000,
      importRows: 50_000,
      writesPerMinuteApp: 600,
      writesPerMinuteActor: 120,
      restoreDays: 90,
      growthFactor: 10,
      growthMinRevisions: 10_000,
      schemaSourceBytes: 1_000_000,
      patternMax: 1000,
      jsonDepth: 32,
      importErrorText: 200,
    })
  })

  it('lists the nine field types', () => {
    expect(collectionFieldType.options).toEqual([
      'text', 'long_text', 'number', 'boolean', 'select', 'date', 'datetime', 'json', 'reference',
    ])
  })
})

describe('field options', () => {
  it('text max_length 1001, long_text 100001, select with 501 options and a select with no options are rejected', () => {
    expect(collectionField.safeParse({ type: 'text', max_length: 1001 }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'long_text', max_length: 100_001 }).success).toBe(false)
    const options = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `o${i}` }))
    expect(collectionField.safeParse({ type: 'select', options: options(501) }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'select', options: [] }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'select' }).success).toBe(false)
  })

  it('accepts the largest allowed values', () => {
    expect(collectionField.safeParse({ type: 'text', max_length: 1000 }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'long_text', max_length: 100_000 }).success).toBe(true)
    const options = Array.from({ length: 500 }, (_, i) => ({ value: `o${i}` }))
    expect(collectionField.safeParse({ type: 'select', options }).success).toBe(true)
  })

  it('needs a positive whole max_length', () => {
    for (const max_length of [0, -1, 1.5]) {
      expect(collectionField.safeParse({ type: 'text', max_length }).success, String(max_length)).toBe(false)
      expect(collectionField.safeParse({ type: 'long_text', max_length }).success, String(max_length)).toBe(false)
    }
  })

  it('holds a select option to a value of 1..200 characters', () => {
    expect(collectionField.safeParse({ type: 'select', options: [{ value: '' }] }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'select', options: [{ value: 'x'.repeat(201) }] }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'select', options: [{ value: 'x'.repeat(200), label: 'Long' }] }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'select', options: [{ label: 'No value' }] }).success).toBe(false)
  })

  it('caps label at 120 and description at 1000 characters', () => {
    expect(collectionField.safeParse({ type: 'boolean', label: 'x'.repeat(120) }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'boolean', label: 'x'.repeat(121) }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'boolean', description: 'x'.repeat(1000) }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'boolean', description: 'x'.repeat(1001) }).success).toBe(false)
  })

  it('takes unique as true, false or collection and nothing else', () => {
    for (const unique of [true, false, 'collection']) {
      expect(collectionField.safeParse({ type: 'text', unique }).success, String(unique)).toBe(true)
    }
    for (const unique of ['robot', 1, null]) {
      expect(collectionField.safeParse({ type: 'text', unique }).success, String(unique)).toBe(false)
    }
  })

  it('takes any value as a default, which the document validity checks against the field', () => {
    expect(collectionField.safeParse({ type: 'number', default: 'x' }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'json', default: { a: [1, 2] } }).success).toBe(true)
  })

  it('takes a json schema as a name or an object and nothing else', () => {
    expect(collectionField.safeParse({ type: 'json', schema: 'pose2d' }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'json', schema: { type: 'object' } }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'json' }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'json', schema: 5 }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'json', schema: ['array'] }).success).toBe(false)
  })

  it('needs a collection key in to, and takes prevent or clear for on_delete', () => {
    expect(collectionField.safeParse({ type: 'reference', to: 'locations' }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'reference', to: 'locations', on_delete: 'clear' }).success).toBe(true)
    expect(collectionField.safeParse({ type: 'reference' }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'reference', to: 'Locations' }).success).toBe(false)
    expect(collectionField.safeParse({ type: 'reference', to: 'locations', on_delete: 'cascade' }).success).toBe(false)
  })
})

describe('access', () => {
  it('parses a role, a list and { all, own }', () => {
    expect(collectionAccess.safeParse({ read: 'observe' }).success).toBe(true)
    expect(collectionAccess.safeParse({ read: ['observe', 'admin'], create: ['admin'] }).success).toBe(true)
    expect(collectionAccess.safeParse({ update: { all: 'admin', own: ['operate'] }, delete: { all: ['admin'] } }).success).toBe(true)
    expect(collectionAccess.safeParse({}).success).toBe(true)
  })

  it('parses { own: [a] } alone', () => {
    expect(collectionAccess.safeParse({ update: { own: ['a'] } }).success).toBe(true)
    expect(collectionAccess.safeParse({ delete: { own: 'a' } }).success).toBe(true)
  })

  it('rejects read as an object', () => {
    expect(collectionAccess.safeParse({ read: { all: 'admin' } }).success).toBe(false)
    expect(collectionAccess.safeParse({ create: { all: 'admin' } }).success).toBe(false)
  })

  it('rejects an empty role key and one longer than 63 characters', () => {
    expect(collectionAccess.safeParse({ read: '' }).success).toBe(false)
    expect(collectionAccess.safeParse({ read: ['x'.repeat(64)] }).success).toBe(false)
    expect(collectionAccess.safeParse({ read: 'x'.repeat(63) }).success).toBe(true)
  })

  it('rejects an action it does not know', () => {
    expect(collectionAccess.safeParse({ restore: 'admin' }).success).toBe(false)
  })
})

describe('the published JSON Schema', () => {
  // Read per test: a missing artifact then fails the test that needs it, not the whole file.
  const load = () =>
    JSON.parse(
      readFileSync(new URL('../artifacts/schema/collections-document.schema.json', import.meta.url), 'utf8'),
    ) as Record<string, any>

  /** The map of collections in the artifact: the object member of the `object | null` the property accepts. */
  const collectionsMap = (artifact: Record<string, any>): Record<string, any> =>
    (artifact.properties.collections.anyOf as Record<string, any>[]).find((member) => member.type === 'object')!

  it('forbids additional properties on collection definitions and lists all nine field types', () => {
    const artifact = load()
    const definition = collectionsMap(artifact).additionalProperties
    expect(definition.additionalProperties).toBe(false)
    expect(artifact.additionalProperties).toBe(false)

    const fields = definition.properties.fields.additionalProperties
    const members: Record<string, any>[] = fields.oneOf ?? fields.anyOf
    const types = members.map((member) => member.properties.type.const).sort()
    expect(types).toEqual([...collectionFieldType.options].sort())
    for (const member of members) expect(member.additionalProperties, member.properties.type.const).toBe(false)
  })

  it('restricts keys to the key grammar and fixes the format to 1', () => {
    const artifact = load()
    expect(artifact.properties.format.const).toBe(1)
    expect(collectionsMap(artifact).propertyNames.pattern).toBe('^[a-z][a-z0-9_]{0,62}$')
    expect(collectionsMap(artifact).additionalProperties.properties.fields.propertyNames.pattern).toBe('^[a-z][a-z0-9_]{0,62}$')
  })

  it('allows null for collections in the artifact, as the parser does, and still requires the key', () => {
    const artifact = load()
    expect(artifact.required).toEqual(['format', 'collections'])
    expect(artifact.properties.collections.anyOf.map((member: { type: string }) => member.type).sort()).toEqual(['null', 'object'])

    const validate = new Ajv2020({ strict: false }).compile(artifact)
    expect(validate({ format: 1, collections: null }), 'null').toBe(true)
    expect(validate({ format: 1, collections: {} }), 'empty map').toBe(true)
    expect(validate({ format: 1 }), 'missing key').toBe(false)
    for (const bad of [5, 'none', [], false]) expect(validate({ format: 1, collections: bad }), JSON.stringify(bad)).toBe(false)
  })

  it('describes the document the same way for a reader of the parsed value: the output side is the map', () => {
    const output = z.toJSONSchema(collectionsDocument, { io: 'output' }) as Record<string, any>
    expect(output.required).toEqual(['format', 'collections'])
    expect(output.properties.collections.type).toBe('object')
    expect(output.properties.collections.anyOf).toBeUndefined()
  })

  it('caps a pattern at 1,000 characters, in the parser and in the artifact', () => {
    const pattern = (length: number) => collectionField.safeParse({ type: 'text', pattern: 'a'.repeat(length) }).success
    expect(pattern(1000)).toBe(true)
    expect(pattern(1001)).toBe(false)
    const artifact = load()
    const fields = collectionsMap(artifact).additionalProperties.properties.fields.additionalProperties
    const members: Record<string, any>[] = fields.oneOf ?? fields.anyOf
    const text = members.find((member) => member.properties.type.const === 'text')!
    expect(text.properties.pattern.maxLength).toBe(1000)
    expect(text.properties.pattern.description).toMatch(/too complex/)
  })

  it('says in which dialect a text pattern is written and checked', () => {
    const artifact = load()
    const fields = collectionsMap(artifact).additionalProperties.properties.fields.additionalProperties
    const members: Record<string, any>[] = fields.oneOf ?? fields.anyOf
    const text = members.find((member) => member.properties.type.const === 'text')!
    const description: string = text.properties.pattern.description
    expect(description).toContain('RE2')
    expect(description).toMatch(/lookahead/)
    expect(description).toMatch(/lookbehind/)
    expect(description).toMatch(/backreference/)
    expect(description).toMatch(/unicode/)
  })

  it('describes the keys it asks an author to write', () => {
    const artifact = load()
    const definition = collectionsMap(artifact).additionalProperties
    expect(typeof definition.properties.binding.description).toBe('string')
    expect(typeof definition.properties.display.description).toBe('string')
    expect(typeof definition.properties.access.description).toBe('string')
  })
})
