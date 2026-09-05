/**
 * Invitations, tiers and account recovery — plus the rate limit that has to
 * exist before any of them face the internet.
 *
 * **Reduced by the 2026-08-29 identity redesign (D1/D6).** The two invitation
 * families and the self-registration policy this file was largely about are
 * gone with the two identity spaces; what survives here is what was never a
 * statement about which space a person lived in. The new shapes' behavioural
 * pins live in `identity-shapes.test.ts`.
 *
 * Written **with** the delta, because additions are not self-policing: a
 * change to an existing shape breaks the tests that cover it, and a new shape
 * breaks nothing. Even written alongside the delta, the last file of this
 * kind needed four corrections within an hour, every one of them a field
 * whose *absence* meant something nobody had written down. So the tests below
 * are mostly about absence, defaults, and the two shapes that must never be
 * confused.
 */
import { describe, it, expect } from 'vitest'
import {
  mailStatus,
  teamInvite,
  tierRequiredDetails,
  passwordChangeRequest,
  passwordResetRequest,
  passwordResetConfirm,
} from '../src/identity.js'
import { rateLimitDetails } from '../src/rest.js'
import { ERROR_CODES } from '../src/errors.js'

const UUID = '7e2b1a4c-3d5f-4a6b-8c9d-0e1f2a3b4c5d'
const LATER = '2026-09-01T10:00:00.000Z'
const GOOD_PASSWORD = 'correct-horse-battery'

describe('error codes', () => {
  it('registers every code this area introduced', () => {
    for (const code of ['rate_limited', 'tier_required', 'token_spent']) {
      expect(ERROR_CODES).toContain(code)
    }
  })

  it('keeps a tier refusal apart from a missing grant', () => {
    // Same answer today for "ask an owner" and "you have the wrong id", and
    // only one of those is worth acting on.
    expect(ERROR_CODES).toContain('forbidden')
    expect(ERROR_CODES.indexOf('tier_required')).not.toBe(ERROR_CODES.indexOf('forbidden'))
  })
})

describe('the limit', () => {
  it('tells the caller when to come back, and nothing about the defence', () => {
    // A refusal that says "too many" without saying "in 800 ms" produces a
    // client that retries immediately — which is the behaviour the limit
    // exists to stop, so the omission would make the refusal part of the
    // attack.
    const d = rateLimitDetails.parse({ retry_after_ms: 800 })
    expect(d.retry_after_ms).toBe(800)
    expect(rateLimitDetails.safeParse({}).success).toBe(false)
    // Zero is legitimate — "try now" — and must not be confused with absent.
    expect(rateLimitDetails.safeParse({ retry_after_ms: 0 }).success).toBe(true)
    expect(rateLimitDetails.safeParse({ retry_after_ms: -1 }).success).toBe(false)
  })

  it('does not describe the limit to whoever is probing it', () => {
    // No window, no remaining count, no ceiling: none of them changes what an
    // honest caller does, and all of them help a dishonest one.
    const parsed = rateLimitDetails.parse({ retry_after_ms: 100, limit: 5, remaining: 0 } as never)
    expect(Object.keys(parsed)).toEqual(['retry_after_ms'])
  })
})

