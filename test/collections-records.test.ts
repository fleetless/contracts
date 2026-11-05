// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLLECTION_FILTER_OPS,
  COLLECTION_FILTER_SYSTEM_KEYS,
  COLLECTION_LIMITS,
  collectionActor,
  collectionDefinitionsResponse,
  collectionFilter,
  collectionListResponse,
  collectionRecord,
  collectionRecordHistoryQuery,
  collectionRecordHistoryResponse,
  collectionRecordListQuery,
  collectionRecordListResponse,
  collectionRecordRestoreRequest,
  collectionRecordWrite,
  collectionRevision,
  collectionSummary,
  parseCollectionFilter,
  parseCollectionSort,
  type CollectionFilterNode,
} from '../src/index.js'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ROBOT = '9b2c1d34-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const NIL = '00000000-0000-0000-0000-000000000000'
const AT = '2026-11-04T10:00:00.000Z'

const developer = { kind: 'developer', id: ROBOT, label: 'ada@example.com' }
const fleetless = { kind: 'fleetless', id: NIL, label: 'Fleetless' }

const record = (over: Record<string, unknown> = {}) => ({
  id: ID,
  robot_id: null,
  created_at: AT,
  created_by: developer,
  updated_at: AT,
  updated_by: developer,
  revision: 1,
  display: 'XTD1',
  values: { name: 'XTD1' },
  ...over,
})

/** A filter with `count` conditions on distinct numeric fields, all under one `and`. */
const manyConditions = (count: number) => ({ and: Array.from({ length: count }, (_, i) => ({ [`f${i}`]: { eq: i } })) })

/** `levels` nested and/or objects around one condition: levels 3 is the deepest allowed. */
function nested(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { name: { eq: 'x' } }
  for (let i = 0; i < levels; i += 1) node = { [i % 2 === 0 ? 'and' : 'or']: [node] }
  return node
}

function parsed(input: unknown): CollectionFilterNode {
  const result = parseCollectionFilter(input)
  if (!result.ok) throw new Error(`expected a valid filter, got ${JSON.stringify(result.issues)}`)
  return result.node
}

function refused(input: unknown) {
  const result = parseCollectionFilter(input)
  if (result.ok) throw new Error(`expected a refused filter, got ${JSON.stringify(result.node)}`)
  return result.issues
}

