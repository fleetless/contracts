// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLLECTION_AUDIT_ACTIONS,
  COLLECTION_LIMITS,
  ERROR_CODES,
  auditEvent,
  collectionExportQuery,
  collectionImportPreview,
  collectionImportRequest,
  collectionImportResult,
  confirmationRequiredDetails,
  recordChangedDetails,
  recordReferencedDetails,
  referenceInvalidDetails,
  requiredMissingDetails,
} from '../src/index.js'

const ROBOT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const request = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'csv',
  content: 'Name,Hall\nQ1,A\n',
  ...over,
})

describe('the import request', () => {
  it('needs a format and a file, nothing else', () => {
    expect(collectionImportRequest.safeParse(request()).success).toBe(true)
    expect(collectionImportRequest.safeParse({ content: 'a' }).success).toBe(false)
    expect(collectionImportRequest.safeParse({ format: 'csv' }).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ format: 'xml' })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ format: 'json', content: '[{"name":"Q1"}]' })).success).toBe(true)
  })

  it('accepts every option together', () => {
    const full = request({
      mapping: { Name: 'name', Hall: 'location', Owner: '', Robot: 'robot' },
      references: { location: 'name' },
      key: 'name',
      mode: 'mirror',
      scope: { robot_id: ROBOT },
      robot_id: ROBOT,
      confirm: 'v1.abc',
    })
    expect(collectionImportRequest.safeParse(full).success).toBe(true)
    expect(collectionImportRequest.safeParse(request({ mode: 'upsert' })).success).toBe(true)
    expect(collectionImportRequest.safeParse(request({ scope: { filter: { category: { eq: 'fault' } } }, mode: 'mirror', key: 'name' })).success).toBe(true)
  })

  it('refuses keys it does not know', () => {
    expect(collectionImportRequest.safeParse(request({ dry_run: true })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ scope: { robot_id: ROBOT, all: true } })).success).toBe(false)
  })

  it('refuses a mode other than upsert and mirror', () => {
    expect(collectionImportRequest.safeParse(request({ mode: 'sync' })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ mode: 'replace' })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ mode: '' })).success).toBe(false)
  })

  it('takes a file of ten million characters and not one more', () => {
    expect(COLLECTION_LIMITS.importBytes).toBe(10_000_000)
    expect(collectionImportRequest.safeParse(request({ content: 'x'.repeat(10_000_000) })).success).toBe(true)
    expect(collectionImportRequest.safeParse(request({ content: 'x'.repeat(10_000_001) })).success).toBe(false)
  })

  it('maps a column to a field key, the robot or nowhere, and to nothing else', () => {
    const mapped = (mapping: Record<string, string>) => collectionImportRequest.safeParse(request({ mapping })).success
    expect(mapped({ 'Column with spaces': 'position_m' })).toBe(true)
    expect(mapped({ Robot: 'robot' })).toBe(true)
    expect(mapped({ Ignored: '' })).toBe(true)
    expect(mapped({ Name: 'Name' })).toBe(false)
    expect(mapped({ Name: 'two words' })).toBe(false)
    expect(collectionImportRequest.safeParse(request({ mapping: { Name: 3 } })).success).toBe(false)
  })

  it('resolves a reference through a field key of the target', () => {
    const references = (value: Record<string, unknown>) => collectionImportRequest.safeParse(request({ references: value })).success
    expect(references({ location: 'name' })).toBe(true)
    expect(references({ Location: 'name' })).toBe(false)
    expect(references({ location: '' })).toBe(false)
    expect(references({ location: 'Name' })).toBe(false)
  })

  it('names the key and the robot as the contract does', () => {
    expect(collectionImportRequest.safeParse(request({ key: 'Name' })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ robot_id: 'gate-bot' })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ scope: { robot_id: 'gate-bot' } })).success).toBe(false)
    expect(collectionImportRequest.safeParse(request({ confirm: '' })).success).toBe(false)
  })

  it('needs a key for a mirror, since the file is matched to the records by it', () => {
    const noKey = collectionImportRequest.safeParse(request({ mode: 'mirror' }))
    expect(noKey.success).toBe(false)
    expect(noKey.error?.issues[0]?.path).toEqual(['key'])
    expect(collectionImportRequest.safeParse(request({ mode: 'mirror', key: 'name' })).success).toBe(true)
    expect(collectionImportRequest.safeParse(request({ mode: 'upsert' })).success).toBe(true)
  })

  it('scopes a mirror to a filter or to a robot, not both', () => {
    const scoped = (scope: Record<string, unknown>) =>
      collectionImportRequest.safeParse(request({ mode: 'mirror', key: 'name', scope })).success
    expect(scoped({ filter: { hall: { eq: 'A' } } })).toBe(true)
    expect(scoped({ robot_id: ROBOT })).toBe(true)
    expect(scoped({ filter: { hall: { eq: 'A' } }, robot_id: ROBOT })).toBe(false)
  })
})

