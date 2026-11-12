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

  describe('the waiting list (fleetless/fleetless#1082)', () => {
    const binding = (contracts as any).journalManifestBinding
    const validateBinding = validateArtifact('journal-manifest-binding')
    const [entry, invitation, proof, consent, effect, delivery, other] = ['11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']
    const row = (table: string, rowId: string) => ({ type: 'uuid_row', table, id: rowId, row_generation: rowId, membership_kind: 'affected' })
    const mailDelivery = (entryId: string, deliveryId = delivery) => ({ type: 'waitlist_mail_delivery', delivery_id: deliveryId, effect_id: effect,
      entry_id: entryId, source_action: 'waitlist_confirm', membership_kind: 'affected' })
    const mailEffect = { type: 'waitlist_mail_effect', effect_id: effect, source_action: 'waitlist_confirm', membership_kind: 'affected' }
    // Sorted by physical identity: deliveries, outbox, then the four waiting-list tables.
    const rows = [mailDelivery(entry!), mailEffect, row('waitlist', entry!), row('waitlist_consents', consent!),
      row('waitlist_invitation_proofs', proof!), row('waitlist_invitations', invitation!)]
    const manifestOf = (scope: unknown, members: unknown[], batches: unknown[], entries: unknown[] = []) => ({
      schema: 'fleetless.deletion-manifest.v1', environment: 'production', generation: 1, operation_id: uuid, manifest_id: uuid,
      scope, entries, rows: members, batches })
    const retention = (scope: unknown, members: unknown[], ids: Record<string, unknown> = { batch_id: uuid, cutoff_at: at, policy_revision: 1 }, entries: unknown[] = []) => ({
      intent: { operation_id: uuid, kind: 'waitlist.retention', ids },
      manifest: manifestOf(scope, members, [{ batch_id: uuid, kind: 'waitlist.retention', cutoff_at: at, policy_revision: 1, rows: members }], entries),
    })
    const withdrawal = (members: unknown[], entryId = entry) => ({
      intent: { operation_id: uuid, kind: 'waitlist.withdrawal', ids: { entry_id: entryId } },
      manifest: manifestOf({ kind: 'waitlist' }, members, []),
    })
    const accepted = (value: unknown) => {
      expect(binding.safeParse(value).success, JSON.stringify(binding.safeParse(value).error?.issues)).toBe(true)
      expect(validateBinding(value), JSON.stringify(validateBinding.errors)).toBe(true)
    }
    const refused = (value: unknown) => expect(binding.safeParse(value).success).toBe(false)

    it('binds a retention batch and a withdrawal over the four tables and the waiting-list mail members', () => {
      accepted(retention({ kind: 'waitlist' }, rows))
      accepted(withdrawal(rows))
    })

    it('admits the shared operator-effect tables only as waiting-list members with a waiting-list source action', () => {
      const row_ = (contracts as any).journalManifestRow
      for (const table of ['operator_effect_outbox', 'operator_effect_mail_deliveries']) expect(row_.safeParse(row(table, effect!)).success).toBe(false)
      for (const source_action of ['plan_change', 'billing_resend_payment_link', 'invitation_resend']) {
        expect(row_.safeParse({ ...mailEffect, source_action }).success).toBe(false)
        expect(row_.safeParse({ ...mailDelivery(entry!), source_action }).success).toBe(false)
      }
    })

    it('keeps waiting-list members out of every other scope, and other rows out of its own', () => {
      const orgBatch = (kind: string, members: unknown[]) => ({
        intent: { operation_id: uuid, kind, ids: { org_id: uuid, batch_id: uuid, cutoff_at: at, policy_revision: 1 } },
        manifest: manifestOf({ kind: 'organization', org_id: uuid }, members, [{ batch_id: uuid, kind, cutoff_at: at, policy_revision: 1, rows: members }]),
      })
      refused(orgBatch('job_run.retention', [row('waitlist', entry!)]))
      refused(orgBatch('audit.retention', [mailEffect]))
      refused(retention({ kind: 'organization', org_id: uuid }, rows))
      refused(retention({ kind: 'waitlist' }, [row('job_runs', other!), ...rows.slice(2)]))
      refused(retention({ kind: 'waitlist' }, rows, { org_id: uuid, batch_id: uuid, cutoff_at: at, policy_revision: 1 }))
      expect((contracts as any).journalManifestScope.safeParse({ kind: 'waitlist', org_id: uuid }).success).toBe(false)
    })

    it('carries no object entry, the only place a free string could hold an address', () => {
      const asset = { kind: 'asset_blob', mapping_id: uuid, source_project_id: 'project', source_bucket: 'bucket',
        old_key: 'waitlist/someone', version_ids: ['version-1'], membership_kind: 'affected' }
      refused(retention({ kind: 'waitlist' }, rows, undefined, [asset]))
    })

    it('ties a withdrawal to its one entry', () => {
      refused(withdrawal(rows, other))
      refused(withdrawal([mailDelivery(other!), ...rows.slice(1)]))
      refused(withdrawal(rows.filter((member: any) => member.table !== 'waitlist')))
      refused(withdrawal([...rows.slice(0, 2), row('waitlist', entry!), row('waitlist', other!), ...rows.slice(3)].sort(() => 0)))
      // A withdrawal is no sweep: no batch.
      const batched = withdrawal(rows)
      refused({ ...batched, manifest: { ...batched.manifest, batches: [{ batch_id: uuid, kind: 'waitlist.retention', cutoff_at: at, policy_revision: 1, rows }] } })
    })
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