describe('parseCollectionFilter', () => {
  it('accepts the documented examples', () => {
    expect(parsed({ 'location.name': { eq: 'XTD1' } })).toEqual({
      kind: 'condition',
      field: 'location.name',
      op: 'eq',
      value: 'XTD1',
    })
    expect(parsed({ and: [{ position_m: { gte: 10 } }, { or: [{ type: { eq: 'bpm' } }, { name: { contains: 'quad' } }] }] })).toEqual({
      kind: 'and',
      children: [
        { kind: 'condition', field: 'position_m', op: 'gte', value: 10 },
        {
          kind: 'or',
          children: [
            { kind: 'condition', field: 'type', op: 'eq', value: 'bpm' },
            { kind: 'condition', field: 'name', op: 'contains', value: 'quad' },
          ],
        },
      ],
    })
  })

  it('accepts and/or nested three levels deep', () => {
    expect(parsed(nested(3))).toEqual({
      kind: 'and',
      children: [
        {
          kind: 'or',
          children: [{ kind: 'and', children: [{ kind: 'condition', field: 'name', op: 'eq', value: 'x' }] }],
        },
      ],
    })
    expect(parsed(nested(0))).toEqual({ kind: 'condition', field: 'name', op: 'eq', value: 'x' })
  })

  it('refuses depth 4, naming the level that is too deep', () => {
    const issues = refused(nested(4))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.path).toBe('/or/0/and/0/or/0/and')
    expect(issues[0]!.message).toContain(String(COLLECTION_LIMITS.filterDepth))
  })

  it('refuses a very deep filter without walking all of it', () => {
    let node: Record<string, unknown> = { name: { eq: 'x' } }
    for (let i = 0; i < 20_000; i += 1) node = { and: [node] }
    expect(refused(node)).toHaveLength(1)
  })

  it('accepts 50 conditions and refuses 51', () => {
    expect(parsed(manyConditions(50))).toMatchObject({ kind: 'and' })
    const issues = refused(manyConditions(51))
    expect(issues).toEqual([{ path: '', message: expect.stringContaining('50') }])
  })

  it('counts the conditions of every branch together', () => {
    const half = Array.from({ length: 26 }, (_, i) => ({ [`f${i}`]: { eq: i } }))
    expect(refused({ or: [{ and: half }, { and: half }] })).toHaveLength(1)
  })

  it('accepts an in list of 100 and refuses 101, an empty one and a non-list', () => {
    const list = (count: number) => Array.from({ length: count }, (_, i) => `v${i}`)
    expect(parsed({ type: { in: list(100) } })).toMatchObject({ op: 'in', value: list(100) })
    expect(refused({ type: { in: list(101) } })).toEqual([{ path: '/type/in', message: expect.stringContaining('100') }])
    expect(refused({ type: { in: [] } })).toEqual([{ path: '/type/in', message: expect.stringContaining('at least one') }])
    expect(refused({ type: { in: 'bpm' } })).toEqual([{ path: '/type/in', message: expect.stringContaining('list') }])
  })

  it('refuses an in list that holds something other than plain values', () => {
    expect(refused({ type: { in: ['bpm', null] } })[0]!.path).toBe('/type/in/1')
    expect(refused({ type: { in: [['bpm']] } })[0]!.path).toBe('/type/in/0')
    expect(refused({ type: { in: [{ a: 1 }] } })[0]!.path).toBe('/type/in/0')
  })

  it('refuses an unknown operator and says which ones exist', () => {
    const issues = refused({ name: { like: 'x' } })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.path).toBe('/name/like')
    for (const op of COLLECTION_FILTER_OPS) expect(issues[0]!.message).toContain(op)
  })

  it('refuses a condition with two operators', () => {
    const issues = refused({ position_m: { gte: 1, lte: 5 } })
    expect(issues).toEqual([{ path: '/position_m', message: expect.stringContaining('one operator') }])
  })

  it('refuses a condition without an operator, and a bare value', () => {
    expect(refused({ name: {} })[0]!.message).toContain('one operator')
    expect(refused({ name: 'XTD1' })[0]!.message).toContain('{ "eq"')
    expect(refused({ name: ['XTD1'] })[0]!.path).toBe('/name')
    expect(refused({ name: null })[0]!.path).toBe('/name')
  })

  it('refuses a field with two dots, and says one reference hop is the limit', () => {
    const issues = refused({ 'a.b.c': { eq: 1 } })
    expect(issues).toEqual([{ path: '/a.b.c', message: expect.stringContaining('one reference') }])
  })

  it('refuses a field that is not a key', () => {
    for (const field of ['Name', '1name', 'name.', '.name', 'na me', 'a..b', 'name-1', '', 'x'.repeat(64)]) {
      expect(refused({ [field]: { eq: 1 } }), `field ${JSON.stringify(field)}`).toHaveLength(1)
    }
  })

  it('accepts the system fields a filter may use, also after a hop', () => {
    expect(COLLECTION_FILTER_SYSTEM_KEYS).toEqual(['id', 'robot_id', 'created_at', 'updated_at', 'created_by'])
    for (const key of COLLECTION_FILTER_SYSTEM_KEYS) {
      expect(parsed({ [key]: { eq: ID } })).toMatchObject({ field: key })
    }
    expect(parsed({ 'location.created_at': { gt: AT } })).toMatchObject({ field: 'location.created_at' })
    expect(parsed({ 'location.id': { eq: ID } })).toMatchObject({ field: 'location.id' })
  })

  it('refuses a system value a filter may not use, and a hop that does not start at a reference', () => {
    for (const key of ['revision', 'updated_by', 'robot']) {
      const issues = refused({ [key]: { eq: 1 } })
      expect(issues, key).toHaveLength(1)
      expect(issues[0]!.message).toContain('id, robot_id, created_at, updated_at, created_by')
    }
    expect(refused({ 'robot.name': { eq: 'x' } })).toHaveLength(1)
    expect(refused({ 'id.name': { eq: 'x' } })).toHaveLength(1)
    expect(refused({ 'location.revision': { eq: 1 } })).toHaveLength(1)
  })

  it('treats ne and empty values as typed, never coerced', () => {
    expect(parsed({ position_m: { ne: 5 } })).toMatchObject({ op: 'ne', value: 5 })
    expect(parsed({ name: { ne: '5' } })).toMatchObject({ op: 'ne', value: '5' })
    expect(parsed({ active: { ne: false } })).toMatchObject({ op: 'ne', value: false })
    expect(parsed({ active: { eq: true } })).toMatchObject({ op: 'eq', value: true })
    expect(parsed({ serial: { empty: true } })).toMatchObject({ op: 'empty', value: true })
    expect(parsed({ serial: { empty: false } })).toMatchObject({ op: 'empty', value: false })
    for (const bad of ['true', 'false', 1, 0, null, [true], {}]) {
      expect(refused({ serial: { empty: bad } }), `empty: ${JSON.stringify(bad)}`).toEqual([
        { path: '/serial/empty', message: expect.stringContaining('true or false') },
      ])
    }
  })

  it('takes plain values for the comparisons and tells null to use empty', () => {
    const nullIssue = refused({ serial: { eq: null } })
    expect(nullIssue[0]!.message).toContain('empty')
    expect(refused({ serial: { ne: null } })).toHaveLength(1)
    expect(refused({ serial: { eq: ['a'] } })).toHaveLength(1)
    expect(refused({ serial: { eq: { a: 1 } } })).toHaveLength(1)
    // Order comparisons are for numbers and text (dates and datetimes are text).
    expect(parsed({ at: { lt: AT } })).toMatchObject({ op: 'lt', value: AT })
    expect(parsed({ n: { gte: -1.5 } })).toMatchObject({ op: 'gte', value: -1.5 })
    expect(refused({ active: { lt: true } })).toHaveLength(1)
    expect(refused({ n: { gt: null } })).toHaveLength(1)
    // `contains` is a text search.
    expect(parsed({ name: { contains: '' } })).toMatchObject({ op: 'contains', value: '' })
    expect(refused({ name: { contains: 5 } })).toHaveLength(1)
  })

  it('keeps every operator reachable', () => {
    const values: Record<string, unknown> = {
      eq: 'a',
      ne: 'a',
      lt: 1,
      lte: 1,
      gt: 1,
      gte: 1,
      contains: 'a',
      in: ['a'],
      empty: true,
    }
    expect([...COLLECTION_FILTER_OPS].sort()).toEqual(Object.keys(values).sort())
    for (const op of COLLECTION_FILTER_OPS) expect(parsed({ f: { [op]: values[op] } })).toMatchObject({ op })
  })

  it('refuses an object that has and/or next to anything else', () => {
    expect(refused({ and: [{ a: { eq: 1 } }], b: { eq: 2 } })).toEqual([{ path: '', message: expect.stringContaining('no other keys') }])
    expect(refused({ and: [{ a: { eq: 1 } }], or: [{ b: { eq: 2 } }] })).toHaveLength(1)
    expect(refused({ or: [{ a: { eq: 1 } }], and: [] })).toHaveLength(1)
  })

  it('refuses and/or that is not a non-empty list of objects', () => {
    expect(refused({ and: { a: { eq: 1 } } })).toEqual([{ path: '/and', message: expect.stringContaining('list') }])
    expect(refused({ or: [] })).toEqual([{ path: '/or', message: expect.stringContaining('at least one') }])
    expect(refused({ and: [5] })[0]!.path).toBe('/and/0')
    expect(refused({ and: [null] })[0]!.path).toBe('/and/0')
    expect(refused({ and: [[{ a: { eq: 1 } }]] })[0]!.path).toBe('/and/0')
  })

  it('refuses an object that names several fields, and says to use and', () => {
    const issues = refused({ a: { eq: 1 }, b: { eq: 2 } })
    expect(issues).toEqual([{ path: '', message: expect.stringContaining('"and"') }])
  })

  it('refuses a filter that is not an object, and an empty object', () => {
    for (const input of [null, undefined, 5, 'name', true, [], [{ a: { eq: 1 } }]]) {
      expect(refused(input), JSON.stringify(input)).toEqual([{ path: '', message: expect.stringContaining('JSON object') }])
    }
    expect(refused({})).toHaveLength(1)
  })

  it('reports every problem at once, each with the path of the filter object that has it', () => {
    const issues = refused({
      and: [{ name: { like: 'x' } }, { 'a.b.c': { eq: 1 } }, { or: [{ serial: { empty: 'yes' } }] }, { ok: { eq: 1 } }],
    })
    expect(issues.map((i) => i.path)).toEqual(['/and/0/name/like', '/and/1/a.b.c', '/and/2/or/0/serial/empty'])
  })

  it('stops listing after a handful of problems', () => {
    const issues = refused({ and: Array.from({ length: 200 }, () => 5) })
    expect(issues.length).toBeLessThanOrEqual(20)
    expect(issues.length).toBeGreaterThan(1)
  })

  it('escapes the characters a path cannot hold', () => {
    const issues = refused({ 'a/b~c': { eq: 1 } })
    expect(issues[0]!.path).toBe('/a~1b~0c')
  })

  it('does not treat inherited names or __proto__ as a field', () => {
    expect(refused(JSON.parse('{"__proto__":{"eq":1}}'))).toHaveLength(1)
    expect(refused({ constructor: { like: 1 } })[0]!.path).toBe('/constructor/like')
    expect(refused(Object.create({ and: [{ a: { eq: 1 } }] }))).toHaveLength(1)
  })

  it('does not echo a long value in a message', () => {
    const issues = refused({ name: { ['x'.repeat(5000)]: 1 } })
    expect(issues[0]!.message.length).toBeLessThan(300)
  })

  it('is agreed on by the schema type: a filter is a JSON object on the wire', () => {
    expect(collectionFilter.safeParse({ name: { eq: 'x' } }).success).toBe(true)
    expect(collectionFilter.safeParse([]).success).toBe(false)
    expect(collectionFilter.safeParse('{}').success).toBe(false)
  })
})

