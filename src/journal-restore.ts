// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { journalIntentV2Body } from './journal-intents.js'

// Decoded restricted restore records. Shape validation does not verify exact
// protected versions, original bytes, signatures, or mirror readback.
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const opaqueId = z.string().min(1)
const utcMillis = z.iso.datetime({ precision: 3 })
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/)
const lsn = z.string().regex(/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/)
const bytesB64Url = z.string().min(1).regex(/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$/)
const recoveryPoint = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('timestamp'), at: utcMillis }),
  z.strictObject({ kind: z.literal('lsn'), timeline: positiveInteger, lsn, at: utcMillis }),
])

const mirrorCommon = { attempt_id: opaqueId, observed_at: utcMillis }
const objectVersion = z.strictObject({
  ...mirrorCommon, type: z.literal('object_version'), version_id: opaqueId,
  delete_marker: z.literal(false), stored_sha256: hash, readback_sha256: hash,
  readback_at: utcMillis, effective_retain_until: utcMillis,
  object_lock_mode: z.literal('COMPLIANCE'),
})
const unexpectedMarker = z.strictObject({
  ...mirrorCommon, type: z.literal('delete_marker'), version_id: opaqueId,
  delete_marker: z.literal(true), failure_code: z.literal('UNEXPECTED_DELETE_MARKER'),
})
const inventoryError = z.union([
  z.strictObject({ ...mirrorCommon, type: z.literal('inventory_error'),
    failure_code: z.enum(['MISSING_VERSION', 'INCOMPLETE_LISTING']), version_id: opaqueId.optional() }),
  z.strictObject({ ...mirrorCommon, type: z.literal('inventory_error'),
    failure_code: z.enum(['CONFLICTING_BYTES', 'UNKNOWN_RETENTION']), version_id: opaqueId }),
])

/** Failed arms remain serializable inventory evidence, never replay coverage. */
export const journalMirrorAttempt = z.union([objectVersion, unexpectedMarker, inventoryError])
export type JournalMirrorAttempt = z.infer<typeof journalMirrorAttempt>

const itemCommon = {
  generation: uuid, stored_bytes_b64url: bytesB64Url, mirror_inventory_digest: hash,
}
const sequenced = { sequence: positiveInteger, previous_hash: hash, record_hash: hash }
function mirrored<S extends z.ZodRawShape>(shape: S) {
  return [
    z.strictObject({ ...itemCommon, ...shape, mirror_verdict: z.literal('complete'), mirror_attempts: z.array(objectVersion).min(1) }),
    z.strictObject({ ...itemCommon, ...shape, mirror_verdict: z.literal('failed'), mirror_attempts: z.array(journalMirrorAttempt).min(1) }),
  ] as const
}
const exportItemShape = z.union([
  ...mirrored({ type: z.literal('c0'), schema: z.literal('fleetless.journal-first-checkpoint.v1'), sequence: z.literal(0), checkpoint_hash: hash }),
  ...mirrored({ type: z.literal('intent_v1'), schema: z.literal('fleetless.deletion-intent.v1'), ...sequenced, operation_id: uuid }),
  ...mirrored({ type: z.literal('intent_v2'), schema: z.literal('fleetless.deletion-intent.v2'), ...sequenced, operation_id: uuid }),
  ...mirrored({ type: z.literal('registry_transition'), schema: z.literal('fleetless.registry-transition.v1'), ...sequenced }),
  ...mirrored({ type: z.literal('v2_activation_checkpoint'), schema: z.literal('fleetless.journal-v2-activation-checkpoint.v1'), ...sequenced }),
  ...mirrored({ type: z.literal('generation_checkpoint'), schema: z.literal('fleetless.journal-generation-checkpoint.v1'), ...sequenced }),
  ...mirrored({ type: z.literal('registry_activation_receipt'), schema: z.literal('fleetless.registry-activation-receipt.v1'), control_sequence: count, control_hash: hash, receipt_hash: hash }),
  ...mirrored({ type: z.literal('seal'), schema: z.literal('fleetless.journal-final-seal.v1'), final_sequence: count, final_hash: hash, seal_hash: hash }),
])