describe('the import preview', () => {
  const preview = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    counts: { unchanged: 2, new: 3, updated: 1, deleted: 0, errors: 0 },
    errors: [],
    errors_total: 0,
    mirror_scope: null,
    warnings: [],
    token: 'v1.abc',
    ...over,
  })
  const failure = { row: 7, column: 'Area', value: 'Hall C', reason: 'No location has the name "Hall C".' }

  it('carries a token for a file without errors', () => {
    const parsed = collectionImportPreview.safeParse(preview())
    expect(parsed.success).toBe(true)
    expect(parsed.data?.token).toBe('v1.abc')
  })

  it('has no token while the file has errors', () => {
    const withErrors = preview({
      counts: { unchanged: 0, new: 0, updated: 0, deleted: 0, errors: 1 },
      errors: [failure],
      errors_total: 1,
      token: null,
    })
    const parsed = collectionImportPreview.safeParse(withErrors)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.token).toBeNull()
    expect(parsed.data?.errors[0]).toEqual(failure)
  })

  it('needs the token to be present, null or a string', () => {
    const { token: _token, ...without } = preview()
    expect(collectionImportPreview.safeParse(without).success).toBe(false)
    expect(collectionImportPreview.safeParse(preview({ token: '' })).success).toBe(false)
  })

  it('lists at most a thousand errors and keeps the total exact', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ ...failure, row: i + 1 }))
    const parsed = (n: number) =>
      collectionImportPreview.safeParse(preview({ errors: list(n), errors_total: 4_200, token: null }))
    expect(parsed(1000).success).toBe(true)
    expect(parsed(1001).success).toBe(false)
    expect(collectionImportPreview.safeParse(preview({ errors_total: 4_200.5 })).success).toBe(false)
  })

  it('describes each error by row, column, value and reason', () => {
    const one = (error: Record<string, unknown>) => collectionImportPreview.safeParse(preview({ errors: [error], errors_total: 1, token: null })).success
    expect(one(failure)).toBe(true)
    expect(one({ ...failure, row: 0, column: '' })).toBe(true)
    for (const key of Object.keys(failure)) {
      const { [key]: _gone, ...rest } = failure as Record<string, unknown>
      expect(one(rest), `without ${key}`).toBe(false)
    }
    expect(one({ ...failure, row: -1 })).toBe(false)
    expect(one({ ...failure, row: 1.5 })).toBe(false)
    expect(one({ ...failure, reason: '' })).toBe(false)
  })

  it('counts five things, all whole numbers', () => {
    const counted = (counts: Record<string, unknown>) => collectionImportPreview.safeParse(preview({ counts })).success
    expect(counted({ unchanged: 0, new: 0, updated: 0, deleted: 0, errors: 0 })).toBe(true)
    expect(counted({ unchanged: 0, new: 0, updated: 0, deleted: 0 })).toBe(false)
    expect(counted({ unchanged: 0, new: -1, updated: 0, deleted: 0, errors: 0 })).toBe(false)
    expect(counted({ unchanged: 0, new: 0.5, updated: 0, deleted: 0, errors: 0 })).toBe(false)
  })

  it('says where a mirror would delete and warns about a plan limit', () => {
    for (const scope of ['collection', 'filter', 'robot', null]) {
      expect(collectionImportPreview.safeParse(preview({ mirror_scope: scope })).success, String(scope)).toBe(true)
    }
    expect(collectionImportPreview.safeParse(preview({ mirror_scope: 'app' })).success).toBe(false)
    expect(collectionImportPreview.safeParse(preview({ warnings: ['plan_limit'] })).success).toBe(true)
    expect(collectionImportPreview.safeParse(preview({ warnings: ['plan_limit', 'too_big'] })).success).toBe(false)
  })
})