describe('parseCollectionSort', () => {
  it('accepts three keys and reads the minus sign as descending', () => {
    expect(parseCollectionSort(['position_m', '-name', 'location.name'])).toEqual({
      ok: true,
      sort: [
        { field: 'position_m', descending: false },
        { field: 'name', descending: true },
        { field: 'location.name', descending: false },
      ],
    })
  })

  it('accepts no keys: the cloud adds its own id tie-break', () => {
    expect(parseCollectionSort([])).toEqual({ ok: true, sort: [] })
  })

  it('accepts the system fields, and id as an explicit key', () => {
    expect(parseCollectionSort(['-created_at', 'id'])).toEqual({
      ok: true,
      sort: [
        { field: 'created_at', descending: true },
        { field: 'id', descending: false },
      ],
    })
  })

  it('refuses four keys', () => {
    const result = parseCollectionSort(['a', 'b', 'c', 'd'])
    expect(result).toEqual({ ok: false, message: expect.stringContaining('3') })
  })

  it('refuses a duplicate, also with the other direction', () => {
    expect(parseCollectionSort(['name', 'name'])).toEqual({ ok: false, message: expect.stringContaining('name') })
    expect(parseCollectionSort(['name', '-name'])).toEqual({ ok: false, message: expect.stringContaining('name') })
  })

  it('refuses a key that is not a field', () => {
    for (const entry of ['', '-', '--name', '+name', ' name', 'name ', 'a.b.c', 'Name', 'revision', 'robot.name']) {
      const result = parseCollectionSort([entry])
      expect(result.ok, JSON.stringify(entry)).toBe(false)
    }
  })

  it('names the entry that is wrong', () => {
    const result = parseCollectionSort(['name', 'a.b.c'])
    expect(result).toEqual({ ok: false, message: expect.stringContaining('a.b.c') })
  })
})

