// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { ERROR_CODES, IN_HANDLER_ROUTES, ROUTES, waitlistRequest } from '../src/index.js'
import { exportedSchemas, schemaIo } from '../scripts/export-schemas.js'

describe('closed beta', () => {
  it('declares one anonymous, rate-limited waiting-list landing outside the admin API', () => {
    const landings = ROUTES.filter((r) => r.path.includes('waitlist-invite'))
    expect(landings).toHaveLength(1)
    expect(landings[0]).toMatchObject({
      method: 'GET', path: '/waitlist-invite/:token', section: 'developer-auth',
      audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false,
      status: 303, transport: 'http', errors: ['rate_limited'],
      query: null, request: null, response: null,
      params: [{ name: 'token', description: expect.stringMatching(/opaque/i) }],
    })
    expect(IN_HANDLER_ROUTES).not.toContain('GET /waitlist-invite/:token')
    expect(ERROR_CODES).toContain('rate_limited')
  })

  it('keeps team invitation acceptance separate from new-organization signup', () => {
    const team = ROUTES.filter((r) => r.path === '/accept-invite/:token')
    expect(team).toHaveLength(1)
    expect(team[0]).toMatchObject({
      method: 'GET', section: 'users', audience: 'internal', auth: 'none',
      rateLimited: false, ownerTier: false, status: 200, transport: 'http',
      query: null, request: null, response: null, errors: [],
      params: [{ name: 'token', description: expect.any(String) }],
    })
  })

  it('preserves the signup steps and their existing auth and rate-limit guards', () => {
    const signup = ROUTES.filter((r) => r.path.startsWith('/console/oauth/signup'))
    expect(signup.map((r) => [r.method, r.path, r.rateLimited])).toEqual([
      ['GET', '/console/oauth/signup/:id', false],
      ['POST', '/console/oauth/signup', true],
      ['POST', '/console/oauth/signup/code', true],
      ['POST', '/console/oauth/signup/organization', true],
    ])
    for (const route of signup) {
      expect(route).toMatchObject({
        section: 'developer-auth', audience: 'internal', auth: 'none',
        ownerTier: false, status: 200, transport: 'http', query: null, request: null,
      })
      if (route.method === 'POST') expect(route.errors).toContain('signup_closed')
    }
  })

  it('registers signup_closed as a refusal code, distinct from forbidden', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).toContain('signup_closed')
    expect(codes).toContain('forbidden')
  })
  it('the waiting list takes an e-mail address and requires it', () => {
    expect(waitlistRequest.safeParse({ email: 'ops@example.com' }).success).toBe(true)
    expect(waitlistRequest.safeParse({ email: 'not-an-address' }).success).toBe(false)
    expect(waitlistRequest.safeParse({}).success).toBe(false)
  })
  it('bounds the address at 254 characters, the RFC 5321 path limit', () => {
    // A long local part is the only way to stay valid at these lengths —
    // domain fixed, totals exact.
    const address = (total: number) => `${'a'.repeat(total - '@example.com'.length)}@example.com`
    expect(address(254)).toHaveLength(254)
    expect(address(300)).toHaveLength(300)
    expect(waitlistRequest.safeParse({ email: address(254) }).success).toBe(true)
    expect(waitlistRequest.safeParse({ email: address(300) }).success).toBe(false)
  })
  it('is exported as an input schema', () => {
    expect(exportedSchemas['waitlist-request']).toBe(waitlistRequest)
    expect(schemaIo('waitlist-request')).toBe('input')
  })
})
