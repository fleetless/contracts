// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  password,
  org,
  fleetlessUser,
  sessionTokens,
  teamInvite,
  createTeamInviteRequest,
  acceptTeamInviteRequest,
  app,
  appIdentifier,
  serverKeyToken,
  serverKey,
  createServerKeyResponse,
  role,
  rolePermissions,
  appUser,
  clientLoginRequest,
  clientIdentity,
  clientLogoutRequest,
  clientAuth,
  authOk,
  authError,
  auditActor,
  auditEvent,
  ERROR_CODES,
  ROUTES,
  roleRenameRequest,
  roleDeleteQuery,
  roleInUseDetails,
} from '../src/index.js'
import * as identityBarrel from '../src/index.js'

const UUID = '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f'
const UUID2 = '7c2f1b40-8e3a-4d51-9f6b-2a1c3d4e5f60'
const NOW = '2026-08-10T20:00:00.000Z'

describe('identity', () => {
  it('states the password rule once, and it is length-based', () => {
    expect(password.safeParse('correct-horse-battery').success).toBe(true)
    expect(password.safeParse('short').success).toBe(false)
    // No composition rules: a rule a user cannot predict is one they work around.
    expect(password.safeParse('aaaaaaaaaaaaaaaa').success).toBe(true)
  })

  it('describes an org with its two-factor policy', () => {
    expect(org.safeParse({ id: UUID, name: 'Dehne Robotik', require_two_factor: false, created_at: NOW }).success).toBe(true)
    expect(org.safeParse({ id: UUID, name: 'Dehne Robotik', created_at: NOW }).success).toBe(false)
  })

  it('knows exactly two tiers, and every Fleetless user has one', () => {
    const base = {
      id: UUID, org_id: UUID2, email: 'a@b.de', display_name: null, created_at: NOW,
      two_factor: { passkeys: 0, authenticator: false },
    }
    expect(fleetlessUser.safeParse({ ...base, tier: 'owner' }).success).toBe(true)
    expect(fleetlessUser.safeParse({ ...base, tier: 'developer' }).success).toBe(true)
    expect(fleetlessUser.safeParse({ ...base, tier: 'admin' }).success).toBe(false)
    // Tier was optional once: the org's pool also held people with no console
    // powers to grade. That pool is gone — a Fleetless user IS the team, so a
    // missing tier is a mapper bug, not a valid state.
    expect(fleetlessUser.safeParse(base).success).toBe(false)
  })

  it('separates the console login from the app login', () => {
    // A Fleetless user signs in on the auth portal by emailed code or passkey
    // and has no JSON login shape at all. App login needs an app identifier:
    // an app user's email is unique only within their app, so the pair names
    // them — separate tables, so a credential from one never authenticates
    // the other.
    expect('developerLoginRequest' in identityBarrel).toBe(false)
    expect(clientLoginRequest.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(false)
    expect(
      clientLoginRequest.safeParse({ app_identifier: 'fleet_ops', email: 'a@b.de', password: 'x' }).success,
    ).toBe(true)
  })

  // `tracks an end user through invited, active and blocked` was deleted on
  // 2026-08-29: `endUser` is gone with the per-app pools, and D1's `users`
  // carries no `status` column. Whether the pool regains a blocked state is
  // the cloud's decision (see the note on the `account_blocked` error code) —
  // a test asserting one here would be inventing it.

  it('carries the accept link and says what happened to the mail', () => {
    const invite = {
      id: UUID,
      email: 'user@example.com',
      tier: 'developer',
      expires_at: NOW,
      accept_url: 'https://console.fleetless.dev/invite/abc',
      // `mail_sent: false` became `mail: 'not_configured' | 'failed' | 'sent'`.
      // The boolean could not tell "we have no SMTP" from "the server refused",
      // so the console had to guess a cause — and guessed the reassuring one.
      mail: 'not_configured',
    }
    expect(teamInvite.safeParse(invite).success).toBe(true)
    // `not_configured` is a normal outcome, not an error — the link is the
    // primary path and a cloud without SMTP still invites. `failed` is not.
    expect(teamInvite.safeParse({ ...invite, accept_url: 'not-a-url' }).success).toBe(false)
    expect(
      createTeamInviteRequest.safeParse({ email: 'u@e.de', tier: 'developer', send_mail: true }).success,
    ).toBe(true)
    // The mailed link proves the address; a Fleetless user holds no password.
    expect(acceptTeamInviteRequest.safeParse({ token: 't' }).success).toBe(true)
    expect(acceptTeamInviteRequest.safeParse({ token: 't', display_name: 'Ada' }).success).toBe(true)
    expect(acceptTeamInviteRequest.safeParse({ token: 't', password: 'correct-horse-battery' }).success).toBe(false)
  })

  it('bounds the session token shape', () => {
    expect(sessionTokens.safeParse({ access_token: 'a', refresh_token: 'r', expires_in: 900 }).success).toBe(true)
    expect(sessionTokens.safeParse({ access_token: 'a', refresh_token: 'r', expires_in: 0 }).success).toBe(false)
  })

  it('names the org', () => {
    expect(org.safeParse({ id: UUID, name: 'Dehne Robotik', require_two_factor: false, created_at: NOW }).success).toBe(true)
    expect(org.safeParse({ id: UUID, name: '', require_two_factor: false, created_at: NOW }).success).toBe(false)
  })
})

describe('apps, keys and roles', () => {
  it('identifies an app by a slug, like a service', () => {
    expect(appIdentifier.safeParse('fleet_ops').success).toBe(true)
    expect(appIdentifier.safeParse('Fleet Ops').success).toBe(false)
    expect(
      app.safeParse({ id: UUID, org_id: UUID2, name: 'Fleet Ops', identifier: 'fleet_ops', robot_ids: [UUID], default_role_id: null, created_at: NOW })
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
        grants: [{ robot_id: UUID2, slugs: ['battery_percentage', 'bridge_state'] }],
        capabilities: { action_history: false, presence: true, assets: false },
      }).success,
    ).toBe(true)
    // A role granting nothing is legal and meaningful: it is how you hide a
    // service app-wide.
    expect(
      rolePermissions.safeParse({
        role_id: UUID,
        grants: [],
        capabilities: { action_history: false, presence: false, assets: false },
      }).success,
    ).toBe(true)
    expect(
      rolePermissions.safeParse({
        role_id: UUID,
        grants: [{ robot_id: UUID2, slugs: ['Not A Slug'] }],
        capabilities: { action_history: false, presence: false, assets: false },
      }).success,
    ).toBe(false)
  })

  it('marks the two starting roles and gives a user exactly one role per app', () => {
    expect(role.safeParse({ id: UUID, app_id: UUID2, name: 'observe', builtin: true }).success).toBe(true)
    expect(role.safeParse({ id: UUID, app_id: UUID2, name: 'night-shift', builtin: false }).success).toBe(true)
    // `appMembership.end_user_id`, then `appAssignment.user_id`, and now the
    // role is a column on the user's own row: access IS the row, and there is
    // no join table left to hold a second one. The property those three shapes
    // pinned — exactly one role per app — is unchanged.
    const user = {
      id: UUID, app_id: UUID2, email: 'u@e.de', display_name: null, role_id: UUID,
      status: 'active', has_password: true, providers: [], last_login_at: null,
      two_factor: { enabled: false, enabled_at: null, recovery_codes_left: 0 }, created_at: NOW,
    }
    expect(appUser.safeParse(user).success).toBe(true)
    const { role_id, ...withoutRole } = user
    void role_id
    expect(appUser.safeParse(withoutRole).success).toBe(false)
  })

  it('reports who the caller is without making the client decode a token', () => {
    expect(
      clientIdentity.safeParse({ kind: 'app_user', developer_id: null, app_user_id: UUID, server_key_id: null, app_id: UUID2, role_id: UUID, email: 'u@e.de', two_factor_enabled: false })
        .success,
    ).toBe(true)
    expect(
      clientIdentity.safeParse({ kind: 'server_key', developer_id: null, app_user_id: null, server_key_id: UUID, app_id: UUID2, role_id: null, email: null, two_factor_enabled: null })
        .success,
    ).toBe(true)
  })

  it('represents a developer on the client API — org-scoped, no app, no role', () => {
    // The console's live views and its playground are developers on the
    // client API. Requiring app_id would have made /realtime client-only and
    // silently killed every live badge in the console.
    expect(
      clientIdentity.safeParse({ kind: 'developer', developer_id: UUID, app_user_id: null, server_key_id: null, app_id: null, role_id: null, email: 'dev@example.com', two_factor_enabled: null })
        .success,
    ).toBe(true)
    expect(clientIdentity.safeParse({ kind: 'nobody', developer_id: null, app_user_id: null, server_key_id: null, app_id: null, role_id: null, email: null }).success).toBe(false)
  })
})