describe('collectionActor', () => {
  it('accepts the four kinds, the nil id included', () => {
    for (const kind of ['developer', 'app_user', 'server_key', 'fleetless']) {
      expect(collectionActor.safeParse({ kind, id: kind === 'fleetless' ? NIL : ID, label: 'x' }).success, kind).toBe(true)
    }
    expect(collectionActor.safeParse(fleetless).success).toBe(true)
  })

  it('refuses an unknown kind, a non-uuid id and a missing label', () => {
    expect(collectionActor.safeParse({ ...developer, kind: 'bridge' }).success).toBe(false)
    expect(collectionActor.safeParse({ ...developer, kind: 'end_user' }).success).toBe(false)
    expect(collectionActor.safeParse({ ...developer, id: 'andre' }).success).toBe(false)
    expect(collectionActor.safeParse({ kind: 'developer', id: ID }).success).toBe(false)
  })
})

describe('collectionRecord', () => {
  it('accepts the envelope, with and without a robot and missing_required', () => {
    expect(collectionRecord.safeParse(record()).success).toBe(true)
    expect(collectionRecord.safeParse(record({ robot_id: ROBOT, missing_required: ['serial'], updated_by: fleetless })).success).toBe(true)
  })

  it('needs display and values', () => {
    const { display: _display, ...withoutDisplay } = record()
    const { values: _values, ...withoutValues } = record()
    expect(collectionRecord.safeParse(withoutDisplay).success).toBe(false)
    expect(collectionRecord.safeParse(withoutValues).success).toBe(false)
    expect(collectionRecord.safeParse(record({ display: '' })).success).toBe(true)
    expect(collectionRecord.safeParse(record({ values: {} })).success).toBe(true)
  })

  it('needs the robot_id key, null for a record without a robot', () => {
    const { robot_id: _robot, ...withoutRobot } = record()
    expect(collectionRecord.safeParse(withoutRobot).success).toBe(false)
    expect(collectionRecord.safeParse(record({ robot_id: 'robot-1' })).success).toBe(false)
  })

  it('refuses a revision below 1 and a fractional one', () => {
    expect(collectionRecord.safeParse(record({ revision: 0 })).success).toBe(false)
    expect(collectionRecord.safeParse(record({ revision: 1.5 })).success).toBe(false)
  })

  it('refuses a malformed timestamp and an actor without a label', () => {
    expect(collectionRecord.safeParse(record({ created_at: 'yesterday' })).success).toBe(false)
    expect(collectionRecord.safeParse(record({ created_by: { kind: 'developer', id: ROBOT } })).success).toBe(false)
  })

  it('lets a reference value hold an embedded record', () => {
    const embedded = record({ id: ROBOT })
    expect(collectionRecord.safeParse(record({ values: { location: embedded } })).success).toBe(true)
  })
})

