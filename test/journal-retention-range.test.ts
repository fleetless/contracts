// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { journalManifestBinding, journalManifestRow } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/dr1895-package-3-cloud-manifest-fixtures.json', import.meta.url), 'utf8'))
const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const hash = (n: number) => String(n).repeat(64)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function validator(name: string) {
  const ajv = new (Ajv2020 as any)({ strict: false }); (addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))
}

const samples = (over: Record<string, unknown> = {}) => ({
  type: 'retention_range', membership_kind: 'affected', table: 'datapoint_series_samples', org_id: uuid(1), robot_id: uuid(7),
  from: '2026-10-01T00:00:00.000Z', cutoff: '2026-10-02T00:00:00.000Z', row_count: 864000, rows_digest: hash(3), ...over,
})
const latency = (over: Record<string, unknown> = {}) => ({
  type: 'retention_range', membership_kind: 'affected', table: 'bridge_latency_buckets', org_id: uuid(1), robot_id: uuid(7),
  from: '2026-10-01T00:00:00.000Z', cutoff: '2026-10-02T00:00:00.000Z', row_count: 1440, rows_digest: hash(4), ...over,
})

/** The positive history.retention fixture with its rows replaced; the intent follows the kind. */
function candidate(kind: 'history.retention' | 'history.slug_delete' | 'latency.retention' | 'audit.retention', rows: unknown[]) {
  const base = clone(fixtures.positive.find((value: any) => value.intent.kind === (kind === 'history.slug_delete' ? 'history.slug_delete' : 'history.retention')))
  base.intent.kind = kind
  if (kind === 'history.slug_delete') base.intent.ids = { ...base.intent.ids, org_id: uuid(1), robot_id: uuid(7), series_id: 12 }
  base.manifest.scope = { kind: 'organization', org_id: uuid(1) }
  base.manifest.rows = rows
  base.manifest.batches[0].kind = kind
  base.manifest.batches[0].rows = rows
  return base
}
const bound = (value: any) => journalManifestBinding.safeParse({ intent: value.intent, manifest: value.manifest })

describe('retention range manifest row', () => {
  const zod = journalManifestRow
  const schema = validator('journal-manifest-row')

  it('accepts a sample range with and without a series, and a latency range', () => {
    for (const row of [samples(), samples({ series_id: 12 }), latency()]) {
      expect(zod.safeParse(row).success, JSON.stringify(row)).toBe(true)
      expect(schema(row), JSON.stringify(row)).toBe(true)
    }
  })

  it('is closed: no unknown field, no missing field, no loose digest, no empty range', () => {
    const bad = [
      samples({ extra: 1 }),
      samples({ robot_id: undefined }),
      samples({ org_id: undefined }),
      samples({ rows_digest: 'abc' }),
      samples({ rows_digest: 'A'.repeat(64) }),
      samples({ row_count: 0 }),
      samples({ row_count: 1.5 }),
      samples({ table: 'audit_events' }),
      samples({ membership_kind: 'unaffected' }),
      samples({ from: '2026-10-01T00:00:00Z' }),
      samples({ cutoff: '2026-10-02' }),
      samples({ series_id: 0 }),
    ]
    for (const row of bad) {
      expect(zod.safeParse(row).success, JSON.stringify(row)).toBe(false)
      expect(schema(row), JSON.stringify(row)).toBe(false)
    }
  })

  it('refuses a range that does not end after it starts and a per-series latency range (Zod only)', () => {
    expect(zod.safeParse(samples({ cutoff: samples().from })).success).toBe(false)
    expect(zod.safeParse(samples({ cutoff: '2026-09-30T00:00:00.000Z' })).success).toBe(false)
    expect(zod.safeParse(latency({ series_id: 3 })).success).toBe(false)
  })

  it('keeps accepting the per-row members of earlier journals', () => {
    const legacy = fixtures.positive.find((value: any) => value.intent.kind === 'history.retention')
    expect(zod.safeParse(legacy.manifest.rows[0]).success).toBe(true)
    expect(bound(legacy).success).toBe(true)
  })
})

describe('retention range binding', () => {
  it('binds a history sweep, a slug deletion and a latency sweep to their intents', () => {
    expect(bound(candidate('history.retention', [samples()])).success).toBe(true)
    expect(bound(candidate('history.retention', [samples(), samples({ robot_id: uuid(8), from: '2026-10-02T00:00:00.000Z', cutoff: '2026-10-03T00:00:00.000Z' })])).success).toBe(true)
    expect(bound(candidate('history.slug_delete', [samples({ series_id: 12, cutoff: '2026-11-03T10:00:00.000Z' })])).success).toBe(true)
    expect(bound(candidate('latency.retention', [latency(), latency({ robot_id: uuid(8) })])).success).toBe(true)
  })

  it('refuses a range under another kind, table, organization, robot, series or past the sweep cutoff', () => {
    const cutoff = (value: string) => ({ cutoff: value })
    const cases: Array<[string, any]> = [
      ['kind', candidate('audit.retention', [samples()])],
      ['table of a history sweep', candidate('history.retention', [latency()])],
      ['table of a latency sweep', candidate('latency.retention', [samples()])],
      ['organization', candidate('history.retention', [samples({ org_id: uuid(2) })])],
      ['slug robot', candidate('history.slug_delete', [samples({ series_id: 12, robot_id: uuid(8) })])],
      ['slug series', candidate('history.slug_delete', [samples({ series_id: 13 })])],
      ['slug without series', candidate('history.slug_delete', [samples()])],
      ['sweep cutoff', candidate('history.retention', [samples(cutoff('2026-11-01T00:00:00.001Z'))])],
    ]
    for (const [name, value] of cases) expect(bound(value).success, name).toBe(false)
  })

  it('refuses overlapping ranges of one robot and a robot that mixes whole and per-series ranges', () => {
    const next = { from: '2026-10-02T00:00:00.000Z', cutoff: '2026-10-03T00:00:00.000Z' }
    expect(bound(candidate('history.retention', [samples(), samples(next)])).success).toBe(true)
    expect(bound(candidate('history.retention', [samples(), samples({ from: '2026-10-01T12:00:00.000Z', cutoff: '2026-10-02T12:00:00.000Z' })])).success).toBe(false)
    expect(bound(candidate('history.retention', [samples({ series_id: 12 }), samples({ series_id: 13 })])).success).toBe(true)
    expect(bound(candidate('history.retention', [samples({ series_id: 12 }), samples({ series_id: 13, from: '2026-10-01T12:00:00.000Z' })])).success).toBe(true)
    expect(bound(candidate('history.retention', [samples({ series_id: 12 }), samples({ series_id: 12, from: '2026-10-01T12:00:00.000Z' })])).success).toBe(false)
    expect(bound(candidate('history.retention', [samples({ series_id: 12 }), samples(next)])).success).toBe(false)
  })

  it('needs the batch to hold exactly the frozen ranges, sorted and unique', () => {
    const value = candidate('history.retention', [samples()])
    value.manifest.batches[0].rows = []
    expect(bound(value).success).toBe(false)
    const duplicate = candidate('history.retention', [samples(), samples()])
    expect(bound(duplicate).success).toBe(false)
  })

  it('holds the same verdicts in the published JSON Schema where it can express them', () => {
    const schema = validator('journal-manifest-binding')
    const good = candidate('history.retention', [samples()])
    expect(schema({ intent: good.intent, manifest: good.manifest })).toBe(true)
    const extra = candidate('history.retention', [{ ...samples(), extra: 1 }])
    expect(schema({ intent: extra.intent, manifest: extra.manifest })).toBe(false)
  })
})