/** A failed mirror attempt remains visible but cannot be marked complete. */
export const journalExportItem = exportItemShape.superRefine((item, ctx) => {
  const attempts = item.mirror_attempts
  if (new Set(attempts.map((attempt) => attempt.attempt_id)).size !== attempts.length) {
    ctx.addIssue({ code: 'custom', path: ['mirror_attempts'], message: 'Mirror attempt IDs must be unique' })
  }
  if (item.mirror_verdict === 'complete' && attempts.some((attempt) =>
    attempt.type !== 'object_version' || attempt.stored_sha256 !== attempt.readback_sha256)) {
    ctx.addIssue({ code: 'custom', path: ['mirror_verdict'], message: 'Complete requires matching object-version readbacks only' })
  }
}).describe('JSON Schema consumers must also reject complete coverage with marker/error arms or unequal readbacks, and verify exact stored bytes and all versions.')
export type JournalExportItem = z.infer<typeof journalExportItem>

/** The mixed container does not re-sign historical v1 bytes or grant replay permission. */
export const journalMixedExport = z.strictObject({
  schema: z.literal('fleetless.journal-mixed-export.v1'), environment: opaqueId,
  restore_attempt_id: opaqueId, source_db_timeline: positiveInteger, source_db_lsn: lsn,
  selected_recovery_point: recoveryPoint, oldest_mapping_bearing_point: recoveryPoint,
  copy_inventory_digest: hash, copy_coverage_digest: hash,
  lower_sequence: count, lower_hash: hash, upper_sequence: count, upper_hash: hash,
  registry_chain_digest: hash, pinned_standby_id: opaqueId, pinned_standby_head_hash: hash,
  seal_hash: hash, seal_version_id: opaqueId, items: z.array(journalExportItem).min(1),
}).superRefine((value, ctx) => {
  const problem = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  if (value.lower_sequence > value.upper_sequence) problem('Invalid committed range', ['lower_sequence'])
  const first = value.items[0]
  if (value.lower_sequence === 0 && (first.type !== 'c0' || first.checkpoint_hash !== value.lower_hash)) {
    problem('Sequence zero requires the C0 lower anchor', ['items', 0])
  }
  const last = value.items[value.items.length - 1]
  if (last.type !== 'seal' || last.final_sequence !== value.upper_sequence ||
    last.final_hash !== value.upper_hash || last.seal_hash !== value.seal_hash) {
    problem('Final item must bind the upper head and seal', ['items'])
  }
  if (value.items.filter((item) => item.type === 'seal').length !== 1) problem('Exactly one final seal is required', ['items'])
  value.items.forEach((item, index) => {
    if (item.type === 'registry_activation_receipt') {
      const prior = value.items[index - 1]
      if (!prior || (prior.type !== 'c0' && prior.type !== 'registry_transition') ||
        item.control_sequence !== prior.sequence || item.control_hash !==
          (prior.type === 'c0' ? prior.checkpoint_hash : prior.record_hash)) {
        problem('Activation receipt must immediately bind C0 or its transition', ['items', index])
      }
    }
    if (item.type === 'c0' || item.type === 'registry_transition') {
      if (value.items[index + 1]?.type !== 'registry_activation_receipt') {
        problem('C0 and transitions require activation receipts', ['items', index])
      }
    }
  })
}).describe('JSON Schema consumers must also verify ordered C0/transition receipts, seal anchors, original v1 bytes, mirror coverage, standby and #844 copy inventory.')
export type JournalMixedExport = z.infer<typeof journalMixedExport>

const evidenceCommon = {
  evidence_id: opaqueId, version_id: opaqueId, sha256: hash, observed_at: utcMillis,
  bundle_digest: hash, seal_hash: hash, target_fingerprint: hash,
}
const operationBinding = { binding_scope: z.literal('operation'), operation_id: uuid }
const globalBinding = { binding_scope: z.literal('global') }
const probeFields = { surface_id: opaqueId, outcome: z.enum(['denied', 'allowed', 'failed']), credential_class: opaqueId }
const probeGlobal = z.strictObject({
  ...evidenceCommon, ...globalBinding, type: z.literal('probe_ref'),
  ...probeFields, surface_id: z.literal('source.version_read'),
})
const probeOperation = z.strictObject({ ...evidenceCommon, ...operationBinding, type: z.literal('probe_ref'), ...probeFields })
const policyFields = {
  ...evidenceCommon, ...operationBinding, type: z.literal('policy_ref'),
  evaluated_at: utcMillis, negative_export_probe_ids: z.array(opaqueId).min(1),
}
const policyDeadline = z.strictObject({
  ...policyFields, policy_class: z.literal('retrieval_deadline'), effective_deadline: utcMillis,
})
const policyDecision = z.strictObject({
  ...policyFields, policy_class: z.literal('section_6_6_decision'),
  decision_id: opaqueId, section_11_rights_digest: hash,
})
const preservation = z.strictObject({
  ...evidenceCommon, ...operationBinding, type: z.literal('preservation_ref'),
  manifest_id: uuid, manifest_version_id: opaqueId, manifest_hash: hash,
  frozen_unaffected_digest: hash, target_unaffected_digest: hash,
})
const copy = z.strictObject({
  ...evidenceCommon, ...globalBinding, type: z.literal('copy_ref'),
  copy_inventory_digest: hash, source_isolation_digest: hash,
  target_inventory_digest: hash, last_restorable_deadline: utcMillis,
})
const closure = z.strictObject({
  ...evidenceCommon, ...globalBinding, type: z.literal('closure_ref'),
  restore_attempt_id: opaqueId, attempt_descriptor_hash: hash,
  attempt_descriptor_version_id: opaqueId, original_restore_at: utcMillis,
  original_affected_count: count, closure_row_digest: hash, closure_commit_marker: opaqueId,
  schema_preflight_digest: hash, zero_open_sessions_count: z.literal(0),
  zero_open_sessions_at: utcMillis,
})