describe('collectionRecordListQuery', () => {
  it('accepts a query string with every parameter', () => {
    const query = {
      filter: '{"location.name":{"eq":"XTD1"}}',
      search: 'quad xtd1',
      sort: '-position_m,name',
      expand: 'location',
      limit: '20',
      cursor: 'abc',
      count: 'true',
      deleted: 'false',
      robot: ROBOT,
    }
    const result = collectionRecordListQuery.safeParse(query)
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ ...query, limit: 20 })
  })

  it('accepts an empty query', () => {
    expect(collectionRecordListQuery.safeParse({}).success).toBe(true)
  })

  it('refuses limit 501 and accepts "500", 500 and "1"', () => {
    expect(collectionRecordListQuery.safeParse({ limit: 501 }).success).toBe(false)
    expect(collectionRecordListQuery.safeParse({ limit: '501' }).success).toBe(false)
    expect(collectionRecordListQuery.safeParse({ limit: '500' }).data?.limit).toBe(500)
    expect(collectionRecordListQuery.safeParse({ limit: 500 }).data?.limit).toBe(COLLECTION_LIMITS.pageMax)
    expect(collectionRecordListQuery.safeParse({ limit: '1' }).data?.limit).toBe(1)
  })

  it('refuses limit 0, a negative or fractional limit and a word', () => {
    for (const limit of ['0', 0, '-1', -1, '1.5', 1.5, 'many', '', '12345']) {
      expect(collectionRecordListQuery.safeParse({ limit }).success, `limit ${JSON.stringify(limit)}`).toBe(false)
    }
  })

  it('takes count and deleted as the words true and false only', () => {
    expect(collectionRecordListQuery.safeParse({ count: 'false', deleted: 'true' }).success).toBe(true)
    for (const bad of ['1', 'yes', true, 'TRUE']) {
      expect(collectionRecordListQuery.safeParse({ count: bad }).success, `count ${String(bad)}`).toBe(false)
      expect(collectionRecordListQuery.safeParse({ deleted: bad }).success, `deleted ${String(bad)}`).toBe(false)
    }
  })

  it('refuses a robot that is not a uuid and a parameter it does not know', () => {
    expect(collectionRecordListQuery.safeParse({ robot: 'robot-1' }).success).toBe(false)
    expect(collectionRecordListQuery.safeParse({ serach: 'x' }).success).toBe(false)
  })

  it('refuses an empty cursor', () => {
    expect(collectionRecordListQuery.safeParse({ cursor: '' }).success).toBe(false)
  })

  describe('as published', () => {
    const artifact = (name: string) =>
      JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')) as {
        properties: Record<string, { description: string }>
      }
    const list = artifact('collection-record-list-query')

    it('names the system fields a filter and a sort can use', () => {
      for (const key of COLLECTION_FILTER_SYSTEM_KEYS) {
        expect(list.properties.filter!.description, `filter names ${key}`).toContain(`\`${key}\``)
        expect(list.properties.sort!.description, `sort names ${key}`).toContain(`\`${key}\``)
      }
      expect(list.properties.filter!.description).toContain('reference.field')
      expect(list.properties.sort!.description).toContain('reference.field')
    })

    it('says that created_by compares the id of whoever created the record', () => {
      expect(list.properties.filter!.description).toMatch(/`created_by` is compared with the id of the/)
    })

    it('says the same of the export, which narrows the same list', () => {
      const exported = artifact('collection-export-query')
      for (const key of ['filter', 'search', 'sort', 'robot']) {
        expect(exported.properties[key]!.description, key).toBe(list.properties[key]!.description)
      }
    })
  })
})

