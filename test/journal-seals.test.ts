// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'

const hash = 'a'.repeat(64)
const generation = '01234567-89ab-4cde-8fab-0123456789ab'
const prior = '01234567-89ab-4cde-8fab-0123456789ac'
const signature = 'A'.repeat(86)
const checkpoint = {
  environment: 'synthetic', generation, signing_key_id: 'signer',
  sequence: 8, previous_hash: hash, checkpoint_at: '2026-11-02T12:00:00.123Z',
  fence_drain_evidence_hash: hash, fence_drain_evidence_version_id: 'fence-version',
  source_db_timeline: 1, source_db_lsn: 'A/1AF',
  registry_chain_digest: hash, registry_digest: hash, build_set_digest: hash,
}
const activation = {
  ...checkpoint, schema: 'fleetless.journal-v2-activation-checkpoint.v1',
  first_v2_sequence: 9, binding_backfill_evidence_hash: hash,
  binding_backfill_evidence_version_id: 'backfill-version',
}
const rotation = {
  ...checkpoint, schema: 'fleetless.journal-generation-checkpoint.v1', previous_generation: prior,
}
const seal = {
  schema: 'fleetless.journal-final-seal.v1', environment: 'synthetic', signing_key_id: 'signer',
  incident_id: 'incident', isolated_target_id: 'target', restore_attempt_id: 'attempt',
  final_sequence: 8, final_hash: hash, final_generation: generation,
  selected_recovery_point: { kind: 'timestamp', at: '2026-11-02T11:00:00.000Z' },
  fence_at: '2026-11-02T12:00:00.123Z', e_max_ms: 100, w_max_ms: 200,
  deployment_admission_evidence_digest: hash,
  cutoff_utc: '2026-11-02T12:00:01.000Z', previous_cutoff_utc: '2026-11-02T11:00:00.000Z',
  registry_chain_digest: hash, copy_inventory_digest: hash, pinned_standby_id: 'standby',
}
const fixtures = [
  ['journalV2ActivationCheckpointBody', 'journal-v2-activation-checkpoint-body', activation],
  ['journalV2ActivationCheckpoint', 'journal-v2-activation-checkpoint', { ...activation, record_hash: hash, signature }],
  ['journalGenerationCheckpointBody', 'journal-generation-checkpoint-body', rotation],
  ['journalGenerationCheckpoint', 'journal-generation-checkpoint', { ...rotation, record_hash: hash, signature }],
  ['journalFinalSealBody', 'journal-final-seal-body', seal],
  ['journalFinalSeal', 'journal-final-seal', { ...seal, seal_hash: hash, signature }],
] as const
const schema = (name: string) => (contracts as any)[name]