/** Global refs forbid an operation; access, policy and preservation refs require one. */
export const journalEvidenceRef = z.union([
  probeGlobal, probeOperation, policyDeadline, policyDecision, preservation, copy, closure,
])
export type JournalEvidenceRef = z.infer<typeof journalEvidenceRef>

const intentKindValues = journalIntentV2Body.options.map((branch) => branch.shape.kind.value) as [string, ...string[]]
const intentKind = z.enum(intentKindValues)
// These kinds have an unconditional target surface. Other object/authority
// obligations depend on the signed kind registry and protected manifest.
const objectRequiredKinds = new Set(['app_logo.delete', 'organization_export.expire'])
const authorityRequiredKinds = new Set([
  'server_key.revoke', 'mcp_grant.revoke', 'mcp_central_grant.revoke',
  'mcp_client.revoke', 'mcp_central_client.revoke',
  'instance.serial_lock', 'instance.serial_rotate_old', 'instance.license_revoke',
  'instance.reporter_key_revoke', 'instance.instance_key_revoke',
])
const operationResult = z.strictObject({
  sequence: positiveInteger, operation_id: uuid, kind: intentKind,
  apply_result: z.enum(['applied', 'already-effective', 'failed']),
  database: z.enum(['absent', 'revoked', 'failed', 'not-applicable']),
  customer_target_object: z.enum(['absent', 'failed', 'not-applicable']),
  authority: z.enum(['revoked', 'failed', 'not-applicable']),
  evidence_ref_ids: z.array(opaqueId),
})
const proofCommon = { operation_id: uuid, probe_ref_ids: z.array(opaqueId) }
const passingProofCommon = { ...proofCommon, probe_ref_ids: z.array(opaqueId).min(1) }
const wholeProof = z.union([
  z.strictObject({ ...passingProofCommon, kind: z.literal('organization.erase'), affected_verdict: z.literal('denied'), unaffected_verdict: z.literal('not-applicable') }),
  z.strictObject({ ...proofCommon, kind: z.literal('organization.erase'), affected_verdict: z.literal('failed'), unaffected_verdict: z.enum(['not-applicable', 'failed']) }),
  z.strictObject({ ...proofCommon, kind: z.literal('organization.erase'), affected_verdict: z.literal('denied'), unaffected_verdict: z.literal('failed') }),
])
const scopeProofCommon = { ...proofCommon, kind: z.literal('organization.scope_erase') }
const passingScopeProofCommon = { ...passingProofCommon, kind: z.literal('organization.scope_erase') }
const scopeAllowed = z.strictObject({
  ...passingScopeProofCommon, affected_verdict: z.literal('denied'), unaffected_verdict: z.literal('allowed'),
  unaffected_state_ref_id: opaqueId,
})
const scopePolicyDenied = z.strictObject({
  ...passingScopeProofCommon, affected_verdict: z.literal('denied'), unaffected_verdict: z.literal('policy-denied'),
  unaffected_state_ref_id: opaqueId, policy_ref_id: opaqueId,
})
const scopeFailed = z.union([
  z.strictObject({ ...scopeProofCommon, affected_verdict: z.literal('failed'),
    unaffected_verdict: z.enum(['allowed', 'failed']), unaffected_state_ref_id: opaqueId.optional() }),
  z.strictObject({ ...scopeProofCommon, affected_verdict: z.literal('failed'),
    unaffected_verdict: z.literal('policy-denied'), unaffected_state_ref_id: opaqueId.optional(), policy_ref_id: opaqueId }),
  z.strictObject({ ...scopeProofCommon, affected_verdict: z.literal('denied'),
    unaffected_verdict: z.literal('failed'), unaffected_state_ref_id: opaqueId.optional() }),
])