describe('collectionRecordListResponse', () => {
  it('accepts a page, with and without a total', () => {
    expect(collectionRecordListResponse.safeParse({ records: [record()], next_cursor: null }).success).toBe(true)
    expect(collectionRecordListResponse.safeParse({ records: [], next_cursor: 'abc', total: 0 }).success).toBe(true)
  })

  it('needs next_cursor, even when it is null', () => {
    expect(collectionRecordListResponse.safeParse({ records: [] }).success).toBe(false)
  })

  it('refuses a negative total and a record without display', () => {
    expect(collectionRecordListResponse.safeParse({ records: [], next_cursor: null, total: -1 }).success).toBe(false)
    const { display: _display, ...bad } = record()
    expect(collectionRecordListResponse.safeParse({ records: [bad], next_cursor: null }).success).toBe(false)
  })
})

describe('collectionRecordWrite', () => {
  it('accepts values alone, and with a robot and an expected revision', () => {
    expect(collectionRecordWrite.safeParse({ values: { name: 'x', note: null } }).success).toBe(true)
    expect(collectionRecordWrite.safeParse({ values: {}, robot_id: ROBOT, expected_revision: 7 }).success).toBe(true)
  })

  it('refuses unknown keys', () => {
    expect(collectionRecordWrite.safeParse({ values: {}, robot: ROBOT }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ values: {}, id: ID }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ name: 'flat record' }).success).toBe(false)
  })

  it('refuses expected_revision 0, a fractional one and a missing values', () => {
    expect(collectionRecordWrite.safeParse({ values: {}, expected_revision: 0 }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ values: {}, expected_revision: -3 }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ values: {}, expected_revision: 1.5 }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ robot_id: ROBOT }).success).toBe(false)
    expect(collectionRecordWrite.safeParse({ values: [] }).success).toBe(false)
  })

  it('refuses a robot_id that is not a uuid', () => {
    expect(collectionRecordWrite.safeParse({ values: {}, robot_id: 'robot-1' }).success).toBe(false)
  })
})

