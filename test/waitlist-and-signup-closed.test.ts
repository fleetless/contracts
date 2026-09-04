import { describe, it, expect } from 'vitest'
import { ERROR_CODES, waitlistRequest } from '../src/index.js'
import { exportedSchemas, schemaIo } from '../scripts/export-schemas.js'

describe('closed beta', () => {
  it('registers signup_closed as a refusal code, distinct from forbidden', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).toContain('signup_closed')
    expect(codes.indexOf('signup_closed')).not.toBe(codes.indexOf('forbidden'))
  })
  it('the waiting list takes one e-mail address and nothing else', () => {
    expect(waitlistRequest.safeParse({ email: 'ops@example.com' }).success).toBe(true)
    expect(waitlistRequest.safeParse({ email: 'not-an-address' }).success).toBe(false)
    expect(waitlistRequest.safeParse({}).success).toBe(false)
  })
  it('is exported as an input schema', () => {
    expect(exportedSchemas['waitlist-request']).toBe(waitlistRequest)
    expect(schemaIo('waitlist-request')).toBe('input')
  })
})
