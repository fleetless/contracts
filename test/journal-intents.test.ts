// SPDX-License-Identifier: Apache-2.0
import { describe, expect, expectTypeOf, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'
import type { JournalIntentV2, JournalIntentV2Body } from '../src/index.js'

const id = '01234567-89ab-4cde-8fab-0123456789ab'
const at = '2026-11-02T12:00:00.000Z'
const hash = 'a'.repeat(64)
const base = {
  schema: 'fleetless.deletion-intent.v2', environment: 'synthetic', generation: id,
  sequence: 1, operation_id: id, intent_at: at, previous_hash: hash, signing_key_id: 'test',
}
const manifest = { manifest_id: id, manifest_version_id: 'version-1', manifest_hash: hash }
const org = { org_id: id }
const app = { ...org, app_id: id }
const batch = { batch_id: id, cutoff_at: at, policy_revision: 1 }
// Explicit consumer examples, independent of the schema's construction.
const examples: [string, Record<string, unknown>, boolean][] = [
  ['organization.erase', org, true],
  ['organization.scope_erase', { ...org, scope_id: id, scope_generation: 1 }, true],
  ['robot.delete', { ...org, robot_id: id }, true],
  ['app.delete', app, true],
  ['member.remove', { ...org, user_id: id }, true],
  ['app_user.remove', { ...app, app_user_id: id }, true],
  ['app_role.delete', { ...app, role_id: id, move_mode: 'none' }, true],
  ['app_role.delete', { ...app, role_id: id, move_mode: 'reassign', move_to_role_id: id }, true],
  ['server_key.revoke', { ...app, key_id: id }, false],
  ['billing_document_link.remove', { ...org, link_id: id }, false],
  ['app_oidc_provider.delete', { ...app, provider_id: id }, true],
  ['team_invitation.revoke', { ...org, invitation_id: id }, false],
  ['app_invitation.revoke', { ...app, invitation_id: id }, false],
  ['mcp_grant.revoke', { ...app, app_user_id: id, grant_id: id, grant_generation: id }, false],
  ['mcp_central_grant.revoke', { subject_id: id, grant_id: id, grant_generation: id }, false],
  ['mcp_client.revoke', { ...app, client_row_id: id }, true],
  ['mcp_central_client.revoke', { client_row_id: id }, true],
  ['auth_factor.remove', { subject_kind: 'developer', subject_id: id, factor_kind: 'totp', factor_id: id }, true],
  ['auth_factor.remove', { subject_kind: 'developer', subject_id: id, factor_kind: 'passkey', factor_id: id }, true],
  ['auth_factor.remove', { subject_kind: 'app_user', subject_id: id, factor_kind: 'totp', factor_id: id }, true],
  ['app_logo.delete', { ...app, logo_generation: id }, false],
  ...['invite', 'verify', 'reset', 'login_code'].map((template_kind): [string, Record<string, unknown>, boolean] =>
    ['mail_template.reset', { ...app, template_kind, template_generation: id }, false]),
  ['robot_assets.clear', { ...org, robot_id: id, batch_id: id }, true],
  ['asset.remove', { ...org, robot_id: id, asset_id: id }, true],
  ['asset.replace', { ...org, robot_id: id, asset_id: id }, true],
  ['organization_export.expire', { ...org, export_id: id, expires_at: at }, true],
  ['history.slug_delete', { ...org, robot_id: id, series_id: 1, slug_generation: id, batch_id: id }, true],
  ...['history.retention', 'audit.retention', 'job_run.retention', 'latency.retention', 'ops_event.retention',
    'oidc_interaction.expire'].map((kind): [string, Record<string, unknown>, boolean] => [kind, { ...org, ...batch }, true]),
  ...['mcp_interaction.expire', 'mcp_client.expire'].map((kind): [string, Record<string, unknown>, boolean] =>
    [kind, { ...app, ...batch }, true]),
  ...['operator_audit.retention', 'mcp_central_interaction.expire', 'mcp_central_client.expire',
    'console_interaction.expire', 'console_code.expire'].map((kind): [string, Record<string, unknown>, boolean] =>
    [kind, batch, true]),
  ['org_note_text.remove', { ...org, old_note_generation: id }, false],
  ['org_note_text.replace', { ...org, old_note_generation: id }, false],
  ['instance.serial_lock', { instance_id: id, serial_binding_id: id, serial_binding_generation: 1 }, false],
  ['instance.serial_rotate_old', { instance_id: id, serial_binding_id: id, serial_binding_generation: 1 }, false],
  ['instance.license_revoke', { instance_id: id, license_id: id }, false],
  ['instance.reporter_key_revoke', { instance_id: id, reporter_key_id: id }, false],
  ['instance.instance_key_revoke', { instance_id: id, instance_key_binding_id: id, instance_key_binding_generation: 1 }, false],
]
const candidates = examples.map(([kind, ids, needsManifest]) => ({ ...base, kind, ids, ...(needsManifest ? manifest : {}) }))

describe('closed v2 journal intents', () => {
  it('exports body and envelope schemas', () => {
    expect(contracts).toHaveProperty('journalIntentV2Body')
    expect(contracts).toHaveProperty('journalIntentV2')
  })

  it('preserves kind-specific TypeScript narrowing in both exports', () => {
    type Scope = Extract<JournalIntentV2, { kind: 'organization.scope_erase' }>
    expectTypeOf<Scope['ids']>().toEqualTypeOf<{ org_id: string; scope_id: string; scope_generation: number }>()
    expectTypeOf<Scope['manifest_version_id']>().toEqualTypeOf<string>()
    type Central = Extract<JournalIntentV2Body, { kind: 'mcp_central_client.revoke' }>
    expectTypeOf<Central['ids']>().toEqualTypeOf<{ client_row_id: string }>()
  })

  for (const [name, artifact, signed] of [
    ['journalIntentV2Body', 'journal-intent-v2-body', false],
    ['journalIntentV2', 'journal-intent-v2', true],
  ] as const) {
    it(`${name}: preserves every branch and rejects malformed identities in Zod and JSON Schema`, () => {
      const schema = (contracts as any)[name]
      const ajv = new (Ajv2020 as any)({ strict: false })
      ;(addFormats as any)(ajv)
      const validate = ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${artifact}.schema.json`, import.meta.url), 'utf8')))
      const rejects = (value: unknown) => {
        expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false)
        expect(validate(value), JSON.stringify(value)).toBe(false)
      }
      for (const candidate of candidates) {
        const value: Record<string, any> = signed ? { ...candidate, record_hash: hash, signature: 'A'.repeat(86) } : candidate
        expect(schema.parse(value)).toEqual(value)
        expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
        for (const key of Object.keys(value)) {
          const missing = { ...value }; delete missing[key]
          rejects(missing)
          rejects({ ...value, [key]: null })
        }
        for (const key of Object.keys(candidate.ids)) {
          const ids = { ...candidate.ids }; delete ids[key]
          rejects({ ...value, ids })
          rejects({ ...value, ids: { ...candidate.ids, [key]: null } })
          if (candidate.ids[key] === id) rejects({ ...value, ids: { ...candidate.ids, [key]: id.toUpperCase() } })
        }
        for (const key of ['source_path_id', 'operation_id', 'old_key']) rejects({ ...value, ids: { ...candidate.ids, [key]: id } })
        rejects({ ...value, raw_key: 'forbidden' })
        rejects({ ...value, kind: 'unknown.delete' })
        rejects({ ...value, schema: 'fleetless.deletion-intent.v1' })
        rejects({ ...value, generation: id.toUpperCase() })
        rejects({ ...value, previous_hash: 'A'.repeat(64) })
        rejects({ ...value, intent_at: '2026-11-02T12:00:00Z' })
        if (signed) rejects({ ...value, signature: 'A'.repeat(85) + 'B' })
        if (candidate.kind === 'mail_template.reset') rejects({ ...value, ids: { ...candidate.ids, template_kind: 'unknown' } })
        if (!('manifest_id' in value)) rejects({ ...value, ...manifest })
        for (const number of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
          rejects({ ...value, sequence: number })
          for (const key of ['scope_generation', 'policy_revision', 'series_id', 'serial_binding_generation', 'instance_key_binding_generation']) {
            if (key in candidate.ids) rejects({ ...value, ids: { ...candidate.ids, [key]: number } })
          }
        }
        if (candidate.kind.startsWith('mcp_central_') || candidate.kind.startsWith('console_')) {
          rejects({ ...value, ids: { ...candidate.ids, org_id: id } })
        }
        if (candidate.kind === 'auth_factor.remove') rejects({ ...value, ids: { ...candidate.ids, subject_kind: 'app_user', factor_kind: 'passkey' } })
        if (candidate.kind === 'app_role.delete') {
          const ids = { ...candidate.ids, move_mode: candidate.ids.move_mode === 'none' ? 'reassign' : 'none' }
          rejects({ ...value, ids })
        }
        if (candidate.kind.includes('client.revoke')) {
          const ids = { ...candidate.ids, client_id: id }; delete (ids as any).client_row_id
          rejects({ ...value, ids })
        }
      }
    })
  }
})