describe('the import result', () => {
  it('counts what the import did', () => {
    expect(collectionImportResult.safeParse({ created: 3, updated: 1, deleted: 0, unchanged: 2 }).success).toBe(true)
    expect(collectionImportResult.safeParse({ created: 3, updated: 1, deleted: 0 }).success).toBe(false)
    expect(collectionImportResult.safeParse({ created: -3, updated: 1, deleted: 0, unchanged: 2 }).success).toBe(false)
  })
})

describe('the export query', () => {
  it('needs a format', () => {
    expect(collectionExportQuery.safeParse({ format: 'csv' }).success).toBe(true)
    expect(collectionExportQuery.safeParse({ format: 'json' }).success).toBe(true)
    expect(collectionExportQuery.safeParse({}).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'xlsx' }).success).toBe(false)
  })

  it('takes the filter, search and sort of a record list and the shape of the file', () => {
    const full = {
      format: 'csv',
      filter: '{"location.name":{"eq":"XTD1"}}',
      search: 'quad xtd1',
      sort: '-position_m,name',
      robot: ROBOT,
      fields: 'name,position_m',
      references: 'name',
      system: 'true',
    }
    expect(collectionExportQuery.safeParse(full).success).toBe(true)
    expect(collectionExportQuery.safeParse({ ...full, references: 'id', system: 'false' }).success).toBe(true)
  })

  it('refuses what the query string cannot carry or does not know', () => {
    expect(collectionExportQuery.safeParse({ format: 'csv', system: true }).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'csv', system: 'yes' }).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'csv', robot: 'gate-bot' }).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'csv', fields: '' }).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'csv', limit: '10' }).success).toBe(false)
    expect(collectionExportQuery.safeParse({ format: 'csv', deleted: 'true' }).success).toBe(false)
  })
})

describe('the error codes of app collections', () => {
  const CODES = [
    'confirmation_required',
    'record_referenced',
    'record_changed',
    'collection_not_found',
    'collection_removed',
    'reference_invalid',
    'required_missing',
    'robot_not_attached',
  ]

  it.each(CODES)('lists %s', (code) => {
    expect(ERROR_CODES).toContain(code)
  })

  it('lists them last and once each', () => {
    expect(ERROR_CODES.slice(-CODES.length)).toEqual(CODES)
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })

  it('writes each one as a lowercase word list', () => {
    for (const code of CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/)
  })
})

describe('the details of the refusals', () => {
  it('confirmation_required carries the current preview', () => {
    const preview = { from_version: 3, to_version: 4, valid: true, issues: [], effects: [], access_changes: [], token: 'v1.abc' }
    expect(confirmationRequiredDetails.safeParse({ preview }).success).toBe(true)
    expect(confirmationRequiredDetails.safeParse({ preview: null }).success).toBe(true)
    expect(confirmationRequiredDetails.safeParse({}).success).toBe(false)
    expect(confirmationRequiredDetails.safeParse({ preview, token: 'v1.abc' }).success).toBe(false)
  })

  it('record_referenced names collections and counts, nothing else', () => {
    const details = { references: [{ collection: 'components', count: 12 }, { collection: 'logbook', count: 1 }] }
    expect(recordReferencedDetails.safeParse(details).success).toBe(true)
    expect(recordReferencedDetails.safeParse({ references: [] }).success).toBe(false)
    expect(recordReferencedDetails.safeParse({ references: [{ collection: 'components', count: 0 }] }).success).toBe(false)
    expect(recordReferencedDetails.safeParse({ references: [{ collection: 'components', count: 1.5 }] }).success).toBe(false)
    expect(recordReferencedDetails.safeParse({ references: [{ collection: 'components', count: 1, ids: [ROBOT] }] }).success).toBe(false)
    expect(recordReferencedDetails.safeParse({ ...details, total: 13 }).success).toBe(false)
  })

  it('record_changed carries the current revision', () => {
    expect(recordChangedDetails.safeParse({ revision: 7 }).success).toBe(true)
    expect(recordChangedDetails.safeParse({ revision: 0 }).success).toBe(false)
    expect(recordChangedDetails.safeParse({ revision: '7' }).success).toBe(false)
    expect(recordChangedDetails.safeParse({}).success).toBe(false)
    expect(recordChangedDetails.safeParse({ revision: 7, expected: 6 }).success).toBe(false)
  })

  it('reference_invalid names the field and one of three reasons', () => {
    for (const reason of ['missing', 'other_robot', 'not_readable']) {
      expect(referenceInvalidDetails.safeParse({ field: 'location', reason }).success, reason).toBe(true)
    }
    expect(referenceInvalidDetails.safeParse({ field: 'location', reason: 'deleted' }).success).toBe(false)
    expect(referenceInvalidDetails.safeParse({ field: '', reason: 'missing' }).success).toBe(false)
    expect(referenceInvalidDetails.safeParse({ reason: 'missing' }).success).toBe(false)
    expect(referenceInvalidDetails.safeParse({ field: 'location', reason: 'missing', id: ROBOT }).success).toBe(false)
  })

  it('required_missing lists every field', () => {
    expect(requiredMissingDetails.safeParse({ fields: ['serial', 'type'] }).success).toBe(true)
    expect(requiredMissingDetails.safeParse({ fields: [] }).success).toBe(false)
    expect(requiredMissingDetails.safeParse({ fields: [''] }).success).toBe(false)
    expect(requiredMissingDetails.safeParse({ fields: 'serial' }).success).toBe(false)
    expect(requiredMissingDetails.safeParse({ fields: ['serial'], count: 1 }).success).toBe(false)
  })
})

