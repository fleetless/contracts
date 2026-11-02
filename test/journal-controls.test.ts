// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'
import { exportedSchemas } from '../scripts/export-schemas.js'

const zero = '0'.repeat(64)
const hash = 'a'.repeat(64)
const uuid = '01234567-89ab-4cde-8fab-0123456789ab'
const at = '2026-11-02T12:00:00.000Z'
const signature = 'A'.repeat(86)
const c0 = {
  schema: 'fleetless.journal-first-checkpoint.v1', environment: 'staging',
  generation: uuid, sequence: 0, previous_hash: zero, checkpoint_at: at,
  source_db_timeline: 1, source_db_lsn: '0/1AF',
  fence_drain_evidence_hash: hash, fence_drain_evidence_version_id: 'fence-1',
  registry_digest: hash, build_set_digest: hash,
  registry_version_id: 'registry-1', build_set_version_id: 'builds-1',
  copy_inventory_digest: hash, journal_primary_id: 'primary-1',
  pinned_standby_id: 'standby-1', signing_key_id: 'signer-1',
}
const transition = {
  schema: 'fleetless.registry-transition.v1', environment: 'staging',
  generation: uuid, sequence: 4, previous_hash: hash, deployment_epoch: 1,
  activated_at: at, old_registry_digest: hash, new_registry_digest: hash,
  old_registry_version_id: 'registry-1', new_registry_version_id: 'registry-2',
  old_build_set_digest: hash, new_build_set_digest: hash,
  old_build_set_version_id: 'builds-1', new_build_set_version_id: 'builds-2',
  fence_drain_evidence_hash: hash, fence_drain_evidence_version_id: 'fence-2',
  source_db_timeline: 1, source_db_lsn: 'A/FFFFFFFF', signing_key_id: 'signer-1',
}
const activation = {
  schema: 'fleetless.registry-activation-receipt.v1', environment: 'staging',
  generation: uuid, control_sequence: 0, control_hash: hash,
  mirror_version_id: 'mirror-1', mirror_retain_until: at,
  fence_drain_evidence_hash: hash, fence_drain_evidence_version_id: 'fence-1',
  fence_retain_until: at, source_db_timeline: 1, source_db_lsn: '0/1AF',
  old_registry_digest: zero, new_registry_digest: hash,
  old_registry_version_id: '', new_registry_version_id: 'registry-1',
  old_build_set_digest: zero, new_build_set_digest: hash,
  old_build_set_version_id: '', new_build_set_version_id: 'builds-1',
  standby_head_hash: hash, standby_id: 'standby-1', copy_inventory_digest: hash,
  copy_coverage_digest: hash, previous_receipt_hash: zero,
  coverage_verdict: 'covered', signing_key_id: 'signer-1',
}
const laterActivation = {
  ...activation, control_sequence: 4, old_registry_digest: hash,
  old_build_set_digest: hash, old_registry_version_id: 'registry-1',
  old_build_set_version_id: 'builds-1', previous_receipt_hash: hash,
}

// A missing export fails as an assertion before any schema is invoked.
const candidates = () => [
  ['journalFirstCheckpointBody', 'journal-first-checkpoint-body', c0],
  ['journalFirstCheckpoint', 'journal-first-checkpoint', { ...c0, checkpoint_hash: hash, signature }],
  ['journalRegistryTransitionBody', 'journal-registry-transition-body', transition],
  ['journalRegistryTransition', 'journal-registry-transition', { ...transition, record_hash: hash, signature }],
  ['journalRegistryActivationReceiptBody', 'journal-registry-activation-receipt-body', activation],
  ['journalRegistryActivationReceipt', 'journal-registry-activation-receipt', { ...activation, receipt_hash: hash, signature }],
] as const

