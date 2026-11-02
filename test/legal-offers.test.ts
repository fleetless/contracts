// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as contracts from '../src/index.js'
import { exportedSchemas, schemaIo, routesArtifact, openApiDocument } from '../scripts/export-schemas.js'

const id = '01234567-89ab-4cde-8fab-0123456789ab'
const at = '2026-11-02T12:00:00.000Z'
const later = '2026-12-02T12:00:00.000Z'
const terms = { version: '1.0', version_date: '2026-11-01', url: 'https://fleetless.dev/terms/v1.0/' }
const proposed = { ...terms, version: '2.0', url: 'https://fleetless.dev/terms/v2.0/' }
const proof = 'A'.repeat(43)
const price = {
  plan: 'plus', cycle: 'monthly', addons: { seats: 0, robots: 0, apps: 0, app_user_packs: 0, live_video_packs: 0 },
  current_net_cents: 2900, offered_net_cents: 3000, offered_period_start_at: later, price_start_at: later, currency: 'eur',
}
const commonSummary = { id, revision: id, decision_state: 'open', organization_name: 'Example', announced_at: at }
const summaries = [
  { ...commonSummary, kind: 'terms', current_terms: terms, proposed_terms: proposed, proposed_effective_at: later, summary: 'Changes', termination: null },
  { ...commonSummary, kind: 'price', ...price },
]
const commonSnapshot = {
  snapshot_id: id, offer_id: id, revision: id, operation_key: id, owner_id: id, organization_id: id,
  organization_name: 'Example', title: 'Synthetic title', text: 'Synthetic fixture, not customer copy.',
  accept_label: 'Accept', decline_label: 'Decline', current_terms: terms, dpa: null,
  issued_at: at, expires_at: '2026-11-02T12:10:00.000Z',
}
const snapshots = [
  { ...commonSnapshot, kind: 'terms', text_id: 'DR-1374-draft-3-H.3-terms', proposed_terms: proposed,
    proposed_effective_at: later, summary: 'Changes', read_changes_label: 'Read the changes', term_end_at: later },
  { ...commonSnapshot, kind: 'price', text_id: 'DR-1374-draft-3-H.3-price', proposed_terms: null,
    ...price, current_agreed_price_id: id, offered_price_proposal_id: id },
]
const decision = { offer_id: id, decision_id: id, decided_at: at, terms, dpa: null }
const results = [
  { ...decision, kind: 'terms', decision: 'accept', effective_at: later, price_start_at: null, termination: null },
  { ...decision, kind: 'terms', decision: 'accept', effective_at: later, price_start_at: null, termination: { state: 'withdrawn', termination_id: id, ends_at: later } },
  { ...decision, kind: 'terms', decision: 'decline', effective_at: null, price_start_at: null, termination: { state: 'scheduled', termination_id: id, ends_at: later } },
  { ...decision, kind: 'price', decision: 'accept', effective_at: null, price_start_at: later, termination: null },
  { ...decision, kind: 'price', decision: 'decline', effective_at: null, price_start_at: null, termination: null },
]
const encode = (value: string) => Buffer.from(value).toString('base64url')
const cursor = encode(JSON.stringify({ v: 1, created_at: at, id }))
const cases = [
  ['legalOfferListQuery', 'legal-offer-list-query', [{}, { limit: '100', cursor }], 'input'],
  ['legalOfferSummary', 'legal-offer-summary', summaries, 'output'],
  ['legalOfferListResponse', 'legal-offer-list-response', [{ offers: summaries, next_cursor: cursor }, { offers: [], next_cursor: null }], 'output'],
  ['legalOfferDisplayRequest', 'legal-offer-display-request', [{ operation_key: id }], 'input'],
  ['legalOfferDecisionRequest', 'legal-offer-decision-request', ['accept', 'decline'].map(decision => ({ operation_key: id, decision, confirmation_proof: proof })), 'input'],
  ['legalOfferDecisionLookupQuery', 'legal-offer-decision-lookup-query', [{ operation_key: id }], 'input'],
  ['legalOfferDecisionSnapshot', 'legal-offer-decision-snapshot', snapshots, 'output'],
  ['legalOfferDisplayResponse', 'legal-offer-display-response', snapshots.map(snapshot => ({ confirmation_proof: proof, expires_at: snapshot.expires_at, snapshot })), 'output'],
  ['legalOfferDecisionResult', 'legal-offer-decision-result', results, 'output'],
  ['legalOfferConflictDetails', 'legal-offer-conflict-details', [{ field: 'term', rule: 'term_unavailable' }], 'output'],
] as const

