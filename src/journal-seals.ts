// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

// Decoded shapes only. Consumers verify original canonical bytes, signatures,
// committed sequence, exact-version fence evidence and standby confirmation.
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const opaqueId = z.string().min(1)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const utcMillis = z.iso.datetime({ precision: 3 })
const lsn = z.string().regex(/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/)
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/)
const checkpointFields = {
  environment: opaqueId,
  generation: uuid,
  sequence: positiveInteger,
  previous_hash: hash,
  checkpoint_at: utcMillis,
  fence_drain_evidence_hash: hash,
  fence_drain_evidence_version_id: opaqueId,
  source_db_timeline: positiveInteger,
  source_db_lsn: lsn,
  registry_chain_digest: hash,
  registry_digest: hash,
  build_set_digest: hash,
  signing_key_id: opaqueId,
}

/** Consumes one sequence; all subsequent obligations use v2. */
export const journalV2ActivationCheckpointBody = z.strictObject({
  schema: z.literal('fleetless.journal-v2-activation-checkpoint.v1'),
  ...checkpointFields,
  first_v2_sequence: positiveInteger,
  binding_backfill_evidence_hash: hash,
  binding_backfill_evidence_version_id: opaqueId,
}).refine((value) => value.sequence < Number.MAX_SAFE_INTEGER && value.first_v2_sequence === value.sequence + 1, {
  path: ['first_v2_sequence'], message: 'Must immediately follow the checkpoint sequence',
}).describe('JSON Schema consumers must also verify first_v2_sequence = sequence + 1 and journal activation evidence.')
export type JournalV2ActivationCheckpointBody = z.infer<typeof journalV2ActivationCheckpointBody>
export const journalV2ActivationCheckpoint = journalV2ActivationCheckpointBody.safeExtend({ record_hash: hash, signature })
export type JournalV2ActivationCheckpoint = z.infer<typeof journalV2ActivationCheckpoint>

/** Advances generation without resetting the shared journal sequence. */
export const journalGenerationCheckpointBody = z.strictObject({
  schema: z.literal('fleetless.journal-generation-checkpoint.v1'),
  ...checkpointFields,
  previous_generation: uuid,
}).refine((value) => value.generation !== value.previous_generation, {
  path: ['previous_generation'], message: 'Must differ from the new generation',
}).describe('JSON Schema consumers must also verify generation differs from previous_generation and the committed sequence is not reset.')
export type JournalGenerationCheckpointBody = z.infer<typeof journalGenerationCheckpointBody>
export const journalGenerationCheckpoint = journalGenerationCheckpointBody.safeExtend({ record_hash: hash, signature })
export type JournalGenerationCheckpoint = z.infer<typeof journalGenerationCheckpoint>

// The actual recovery point B. The oldest selectable mapping-bearing point
// belongs in the export header and cannot substitute for this selected point.
const recoveryPoint = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('timestamp'), at: utcMillis }),
  z.strictObject({ kind: z.literal('lsn'), timeline: positiveInteger, lsn, at: utcMillis }),
])

/** Domain-separated final drain seal, not permission to open target traffic. */
export const journalFinalSealBody = z.strictObject({
  schema: z.literal('fleetless.journal-final-seal.v1'),
  environment: opaqueId,
  signing_key_id: opaqueId,
  incident_id: opaqueId,
  isolated_target_id: opaqueId,
  restore_attempt_id: opaqueId,
  final_sequence: count,
  final_hash: hash,
  final_generation: uuid,
  selected_recovery_point: recoveryPoint,
  fence_at: utcMillis,
  e_max_ms: count,
  w_max_ms: count,
  deployment_admission_evidence_digest: hash,
  cutoff_utc: utcMillis,
  previous_cutoff_utc: utcMillis,
  registry_chain_digest: hash,
  copy_inventory_digest: hash,
  pinned_standby_id: opaqueId,
}).refine((value) => {
  // BigInt prevents an otherwise safe pair of duration inputs from rounding
  // when added. Validate before conversion: refinements can see invalid scalars.
  const fenceAt = Date.parse(value.fence_at)
  const cutoff = Date.parse(value.cutoff_utc)
  const previous = Date.parse(value.previous_cutoff_utc)
  if (![fenceAt, cutoff, previous, value.e_max_ms, value.w_max_ms].every(Number.isSafeInteger)) return false
  const bound = BigInt(fenceAt) + BigInt(value.e_max_ms) + BigInt(value.w_max_ms)
  const rounded = (bound / 1000n + (bound % 1000n > 0n ? 1n : 0n)) * 1000n
  const next = BigInt(previous) + 1000n
  return BigInt(cutoff) === (rounded > next ? rounded : next)
}, { path: ['cutoff_utc'], message: 'Must equal max(ceil_to_second(T + E_max + W_max), previous C + 1 second)' })
  .describe('JSON Schema consumers must also verify C = max(ceil_to_second(T + E_max + W_max), previous C + 1 second), original signatures and complete drain/admission evidence.')
export type JournalFinalSealBody = z.infer<typeof journalFinalSealBody>
export const journalFinalSeal = journalFinalSealBody.safeExtend({ seal_hash: hash, signature })
export type JournalFinalSeal = z.infer<typeof journalFinalSeal>
