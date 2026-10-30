// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../src/routes.js'

const valid = {
  legalName: 'Dehne Customer GmbH',
  address: { line1: 'Main Street 1', line2: null, postalCode: '10115', city: 'Berlin', country: 'DE' },
  privacyContact: { name: 'Privacy Desk', email: 'privacy@example.com', role: 'general' },
  euRepresentative: null,
  confirmationSource: 'Customer confirmation 2026-10-30',
}

describe('organization controller register contract', () => {
  const route = (method: string) => ROUTES.find(r => r.method === method && r.path === '/api/org/controller-register')

  it('gates both own-organization routes on developer owner authentication', () => {
    for (const method of ['GET', 'PUT']) {
      expect(route(method)).toMatchObject({ section: 'org', audience: 'developer', auth: 'developer', ownerTier: true, status: 200,
        params: [], query: null, transport: 'http' })
      expect(route(method)?.errors).toContain('tier_required')
    }
  })

  it('accepts confirmed details and explicit clearing of optional contacts', () => {
    const request = route('PUT')?.request
    expect(request?.safeParse(valid).success).toBe(true)
    expect(request?.safeParse({ ...valid, address: { line1: 'Main Street 1', postalCode: '10115', city: 'Berlin', country: 'DE' } }).success).toBe(true)
    expect(request?.safeParse({ ...valid, privacyContact: null, euRepresentative: null }).success).toBe(true)
    expect(request?.safeParse({ ...valid, privacyContact: { ...valid.privacyContact, role: 'appointed_dpo' } }).success).toBe(true)
  })

  it('normalizes owner write payload before persistence', () => {
    const request = route('PUT')?.request
    expect(request?.parse({
      ...valid,
      legalName: '  Dehne Customer GmbH  ',
      address: { ...valid.address, country: ' DE ' },
      privacyContact: { ...valid.privacyContact, email: ' privacy@example.com ' },
      euRepresentative: { name: ' EU Rep ', email: ' rep@example.com ', address: ' Avenue 1 ' },
      confirmationSource: ' Customer confirmation 2026-10-30 ',
    })).toEqual({
      ...valid,
      address: { ...valid.address, country: 'DE' },
      euRepresentative: { name: 'EU Rep', email: 'rep@example.com', address: 'Avenue 1' },
    })
  })

  it('rejects unconfirmed, malformed and cross-organization input', () => {
    const request = route('PUT')?.request
    for (const input of [
      { ...valid, orgId: 'another-org' },
      { ...valid, legalName: '  ' },
      { ...valid, legalName: 'Bad\nName' },
      { ...valid, legalName: 'Bad\n' },
      { ...valid, address: { ...valid.address, country: 'Germany' } },
      { ...valid, address: { ...valid.address, postalCode: '' } },
      { ...valid, privacyContact: { ...valid.privacyContact, email: 'not-an-email' } },
      { ...valid, confirmationSource: '' },
    ]) expect(request?.safeParse(input).success).toBe(false)
  })

  it('returns only the source record and its provenance', () => {
    const response = route('GET')?.response
    expect(response?.safeParse({ orgId: '6a22cf9d-3e9b-4075-bde4-3af69157ece8', details: null }).success).toBe(true)
    expect(response?.safeParse({ orgId: '6a22cf9d-3e9b-4075-bde4-3af69157ece8', details: {
      ...valid, updatedAt: '2026-10-30T12:00:00.000Z', updatedByKind: 'owner',
      updatedById: '4e11468e-a209-45ab-b340-c5c638c96015',
    } }).success).toBe(true)
    expect(response?.safeParse({ orgId: '6a22cf9d-3e9b-4075-bde4-3af69157ece8', details: null, billing: {} }).success).toBe(false)
  })
})
