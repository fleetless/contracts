// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { journalIntentV2Body } from './journal-intents.js'

// Restricted, decoded protected manifests. The source and target still verify
// exact protected versions, original bytes, ownership and readback separately.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const opaqueId = z.string().min(1)
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const utcMillis = z.iso.datetime({ precision: 3 })
const membership = z.enum(['affected', 'unaffected'])

export const journalManifestScope = z.union([
  z.strictObject({ kind: z.literal('organization'), org_id: uuid }),
  z.strictObject({ kind: z.literal('organization_scope'), org_id: uuid, scope_id: uuid,
    scope_generation: positive, approved_predicate_digest: hash }),
  z.strictObject({ kind: z.literal('central_mcp') }),
  z.strictObject({ kind: z.literal('console_oauth') }),
  z.strictObject({ kind: z.literal('global_ops_event') }),
  z.strictObject({ kind: z.literal('operator_audit') }),
  z.strictObject({ kind: z.literal('subject'), subject_kind: z.enum(['developer', 'app_user']), subject_id: uuid }),
])
export type JournalManifestScope = z.infer<typeof journalManifestScope>

const uuidRowTable = z.enum([
  'assets', 'audit_events', 'job_runs', 'oidc_interactions',
  'organization_exports', 'ops_notification_jobs', 'console_oauth_codes',
])
const member = { membership_kind: membership }
export const journalManifestRow = z.union([
  z.strictObject({ ...member, type: z.literal('uuid_row'), table: uuidRowTable, id: uuid, row_generation: uuid }),
  z.strictObject({ ...member, type: z.literal('basic_activity_observation'), org_id: uuid, audit_event_id: uuid }),
  z.strictObject({ ...member, type: z.literal('history_sample'), robot_id: uuid, series_id: positive,
    series_generation: uuid, captured_at_epoch_us: positive, sample_id: uuid }),
  z.strictObject({ ...member, type: z.literal('latency_bucket'), robot_id: uuid, bucket_at: utcMillis, bucket_generation: uuid }),
  z.strictObject({ ...member, type: z.literal('org_keyed_row'), table: z.enum(['basic_activity_history', 'synthetic_org_fixtures']), org_id: uuid }),
  z.strictObject({ ...member, type: z.literal('app_mcp_client'), app_id: uuid, client_row_id: uuid }),
  z.strictObject({ ...member, type: z.literal('central_mcp_client'), client_row_id: uuid }),
  z.strictObject({ ...member, type: z.literal('app_mcp_grant'), app_id: uuid, grant_id: uuid, grant_generation: uuid }),
  z.strictObject({ ...member, type: z.literal('central_mcp_grant'), grant_id: uuid, grant_generation: uuid }),
  z.strictObject({ ...member, type: z.literal('app_mcp_code'), app_id: uuid, code_row_id: uuid }),
  z.strictObject({ ...member, type: z.literal('central_mcp_code'), code_row_id: uuid }),
  z.strictObject({ ...member, type: z.literal('app_mcp_interaction'), app_id: uuid, interaction_id: opaqueId }),
  z.strictObject({ ...member, type: z.literal('central_mcp_interaction'), interaction_id: opaqueId }),
  z.strictObject({ ...member, type: z.literal('console_interaction'), interaction_id: opaqueId }),
  z.strictObject({ ...member, type: z.literal('org_ops_event'), org_id: uuid, event_id: uuid }),
  z.strictObject({ ...member, type: z.literal('global_ops_event'), event_id: uuid }),
  z.strictObject({ ...member, type: z.literal('org_operator_audit'), org_id: uuid, audit_id: uuid }),
  z.strictObject({ ...member, type: z.literal('global_operator_audit'), audit_id: uuid }),
]).superRefine((row, ctx) => {
  if (row.type === 'uuid_row' && row.row_generation !== row.id) {
    ctx.addIssue({ code: 'custom', path: ['row_generation'], message: 'Immutable UUID row generation must equal its ID' })
  }
}).describe('JSON Schema consumers must also check uuid_row generation equality and exact physical identity.')
export type JournalManifestRow = z.infer<typeof journalManifestRow>

const entry = { mapping_id: uuid, source_project_id: opaqueId, source_bucket: opaqueId,
  old_key: opaqueId, version_ids: z.array(opaqueId).min(1), membership_kind: membership }
