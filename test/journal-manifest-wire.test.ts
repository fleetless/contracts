// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'
import { exportedSchemas } from '../scripts/export-schemas.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/dr1895-package-3-cloud-manifest-fixtures.json', import.meta.url), 'utf8'))
const matrix = JSON.parse(readFileSync(new URL('./fixtures/dr1895-package-3-cloud-membership-matrix.json', import.meta.url), 'utf8'))
const uuid = '11111111-1111-4111-8111-111111111111'
const at = '2026-11-02T10:00:00.000Z'
const hash = 'a'.repeat(64)

function validateArtifact(name: string) {
  const ajv = new (Ajv2020 as any)({ strict: false }); (addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))
}

function scalar(type: string | string[]) {
  if (Array.isArray(type)) return type[0]
  if (type === 'uuid') return uuid
  if (type === 'sha256') return hash
  if (type === 'utc_millis') return at
  if (type === 'positive_integer' || type === 'positive_safe_integer') return 1
  return 'restricted-id'
}

describe('package 3 protected manifest wire', () => {
  it('exports the closed source shapes and accepts all eight complete Cloud vectors', () => {
    for (const [name, artifact] of [
      ['journalManifestScope', 'journal-manifest-scope'],
      ['journalManifestRow', 'journal-manifest-row'],
      ['journalManifestEntry', 'journal-manifest-entry'],
      ['journalManifestBatch', 'journal-manifest-batch'],
      ['journalDeletionManifest', 'journal-deletion-manifest'],
      ['journalManifestBinding', 'journal-manifest-binding'],
    ]) {
      expect((contracts as any)[name]).toBeDefined()
      expect((exportedSchemas as any)[artifact]).toBe((contracts as any)[name])
    }
    const manifest = (contracts as any).journalDeletionManifest
    const binding = (contracts as any).journalManifestBinding
    const validateManifest = validateArtifact('journal-deletion-manifest')
    const validateBinding = validateArtifact('journal-manifest-binding')
    for (const fixture of fixtures.positive) {
      expect(manifest.safeParse(fixture.manifest).success, fixture.name).toBe(true)
      expect(validateManifest(fixture.manifest), fixture.name).toBe(true)
      expect(binding.safeParse({ intent: fixture.intent, manifest: fixture.manifest }).success, fixture.name).toBe(true)
      expect(validateBinding({ intent: fixture.intent, manifest: fixture.manifest }), fixture.name).toBe(true)
    }
  })

  it('closes every declared scope, row, object and batch arm in Zod and JSON Schema', () => {
    for (const [name, variants, make] of [
      ['journal-manifest-scope', matrix.scope_variants, (variant: any) =>
        ({ kind: variant.kind, ...Object.fromEntries(Object.entries(variant.fields).map(([key, type]) => [key, scalar(type as string | string[])])) })],
      ['journal-manifest-row', matrix.row_variants, (variant: any) => {
        const row: any = { type: variant.type, membership_kind: 'affected',
          ...Object.fromEntries(Object.entries(variant.fields).map(([key, type]) => [key, scalar(type as string | string[])])) }
        if (row.type === 'uuid_row') row.row_generation = row.id
        return row
      }],
      ['journal-manifest-entry', matrix.object_entry_variants, (variant: any) =>
        ({ kind: variant.kind, membership_kind: 'affected', mapping_id: uuid, source_project_id: 'project',
          source_bucket: 'bucket', old_key: 'restricted/key', version_ids: ['version-1'] })],
      ['journal-manifest-batch', matrix.batch_variants.flatMap((variant: any) => variant.kinds.map((kind: string) => ({ ...variant, kind }))),
        (variant: any) => ({ batch_id: uuid, kind: variant.kind, rows: [fixtures.positive[0].manifest.rows[0]],
          ...(variant.form === 'sweep' ? { cutoff_at: at, policy_revision: 1 } : {}) })],
    ] as const) {
      const schema = (exportedSchemas as any)[name]
      const validate = validateArtifact(name)
      for (const variant of variants as any[]) {
        const value = make(variant)
        expect(schema.safeParse(value).success, `${name}:${variant.kind ?? variant.type}`).toBe(true)
        expect(validate(value), `${name}:${variant.kind ?? variant.type}`).toBe(true)
      }
    }
  })

  it('binds a waiting-list retention batch to the waitlist scope and its tables only (fleetless/fleetless#1082)', () => {
    const binding = (contracts as any).journalManifestBinding
    const validateBinding = validateArtifact('journal-manifest-binding')
    const row = (table: string, id: string) => ({ type: 'uuid_row', table, id, row_generation: id, membership_kind: 'affected' })
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666']
    const tables = ['operator_effect_mail_deliveries', 'operator_effect_outbox', 'waitlist', 'waitlist_consents',
      'waitlist_invitation_proofs', 'waitlist_invitations']
    const rows = tables.map((table, index) => row(table, ids[index]!))
    const make = (scope: unknown, members: unknown[], intentIds: Record<string, unknown> = { batch_id: uuid, cutoff_at: at, policy_revision: 1 }) => ({
      intent: { operation_id: uuid, kind: 'waitlist.retention', ids: intentIds },
      manifest: { schema: 'fleetless.deletion-manifest.v1', environment: 'production', generation: 1, operation_id: uuid, manifest_id: uuid,
        scope, entries: [], rows: members,
        batches: [{ batch_id: uuid, kind: 'waitlist.retention', cutoff_at: at, policy_revision: 1, rows: members }] },
    })
    const valid = make({ kind: 'waitlist' }, rows)
    expect(binding.safeParse(valid).success, JSON.stringify(binding.safeParse(valid).error?.issues)).toBe(true)
    expect(validateBinding(valid)).toBe(true)
    // A table outside the waiting list, an organization scope or an organization in the ids is refused.
    expect(binding.safeParse(make({ kind: 'waitlist' }, [...rows.slice(0, 2), row('job_runs', ids[2]!)])).success).toBe(false)
    expect(binding.safeParse(make({ kind: 'organization', org_id: uuid }, rows)).success).toBe(false)
    expect(binding.safeParse(make({ kind: 'waitlist' }, rows, { org_id: uuid, batch_id: uuid, cutoff_at: at, policy_revision: 1 })).success).toBe(false)
    expect((contracts as any).journalManifestScope.safeParse({ kind: 'waitlist', org_id: uuid }).success).toBe(false)
  })

  it('rejects all ten broken Cloud manifest bindings and structural owner/shape drift', () => {
    const binding = (contracts as any).journalManifestBinding
    for (const fixture of fixtures.negative) {
      expect(binding.safeParse({ intent: fixture.intent, manifest: fixture.manifest }).success, fixture.name).toBe(false)
    }
    const scope = (contracts as any).journalManifestScope
    const validateScope = validateArtifact('journal-manifest-scope')
    const fabricated = { kind: 'central_mcp', org_id: uuid }
    expect(scope.safeParse(fabricated).success).toBe(false)
    expect(validateScope(fabricated)).toBe(false)
    const batch = (contracts as any).journalManifestBatch
    const validateBatch = validateArtifact('journal-manifest-batch')
    const explicit = fixtures.positive.find((value: any) => value.intent.kind === 'history.slug_delete').manifest.batches[0]
    expect(batch.safeParse({ ...explicit, cutoff_at: at }).success).toBe(false)
    expect(validateBatch({ ...explicit, cutoff_at: at })).toBe(false)
    const projection = (contracts as any).journalManifestIntentProjection
    expect(projection.safeParse({ operation_id: uuid, kind: 'server_key.revoke', ids: { org_id: uuid, app_id: uuid, key_id: uuid } }).success).toBe(false)
    const shared = fixtures.positive[0].manifest.entries[0]
    expect((contracts as any).journalManifestEntry.safeParse({ ...shared, version_ids: ['version-1', 'version-1'] }).success).toBe(false)
  })
})