describe('sequenced checkpoints and final seal', () => {
  it('publishes exact body and envelope shapes without changing their input', () => {
    for (const [name, , value] of fixtures) {
      expect(contracts).toHaveProperty(name)
      expect(schema(name).parse(value)).toEqual(value)
    }
  })
  it('rejects missing, null and unregistered fields throughout the signed shapes', () => {
    for (const [name, , value] of fixtures) {
      for (const key of Object.keys(value)) {
        const missing: Record<string, unknown> = { ...value }
        delete missing[key]
        expect(schema(name).safeParse(missing).success, `${name}: ${key}`).toBe(false)
        expect(schema(name).safeParse({ ...value, [key]: null }).success).toBe(false)
      }
      for (const extra of [{ deployment_epoch: 1 }, { raw_key: 'private' }, { schema: 'future.v1' }]) {
        expect(schema(name).safeParse({ ...value, ...extra }).success).toBe(false)
      }
    }
  })
  it('requires a safe immediate v2 successor and a different generation without resetting sequence', () => {
    for (const name of ['journalV2ActivationCheckpointBody', 'journalV2ActivationCheckpoint']) {
      const value = name.endsWith('Body') ? activation : { ...activation, record_hash: hash, signature }
      for (const patch of [{ sequence: 0 }, { first_v2_sequence: 8 }, { first_v2_sequence: 10 },
        { sequence: Number.MAX_SAFE_INTEGER, first_v2_sequence: Number.MAX_SAFE_INTEGER + 1 }]) {
        expect(schema(name).safeParse({ ...value, ...patch }).success).toBe(false)
      }
      expect(schema(name).safeParse({ ...value, sequence: Number.MAX_SAFE_INTEGER - 1,
        first_v2_sequence: Number.MAX_SAFE_INTEGER }).success).toBe(true)
    }
    for (const name of ['journalGenerationCheckpointBody', 'journalGenerationCheckpoint']) {
      const value = name.endsWith('Body') ? rotation : { ...rotation, record_hash: hash, signature }
      for (const patch of [{ previous_generation: generation }, { sequence: 0 }, { first_v2_sequence: 9 }]) {
        expect(schema(name).safeParse({ ...value, ...patch }).success).toBe(false)
      }
    }
  })
  it('keeps the actual LSN recovery point strict and distinct from the oldest mapping bound', () => {
    const target = schema('journalFinalSealBody')
    expect(target.safeParse({ ...seal, selected_recovery_point: {
      kind: 'lsn', timeline: 2, lsn: '0/FA', at: '2026-11-02T11:00:00.000Z',
    } }).success).toBe(true)
    for (const selected_recovery_point of [
      { kind: 'lsn', timeline: 2, lsn: '0/FA' },
      { kind: 'lsn', timeline: 0, lsn: '0/FA', at: seal.fence_at },
      { kind: 'lsn', timeline: 2, lsn: '0/fa', at: seal.fence_at },
      { ...seal.selected_recovery_point, timeline: 2 },
    ]) expect(target.safeParse({ ...seal, selected_recovery_point }).success).toBe(false)
    expect(target.safeParse({ ...seal, oldest_mapping_bearing_point: seal.selected_recovery_point }).success).toBe(false)
  })
  it('checks the exact cutoff including rounding, prior-cutoff dominance and integer overflow', () => {
    for (const name of ['journalFinalSealBody', 'journalFinalSeal']) {
      const value = name.endsWith('Body') ? seal : { ...seal, seal_hash: hash, signature }
      for (const cutoff_utc of ['2026-11-02T12:00:00.423Z', '2026-11-02T12:00:00.999Z', '2026-11-02T12:00:02.000Z']) {
        expect(schema(name).safeParse({ ...value, cutoff_utc }).success).toBe(false)
      }
      const priorDominates = { ...value, previous_cutoff_utc: '2026-11-02T12:00:04.000Z', cutoff_utc: '2026-11-02T12:00:05.000Z' }
      expect(schema(name).safeParse(priorDominates).success).toBe(true)
      expect(schema(name).safeParse({ ...priorDominates, cutoff_utc: seal.cutoff_utc }).success).toBe(false)
      expect(schema(name).safeParse({ ...value, fence_at: '2026-11-02T12:00:00.000Z',
        e_max_ms: 0, w_max_ms: 0, cutoff_utc: '2026-11-02T12:00:00.000Z' }).success).toBe(true)
      for (const patch of [{ e_max_ms: -1 }, { w_max_ms: 0.5 },
        { e_max_ms: Number.MAX_SAFE_INTEGER, w_max_ms: Number.MAX_SAFE_INTEGER }]) {
        expect(schema(name).safeParse({ ...value, ...patch }).success).toBe(false)
      }
    }
  })
  it('exports JSON Schema with the same closed scalar/union shapes', () => {
    const ajv = new (Ajv2020 as any)({ strict: false })
    ;(addFormats as any)(ajv)
    for (const [, artifact, value] of fixtures) {
      const json = JSON.parse(readFileSync(new URL(`../artifacts/schema/${artifact}.schema.json`, import.meta.url), 'utf8'))
      const validate = ajv.compile(json)
      expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
      expect(validate({ ...value, deployment_epoch: 1 })).toBe(false)
      for (const key of Object.keys(value)) {
        const missing: Record<string, unknown> = { ...value }
        delete missing[key]
        expect(validate(missing), `${artifact}: ${key}`).toBe(false)
      }
      if ('signature' in value) expect(validate({ ...value, signature: 'A'.repeat(85) + 'B' })).toBe(false)
      if ('selected_recovery_point' in value) {
        expect(validate({ ...value, selected_recovery_point: { kind: 'lsn', timeline: 1, lsn: '0/AF' } })).toBe(false)
      }
    }
  })
})