export const journalManifestEntry = z.union([
  z.strictObject({ kind: z.literal('asset_blob'), ...entry }),
  z.strictObject({ kind: z.literal('export_archive'), ...entry }),
]).superRefine((value, ctx) => {
  if (new Set(value.version_ids).size !== value.version_ids.length) {
    ctx.addIssue({ code: 'custom', path: ['version_ids'], message: 'Version IDs must be unique within a mapping' })
  }
}).describe('Restricted object keys remain only in the protected manifest; JSON Schema consumers also check unique versions.')
export type JournalManifestEntry = z.infer<typeof journalManifestEntry>

const sweepKinds = [
  'history.retention', 'audit.retention', 'job_run.retention', 'latency.retention',
  'ops_event.retention', 'ops_global_event.retention', 'operator_audit.retention',
  'oidc_interaction.expire', 'mcp_interaction.expire', 'mcp_central_interaction.expire',
  'mcp_client.expire', 'mcp_central_client.expire', 'console_interaction.expire',
  'console_code.expire',
] as const
const explicitKinds = ['history.slug_delete', 'robot_assets.clear'] as const
export const journalManifestBatch = z.union([
  z.strictObject({ batch_id: uuid, kind: z.enum(sweepKinds), cutoff_at: utcMillis,
    policy_revision: positive, rows: z.array(journalManifestRow).min(1) }),
  z.strictObject({ batch_id: uuid, kind: z.enum(explicitKinds), rows: z.array(journalManifestRow).min(1) }),
]).describe('A batch binds one intent and contains exactly its frozen affected rows; JSON Schema consumers check this cross-record relation.')
export type JournalManifestBatch = z.infer<typeof journalManifestBatch>

function rowKey(row: JournalManifestRow) {
  switch (row.type) {
    case 'uuid_row': return JSON.stringify([row.table, row.table, row.id])
    case 'basic_activity_observation': return JSON.stringify(['basic_activity_observations', row.audit_event_id])
    case 'history_sample': return JSON.stringify(['datapoint_series_samples', row.robot_id, row.series_id, row.captured_at_epoch_us, row.sample_id])
    case 'latency_bucket': return JSON.stringify(['bridge_latency_buckets', row.robot_id, row.bucket_at])
    case 'org_keyed_row': return JSON.stringify([row.table, row.table, row.org_id])
    case 'app_mcp_client': case 'central_mcp_client': return JSON.stringify(['mcp_oauth_clients', row.client_row_id])
    case 'app_mcp_grant': case 'central_mcp_grant': return JSON.stringify(['mcp_oauth_consent_grants', row.grant_id])
    case 'app_mcp_code': case 'central_mcp_code': return JSON.stringify(['mcp_oauth_codes', row.code_row_id])
    case 'app_mcp_interaction': case 'central_mcp_interaction': return JSON.stringify(['mcp_oauth_interactions', row.interaction_id])
    case 'console_interaction': return JSON.stringify(['console_oauth_interactions', row.interaction_id])
    case 'org_ops_event': case 'global_ops_event': return JSON.stringify(['ops_events', row.event_id])
    case 'org_operator_audit': case 'global_operator_audit': return JSON.stringify(['operator_audit', row.audit_id])
  }
}
function entryKey(value: JournalManifestEntry) { return JSON.stringify([value.kind, value.mapping_id]) }
function sortedUnique<T>(items: T[], key: (item: T) => string) {
  const keys = items.map(key)
  return keys.every((value, index) => index === 0 || keys[index - 1] < value)
}

export const journalDeletionManifest = z.strictObject({
  schema: z.literal('fleetless.deletion-manifest.v1'), environment: z.enum(['staging', 'production']),
  generation: positive, operation_id: uuid, manifest_id: uuid, scope: journalManifestScope,
  entries: z.array(journalManifestEntry), rows: z.array(journalManifestRow),
  batches: z.array(journalManifestBatch),
}).superRefine((value, ctx) => {
  if (!sortedUnique(value.rows, rowKey)) ctx.addIssue({ code: 'custom', path: ['rows'], message: 'Rows must be sorted and physically unique' })
  if (!sortedUnique(value.entries, entryKey)) ctx.addIssue({ code: 'custom', path: ['entries'], message: 'Mappings must be sorted and physically unique' })
  value.batches.forEach((batch, index) => {
    if (!sortedUnique(batch.rows, rowKey)) ctx.addIssue({ code: 'custom', path: ['batches', index, 'rows'], message: 'Batch rows must be sorted and physically unique' })
  })
}).describe('JSON Schema consumers also check physical uniqueness, ordering, intent binding and protected-version readbacks.')
export type JournalDeletionManifest = z.infer<typeof journalDeletionManifest>

