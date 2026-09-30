// SPDX-License-Identifier: Apache-2.0
/**
 * **Email-code sign-in and TOTP two-factor for app users.**
 *
 * The shapes the cloud, the sdk and the hosted pages agree on: a six-digit
 * code, a recovery code, the one result every sign-in step answers, and the
 * routes that answer it. Each assertion is a denial paired with the positive,
 * because a schema that accepts the good case proves nothing about the bad
 * one sitting beside it.
 */
import { describe, expect, it } from 'vitest'
import {
  clientAcceptInvitationRequest,
  clientIdentity,
  clientProviderListResponse,
  clientRegisterRequest,
  clientSignInResult,
  clientTwoFactorSetupConfirmResponse,
  clientTwoFactorVerifyRequest,
} from '../src/client-auth.js'
import { ERROR_CODES, invalidCodeDetails } from '../src/errors.js'
import { loginCode, recoveryCode, recoveryCodesList } from '../src/identity.js'
import { ROUTES } from '../src/routes.js'

const key = (r: { method: string, path: string }) => `${r.method} ${r.path}`
const TEN = ['abcde-fghij', 'klmno-pqrst', 'uvwxy-z2345', 'aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff', 'ggggg-hhhhh', 'iiiii-jjjjj', 'kkkkk-lllll', 'mmmmm-nnnnn']

describe('app-user sign-in for #98', () => {
  it('a sign-in result is either tokens or a challenge', () => {
    expect(clientSignInResult.safeParse({ access_token: 'a', refresh_token: 'r', expires_in: 900 }).success).toBe(true)
    expect(clientSignInResult.safeParse({ status: 'two_factor_setup_required', challenge: 'c' }).success).toBe(true)
    expect(clientSignInResult.safeParse({ status: 'two_factor_required', challenge: 'c' }).success).toBe(true)
    expect(clientSignInResult.safeParse({ status: 'signed_in', challenge: 'c' }).success).toBe(false)
  })

  it('two-factor verify takes exactly one of code and recovery code', () => {
    expect(clientTwoFactorVerifyRequest.safeParse({ challenge: 'c', code: '123456' }).success).toBe(true)
    expect(clientTwoFactorVerifyRequest.safeParse({ challenge: 'c', recovery_code: 'abcde-fghij' }).success).toBe(true)
    expect(clientTwoFactorVerifyRequest.safeParse({ challenge: 'c' }).success).toBe(false)
    expect(clientTwoFactorVerifyRequest.safeParse({ challenge: 'c', code: '123456', recovery_code: 'abcde-fghij' }).success).toBe(false)
  })

  it('a login code is six digits, leading zeros included', () => {
    expect(loginCode.safeParse('012345').success).toBe(true)
    expect(loginCode.safeParse('12345').success).toBe(false)
    expect(loginCode.safeParse('12345a').success).toBe(false)
    expect(loginCode.safeParse('123 456').success).toBe(false)
  })

  it('a recovery code is typed in either case and issued in lower case, ten at a time', () => {
    expect(recoveryCode.safeParse('ABCDE-fghij').success).toBe(true)
    expect(recoveryCode.safeParse('abcde-fghi1').success).toBe(false)
    expect(recoveryCodesList.safeParse(TEN).success).toBe(true)
    expect(recoveryCodesList.safeParse(TEN.slice(1)).success).toBe(false)
    expect(recoveryCodesList.safeParse([...TEN.slice(1), 'ABCDE-FGHIJ']).success).toBe(false)
  })

  it('a confirmed setup answers the codes and a session together', () => {
    expect(clientTwoFactorSetupConfirmResponse.safeParse({
      recovery_codes: TEN, session: { access_token: 'a', refresh_token: 'r', expires_in: 900 },
    }).success).toBe(true)
  })

  it('registration and invitations take no password when the app has none', () => {
    expect(clientRegisterRequest.safeParse({ app_identifier: 'shop', email: 'a@b.co' }).success).toBe(true)
    expect(clientAcceptInvitationRequest.safeParse({ token: 't' }).success).toBe(true)
    // Still the password rule when one is sent.
    expect(clientAcceptInvitationRequest.safeParse({ token: 't', password: 'short' }).success).toBe(false)
  })

  it('knows the two new error codes, and the details of invalid_code', () => {
    expect(ERROR_CODES).toContain('invalid_code')
    expect(ERROR_CODES).toContain('method_not_allowed')
    expect(invalidCodeDetails.safeParse({ attempts_left: 4 }).success).toBe(true)
    expect(invalidCodeDetails.safeParse({ attempts_left: -1 }).success).toBe(false)
  })

  it('tells an app which methods it offers, and an app user whether they have a second factor', () => {
    expect(clientProviderListResponse.safeParse({ providers: [], sign_in_methods: { password: false, email_code: true } }).success).toBe(true)
    expect(clientProviderListResponse.safeParse({ providers: [] }).success).toBe(false)
    expect(clientIdentity.shape.two_factor_enabled).toBeDefined()
  })
})

describe('the routes that sign an app user in', () => {
  /**
   * **No path yields a session without the second factor.** Every step that
   * used to answer tokens directly answers the union now, so a caller that
   * skips the challenge branch does not typecheck. The OIDC exchange is the
   * one exception, and it is pinned as one: the provider owns that sign-in.
   */
  const SIGN_IN_STEPS = [
    'POST /api/client/login',
    'POST /api/client/login/code/verify',
    'POST /api/client/verify-email',
    'POST /api/client/password/reset/confirm',
    'POST /api/client/invitations/accept',
  ]

  it('answers the sign-in result on every step that signs somebody in, and nowhere else', () => {
    const rows = ROUTES.filter((r) => r.response === clientSignInResult).map(key).sort()
    expect(rows).toEqual([...SIGN_IN_STEPS].sort())
    expect(ROUTES.find((r) => key(r) === 'POST /api/client/oidc/exchange')?.response).not.toBe(clientSignInResult)
  })

  it('offers the code and two-factor routes, each refusing a wrong code with invalid_code', () => {
    for (const k of ['POST /api/client/login/code/verify', 'POST /api/client/two-factor/verify', 'POST /api/client/two-factor/setup/confirm', 'DELETE /api/client/two-factor']) {
      const r = ROUTES.find((x) => key(x) === k)
      expect(r, k).toBeDefined()
      expect(r!.errors, k).toContain('invalid_code')
      expect(r!.rateLimited, `${k} checks a code and is not rate limited`).toBe(true)
    }
  })

  it('answers the code request with 202 and no body, like every other decoy', () => {
    const r = ROUTES.find((x) => key(x) === 'POST /api/client/login/code')!
    expect(r.status).toBe(202)
    expect(r.response).toBeNull()
    expect(r.errors).toContain('method_not_allowed')
  })
})
