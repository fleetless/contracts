// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { auditQuery, auditListResponse, AUDIT_CSV_COLUMNS, AUDIT_RETENTION_DAYS } from '../src/audit.js'
import { historyQuery } from '../src/rest.js'
import type { AuditQuery } from '../src/index.js'

const UUID = '00000000-0000-4000-8000-000000000000'
const NOW = '2026-08-19T12:00:00.000Z'

describe('a limit a query string can actually carry', () => {
  const lim = (v: unknown) => historyQuery.safeParse({ from: 'now-1h', limit: v })

  it('accepts the wire form and the programmatic form, and yields a number either way', () => {
    const s = lim('25'), n = lim(25)
    expect(s.success && s.data.limit).toBe(25)
    expect(n.success && n.data.limit).toBe(25)
  })

  it('refuses what a coercion silently swallowed', () => {
    // `z.coerce.number()` machte aus '' eine 0 und aus true eine 1 — beides
    // Eingaben, die niemand gemeint hat. Die Union hat keinen Zweig dafuer.
    for (const bad of ['', 'abc', '12abc', true, null, {}, '-5', '1.5']) {
      expect(lim(bad).success).toBe(false)
    }
  })

  it('still bounds the value', () => {
    expect(lim('0').success).toBe(false)
    expect(lim('10001').success).toBe(false)
    expect(lim('10000').success).toBe(true)
  })
})

describe('the audit log can be paged and filtered', () => {
  it('takes a cursor and a limit from a query string', () => {
    const q = auditQuery.safeParse({ before_seq: '4711', limit: '50' })
    expect(q.success && q.data.before_seq).toBe(4711)
    expect(q.success && q.data.limit).toBe(50)
  })

  it('refuses a cursor JavaScript cannot represent, rather than handing Postgres an out-of-range bigint', () => {
    // The regex admits 19 digits and `Number()` renders those as 1e19, which
    // `Number.isInteger` calls an integer. What refuses it is `.int()` bounding
    // the SAFE-integer range — pinned here because that is not obvious from
    // reading `.int().positive()`, and loosening it would be a silent 500.
    expect(auditQuery.safeParse({ before_seq: '9999999999999999999' }).success).toBe(false)
    expect(auditQuery.safeParse({ before_seq: String(Number.MAX_SAFE_INTEGER) }).success).toBe(true)
  })

  it('is `.strict()`, so a typo in a filter name is refused rather than ignored', () => {
    // A silently ignored filter is worse than a refused one: the caller sees a
    // list and believes it was filtered.
    expect(auditQuery.safeParse({ action: 'config.published' }).success).toBe(true)
    expect(auditQuery.safeParse({ action: 'config.published', actin: 'x' }).success).toBe(false)
  })

  it('carries every filter the row names', () => {
    const full: AuditQuery = auditQuery.parse({
      before_seq: 9, limit: 10, action: 'config.published',
      actor_id: UUID, target_kind: 'robot', from_ms: 0, to_ms: 1,
    })
    expect(Object.keys(full).sort()).toEqual(
      ['action', 'actor_id', 'before_seq', 'from_ms', 'limit', 'target_kind', 'to_ms'],
    )
  })

  it('bounds the page so nobody can ask for the whole log through the new door', () => {
    expect(auditQuery.safeParse({ limit: '500' }).success).toBe(true)
    expect(auditQuery.safeParse({ limit: '501' }).success).toBe(false)
  })

  it('says "no more pages" as a promise, not as a short array', () => {
    const page = { events: [], next_cursor: null }
    expect(auditListResponse.safeParse(page).success).toBe(true)
    expect(auditListResponse.safeParse({ events: [] }).success).toBe(false)
    expect(auditListResponse.safeParse({ events: [], next_cursor: 0 }).success).toBe(false)
  })
})

describe('one CSV column order, in one place', () => {
  it('names every field a reader needs to reconstruct the event', () => {
    expect(AUDIT_CSV_COLUMNS).toEqual(
      ['seq', 'at', 'actor_kind', 'actor_id', 'action', 'target_kind', 'target_id', 'target_label', 'details'],
    )
  })

  it('starts with `seq`, because that is the order the log has', () => {
    expect(AUDIT_CSV_COLUMNS[0]).toBe('seq')
  })
})

describe('the retention window is one number, readable from both sides', () => {
  it('is 90 days', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90)
  })

  it('reaches the artifact, which is the only channel a non-TypeScript consumer has', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/constants.json', import.meta.url), 'utf8'))
    expect(artifact.AUDIT_RETENTION_DAYS).toBe(AUDIT_RETENTION_DAYS)
  })
})

describe('the barrel exports the values AND the types', () => {
  it('compiles a value of the new type, taken from the barrel', () => {
    const q: AuditQuery = { before_seq: 1, limit: 2 }
    expect(q.before_seq).toBe(1)
    expect(NOW).toBeTruthy()
  })
})
