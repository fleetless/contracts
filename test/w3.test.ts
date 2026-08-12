import { describe, it, expect } from 'vitest'
import {
  password,
  org,
  orgMember,
  sessionTokens,
  signUpRequest,
  signUpResponse,
  developerLoginRequest,
  endUser,
  invitation,
  createInvitationRequest,
  acceptInvitationRequest,
  app,
  appIdentifier,
  serverKeyToken,
  serverKey,
  createServerKeyResponse,
  role,
  rolePermissions,
  appMembership,
  clientLoginRequest,
  clientIdentity,
  clientLogoutRequest,
  clientAuth,
  authOk,
  authError,
  auditActor,
  auditEvent,
  ERROR_CODES,
} from '../src/index.js'

const UUID = '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f'
const UUID2 = '7c2f1b40-8e3a-4d51-9f6b-2a1c3d4e5f60'
const NOW = '2026-08-10T20:00:00.000Z'

describe('W3 identity', () => {
  it('states the password rule once, and it is length-based', () => {
    expect(password.safeParse('correct-horse-battery').success).toBe(true)
    expect(password.safeParse('short').success).toBe(false)
    // No composition rules: a rule a user cannot predict is one they work around.
    expect(password.safeParse('aaaaaaaaaaaaaaaa').success).toBe(true)
  })

  it('registering an org yields org, first owner and a session in one step', () => {
    const request = { org_name: 'Dehne Robotik', email: 'andre@example.com', password: 'correct-horse-battery' }
    expect(signUpRequest.safeParse(request).success).toBe(true)
    expect(signUpRequest.safeParse({ ...request, password: 'short' }).success).toBe(false)
    expect(signUpRequest.safeParse({ ...request, email: 'not-an-email' }).success).toBe(false)

    expect(
      signUpResponse.safeParse({
        org: { id: UUID, name: 'Dehne Robotik', created_at: NOW },
        member: { id: UUID2, org_id: UUID, email: 'andre@example.com', role: 'owner', created_at: NOW },
        tokens: { access_token: 'a', refresh_token: 'r', expires_in: 900 },
      }).success,
    ).toBe(true)
  })

  it('knows exactly two org tiers', () => {
    const base = { id: UUID, org_id: UUID2, email: 'a@b.de', created_at: NOW }
    expect(orgMember.safeParse({ ...base, role: 'owner' }).success).toBe(true)
    expect(orgMember.safeParse({ ...base, role: 'member' }).success).toBe(true)
    expect(orgMember.safeParse({ ...base, role: 'admin' }).success).toBe(false)
  })

  it('separates the developer login from the client login', () => {
    // The developer login carries no app identifier — that is what keeps the
    // two identity spaces from accepting each other's credentials (§3.1).
    expect(developerLoginRequest.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(true)
    expect(clientLoginRequest.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(false)
    expect(
      clientLoginRequest.safeParse({ app_identifier: 'fleet-ops', email: 'a@b.de', password: 'x' }).success,
    ).toBe(true)
  })

  it('tracks an end user through invited, active and blocked', () => {
    const base = { id: UUID, org_id: UUID2, email: 'user@example.com', created_at: NOW }
    for (const status of ['invited', 'active', 'blocked']) {
      expect(endUser.safeParse({ ...base, status }).success).toBe(true)
    }
    expect(endUser.safeParse({ ...base, status: 'deleted' }).success).toBe(false)
  })

  it('carries the accept link and says what happened to the mail', () => {
    const invite = {
      id: UUID,
      email: 'user@example.com',
      app_id: UUID2,
      role_id: UUID,
      expires_at: NOW,
      accept_url: 'https://console.fleetless.dev/invite/abc',
      // W6c: `mail_sent: false` became `mail: 'not_configured' | 'failed' | 'sent'`.
      // The boolean could not tell "we have no SMTP" from "the server refused",
      // so the console had to guess a cause — and guessed the reassuring one.
      mail: 'not_configured',
    }
    expect(invitation.safeParse(invite).success).toBe(true)
    // `not_configured` is a normal outcome, not an error — the link is the
    // primary path and a cloud without SMTP still invites. `failed` is not.
    expect(invitation.safeParse({ ...invite, accept_url: 'not-a-url' }).success).toBe(false)
    expect(
      createInvitationRequest.safeParse({ email: 'u@e.de', app_id: UUID, role_id: UUID2, send_mail: true }).success,
    ).toBe(true)
    expect(acceptInvitationRequest.safeParse({ token: 't', password: 'correct-horse-battery' }).success).toBe(true)
    expect(acceptInvitationRequest.safeParse({ token: 't', password: 'short' }).success).toBe(false)
  })

  it('bounds the session token shape', () => {
    expect(sessionTokens.safeParse({ access_token: 'a', refresh_token: 'r', expires_in: 900 }).success).toBe(true)
    expect(sessionTokens.safeParse({ access_token: 'a', refresh_token: 'r', expires_in: 0 }).success).toBe(false)
  })

  it('names the org', () => {
    expect(org.safeParse({ id: UUID, name: 'Dehne Robotik', created_at: NOW }).success).toBe(true)
    expect(org.safeParse({ id: UUID, name: '', created_at: NOW }).success).toBe(false)
  })
})

describe('W3 apps, keys and roles', () => {
  it('identifies an app by a slug, like a service', () => {
    expect(appIdentifier.safeParse('fleet-ops').success).toBe(true)
    expect(appIdentifier.safeParse('Fleet Ops').success).toBe(false)
    expect(
      app.safeParse({ id: UUID, org_id: UUID2, name: 'Fleet Ops', identifier: 'fleet-ops', robot_ids: [UUID], created_at: NOW })
        .success,
    ).toBe(true)
  })

  it('formats server keys like robot tokens and returns them once', () => {
    const key = 'flk_' + 'ab'.repeat(16)
    expect(serverKeyToken.safeParse(key).success).toBe(true)
    expect(serverKeyToken.safeParse('flk_short').success).toBe(false)
    expect(serverKeyToken.safeParse('frt_' + 'ab'.repeat(16)).success).toBe(false)
    const record = { id: UUID, app_id: UUID2, name: 'ci', created_at: NOW, last_used_at: null }
    expect(serverKey.safeParse(record).success).toBe(true)
    expect(createServerKeyResponse.safeParse({ server_key: record, key }).success).toBe(true)
  })

  it('grants rights per robot and slug, plus the two capabilities', () => {
    expect(
      rolePermissions.safeParse({
        role_id: UUID,
        grants: [{ robot_id: UUID2, slugs: ['battery-percentage', 'bridge-state'] }],
        capabilities: { action_history: false, presence: true },
      }).success,
    ).toBe(true)
    // A role granting nothing is legal and meaningful: it is how you hide a
    // service app-wide (§3.3).
    expect(
      rolePermissions.safeParse({
        role_id: UUID,
        grants: [],
        capabilities: { action_history: false, presence: false },
      }).success,
    ).toBe(true)
    expect(
      rolePermissions.safeParse({
        role_id: UUID,
        grants: [{ robot_id: UUID2, slugs: ['Not A Slug'] }],
        capabilities: { action_history: false, presence: false },
      }).success,
    ).toBe(false)
  })

  it('marks the two starting roles and gives a user one role per app', () => {
    expect(role.safeParse({ id: UUID, app_id: UUID2, name: 'observe', builtin: true }).success).toBe(true)
    expect(role.safeParse({ id: UUID, app_id: UUID2, name: 'night-shift', builtin: false }).success).toBe(true)
    expect(appMembership.safeParse({ end_user_id: UUID, app_id: UUID2, role_id: UUID }).success).toBe(true)
  })

  it('reports who the caller is without making the client decode a token', () => {
    expect(
      clientIdentity.safeParse({ kind: 'end_user', developer_id: null, end_user_id: UUID, server_key_id: null, app_id: UUID2, role_id: UUID, email: 'u@e.de' })
        .success,
    ).toBe(true)
    expect(
      clientIdentity.safeParse({ kind: 'server_key', developer_id: null, end_user_id: null, server_key_id: UUID, app_id: UUID2, role_id: null, email: null })
        .success,
    ).toBe(true)
  })

  it('represents a developer on the client API — org-scoped, no app, no role', () => {
    // The console's live views and the §15.2 playground are developers on the
    // client API. Requiring app_id would have made /realtime client-only and
    // silently killed every live badge in the console.
    expect(
      clientIdentity.safeParse({ kind: 'developer', developer_id: UUID, end_user_id: null, server_key_id: null, app_id: null, role_id: null, email: 'dev@example.com' })
        .success,
    ).toBe(true)
    expect(clientIdentity.safeParse({ kind: 'nobody', developer_id: null, end_user_id: null, server_key_id: null, app_id: null, role_id: null, email: null }).success).toBe(false)
  })
})

describe('W3 audit', () => {
  it('never records an anonymous event', () => {
    const actor = { kind: 'end_user', id: UUID, label: 'user@example.com' }
    expect(auditActor.safeParse(actor).success).toBe(true)
    expect(auditActor.safeParse({ ...actor, kind: 'anonymous' }).success).toBe(false)
    expect(
      auditEvent.safeParse({
        id: UUID,
        org_id: UUID2,
        at: NOW,
        seq: 1,
        actor,
        action: 'end_user.invited',
        target: { kind: 'end_user', id: UUID, label: 'user@example.com' },
        details: null,
      }).success,
    ).toBe(true)
  })

  it('allows an event with no target', () => {
    expect(
      auditEvent.safeParse({
        id: UUID,
        org_id: UUID2,
        at: NOW,
        seq: 2,
        actor: { kind: 'developer', id: UUID, label: 'andre@example.com' },
        action: 'auth.login_failed',
        target: null,
        details: { reason: 'invalid_credentials' },
      }).success,
    ).toBe(true)
  })
})

describe('W3 error vocabulary', () => {
  it('names the refusals identity brings', () => {
    for (const code of [
      'unauthorized',
      'forbidden',
      'invalid_credentials',
      'token_expired',
      'token_revoked',
      'invite_expired',
      'invite_used',
      'email_taken',
      'identifier_taken',
      'weak_password',
      'not_a_member',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})

describe('W3 realtime authentication', () => {
  it('authenticates with a first frame, not a query string', () => {
    // A browser cannot set Authorization on a WS handshake, and a token in
    // the URL outlives the request in every log it passes through.
    expect(clientAuth.safeParse({ type: 'auth', token: 'ey...' }).success).toBe(true)
    expect(clientAuth.safeParse({ type: 'auth', token: '' }).success).toBe(false)
    expect(
      authOk.safeParse({
        type: 'auth_ok',
        identity: { kind: 'end_user', developer_id: null, end_user_id: UUID, server_key_id: null, app_id: UUID2, role_id: UUID, email: 'u@e.de' },
      }).success,
    ).toBe(true)
    expect(authError.safeParse({ type: 'auth_error', code: 'unauthorized', message: 'bad token' }).success).toBe(true)
  })

  it('revokes server-side on logout', () => {
    // Clearing a client store is a UI gesture; the family has to die on the
    // server or a token stolen before logout keeps working.
    expect(clientLogoutRequest.safeParse({ refresh_token: 'r' }).success).toBe(true)
    expect(clientLogoutRequest.safeParse({}).success).toBe(false)
  })
})