const backedBranches = journalIntentV2Body.options.filter((branch) => 'manifest_id' in branch.shape)
/** Exact projection of the closed manifest-backed intent kind and ID branches. */
type ManifestIntentProjection = { operation_id: string; kind: string; ids: Record<string, unknown> }
export const journalManifestIntentProjection = z.union(backedBranches.map((branch) => z.strictObject({
  operation_id: branch.shape.operation_id, kind: branch.shape.kind, ids: branch.shape.ids,
})) as unknown as [z.ZodType<ManifestIntentProjection>, ...z.ZodType<ManifestIntentProjection>[]])
export type JournalManifestIntentProjection = z.infer<typeof journalManifestIntentProjection>

const nonOrganizationScope: Record<string, JournalManifestScope['kind']> = {
  'mcp_central_client.revoke': 'central_mcp',
  'mcp_central_interaction.expire': 'central_mcp',
  'mcp_central_client.expire': 'central_mcp',
  'console_interaction.expire': 'console_oauth',
  'console_code.expire': 'console_oauth',
  'ops_global_event.retention': 'global_ops_event',
  'operator_audit.retention': 'operator_audit',
  'auth_factor.remove': 'subject',
}

/** A structural candidate; it is not a signed intent or protected readback. */
export const journalManifestBinding = z.strictObject({
  intent: journalManifestIntentProjection, manifest: journalDeletionManifest,
}).superRefine(({ intent, manifest }, ctx) => {
  const problem = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  if (manifest.operation_id !== intent.operation_id) problem('Operation ID mismatch', ['manifest', 'operation_id'])
  const ids = intent.ids
  const expectedScope = intent.kind === 'organization.scope_erase' ? 'organization_scope' :
    nonOrganizationScope[intent.kind] ?? ('org_id' in ids ? 'organization' : undefined)
  if (manifest.scope.kind !== expectedScope) problem('Scope kind mismatch', ['manifest', 'scope'])
  if ('org_id' in manifest.scope && manifest.scope.org_id !== ids.org_id) problem('Organization scope mismatch', ['manifest', 'scope', 'org_id'])
  if (manifest.scope.kind === 'organization_scope' &&
    (manifest.scope.scope_id !== ids.scope_id || manifest.scope.scope_generation !== ids.scope_generation)) {
    problem('Approved scope identity or generation mismatch', ['manifest', 'scope'])
  }
  if (manifest.scope.kind === 'subject' &&
    (manifest.scope.subject_kind !== ids.subject_kind || manifest.scope.subject_id !== ids.subject_id)) {
    problem('Subject scope mismatch', ['manifest', 'scope'])
  }
  const allowedRows: Partial<Record<JournalManifestScope['kind'], (row: JournalManifestRow) => boolean>> = {
    central_mcp: (row) => row.type.startsWith('central_mcp_'),
    console_oauth: (row) => row.type === 'console_interaction' || (row.type === 'uuid_row' && row.table === 'console_oauth_codes'),
    global_ops_event: (row) => row.type === 'global_ops_event' || (row.type === 'uuid_row' && row.table === 'ops_notification_jobs'),
    operator_audit: (row) => row.type === 'global_operator_audit' || row.type === 'org_operator_audit',
  }
  const allows = allowedRows[manifest.scope.kind]
  if (allows && !manifest.rows.every(allows)) problem('Row outside closed source scope', ['manifest', 'rows'])
  const isSweep = sweepKinds.some((kind) => kind === intent.kind)
  const isExplicit = explicitKinds.some((kind) => kind === intent.kind)
  if (isSweep || isExplicit) {
    if (manifest.batches.length !== 1) problem('Exactly one frozen batch required', ['manifest', 'batches'])
    else {
      const batch = manifest.batches[0]
      if (batch.kind !== intent.kind || batch.batch_id !== ids.batch_id) problem('Batch kind or ID mismatch', ['manifest', 'batches', 0])
      if (isSweep && ('cutoff_at' in batch ? batch.cutoff_at !== ids.cutoff_at || batch.policy_revision !== ids.policy_revision : true)) {
        problem('Sweep cutoff or policy mismatch', ['manifest', 'batches', 0])
      }
      const affected = manifest.rows.filter((row) => row.membership_kind === 'affected')
      if (batch.rows.some((row) => row.membership_kind !== 'affected') ||
        JSON.stringify(batch.rows) !== JSON.stringify(affected)) problem('Batch must contain every and only affected row', ['manifest', 'batches', 0, 'rows'])
    }
  } else if (manifest.batches.length !== 0) problem('Unexpected batch', ['manifest', 'batches'])
}).describe('JSON Schema consumers must also verify exact intent/scope/batch binding, sorted physical membership, original bytes and protected readbacks.')
export type JournalManifestBinding = z.infer<typeof journalManifestBinding>
