// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { OPERATOR_ROLES, CONFIRMATION_LEVELS, operatorAssertionClaims, OPERATOR_ASSERTION_ISSUER } from '../src/index.js'

const valid = { iss: OPERATOR_ASSERTION_ISSUER, aud: 'fleetless-cloud-admin', sub: 'ak-123', name: 'Test Operator', email: 'op@example.com', roles: ['operator-admin'], iat: 1_800_000_000, exp: 1_800_000_060, jti: 'a'.repeat(16) }

describe('operator vocabulary (§5.4, §5.6, §6; fleetless/fleetless#268)', () => {
  it('names exactly three roles and three confirmation levels', () => {
    expect([...OPERATOR_ROLES]).toEqual(['operator-admin', 'operator-finance', 'operator-support'])
    expect([...CONFIRMATION_LEVELS]).toEqual(['click', 'second_click', 'type_to_confirm'])
  })
  it('accepts a well-formed assertion claim set', () => {
    expect(operatorAssertionClaims.parse(valid)).toEqual(valid)
  })
  it.each([
    ['an unknown role', { roles: ['operator-root'] }],
    ['another issuer', { iss: 'someone-else' }],
    ['a short jti', { jti: 'short' }],
    ['no email', { email: 'not-an-address' }],
    ['an empty audience', { aud: '' }],
  ])('refuses %s', (_label, patch) => {
    expect(operatorAssertionClaims.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})
