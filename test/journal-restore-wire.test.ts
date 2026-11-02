// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'
import { exportedSchemas } from '../scripts/export-schemas.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/dr1895-package-3-ops-wire-receipts.json', import.meta.url), 'utf8'))
const hash = 'a'.repeat(64)
const otherHash = 'b'.repeat(64)
const generation = '00000000-0000-4000-8000-000000000001'
const itemCommon = {
  generation, stored_bytes_b64url: 'AA', mirror_inventory_digest: hash,
  mirror_verdict: 'complete', mirror_attempts: fixture.mirror_attempts[0].attempts,
}
const emptyExport = {
  schema: 'fleetless.journal-mixed-export.v1', environment: 'synthetic-c0-environment',
  restore_attempt_id: 'attempt-1', source_db_timeline: 1, source_db_lsn: '0/FA',
  selected_recovery_point: { kind: 'timestamp', at: '2026-11-02T11:00:00.000Z' },
  oldest_mapping_bearing_point: { kind: 'timestamp', at: '2026-11-01T11:00:00.000Z' },
  copy_inventory_digest: hash, copy_coverage_digest: otherHash,
  lower_sequence: 0, lower_hash: hash, upper_sequence: 0, upper_hash: hash,
  registry_chain_digest: hash, pinned_standby_id: 'standby-1', pinned_standby_head_hash: hash,
  seal_hash: otherHash, seal_version_id: 'seal-version-1',
  items: [
    { ...itemCommon, type: 'c0', schema: 'fleetless.journal-first-checkpoint.v1', sequence: 0, checkpoint_hash: hash },
    { ...itemCommon, type: 'registry_activation_receipt', schema: 'fleetless.registry-activation-receipt.v1', control_sequence: 0, control_hash: hash, receipt_hash: otherHash },
    { ...itemCommon, type: 'seal', schema: 'fleetless.journal-final-seal.v1', final_sequence: 0, final_hash: hash, seal_hash: otherHash },
  ],
}

function artifact(name: string) {
  const ajv = new (Ajv2020 as any)({ strict: false }); (addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))
}

describe('package 3 restore wire', () => {
  it('keeps object versions, unexpected markers and inventory errors in closed mirror arms', () => {
    const schema = (contracts as any).journalMirrorAttempt
    expect(schema).toBeDefined()
    expect((exportedSchemas as any)['journal-mirror-attempt']).toBe(schema)
    const validate = artifact('journal-mirror-attempt')
    for (const example of fixture.mirror_attempts) {
      for (const attempt of example.attempts) {
        expect(schema.safeParse(attempt).success, example.name).toBe(true)
        expect(validate(attempt), example.name).toBe(true)
      }
    }
    const marker = fixture.mirror_attempts[1].attempts[0]
    for (const invalid of [
      { ...marker, readback_sha256: 'a'.repeat(64) },
      { ...marker, delete_marker: false },
      { ...marker, failure_code: 'MISSING_VERSION' },
    ]) {
      expect(schema.safeParse(invalid).success).toBe(false)
      expect(validate(invalid)).toBe(false)
    }
  })

  it('accepts four complete signed-receipt body shapes, including a serializable failed scope', () => {
    const schema = (contracts as any).journalReplayReceiptBody
    expect(schema).toBeDefined()
    expect((exportedSchemas as any)['journal-replay-receipt-body']).toBe(schema)
    const validate = artifact('journal-replay-receipt-body')
    for (const { name, body } of fixture.receipts) {
      expect(schema.safeParse(body).success, name).toBe(true)
      expect(validate(body), name).toBe(true)
    }
  })

  it('rejects a failed receipt promoted to pass and misbound scoped evidence', () => {
    const schema = (contracts as any).journalReplayReceiptBody
    expect(schema).toBeDefined()
    const failed = structuredClone(fixture.receipts.find((value: any) => value.name === 'scope_failed_report').body)
    expect(schema.safeParse({ ...failed, verdict: 'pass' }).success).toBe(false)
    const allowed = structuredClone(fixture.receipts.find((value: any) => value.name === 'scope_allowed_pass').body)
    const proof = allowed.access_proofs[0]
    expect(schema.safeParse({ ...allowed, access_proofs: [{ ...proof, unaffected_state_ref_id: undefined }] }).success).toBe(false)
    expect(schema.safeParse({ ...allowed, access_proofs: [{ ...proof, probe_ref_ids: [] }] }).success).toBe(false)
    expect(artifact('journal-access-proof')({ ...proof, probe_ref_ids: [] })).toBe(false)
    const failedProbe = structuredClone(allowed)
    failedProbe.evidence_refs.find((ref: any) => ref.evidence_id === proof.probe_ref_ids[0]).outcome = 'failed'
    expect(schema.safeParse(failedProbe).success).toBe(false)
    const wrongOperation = '00000000-0000-4000-8000-000000000099'
    const misbound = structuredClone(allowed)
    misbound.evidence_refs.find((ref: any) => ref.evidence_id === proof.unaffected_state_ref_id).operation_id = wrongOperation
    expect(schema.safeParse(misbound).success).toBe(false)
    const globalProbe = structuredClone(allowed)
    globalProbe.evidence_refs.find((ref: any) => ref.evidence_id === globalProbe.source_isolation_ref_id).binding_scope = 'operation'
    expect(schema.safeParse(globalProbe).success).toBe(false)
    const policyDenied = structuredClone(fixture.receipts.find((value: any) => value.name === 'scope_policy_denied_pass').body)
    policyDenied.evidence_refs.find((ref: any) => ref.type === 'policy_ref').negative_export_probe_ids = ['missing-probe']
    expect(schema.safeParse(policyDenied).success).toBe(false)
  })

  it('rejects invalid global and operation EvidenceRef binding at the JSON Schema boundary', () => {
    const schema = (contracts as any).journalEvidenceRef
    expect(schema).toBeDefined()
    const validate = artifact('journal-evidence-ref')
    const allowed = fixture.receipts.find((value: any) => value.name === 'scope_allowed_pass').body
    for (const ref of allowed.evidence_refs) {
      expect(schema.safeParse(ref).success).toBe(true)
      expect(validate(ref)).toBe(true)
    }
    const global = allowed.evidence_refs.find((ref: any) => ref.binding_scope === 'global')
    const operation = allowed.evidence_refs.find((ref: any) => ref.binding_scope === 'operation')
    for (const bad of [{ ...global, operation_id: operation.operation_id }, { ...operation, operation_id: undefined }]) {
      expect(schema.safeParse(bad).success).toBe(false)
      expect(validate(bad)).toBe(false)
    }
  })

  it('preserves empty-range C0, activation receipt and seal anchors in a mixed export', () => {
    const schema = (contracts as any).journalMixedExport
    expect(schema).toBeDefined()
    expect((exportedSchemas as any)['journal-mixed-export']).toBe(schema)
    expect(schema.safeParse(emptyExport).success).toBe(true)
    expect(artifact('journal-mixed-export')(emptyExport)).toBe(true)
    const marker = fixture.mirror_attempts[1].attempts[0]
    const failed = structuredClone(emptyExport)
    failed.items[0].mirror_attempts = [marker]
    failed.items[0].mirror_verdict = 'failed'
    expect(schema.safeParse(failed).success).toBe(true)
    failed.items[0].mirror_verdict = 'complete'
    expect(schema.safeParse(failed).success).toBe(false)
    expect(artifact('journal-mixed-export')(failed)).toBe(false)
    expect(schema.safeParse({ ...emptyExport, items: [emptyExport.items[0], emptyExport.items[2]] }).success).toBe(false)
  })
})