describe('H.3 legal offers', () => {
  it('exports every agreed strict wire shape', () => {
    for (const [name] of cases) expect(contracts).toHaveProperty(name)
  })
  for (const [name, artifact, examples, direction] of cases) {
    it(`${name} preserves valid arms and rejects unknown fields in Zod and JSON Schema`, () => {
      const schema = (contracts as any)[name]
      expect((exportedSchemas as any)[artifact]).toBe(schema)
      expect(schemaIo(artifact)).toBe(direction)
      const ajv = new (Ajv2020 as any)({ strict: false }); (addFormats as any)(ajv)
      const validate = ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${artifact}.schema.json`, import.meta.url), 'utf8')))
      for (const value of examples) {
        expect(schema.parse(value)).toEqual(value)
        expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
        for (const invalid of [{ ...value, extra: true }, { ...value, org_id: id }]) {
          expect(schema.safeParse(invalid).success).toBe(false)
          expect(validate(invalid)).toBe(false)
        }
        if (name !== 'legalOfferListQuery') for (const key of Object.keys(value)) {
          const missing: Record<string, unknown> = { ...value }; delete missing[key]
          expect(schema.safeParse(missing).success, key).toBe(false)
          expect(validate(missing), key).toBe(false)
        }
      }
    })
  }

  it('rejects cross-arm prices, Terms, DPA, termination and forged action inputs', () => {
    const result = (contracts as any).legalOfferDecisionResult
    for (const invalid of [
      { ...results[0], price_start_at: later }, { ...results[2], termination: null },
      { ...results[2], termination: { state: 'withdrawn', termination_id: id, ends_at: later } },
      { ...results[3], effective_at: later }, { ...results[4], termination: results[2].termination },
      { ...results[0], dpa: terms }, { ...results[4], decision: 'silent' },
    ]) expect(result.safeParse(invalid).success).toBe(false)
    const snapshot = (contracts as any).legalOfferDecisionSnapshot
    for (const invalid of [
      { ...snapshots[0], ...price }, { ...snapshots[1], term_end_at: later },
      { ...snapshots[1], proposed_terms: proposed }, { ...snapshots[0], term_end_at: null },
      { ...snapshots[0], text_id: 'DR-1374-draft-3-H.3-price' },
      { ...snapshots[1], current_net_cents: -1 }, { ...snapshots[1], offered_net_cents: 0.1 },
      { ...snapshots[1], addons: { ...price.addons, unknown: 1 } },
      { ...snapshots[0], dpa: terms },
    ]) expect(snapshot.safeParse(invalid).success).toBe(false)
    for (const key of ['price', 'terms', 'owner_id', 'organization_id', 'effective_at', 'text']) {
      expect((contracts as any).legalOfferDecisionRequest.safeParse({ operation_key: id, decision: 'accept', confirmation_proof: proof, [key]: id }).success).toBe(false)
    }
  })

  it('validates string limits and exact canonical cursor payloads without coercion', () => {
    const schema = (contracts as any).legalOfferListQuery
    for (const limit of ['0', '01', '001', '+1', '1.0', '101', ' 1', 1, ['1']]) expect(schema.safeParse({ limit }).success).toBe(false)
    for (const bad of ['', cursor + '=', '+/8', 'A', encode('{}'), encode(JSON.stringify({ id, created_at: at, v: 1 })),
      encode(JSON.stringify({ v: 2, created_at: at, id })), encode(JSON.stringify({ v: 1, created_at: at, id, extra: 1 })),
      encode(JSON.stringify({ v: 1, created_at: 'invalid', id })), encode('{"v":1,"v":1,"created_at":"' + at + '","id":"' + id + '"}')]) {
      expect(schema.safeParse({ cursor: bad }).success, bad).toBe(false)
    }
  })

  it('binds display expiry to a positive lifetime of at most ten minutes', () => {
    const schema = (contracts as any).legalOfferDisplayResponse
    for (const expires_at of [at, '2026-11-02T11:59:59Z', '2026-11-02T12:10:00.001Z']) {
      expect(schema.safeParse({ confirmation_proof: proof, expires_at, snapshot: { ...snapshots[0], expires_at } }).success).toBe(false)
    }
    expect(schema.safeParse({ confirmation_proof: proof, expires_at: at, snapshot: snapshots[0] }).success).toBe(false)
  })

  it('registers four authenticated routes, strict schemas and the unavailable error', () => {
    const prefix = '/api/org/legal/offers'
    for (const [method, path, ownerTier, request, query, response] of [
      ['GET', prefix, false, null, 'legal-offer-list-query', 'legal-offer-list-response'],
      ['POST', prefix + '/:id/display', true, 'legal-offer-display-request', null, 'legal-offer-display-response'],
      ['POST', prefix + '/:id/decisions', true, 'legal-offer-decision-request', null, 'legal-offer-decision-result'],
      ['GET', prefix + '/:id/decisions', true, null, 'legal-offer-decision-lookup-query', 'legal-offer-decision-result'],
    ] as const) {
      const route = routesArtifact().routes.find(r => r.method === method && r.path === path)
      expect(route).toMatchObject({ auth: 'developer', audience: 'developer', status: 200, ownerTier, request, query, response })
      expect(route?.notes).toContain('no-store')
      expect(route?.errors).toContain('legal_offer_unavailable')
      if (ownerTier) expect(route?.errors).toEqual(expect.arrayContaining(['tier_required', 'support_forbidden', 'not_found']))
      const op = (openApiDocument().paths as any)[path.replace(':id', '{id}')][method.toLowerCase()]
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/' + response)
    }
    expect(contracts.ERROR_CODES).toContain('legal_offer_unavailable')
  })

  it('keeps offer acceptance history DPA-free in the generated schema too', () => {
    const ajv = new (Ajv2020 as any)({ strict: false }); (addFormats as any)(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(new URL('../artifacts/schema/legal-acceptance-version-row.schema.json', import.meta.url), 'utf8')))
    for (const context of ['amendment', 'price_offer']) {
      const row = { id, context, accepted_at: '2026-11-02T12:00:00.000000Z', text_id: 'synthetic', terms, dpa: null }
      expect(validate(row)).toBe(true)
      expect(validate({ ...row, dpa: terms })).toBe(false)
      expect(validate({ ...row, context: 'decline' })).toBe(false)
    }
  })
})
