// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as contracts from '../src/index.js'

const terms = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/terms/v1.0/' }
const dpa = { version: '2.0', version_date: '2027-02-01', url: 'https://fleetless.dev/dpa/v2.0/' }
const row = {
  id: '01234567-89ab-4cde-8fab-0123456789ab',
  context: 'registration',
  accepted_at: '2026-10-31T07:31:48.123456Z',
  text_id: 'A:1.0',
  terms,
  dpa: null,
}

describe('Owner legal acceptance list contract', () => {
  it('exports the three public schemas', () => {
    expect(contracts).toHaveProperty('legalAcceptanceListQuery')
    expect(contracts).toHaveProperty('legalAcceptanceVersionRow')
    expect(contracts).toHaveProperty('legalAcceptanceListResponse')
  })

  it('accepts the four evidence contexts and independent legal references', () => {
    for (const context of ['registration', 'invitation', 'order', 'existing_org']) {
      expect(contracts.legalAcceptanceVersionRow.safeParse({ ...row, context, dpa }).success, context).toBe(true)
    }
    expect(contracts.legalAcceptanceVersionRow.safeParse(row).success).toBe(true)
    expect(contracts.legalAcceptanceVersionRow.safeParse({ ...row, context: 'renewal' }).success).toBe(false)
  })

  it('requires an exact six-digit UTC acceptance instant and a complete row', () => {
    for (const accepted_at of [
      '2026-10-31T07:31:48.123Z',
      '2026-10-31T07:31:48.1234567Z',
      '2026-10-31T09:31:48.123456+02:00',
      '2026-02-30T07:31:48.123456Z',
    ]) expect(contracts.legalAcceptanceVersionRow.safeParse({ ...row, accepted_at }).success, accepted_at).toBe(false)
    for (const invalid of [
      { ...row, id: 'not-a-uuid' },
      { ...row, terms: undefined },
      { ...row, dpa: undefined },
      { ...row, text_id: '   ' },
      { ...row, text_id: 'x'.repeat(81) },
      { ...row, extra: true },
      { ...row, terms: { ...terms, url: 'http://fleetless.dev/terms/v1.0/' } },
      { ...row, dpa: { ...dpa, url: 'https://user:pass@fleetless.dev/dpa/v2.0/' } },
    ]) expect(contracts.legalAcceptanceVersionRow.safeParse(invalid).success).toBe(false)
  })

  it('accepts only bounded numeric limits and base64url cursor syntax', () => {
    const q = contracts.legalAcceptanceListQuery
    expect(q.parse({})).toEqual({})
    for (const limit of ['1', 1, '100', 100]) expect(q.parse({ limit }).limit).toBe(Number(limit))
    expect(q.parse({ cursor: 'Abc_123-' })).toEqual({ cursor: 'Abc_123-' })
    for (const limit of ['0', 0, '101', 101, '-1', '1.5', 1.5, ' 1', '1 ', ['1', '2'], 'x']) {
      expect(q.safeParse({ limit }).success, String(limit)).toBe(false)
    }
    for (const cursor of ['', 'ab==', 'a/b', 'a+b', 'x'.repeat(513)]) {
      expect(q.safeParse({ cursor }).success, cursor).toBe(false)
    }
    expect(q.safeParse({ org_id: row.id }).success).toBe(false)
  })

  it('requires a nullable next cursor and valid version rows', () => {
    const response = contracts.legalAcceptanceListResponse
    expect(response.safeParse({ acceptances: [], next_cursor: null }).success).toBe(true)
    expect(response.safeParse({ acceptances: [row], next_cursor: 'Abc_123-' }).success).toBe(true)
    expect(response.safeParse({ acceptances: [row] }).success).toBe(false)
    expect(response.safeParse({ acceptances: [row], next_cursor: 'ab==' }).success).toBe(false)
    expect(response.safeParse({ acceptances: [{ ...row, terms: undefined }], next_cursor: null }).success).toBe(false)
    expect(response.safeParse({ acceptances: [], next_cursor: null, actor_email: 'person@example.com' }).success).toBe(false)
  })
})
