// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as contracts from '../src/index.js'
import { exportedSchemas, openApiDocument, routesArtifact, schemaIo } from '../scripts/export-schemas.js'

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

describe('published Owner legal acceptance list', () => {
  const load = (name: string) => JSON.parse(readFileSync(
    new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8',
  )) as { properties: Record<string, any>; required: string[] }

  it('registers the authenticated Owner-only route and its support refusal', () => {
    const route = contracts.ROUTES.find(r => r.method === 'GET' && r.path === '/api/org/legal/acceptances')
    expect(route).toMatchObject({
      method: 'GET', path: '/api/org/legal/acceptances', section: 'org',
      audience: 'developer', auth: 'developer', ownerTier: true, rateLimited: false,
      status: 200, params: [], request: null, transport: 'http',
    })
    expect(route?.query).toBe(contracts.legalAcceptanceListQuery)
    expect(route?.response).toBe(contracts.legalAcceptanceListResponse)
    expect(route?.errors).toContain('tier_required')
    expect(route?.errors).toContain('support_forbidden')
    expect(route?.errors).toContain('validation_error')
  })

  it('names all three schemas with the correct wire direction', () => {
    expect(exportedSchemas['legal-acceptance-list-query']).toBe(contracts.legalAcceptanceListQuery)
    expect(exportedSchemas['legal-acceptance-version-row']).toBe(contracts.legalAcceptanceVersionRow)
    expect(exportedSchemas['legal-acceptance-list-response']).toBe(contracts.legalAcceptanceListResponse)
    expect(schemaIo('legal-acceptance-list-query')).toBe('input')
    expect(schemaIo('legal-acceptance-version-row')).toBe('output')
    expect(schemaIo('legal-acceptance-list-response')).toBe('output')
  })

  it('publishes the route and its Owner and cursor contract in routes and OpenAPI', () => {
    const route = routesArtifact().routes.find(r => r.method === 'GET' && r.path === '/api/org/legal/acceptances')
    expect(route).toMatchObject({
      ownerTier: true, query: 'legal-acceptance-list-query', response: 'legal-acceptance-list-response',
      errors: expect.arrayContaining(['tier_required', 'support_forbidden', 'validation_error']),
      notes: expect.stringContaining('Owner'),
    })
    const openapi = openApiDocument()
    const path = openapi.paths['/api/org/legal/acceptances']
    expect(path).toMatchObject({ get: {
      security: [{ developerSession: [] }],
      parameters: [{ name: 'limit', in: 'query' }, { name: 'cursor', in: 'query' }],
      description: expect.stringContaining('Owner'),
      responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/legal-acceptance-list-response' } } } } },
    } })
    expect(openapi.components.schemas).toHaveProperty('legal-acceptance-list-response')
  })

  it('emits strict row, query, and nullable response JSON Schemas', () => {
    const rowSchema = load('legal-acceptance-version-row')
    expect(rowSchema.required).toEqual(['id', 'context', 'accepted_at', 'text_id', 'terms', 'dpa'])
    expect(rowSchema.properties.context.enum).toEqual(['registration', 'invitation', 'order', 'existing_org'])
    const datePattern = new RegExp(rowSchema.properties.accepted_at.pattern)
    expect(datePattern.test('2026-10-31T07:31:48.123456Z')).toBe(true)
    expect(datePattern.test('2026-10-31T07:31:48.123Z')).toBe(false)
    const urlPattern = new RegExp(rowSchema.properties.terms.properties.url.pattern)
    expect(urlPattern.test('https://fleetless.dev/terms/v1.0/')).toBe(true)
    expect(urlPattern.test('http://fleetless.dev/terms/v1.0/')).toBe(false)
    const textPattern = new RegExp(rowSchema.properties.text_id.pattern)
    expect(textPattern.test('A:1.0')).toBe(true)
    expect(textPattern.test('   ')).toBe(false)
    const querySchema = load('legal-acceptance-list-query')
    expect(querySchema.properties.limit.anyOf.map((arm: { type: string }) => arm.type)).toEqual(['string', 'integer'])
    const limitPattern = new RegExp(querySchema.properties.limit.anyOf[0].pattern)
    expect(limitPattern.test('001')).toBe(true)
    expect(limitPattern.test('100')).toBe(true)
    expect(limitPattern.test('101')).toBe(false)
    expect(querySchema.properties.limit.anyOf[1]).toMatchObject({ minimum: 1, maximum: 100 })
    expect(querySchema.properties.cursor).toMatchObject({ minLength: 1, maxLength: 512 })
    const responseSchema = load('legal-acceptance-list-response')
    expect(responseSchema.required).toEqual(['acceptances', 'next_cursor'])
    expect(responseSchema.properties.next_cursor.anyOf).toEqual(expect.arrayContaining([{ type: 'null' }]))
  })
})