/** Failed scope proofs can omit preservation; successful scopes cannot. */
export const journalAccessProof = z.union([wholeProof, scopeAllowed, scopePolicyDenied, scopeFailed])
export type JournalAccessProof = z.infer<typeof journalAccessProof>

const receiptFields = {
  schema: z.literal('fleetless.journal-replay-receipt.v2'), environment: opaqueId, signing_key_id: opaqueId,
  run_id: opaqueId, restore_attempt_id: opaqueId, bundle_digest: hash, seal_hash: hash,
  seal_version_id: opaqueId, registry_chain_digest: hash, source_fingerprint: hash,
  target_fingerprint: hash, schema_preflight_digest: hash, copy_inventory_digest: hash,
  copy_coverage_digest: hash, target_inventory_digest: hash,
  lower_sequence: count, lower_hash: hash, upper_sequence: count, upper_hash: hash,
  operation_count: count, applied_count: count, already_effective_count: count,
  failed_count: count, last_applied_sequence: count,
  operations: z.array(operationResult), evidence_refs: z.array(journalEvidenceRef),
  source_isolation_ref_id: opaqueId, copy_ref_id: opaqueId, closure_ref_id: opaqueId,
  access_proofs: z.array(journalAccessProof), original_restore_at: utcMillis,
  original_closure_affected_count: count, zero_open_sessions_count: z.literal(0),
  final_probe_at: utcMillis, completed_at: utcMillis, verdict: z.enum(['pass', 'fail']),
}

