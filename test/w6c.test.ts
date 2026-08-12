/**
 * W6c — identity, and the limit that has to exist before it.
 *
 * Written **with** the delta. W6a shipped four new shapes with no contract
 * tests at all, because a change to an existing shape breaks the tests that
 * cover it while a new shape breaks nothing — additions are not self-policing.
 * W6b wrote its file alongside the delta and still needed four corrections
 * found by teammates within an hour, every one of them a field whose *absence*
 * meant something nobody had written down. So the tests below are mostly about
 * absence, defaults, and the two shapes that must never be confused.
 */
import { describe, it, expect } from 'vitest'
import {
  mailStatus,
  invitation,
  developerInvitation,
  createDeveloperInvitationRequest,
  acceptDeveloperInvitationRequest,
  createInvitationRequest,
  tierRequiredDetails,
  selfRegistration,
  clientRegisterRequest,
  passwordChangeRequest,
  passwordResetRequest,
  passwordResetConfirm,
  orgMemberRole,
} from '../src/identity.js'
import { rateLimitDetails } from '../src/rest.js'
import { ERROR_CODES } from '../src/errors.js'

const UUID = '7e2b1a4c-3d5f-4a6b-8c9d-0e1f2a3b4c5d'
const LATER = '2026-09-01T10:00:00.000Z'
const GOOD_PASSWORD = 'correct-horse-battery'

describe('W6c error codes', () => {
  it('registers every code the wave introduced', () => {
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

describe('W6c — the limit', () => {
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

describe('W6c — mail, in three words instead of one', () => {
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
      id: UUID, email: 'dev@example.com', app_id: UUID, role_id: UUID,
      expires_at: LATER, accept_url: 'https://console.example/accept?t=x', mail: 'sent',
    }
    expect(invitation.parse(inv).mail).toBe('sent')
    const { mail: _dropped, ...withBooleanInstead } = inv
    expect(invitation.safeParse({ ...withBooleanInstead, mail_sent: true }).success).toBe(false)
  })

  it('lets an invitation be complete with no mail server at all', () => {
    // §3.2: the link is the primary path. An org with no SMTP still invites.
    expect(invitation.parse({
      id: UUID, email: 'dev@example.com', app_id: UUID, role_id: UUID,
      expires_at: LATER, accept_url: 'https://console.example/accept?t=x',
      mail: 'not_configured',
    }).mail).toBe('not_configured')
  })
})

describe('W6c — two invitations that must never be confused', () => {
  it('keeps the developer and end-user shapes structurally incompatible', () => {
    // Different identity spaces (§3.1, §3.4): a credential from one must never
    // authenticate the other. One shape with a discriminator would be a single
    // careless cast away from letting it, so they are separate and each
    // rejects the other's payload.
    const devReq = { email: 'dev@example.com', role: 'member', send_mail: true }
    const endUserReq = { email: 'user@example.com', app_id: UUID, role_id: UUID, send_mail: true }
    expect(createDeveloperInvitationRequest.safeParse(devReq).success).toBe(true)
    expect(createInvitationRequest.safeParse(endUserReq).success).toBe(true)
    expect(createDeveloperInvitationRequest.safeParse(endUserReq).success).toBe(false)
    expect(createInvitationRequest.safeParse(devReq).success).toBe(false)
  })

  it('requires the tier rather than defaulting it', () => {
    // "I did not think about it" and "I meant Member" would otherwise produce
    // the same request, on the field that decides who can remove whom.
    expect(createDeveloperInvitationRequest.safeParse({
      email: 'dev@example.com', send_mail: false,
    }).success).toBe(false)
    for (const role of orgMemberRole.options) {
      expect(createDeveloperInvitationRequest.safeParse({
        email: 'dev@example.com', role, send_mail: false,
      }).success).toBe(true)
    }
  })

  it('makes an accepted invitation set a password that meets the shared rule', () => {
    expect(acceptDeveloperInvitationRequest.safeParse({ token: 't', password: GOOD_PASSWORD }).success).toBe(true)
    expect(acceptDeveloperInvitationRequest.safeParse({ token: 't', password: 'short' }).success).toBe(false)
    expect(acceptDeveloperInvitationRequest.safeParse({ password: GOOD_PASSWORD }).success).toBe(false)
  })
})

describe('W6c — tiers', () => {
  it('names the tier required and the one held, and nothing about the target', () => {
    // §3.3 stays intact: this says nothing about whether the target exists.
    // It says what the caller could already read off the documentation.
    const d = tierRequiredDetails.parse({ required: 'owner', actual: 'member' })
    expect([d.required, d.actual]).toEqual(['owner', 'member'])
    expect(tierRequiredDetails.safeParse({ required: 'owner' }).success).toBe(false)
    expect(tierRequiredDetails.safeParse({ required: 'admin', actual: 'member' }).success).toBe(false)
  })
})

describe('W6c — self-registration belongs to an app, not an org', () => {
  const base = { enabled: true, all_domains: false, domains: ['dehne-robotik.de'], role_id: UUID }

  it('says "open to everyone" with a flag, never with an empty list', () => {
    // The dangerous reading, written down because somebody will make it at
    // 2 a.m. on a public endpoint: a filter that matches nothing is not a
    // filter that matches everything. §3.2's "wahlweise für alle E-Mail-
    // Domains" is `all_domains: true` — something an app owner has to SAY,
    // not something that falls out of leaving a list empty.
    const nobody = selfRegistration.parse({ ...base, all_domains: false, domains: [] })
    expect([nobody.enabled, nobody.all_domains, nobody.domains]).toEqual([true, false, []])
    expect(selfRegistration.parse({ ...base, all_domains: true, domains: [] }).all_domains).toBe(true)
  })

  it('requires a role, because a pool member with no role is not a state', () => {
    // §3.2: "pro App erhält er genau eine Rolle." An app that enables
    // self-registration has to decide which one, and that IS the security
    // decision here.
    const { role_id: _dropped, ...noRole } = base
    expect(selfRegistration.safeParse(noRole).success).toBe(false)
    expect(selfRegistration.safeParse({ ...base, role_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('requires every field, so "not configured" cannot masquerade as "open"', () => {
    for (const drop of ['enabled', 'all_domains', 'domains', 'role_id']) {
      const partial = { ...base }
      delete partial[drop]
      expect(selfRegistration.safeParse(partial).success).toBe(false)
    }
  })

  it('registers an END USER against an app, never a developer against an org', () => {
    // The first version of this delta had self-registration minting a
    // DEVELOPER session against an org resolved by email domain — a feature
    // §3.2 does not contain, and a path into the org that owns the robots
    // rather than into an app's pool.
    expect(clientRegisterRequest.safeParse({
      app_identifier: 'my-app', email: 'user@dehne-robotik.de', password: GOOD_PASSWORD,
    }).success).toBe(true)
    // No org_name, no role: the caller chooses neither.
    expect(clientRegisterRequest.safeParse({
      app_identifier: 'my-app', email: 'user@dehne-robotik.de', password: GOOD_PASSWORD,
      role_id: UUID, org_name: 'Sneaky',
    }).success).toBe(true)
    expect(Object.keys(clientRegisterRequest.parse({
      app_identifier: 'my-app', email: 'user@dehne-robotik.de', password: GOOD_PASSWORD,
      role_id: UUID,
    }))).toEqual(['app_identifier', 'email', 'password'])
    expect(clientRegisterRequest.safeParse({
      email: 'user@dehne-robotik.de', password: GOOD_PASSWORD,
    }).success).toBe(false)
  })
})

describe('W6c — recovering an account', () => {
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