describe('mail, in three words instead of one', () => {
  it('separates "we have no mail server" from "the mail server refused"', () => {
    // `mail_sent: boolean` forced the console to pick a sentence for a cause
    // it could not know, and it picked the reassuring one — so a bounced
    // invitation read like a link-only invitation, which is a normal outcome.
    for (const v of ['sent', 'not_configured', 'failed']) {
      expect(mailStatus.safeParse(v).success).toBe(true)
    }
    expect(mailStatus.safeParse(true).success).toBe(false)
    expect(mailStatus.safeParse('unknown').success).toBe(false)
  })

  it('has removed the boolean rather than leaving both', () => {
    const inv = {
      id: UUID, email: 'dev@example.com', tier: 'developer' as const,
      expires_at: LATER, accept_url: 'https://console.example/accept?t=x', mail: 'sent',
    }
    expect(teamInvite.parse(inv).mail).toBe('sent')
    const { mail: _dropped, ...withBooleanInstead } = inv
    expect(teamInvite.safeParse({ ...withBooleanInstead, mail_sent: true }).success).toBe(false)
  })

  it('lets an invitation be complete with no mail server at all', () => {
    // The link is the primary path. An org with no SMTP still invites.
    expect(teamInvite.parse({
      id: UUID, email: 'dev@example.com', tier: 'developer',
      expires_at: LATER, accept_url: 'https://console.example/accept?t=x',
      mail: 'not_configured',
    }).mail).toBe('not_configured')
  })
})

/*
 * **`two invitations that must never be confused` and `self-registration
 * belongs to an app, not an org` were deleted here on 2026-08-29 (D1/D6), not
 * quietly dropped.**
 *
 * The first pinned that the developer and end-user invitation shapes rejected
 * each other's payloads, because a credential from one identity space must
 * never authenticate the other. There is one space now, and one
 * `createUserInviteRequest`; the property it guarded cannot be stated any
 * more, and a test kept alive against a merged model would have been asserting
 * a distinction the platform had stopped making.
 *
 * The second pinned `selfRegistration`'s four controls — the empty-domain-list
 * reading in particular. That policy dies with no successor; its reasoning is
 * carried forward, in words, at the deletion tombstone in `src/identity.ts`,
 * because JIT provisioning (D3) inherits every one of its rules.
 */

describe('tiers', () => {
  it('names the tier required and the one held, and nothing about the target', () => {
    // The rule stays intact through the owner/member -> owner/developer
    // rename: this says nothing about whether the target exists. It says what
    // the caller could already read off the documentation.
    const d = tierRequiredDetails.parse({ required: 'owner', actual: 'developer' })
    expect([d.required, d.actual]).toEqual(['owner', 'developer'])
    expect(tierRequiredDetails.safeParse({ required: 'owner' }).success).toBe(false)
    expect(tierRequiredDetails.safeParse({ required: 'admin', actual: 'developer' }).success).toBe(false)
    // The pre-redesign name is not an alias.
    expect(tierRequiredDetails.safeParse({ required: 'owner', actual: 'member' }).success).toBe(false)
  })
})

describe('recovering an account', () => {
  it('makes a password change prove the current password, not just the session', () => {
    // What stops a stolen SESSION from becoming a stolen ACCOUNT.
    expect(passwordChangeRequest.safeParse({
      current_password: 'whatever-they-had', new_password: GOOD_PASSWORD,
    }).success).toBe(true)
    expect(passwordChangeRequest.safeParse({ new_password: GOOD_PASSWORD }).success).toBe(false)
    // The new one obeys the shared rule; the current one is whatever it is,
    // including something that predates the rule.
    expect(passwordChangeRequest.safeParse({ current_password: 'x', new_password: 'short' }).success).toBe(false)
  })

  it('asks for a reset with an address and nothing else', () => {
    // Anything more would be another thing an unauthenticated caller can probe.
    expect(passwordResetRequest.safeParse({ email: 'dev@example.com' }).success).toBe(true)
    expect(passwordResetRequest.safeParse({ email: 'not-an-address' }).success).toBe(false)
    expect(Object.keys(passwordResetRequest.parse({ email: 'dev@example.com' }))).toEqual(['email'])
  })

  it('confirms a reset with the token and the new password', () => {
    expect(passwordResetConfirm.safeParse({ token: 't', new_password: GOOD_PASSWORD }).success).toBe(true)
    expect(passwordResetConfirm.safeParse({ token: '', new_password: GOOD_PASSWORD }).success).toBe(false)
    expect(passwordResetConfirm.safeParse({ token: 't', new_password: 'short' }).success).toBe(false)
  })
})
