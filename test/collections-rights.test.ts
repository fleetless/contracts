// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { roleCollectionRights } from '../src/index.js'

const row = { collection: 'logbook', label: 'Logbook', binding: 'per_robot', read: true, create: true, update: 'own', delete: false, robot_filter: true }

/** The JSON Schema artifact a consumer validates against, compiled the way a non-TypeScript consumer would. */
function artifact() {
  const ajv = new (Ajv2020 as any)({ strict: false })
  ;(addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL('../artifacts/schema/role-collection-rights.schema.json', import.meta.url), 'utf8')))
}

describe('roleCollectionRights', () => {
  it('parses a rights row', () => {
    expect(roleCollectionRights.parse(row)).toEqual(row)
    expect(roleCollectionRights.parse({ ...row, binding: 'global', update: 'all', delete: 'all', robot_filter: false })).toMatchObject({ update: 'all', delete: 'all' })
    expect(artifact()(row)).toBe(true)
  })

  it('says per action what the role may do: read and create are yes or no, update and delete are every record, own records or nothing', () => {
    for (const update of ['all', 'own', false]) {
      for (const del of ['all', 'own', false]) {
        expect(roleCollectionRights.safeParse({ ...row, update, delete: del }).success, `${update} ${del}`).toBe(true)
      }
    }
    expect(roleCollectionRights.safeParse({ ...row, read: false, create: false }).success).toBe(true)
  })

  it('refuses update: true', () => {
    // `true` would not say which records. The row spells the scope out, or says nothing is granted.
    expect(roleCollectionRights.safeParse({ ...row, update: true }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, delete: true }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, update: 'some' }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, delete: null }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, read: 'all' }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, create: 'own' }).success).toBe(false)
    expect(artifact()({ ...row, update: true })).toBe(false)
  })

  it('names the collection by key, its binding and a label for people', () => {
    expect(roleCollectionRights.safeParse({ ...row, collection: 'Logbook' }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, binding: 'per_app' }).success).toBe(false)
    expect(roleCollectionRights.safeParse({ ...row, label: 1 }).success).toBe(false)
  })

  it('leaves nothing out: an absent key would read as a no', () => {
    for (const key of Object.keys(row) as (keyof typeof row)[]) {
      const { [key]: _omitted, ...rest } = row
      expect(roleCollectionRights.safeParse(rest).success, key).toBe(false)
    }
  })

  it('has the eight keys and no more', () => {
    expect(Object.keys(roleCollectionRights.shape)).toEqual(['collection', 'label', 'binding', 'read', 'create', 'update', 'delete', 'robot_filter'])
  })
})