const revision = (over: Record<string, unknown> = {}) => ({
  seq: 12,
  op: 'update',
  at: AT,
  actor: developer,
  reason: null,
  revision: 2,
  changes: { name: { old: 'XTD1', new: 'XTD2' } },
  record: null,
  ...over,
})

describe('collectionRevision and history', () => {
  it('accepts an update, a schema change and a delete that carries the record', () => {
    expect(collectionRevision.safeParse(revision()).success).toBe(true)
    expect(collectionRevision.safeParse(revision({ actor: fleetless, reason: 'schema v5' })).success).toBe(true)
    expect(collectionRevision.safeParse(revision({ op: 'delete', revision: 3, changes: {}, record: record() })).success).toBe(true)
  })

  it('knows the four operations only', () => {
    for (const op of ['create', 'update', 'delete', 'restore']) {
      expect(collectionRevision.safeParse(revision({ op })).success, op).toBe(true)
    }
    expect(collectionRevision.safeParse(revision({ op: 'purge' })).success).toBe(false)
  })

  it('needs both sides of every change, null standing for no value', () => {
    expect(collectionRevision.safeParse(revision({ changes: { note: { old: null, new: 'x' } } })).success).toBe(true)
    expect(collectionRevision.safeParse(revision({ changes: { note: { old: 'x' } } })).success).toBe(false)
  })

  it('needs reason and record, null when there is none', () => {
    const { reason: _reason, ...withoutReason } = revision()
    const { record: _record, ...withoutRecord } = revision()
    expect(collectionRevision.safeParse(withoutReason).success).toBe(false)
    expect(collectionRevision.safeParse(withoutRecord).success).toBe(false)
  })

  it('refuses seq 0 and a revision below 1', () => {
    expect(collectionRevision.safeParse(revision({ seq: 0 })).success).toBe(false)
    expect(collectionRevision.safeParse(revision({ revision: 0 })).success).toBe(false)
  })

  it('reads the history query like every other seq cursor', () => {
    expect(collectionRecordHistoryQuery.safeParse({}).success).toBe(true)
    expect(collectionRecordHistoryQuery.safeParse({ limit: '50', before_seq: '99' }).data).toEqual({ limit: 50, before_seq: 99 })
    expect(collectionRecordHistoryQuery.safeParse({ limit: 501 }).success).toBe(false)
    expect(collectionRecordHistoryQuery.safeParse({ before_seq: 0 }).success).toBe(false)
    expect(collectionRecordHistoryQuery.safeParse({ before: 5 }).success).toBe(false)
  })

  it('accepts a history page, with and without a purge note', () => {
    expect(collectionRecordHistoryResponse.safeParse({ revisions: [revision()], next_before_seq: 11, purged: null }).success).toBe(true)
    expect(
      collectionRecordHistoryResponse.safeParse({
        revisions: [],
        next_before_seq: null,
        purged: { before: AT, by: developer, at: '2026-11-05T08:00:00.000Z' },
      }).success,
    ).toBe(true)
  })

  it('needs next_before_seq and purged, null when there is nothing', () => {
    expect(collectionRecordHistoryResponse.safeParse({ revisions: [], purged: null }).success).toBe(false)
    expect(collectionRecordHistoryResponse.safeParse({ revisions: [], next_before_seq: null }).success).toBe(false)
    expect(collectionRecordHistoryResponse.safeParse({ revisions: [], next_before_seq: 0, purged: null }).success).toBe(false)
    expect(
      collectionRecordHistoryResponse.safeParse({ revisions: [], next_before_seq: null, purged: { before: AT, by: developer } }).success,
    ).toBe(false)
  })

  it('accepts a restore request with or without a seq and refuses anything else', () => {
    expect(collectionRecordRestoreRequest.safeParse({}).success).toBe(true)
    expect(collectionRecordRestoreRequest.safeParse({ seq: 4 }).success).toBe(true)
    expect(collectionRecordRestoreRequest.safeParse({ seq: 0 }).success).toBe(false)
    expect(collectionRecordRestoreRequest.safeParse({ seq: 1.5 }).success).toBe(false)
    expect(collectionRecordRestoreRequest.safeParse({ revision: 4 }).success).toBe(false)
  })
})