describe('audit', () => {
  it('never records an anonymous event', () => {
    const actor = { kind: 'app_user', id: UUID, label: 'user@example.com' }
    expect(auditActor.safeParse(actor).success).toBe(true)
    expect(auditActor.safeParse({ ...actor, kind: 'anonymous' }).success).toBe(false)
    expect(
      auditEvent.safeParse({
        id: UUID,
        org_id: UUID2,
        at: NOW,
        seq: 1,
        actor,
        action: 'app_user.invited',
        target: { kind: 'app_user', id: UUID, label: 'user@example.com' },
        details: null,
      }).success,
    ).toBe(true)
  })

  /**
   * **`end_user` stays readable while nothing writes it again.** Audit logs
   * are never rewritten, and stored rows carry that kind — dropping the enum
   * member would fail them against their own schema. The enum is deliberately
   * wider than any producer, asserted here because this package has been
   * wrong before by leaving such claims unsaid.
   */
  it('still parses a stored end_user row, alongside the app_user rows written now', () => {
    expect(auditActor.safeParse({ kind: 'end_user', id: UUID, label: 'old@example.com' }).success).toBe(true)
    expect(auditActor.shape.kind.options).toEqual(['developer', 'end_user', 'app_user', 'server_key', 'bridge'])
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

describe('error vocabulary', () => {
  it('names the refusals identity brings', () => {
    for (const code of [
      'unauthorized',
      'forbidden',
      'invalid_credentials',
      'token_expired',
      'token_revoked',
      'email_taken',
      'registration_closed',
      'domain_not_allowed',
      'identifier_taken',
      'weak_password',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
  })

  /**
   * The other half: codes this file used to assert *present*, now asserted
   * absent. `not_a_member` had no producer and named the deleted model's
   * noun. `invite_expired` and `invite_used` had no producer either — the
   * route they were written for answers `410 token_spent` to every invitation
   * token that fails, so branching on them answered nothing a caller can
   * receive. Re-adding any of the three re-adds a refusal nothing can answer.
   * See the tombstones in `errors.ts`.
   *
   * Asserted as a set: this list records what was retired, and a code dropped
   * from it quietly stops being guarded.
   */
  it('has dropped the refusals nothing can answer with', () => {
    const codes: readonly string[] = ERROR_CODES
    for (const gone of ['not_a_member', 'invite_expired', 'invite_used']) {
      expect(codes, `${gone} is back in the catalogue`).not.toContain(gone)
    }
  })
})

describe('realtime authentication', () => {
  it('authenticates with a first frame, not a query string', () => {
    // A browser cannot set Authorization on a WS handshake, and a token in
    // the URL outlives the request in every log it passes through.
    expect(clientAuth.safeParse({ type: 'auth', token: 'ey...' }).success).toBe(true)
    expect(clientAuth.safeParse({ type: 'auth', token: '' }).success).toBe(false)
    expect(
      authOk.safeParse({
        type: 'auth_ok',
        identity: { kind: 'app_user', developer_id: null, app_user_id: UUID, server_key_id: null, app_id: UUID2, role_id: UUID, email: 'u@e.de', two_factor_enabled: true },
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

describe('role rename and delete', () => {
  it('renames to 1–60 trimmed characters', () => {
    expect(roleRenameRequest.parse({ name: '  operator ' }).name).toBe('operator')
    expect(roleRenameRequest.safeParse({ name: '' }).success).toBe(false)
    expect(roleRenameRequest.safeParse({ name: '   ' }).success).toBe(false)
    expect(roleRenameRequest.safeParse({ name: 'x'.repeat(60) }).success).toBe(true)
    expect(roleRenameRequest.safeParse({ name: 'x'.repeat(61) }).success).toBe(false)
    expect(roleRenameRequest.safeParse({ name: 'a', builtin: false }).success).toBe(false)
  })
  it('deletes with an optional uuid move_to', () => {
    expect(roleDeleteQuery.parse({})).toEqual({})
    expect(roleDeleteQuery.parse({ move_to: UUID })).toEqual({ move_to: UUID })
    expect(roleDeleteQuery.safeParse({ move_to: 'observe' }).success).toBe(false)
    expect(roleDeleteQuery.safeParse({ force: 'true' }).success).toBe(false)
  })
  it('describes what holds a role in use', () => {
    expect(roleInUseDetails.parse({ users: 3, invitations: 1, is_default: true })).toEqual({ users: 3, invitations: 1, is_default: true })
    expect(roleInUseDetails.safeParse({ users: -1, invitations: 0, is_default: false }).success).toBe(false)
    expect(roleInUseDetails.safeParse({ users: 0, invitations: 0 }).success).toBe(false)
  })
  it('catalogues the three new codes', () => {
    for (const code of ['role_name_taken', 'role_in_use', 'last_role']) expect(ERROR_CODES).toContain(code)
  })
  it('declares the two routes', () => {
    const patch = ROUTES.find((r) => r.method === 'PATCH' && r.path === '/api/apps/:id/roles/:roleId')
    const del = ROUTES.find((r) => r.method === 'DELETE' && r.path === '/api/apps/:id/roles/:roleId')
    expect(patch).toMatchObject({ status: 200, auth: 'developer', section: 'apps', request: roleRenameRequest, response: role })
    expect(patch?.errors).toContain('role_name_taken')
    expect(del).toMatchObject({ status: 204, auth: 'developer', section: 'apps', query: roleDeleteQuery, request: null, response: null })
    expect(del?.errors).toEqual(expect.arrayContaining(['role_in_use', 'last_role', 'validation_error']))
  })
  it('no longer tells anyone a built-in role cannot be renamed or deleted', () => {
    const description = role.shape.builtin.meta()?.description ?? ''
    expect(description).not.toContain('no route does that')
    expect(description).toContain('can be renamed and deleted like any other')
  })
  it('states the same 60-character limit on create as the role itself', () => {
    const create = ROUTES.find((r) => r.method === 'POST' && r.path === '/api/apps/:id/roles')
    expect(create?.notes).toContain('at most 60 characters')
    expect(create?.notes).not.toContain('120')
  })
})
