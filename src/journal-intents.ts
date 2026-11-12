// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { mailTemplateKind } from './app-users.js'
// Private scalar schemas: only complete consumer records are package exports.
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const opaqueId = z.string().min(1)
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const utcMillis = z.iso.datetime({ precision: 3 })
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/)

const common = {
  schema: z.literal('fleetless.deletion-intent.v2'),
  environment: opaqueId,
  generation: uuid,
  sequence: positiveInteger,
  operation_id: uuid,
  intent_at: utcMillis,
  previous_hash: hash,
  signing_key_id: opaqueId,
}
const manifest = { manifest_id: uuid, manifest_version_id: opaqueId, manifest_hash: hash }
const org = { org_id: uuid }
const app = { ...org, app_id: uuid }
const robot = { ...org, robot_id: uuid }
const batch = { batch_id: uuid, cutoff_at: utcMillis, policy_revision: positiveInteger }
const serial = z.strictObject({ instance_id: uuid, serial_binding_id: uuid, serial_binding_generation: positiveInteger })
const factor = { subject_id: uuid, factor_id: uuid }

function plain<K extends string, I extends z.ZodType>(kind: K, ids: I) {
  return z.strictObject({ ...common, kind: z.literal(kind), ids })
}
function captured<K extends string, I extends z.ZodType>(kind: K, ids: I) {
  return plain(kind, ids).extend(manifest)
}

// Each kind has one fixed signature. Adding protected dependent membership to
// a plain kind requires an agreed wire revision; optional references are unsafe.
const branches = [
  captured('organization.erase', z.strictObject(org)),
  captured('organization.scope_erase', z.strictObject({ ...org, scope_id: uuid, scope_generation: positiveInteger })),
  captured('robot.delete', z.strictObject(robot)),
  captured('app.delete', z.strictObject(app)),
  captured('member.remove', z.strictObject({ ...org, user_id: uuid })),
  captured('app_user.remove', z.strictObject({ ...app, app_user_id: uuid })),
  // Retired: per-app roles no longer exist, so nothing writes this kind. It stays so
  // journals written before still parse and replay (as a no-op).
  captured('app_role.delete', z.discriminatedUnion('move_mode', [
    z.strictObject({ ...app, role_id: uuid, move_mode: z.literal('none') }),
    z.strictObject({ ...app, role_id: uuid, move_mode: z.literal('reassign'), move_to_role_id: uuid }),
  ])),
  plain('server_key.revoke', z.strictObject({ ...app, key_id: uuid })),
  plain('org_role.delete', z.strictObject({ ...org, role_id: uuid })),
  plain('billing_document_link.remove', z.strictObject({ ...org, link_id: uuid })),
  captured('app_oidc_provider.delete', z.strictObject({ ...app, provider_id: uuid })),
  plain('team_invitation.revoke', z.strictObject({ ...org, invitation_id: uuid })),
  plain('app_invitation.revoke', z.strictObject({ ...app, invitation_id: uuid })),
  plain('mcp_grant.revoke', z.strictObject({ ...app, app_user_id: uuid, grant_id: uuid, grant_generation: uuid })),
  plain('mcp_central_grant.revoke', z.strictObject({ subject_id: uuid, grant_id: uuid, grant_generation: uuid })),
  captured('mcp_client.revoke', z.strictObject({ ...app, client_row_id: uuid })),
  captured('mcp_central_client.revoke', z.strictObject({ client_row_id: uuid })),
  captured('auth_factor.remove', z.union([
    z.strictObject({ ...factor, subject_kind: z.literal('developer'), factor_kind: z.literal('totp') }),
    z.strictObject({ ...factor, subject_kind: z.literal('developer'), factor_kind: z.literal('passkey') }),
    z.strictObject({ ...factor, subject_kind: z.literal('app_user'), factor_kind: z.literal('totp') }),
  ])),
  plain('app_logo.delete', z.strictObject({ ...app, logo_generation: uuid })),
  plain('mail_template.reset', z.strictObject({ ...app, template_kind: mailTemplateKind, template_generation: uuid })),
  captured('robot_assets.clear', z.strictObject({ ...robot, batch_id: uuid })),
  captured('asset.remove', z.strictObject({ ...robot, asset_id: uuid })),
  captured('asset.replace', z.strictObject({ ...robot, asset_id: uuid })),
  captured('organization_export.expire', z.strictObject({ ...org, export_id: uuid, expires_at: utcMillis })),
  captured('history.slug_delete', z.strictObject({ ...robot, series_id: positiveInteger, slug_generation: uuid, batch_id: uuid })),
  captured('history.retention', z.strictObject({ ...org, ...batch })),
  captured('audit.retention', z.strictObject({ ...org, ...batch })),
  captured('job_run.retention', z.strictObject({ ...org, ...batch })),
  captured('latency.retention', z.strictObject({ ...org, ...batch })),
  captured('ops_event.retention', z.strictObject({ ...org, ...batch })),
  captured('ops_global_event.retention', z.strictObject(batch)),
  captured('operator_audit.retention', z.strictObject(batch)),
  // The waiting list has no organization: entries are deleted by their own retention period.
  captured('waitlist.retention', z.strictObject(batch)),
  plain('org_note_text.remove', z.strictObject({ ...org, old_note_generation: uuid })),
  plain('org_note_text.replace', z.strictObject({ ...org, old_note_generation: uuid })),
  captured('oidc_interaction.expire', z.strictObject({ ...org, ...batch })),
  captured('mcp_interaction.expire', z.strictObject({ ...app, ...batch })),
  captured('mcp_central_interaction.expire', z.strictObject(batch)),
  captured('mcp_client.expire', z.strictObject({ ...app, ...batch })),
  captured('mcp_central_client.expire', z.strictObject(batch)),
  captured('console_interaction.expire', z.strictObject(batch)),
  captured('console_code.expire', z.strictObject(batch)),
  plain('instance.serial_lock', serial),
  plain('instance.serial_rotate_old', serial),
  plain('instance.license_revoke', z.strictObject({ instance_id: uuid, license_id: uuid })),
  plain('instance.reporter_key_revoke', z.strictObject({ instance_id: uuid, reporter_key_id: uuid })),
  plain('instance.instance_key_revoke', z.strictObject({ instance_id: uuid, instance_key_binding_id: uuid, instance_key_binding_generation: positiveInteger })),
] as const

/** Decoded v2 signable shape only; no activation, canonical-byte or signature verification. */
export const journalIntentV2Body = z.discriminatedUnion('kind', branches)
export type JournalIntentV2Body = z.infer<typeof journalIntentV2Body>

/** The hash and signature cover the domain-separated body, not these envelope fields. */
const envelope = { record_hash: hash, signature }
export const journalIntentV2 = z.discriminatedUnion('kind', [
  branches[0].extend(envelope),
  ...branches.slice(1).map((branch) => branch.extend(envelope)),
])
export type JournalIntentV2 = z.infer<typeof journalIntentV2>
