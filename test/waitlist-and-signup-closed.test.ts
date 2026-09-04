import { describe, it, expect } from 'vitest'
import { ERROR_CODES, waitlistRequest } from '../src/index.js'
import { exportedSchemas, schemaIo } from '../scripts/export-schemas.js'

describe('closed beta', () => {
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
    // A long local part is the only way to reach these lengths with a valid
    // address; the domain is fixed so the totals are exact.
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