describe('package 3 journal control wire', () => {
  it('exports each exact signable body and envelope', () => {
    for (const [name] of candidates()) expect(contracts).toHaveProperty(name)
  })

  it('accepts fixtures without adding, stripping or normalizing signed fields', () => {
    for (const [name, , body] of candidates()) {
      const schema = (contracts as any)[name]
      expect(schema.parse(body)).toEqual(body)
    }
  })

  it('rejects every missing field, null and unknown key in every body and envelope', () => {
    for (const [name, , body] of candidates()) {
      const schema = (contracts as any)[name]
      for (const key of Object.keys(body)) {
        const missing: Record<string, unknown> = { ...body }
        delete missing[key]
        expect(schema.safeParse(missing).success, `${name}: missing ${key}`).toBe(false)
        expect(schema.safeParse({ ...body, [key]: null }).success, `${name}: null ${key}`).toBe(false)
      }
      expect(schema.safeParse({ ...body, raw_key: 'forbidden' }).success).toBe(false)
      expect(schema.safeParse({ ...body, schema: 'future.v9' }).success).toBe(false)
    }
  })

  it('requires canonical UUID, SHA-256, UTC milliseconds and PostgreSQL LSN syntax', () => {
    const schema = (contracts as any).journalFirstCheckpointBody
    for (const [key, values] of Object.entries({
      generation: [uuid.toUpperCase(), 'not-a-uuid', `{${uuid}}`],
      registry_digest: ['A'.repeat(64), hash.slice(1), `${hash}0`],
      checkpoint_at: ['2026-11-02T12:00:00Z', '2026-11-02T12:00:00.00Z',
        '2026-11-02T12:00:00.0000Z', '2026-11-02T13:00:00.000+01:00', '2026-02-30T12:00:00.000Z'],
      source_db_lsn: ['0/1af', '00/1AF', '0/01AF', '0x0/1AF', '100000000/0', '0/100000000'],
      source_db_timeline: [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'],
      environment: [''], registry_version_id: [''], build_set_version_id: [''],
      signing_key_id: [''], pinned_standby_id: [''], journal_primary_id: [''],
    })) for (const value of values) {
      expect(schema.safeParse({ ...c0, [key]: value }).success, `${key}: ${value}`).toBe(false)
    }
    expect(schema.safeParse({ ...c0, source_db_lsn: '0/0' }).success).toBe(true)
    expect(schema.safeParse({ ...c0, sequence: 1 }).success).toBe(false)
    expect(schema.safeParse({ ...c0, previous_hash: hash }).success).toBe(false)
  })

  it('bounds sequence and deployment epoch to positive safe integers', () => {
    const schema = (contracts as any).journalRegistryTransitionBody
    for (const key of ['sequence', 'deployment_epoch']) {
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
        expect(schema.safeParse({ ...transition, [key]: value }).success).toBe(false)
      }
      expect(schema.safeParse({ ...transition, [key]: Number.MAX_SAFE_INTEGER }).success).toBe(true)
    }
  })

  it('requires exactly 64 bytes of canonical unpadded base64url Ed25519 signature', () => {
    const schema = (contracts as any).journalFirstCheckpoint
    const valid = { ...c0, checkpoint_hash: hash, signature }
    for (const value of ['', 'A'.repeat(85), 'A'.repeat(87), `${signature}==`,
      `${'A'.repeat(85)}B`, `${'A'.repeat(85)}_`, `+${'A'.repeat(85)}`]) {
      expect(schema.safeParse({ ...valid, signature: value }).success, value).toBe(false)
    }
    for (const last of ['A', 'Q', 'g', 'w']) {
      expect(schema.safeParse({ ...valid, signature: `${'A'.repeat(85)}${last}` }).success).toBe(true)
    }
  })

  it('keeps the C0 receipt sentinel fields separate from later activation receipts', () => {
    const schema = (contracts as any).journalRegistryActivationReceiptBody
    expect(schema.safeParse(laterActivation).success).toBe(true)
    expect(schema.safeParse({ ...activation, coverage_verdict: 'gap' }).success).toBe(true)
    expect(schema.safeParse({ ...activation, coverage_verdict: 'pass' }).success).toBe(false)
    for (const key of ['old_registry_digest', 'old_build_set_digest', 'previous_receipt_hash']) {
      expect(schema.safeParse({ ...activation, [key]: hash }).success, key).toBe(false)
    }
    for (const key of ['old_registry_version_id', 'old_build_set_version_id']) {
      expect(schema.safeParse({ ...activation, [key]: 'nonempty' }).success).toBe(false)
      expect(schema.safeParse({ ...laterActivation, [key]: '' }).success).toBe(false)
    }
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(schema.safeParse({ ...laterActivation, control_sequence: value }).success).toBe(false)
    }
  })
})

describe('journal control JSON Schema parity', () => {
  it('publishes strict schemas with the same C0 and signature constraints', () => {
    const ajv = new (Ajv2020 as any)({ strict: false })
    ;(addFormats as any)(ajv)
    for (const [name, artifact, body] of candidates()) {
      expect(exportedSchemas).toHaveProperty(artifact)
      const json = JSON.parse(readFileSync(new URL(`../artifacts/schema/${artifact}.schema.json`, import.meta.url), 'utf8'))
      const validate = ajv.compile(json)
      expect(validate(body), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true)
      expect(validate({ ...body, extra: true })).toBe(false)
      for (const key of Object.keys(body)) {
        const missing: Record<string, unknown> = { ...body }
        delete missing[key]
        expect(validate(missing), `${name}: ${key}`).toBe(false)
      }
      if ('signature' in body) expect(validate({ ...body, signature: 'A'.repeat(85) + 'B' })).toBe(false)
      if ('control_sequence' in body) {
        expect(validate({ ...body, old_registry_digest: hash })).toBe(false)
        expect(validate({ ...body, ...laterActivation })).toBe(true)
        expect(validate({ ...body, ...laterActivation, old_registry_version_id: '' })).toBe(false)
      }
    }
  })
})
