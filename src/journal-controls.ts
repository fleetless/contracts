// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

// Private Cloud/Ops wire, not customer API routes. These schemas validate
// decoded shapes only: canonical bytes, signatures and activation evidence
// must be verified by the journal/restore consumers before any mutation.
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const zeroHash = z.literal('0'.repeat(64))
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const opaqueId = z.string().min(1)
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const utcMillis = z.iso.datetime({ precision: 3 })
// PostgreSQL prints each 32-bit LSN half in uppercase hex without leading zeros.
const lsn = z.string().regex(/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/)
// 64 bytes encode to 86 base64url characters; the last four padding bits are zero.
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/)

const identity = {
  environment: opaqueId,
  generation: uuid,
  signing_key_id: opaqueId,
}
const fence = {
  fence_drain_evidence_hash: hash,
  fence_drain_evidence_version_id: opaqueId,
  source_db_timeline: positiveInteger,
  source_db_lsn: lsn,
}

/** RFC-8785 body, signed with domain `fleetless.journal-first-checkpoint.v1` + NUL. */
export const journalFirstCheckpointBody = z.strictObject({
  schema: z.literal('fleetless.journal-first-checkpoint.v1'),
  ...identity,
  sequence: z.literal(0),
  previous_hash: zeroHash,
  checkpoint_at: utcMillis,
  ...fence,
  registry_digest: hash,
  build_set_digest: hash,
  registry_version_id: opaqueId,
  build_set_version_id: opaqueId,
  copy_inventory_digest: hash,
  journal_primary_id: opaqueId,
  pinned_standby_id: opaqueId,
})
export type JournalFirstCheckpointBody = z.infer<typeof journalFirstCheckpointBody>

export const journalFirstCheckpoint = journalFirstCheckpointBody.extend({
  checkpoint_hash: hash,
  signature,
})
export type JournalFirstCheckpoint = z.infer<typeof journalFirstCheckpoint>

/** Shares the intent sequence; the control record itself has no customer mutation. */
export const journalRegistryTransitionBody = z.strictObject({
  schema: z.literal('fleetless.registry-transition.v1'),
  ...identity,
  sequence: positiveInteger,
  previous_hash: hash,
  deployment_epoch: positiveInteger,
  activated_at: utcMillis,
  old_registry_digest: hash,
  new_registry_digest: hash,
  old_registry_version_id: opaqueId,
  new_registry_version_id: opaqueId,
  old_build_set_digest: hash,
  new_build_set_digest: hash,
  old_build_set_version_id: opaqueId,
  new_build_set_version_id: opaqueId,
  ...fence,
})
export type JournalRegistryTransitionBody = z.infer<typeof journalRegistryTransitionBody>

export const journalRegistryTransition = journalRegistryTransitionBody.extend({
  record_hash: hash,
  signature,
})
export type JournalRegistryTransition = z.infer<typeof journalRegistryTransition>

const activationFields = {
  schema: z.literal('fleetless.registry-activation-receipt.v1'),
  ...identity,
  control_hash: hash,
  mirror_version_id: opaqueId,
  mirror_retain_until: utcMillis,
  ...fence,
  fence_retain_until: utcMillis,
  new_registry_digest: hash,
  new_registry_version_id: opaqueId,
  new_build_set_digest: hash,
  new_build_set_version_id: opaqueId,
  standby_head_hash: hash,
  standby_id: opaqueId,
  copy_inventory_digest: hash,
  copy_coverage_digest: hash,
  coverage_verdict: z.enum(['covered', 'gap']),
}
const firstActivationBody = z.strictObject({
  ...activationFields,
  control_sequence: z.literal(0),
  old_registry_digest: zeroHash,
  old_registry_version_id: z.literal(''),
  old_build_set_digest: zeroHash,
  old_build_set_version_id: z.literal(''),
  previous_receipt_hash: zeroHash,
})
const laterActivationBody = z.strictObject({
  ...activationFields,
  control_sequence: positiveInteger,
  old_registry_digest: hash,
  old_registry_version_id: opaqueId,
  old_build_set_digest: hash,
  old_build_set_version_id: opaqueId,
  previous_receipt_hash: hash,
})

// A structural union preserves the C0-only sentinels in JSON Schema too.
// `gap` is a valid report, never permission to activate or open traffic.
export const journalRegistryActivationReceiptBody = z.union([firstActivationBody, laterActivationBody])
export type JournalRegistryActivationReceiptBody = z.infer<typeof journalRegistryActivationReceiptBody>

export const journalRegistryActivationReceipt = z.union([
  firstActivationBody.extend({ receipt_hash: hash, signature }),
  laterActivationBody.extend({ receipt_hash: hash, signature }),
])
export type JournalRegistryActivationReceipt = z.infer<typeof journalRegistryActivationReceipt>