describe('the audit actions of app collections', () => {
  it('are the eight, in this order', () => {
    expect([...COLLECTION_AUDIT_ACTIONS]).toEqual([
      'collection_schema.published',
      'collection_schema.restored',
      'collection_record.created',
      'collection_record.updated',
      'collection_record.deleted',
      'collection_record.restored',
      'collection_import.completed',
      'collection_history.purged',
    ])
  })

  it('fit the audit event, which stops at eighty characters', () => {
    const event = {
      id: ROBOT,
      org_id: ROBOT,
      at: '2026-11-04T10:00:00.000Z',
      seq: 1,
      actor: { kind: 'developer', id: ROBOT, label: 'ada@example.com' },
      target: null,
      details: null,
    }
    for (const action of COLLECTION_AUDIT_ACTIONS) {
      expect(action.length).toBeLessThanOrEqual(80)
      expect(auditEvent.safeParse({ ...event, action }).success, action).toBe(true)
    }
  })

  it('can be filtered by the prefix of their kind', () => {
    const prefixes = new Set(COLLECTION_AUDIT_ACTIONS.map((action) => action.split('.')[0]))
    expect([...prefixes].sort()).toEqual(['collection_history', 'collection_import', 'collection_record', 'collection_schema'])
  })
})

describe('the published schemas', () => {
  const dir = new URL('../artifacts/schema/', import.meta.url)

  it.each([
    'collection-import-request',
    'collection-import-preview',
    'collection-import-result',
    'collection-export-query',
    'confirmation-required-details',
    'record-referenced-details',
    'record-changed-details',
    'reference-invalid-details',
    'required-missing-details',
  ])('%s has an artifact', (name) => {
    expect(existsSync(new URL(`${name}.schema.json`, dir))).toBe(true)
  })

  it('the import request artifact describes every option and takes none that is not there', () => {
    const artifact = JSON.parse(readFileSync(new URL('collection-import-request.schema.json', dir), 'utf8'))
    expect(Object.keys(artifact.properties).sort()).toEqual([
      'confirm',
      'content',
      'format',
      'key',
      'mapping',
      'mode',
      'references',
      'robot_id',
      'scope',
    ])
    expect(artifact.required.sort()).toEqual(['content', 'format'])
    expect(artifact.properties.mode.enum).toEqual(['upsert', 'mirror'])
    expect(artifact.properties.content.maxLength).toBe(10_000_000)
  })

  it('the preview artifact leaves nothing undescribed', () => {
    const artifact = JSON.parse(readFileSync(new URL('collection-import-preview.schema.json', dir), 'utf8'))
    for (const key of ['counts', 'errors', 'errors_total', 'mirror_scope', 'warnings', 'token']) {
      expect(artifact.properties[key].description, key).toBeTruthy()
    }
    expect(artifact.properties.errors.maxItems).toBe(1000)
  })
})