const summary = (over: Record<string, unknown> = {}) => ({
  key: 'components',
  label: 'Components',
  binding: 'global',
  records: 120,
  fields: 6,
  read_roles: ['observe', 'operate'],
  warnings: [],
  revisions: 340,
  history_bytes: 81_920,
  updated_at: AT,
  ...over,
})

describe('collectionSummary and collectionListResponse', () => {
  it('accepts a summary, with every warning and without a last update', () => {
    expect(collectionSummary.safeParse(summary()).success).toBe(true)
    expect(
      collectionSummary.safeParse(summary({ warnings: ['no_role_access', 'history_growing', 'unknown_role'], updated_at: null })).success,
    ).toBe(true)
  })

  it('refuses a warning it does not know, a key that is not a key and a negative count', () => {
    expect(collectionSummary.safeParse(summary({ warnings: ['sad'] })).success).toBe(false)
    expect(collectionSummary.safeParse(summary({ key: 'Components' })).success).toBe(false)
    expect(collectionSummary.safeParse(summary({ records: -1 })).success).toBe(false)
    expect(collectionSummary.safeParse(summary({ binding: 'per_app' })).success).toBe(false)
  })

  it('wraps the summaries with the published version, null before the first publish', () => {
    expect(collectionListResponse.safeParse({ version: 4, collections: [summary()] }).success).toBe(true)
    expect(collectionListResponse.safeParse({ version: null, collections: [] }).success).toBe(true)
    expect(collectionListResponse.safeParse({ collections: [] }).success).toBe(false)
  })
})

describe('collectionDefinitionsResponse', () => {
  const definition = (over: Record<string, unknown> = {}) => ({
    key: 'components',
    label: 'Components',
    description: '',
    binding: 'global',
    display: '{{name}}',
    fields: { name: { type: 'text', required: true }, type: { type: 'select', options: [{ value: 'bpm' }] } },
    can: { read: true, create: false, update: 'own', delete: false },
    ...over,
  })

  it('accepts collections with the field definitions and what the caller can do', () => {
    expect(collectionDefinitionsResponse.safeParse({ version: 3, collections: [definition()] }).success).toBe(true)
    expect(collectionDefinitionsResponse.safeParse({ version: null, collections: [] }).success).toBe(true)
  })

  it('reads update and delete as all, own or false', () => {
    for (const right of ['all', 'own', false]) {
      expect(collectionDefinitionsResponse.safeParse({ version: 1, collections: [definition({ can: { read: true, create: true, update: right, delete: right } })] }).success).toBe(true)
    }
    for (const right of [true, 'some', null]) {
      expect(collectionDefinitionsResponse.safeParse({ version: 1, collections: [definition({ can: { read: true, create: true, update: right, delete: false } })] }).success).toBe(false)
    }
  })

  it('refuses a field definition the document would refuse', () => {
    expect(
      collectionDefinitionsResponse.safeParse({ version: 1, collections: [definition({ fields: { name: { type: 'number', max_length: 5 } } })] }).success,
    ).toBe(false)
  })

  it('refuses a missing right', () => {
    expect(
      collectionDefinitionsResponse.safeParse({ version: 1, collections: [definition({ can: { read: true, create: true, update: 'all' } })] }).success,
    ).toBe(false)
  })
})