/** Structural gate report. The consumer still verifies signed bytes and protected evidence. */
export const journalReplayReceiptBody = z.strictObject(receiptFields).superRefine((value, ctx) => {
  const problem = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  const refs = new Map<string, JournalEvidenceRef>()
  value.evidence_refs.forEach((ref, index) => {
    if (refs.has(ref.evidence_id)) problem('Duplicate evidence ID', ['evidence_refs', index, 'evidence_id'])
    refs.set(ref.evidence_id, ref)
    if (ref.bundle_digest !== value.bundle_digest || ref.seal_hash !== value.seal_hash || ref.target_fingerprint !== value.target_fingerprint) {
      problem('Evidence must bind this bundle, seal and target', ['evidence_refs', index])
    }
  })
  const bound = (id: string, type: JournalEvidenceRef['type'], operationId?: string) => {
    const ref = refs.get(id)
    if (!ref || ref.type !== type || ref.binding_scope !== (operationId ? 'operation' : 'global') ||
      (operationId && ('operation_id' in ref ? ref.operation_id : undefined) !== operationId)) return undefined
    return ref
  }
  const source = bound(value.source_isolation_ref_id, 'probe_ref')
  if (!source) problem('Source isolation must resolve to a global probe', ['source_isolation_ref_id'])
  const copyRef = bound(value.copy_ref_id, 'copy_ref')
  if (!copyRef || copyRef.type !== 'copy_ref' || copyRef.copy_inventory_digest !== value.copy_inventory_digest ||
    copyRef.target_inventory_digest !== value.target_inventory_digest) problem('Copy inventory reference mismatch', ['copy_ref_id'])
  const closureRef = bound(value.closure_ref_id, 'closure_ref')
  if (!closureRef || closureRef.type !== 'closure_ref' || closureRef.restore_attempt_id !== value.restore_attempt_id ||
    closureRef.original_restore_at !== value.original_restore_at ||
    closureRef.original_affected_count !== value.original_closure_affected_count ||
    closureRef.schema_preflight_digest !== value.schema_preflight_digest) problem('Closure reference mismatch', ['closure_ref_id'])
  const counts = { applied: 0, 'already-effective': 0, failed: 0 }
  const erase = new Set<string>()
  const operationIds = new Set<string>()
  let previousSequence = 0
  value.operations.forEach((operation, index) => {
    counts[operation.apply_result]++
    if (operation.sequence <= previousSequence || operationIds.has(operation.operation_id)) problem('Operations must be sorted and unique', ['operations', index])
    previousSequence = operation.sequence
    operationIds.add(operation.operation_id)
    if (operation.kind === 'organization.erase' || operation.kind === 'organization.scope_erase') erase.add(`${operation.kind}:${operation.operation_id}`)
    operation.evidence_ref_ids.forEach((id) => {
      const ref = refs.get(id)
      if (!ref || ref.binding_scope !== 'operation' || ref.operation_id !== operation.operation_id) {
        problem('Operation evidence binding mismatch', ['operations', index, 'evidence_ref_ids'])
      }
    })
  })
  if (value.operation_count !== value.operations.length || value.applied_count !== counts.applied ||
    value.already_effective_count !== counts['already-effective'] || value.failed_count !== counts.failed) problem('Replay counts mismatch', ['operation_count'])
  const lastApplied = [...value.operations].reverse().find((operation) => operation.apply_result !== 'failed')?.sequence ?? 0
  if (value.last_applied_sequence !== lastApplied) problem('Last applied sequence mismatch', ['last_applied_sequence'])
  const seenProofs = new Set<string>()
  value.access_proofs.forEach((proof, index) => {
    const key = `${proof.kind}:${proof.operation_id}`
    if (seenProofs.has(key) || !erase.has(key)) problem('Extra or duplicate erase access proof', ['access_proofs', index])
    seenProofs.add(key)
    proof.probe_ref_ids.forEach((id) => { if (!bound(id, 'probe_ref', proof.operation_id)) problem('Probe must bind the erase operation', ['access_proofs', index, 'probe_ref_ids']) })
    if ('unaffected_state_ref_id' in proof && proof.unaffected_state_ref_id && !bound(proof.unaffected_state_ref_id, 'preservation_ref', proof.operation_id)) {
      problem('Preservation must bind the erase operation', ['access_proofs', index, 'unaffected_state_ref_id'])
    }
    if ('policy_ref_id' in proof && proof.policy_ref_id) {
      const policy = bound(proof.policy_ref_id, 'policy_ref', proof.operation_id)
      if (!policy || policy.type !== 'policy_ref') problem('Policy must bind the erase operation', ['access_proofs', index, 'policy_ref_id'])
      else policy.negative_export_probe_ids.forEach((id) => {
        const probe = bound(id, 'probe_ref', proof.operation_id)
        if (!probe || probe.type !== 'probe_ref' || probe.outcome !== 'denied') {
          problem('Negative export probe must bind the erase operation and deny access', ['access_proofs', index, 'policy_ref_id'])
        }
      })
    }
  })
  if (erase.size !== seenProofs.size) problem('Access proof set must equal erase operations', ['access_proofs'])
  if (value.verdict === 'pass') {
    if (value.failed_count !== 0 || value.operations.some((operation) => operation.database === 'failed' ||
      operation.customer_target_object === 'failed' || operation.authority === 'failed')) problem('Failed operation cannot pass', ['verdict'])
    value.operations.forEach((operation, index) => {
      if ((operation.kind === 'organization.erase' || operation.kind === 'organization.scope_erase') && operation.database !== 'absent') {
        problem('Passing organization erase requires database absence', ['operations', index, 'database'])
      }
      if (objectRequiredKinds.has(operation.kind) && operation.customer_target_object !== 'absent') {
        problem('Passing object deletion requires target object absence', ['operations', index, 'customer_target_object'])
      }
      if (authorityRequiredKinds.has(operation.kind) && operation.authority !== 'revoked') {
        problem('Passing authority revocation requires revoked authority', ['operations', index, 'authority'])
      }
    })
    if (value.access_proofs.some((proof) => proof.affected_verdict === 'failed' || proof.unaffected_verdict === 'failed')) problem('Failed access proof cannot pass', ['verdict'])
    if (value.access_proofs.some((proof) => proof.probe_ref_ids.some((id) => {
      const probe = bound(id, 'probe_ref', proof.operation_id)
      return !probe || probe.type !== 'probe_ref' || probe.outcome === 'failed'
    }))) problem('Failed or missing access probe cannot pass', ['verdict'])
    if (!source || source.type !== 'probe_ref' || source.outcome !== 'denied') problem('Source isolation not proved', ['verdict'])
  }
})
  .describe('JSON Schema consumers must also verify counts, exact erase-proof set, reference bindings, kind/registry surface applicability and pass outcomes, signatures and protected-version readbacks.')
export type JournalReplayReceiptBody = z.infer<typeof journalReplayReceiptBody>
export const journalReplayReceipt = journalReplayReceiptBody.safeExtend({ receipt_hash: hash, signature })
export type JournalReplayReceipt = z.infer<typeof journalReplayReceipt>
