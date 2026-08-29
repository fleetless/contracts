/**
 * The org-central identity shapes (spec `2026-08-29-org-identity-redesign`,
 * D1/D2/D6): one user pool per org, users in exactly one group, an Org Admins
 * group as the only console path, and explicit per-user app assignments.
 *
 * These are behavioural pins, not a restatement of the schema. Each one names
 * the wrong outcome it exists to stop: a `password_hash` reaching the wire, a
 * tier written onto somebody who is not an org admin, an `is_org_admins` a
 * caller can set on themselves, a group move that silently deletes somebody's
 * assignments because the acknowledgement was optional.
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import * as identity from '../src/identity.js'
import * as apps from '../src/apps.js'
import { ERROR_CODES } from '../src/errors.js'
import { app, createAppRequest, updateAppRequest } from '../src/index.js'
import {
  orgUser,
  orgGroup,
  appAssignment,
  appAssignmentListResponse,
  groupListResponse,
  orgUserListResponse,
  createGroupRequest,
  patchGroupRequest,
  createUserInviteRequest,
  userInvite,
  pendingUserInvite,
  userInviteListResponse,
  acceptUserInviteRequest,
  patchUserRequest,
  moveUserGroupRequest,
  putAppGroupRequest,
  putAssignmentRequest,
  tierChangeRequest,
  groupUsageResponse,
  orgAdminTier,
  mcpAccess,
  authMeResponse,
  signUpResponse,
  tierRequiredDetails,
  GROUP_NAME_MAX,
  USER_DISPLAY_NAME_MAX,
  ORG_ADMINS_GROUP_DEFAULT_NAME,
} from '../src/index.js'

// zod 4's z.uuid() enforces version and variant nibbles, so
// `11111111-1111-1111-1111-111111111111` is refused (see org-events.test.ts).
const ORG = '11111111-4111-8111-9111-111111111111'
const USER = '22222222-4222-8222-9222-222222222222'
const GROUP = '33333333-4333-8333-9333-333333333333'
const APP = '44444444-4444-8444-9444-444444444444'
const ROLE = '55555555-4555-8555-9555-555555555555'
const NOW = '2026-08-29T10:00:00.000Z'

const VALID_USER = {
  id: USER,
  org_id: ORG,
  email: 'pilot@example.com',
  display_name: 'Pilot',
  group_id: GROUP,
  has_password: true,
  mcp_access: 'default' as const,
  created_at: NOW,
}

const VALID_GROUP = {
  id: GROUP,
  org_id: ORG,
  name: 'Warehouse crew',
  is_org_admins: false,
  mcp_enabled: false,
  member_count: 3,
  app_count: 1,
  created_at: NOW,
}

describe('orgUser — one pool, and the wire says nothing about the credential', () => {
  it('accepts the full shape', () => {
    expect(orgUser.safeParse(VALID_USER).success).toBe(true)
  })

  /**
   * The pin the whole redesign hangs on: `has_password` is the only statement
   * about the Fleetless credential, and a hash must not be able to ride along.
   * `orgUser` is an entity (zod strips unknowns), so the check is that the key
   * is not in the shape AND that a parse drops it — a schema that merely
   * ignored it would still let a hand-built response object carry it.
   */
  it('has no password_hash field and strips one that is offered', () => {
    expect('password_hash' in orgUser.shape).toBe(false)
    const parsed = orgUser.parse({ ...VALID_USER, password_hash: '$argon2id$v=19$m=65536' })
    expect(parsed).not.toHaveProperty('password_hash')
  })

  it('has_password is required — "we did not look" must not parse as "no password"', () => {
    const { has_password: _omitted, ...withoutFlag } = VALID_USER
    expect(orgUser.safeParse(withoutFlag).success).toBe(false)
  })

  it('mcp_access takes exactly the three documented values', () => {
    for (const value of ['default', 'allowed', 'denied']) {
      expect(orgUser.safeParse({ ...VALID_USER, mcp_access: value }).success, value).toBe(true)
    }
    expect(orgUser.safeParse({ ...VALID_USER, mcp_access: 'blocked' }).success).toBe(false)
    // Required, not defaulted: a user row with no answer is not a state.
    const { mcp_access: _dropped, ...withoutAccess } = VALID_USER
    expect(orgUser.safeParse(withoutAccess).success).toBe(false)
  })

  it('tier is optional (not applicable outside Org Admins) and only owner|developer', () => {
    expect(orgUser.safeParse(VALID_USER).success).toBe(true)
    expect(orgUser.safeParse({ ...VALID_USER, tier: 'owner' }).success).toBe(true)
    expect(orgUser.safeParse({ ...VALID_USER, tier: 'developer' }).success).toBe(true)
    // "member" is the pre-redesign name and must not survive as an alias.
    expect(orgUser.safeParse({ ...VALID_USER, tier: 'member' }).success).toBe(false)
    expect(orgUser.safeParse({ ...VALID_USER, tier: 'admin' }).success).toBe(false)
  })

  it('group_id is required — every user is in exactly one group (D1)', () => {
    const { group_id: _dropped, ...groupless } = VALID_USER
    expect(orgUser.safeParse(groupless).success).toBe(false)
    expect(orgUser.safeParse({ ...VALID_USER, group_id: null }).success).toBe(false)
  })

  it('display_name is required-but-nullable, so an absent key is not silently null', () => {
    expect(orgUser.safeParse({ ...VALID_USER, display_name: null }).success).toBe(true)
    const { display_name: _dropped, ...withoutName } = VALID_USER
    expect(orgUser.safeParse(withoutName).success).toBe(false)
  })

  it('email must look like an address', () => {
    expect(orgUser.safeParse({ ...VALID_USER, email: 'not-an-address' }).success).toBe(false)
  })
})

describe('orgGroup', () => {
  it('accepts the full shape and bounds the name at 1..GROUP_NAME_MAX', () => {
    expect(orgGroup.safeParse(VALID_GROUP).success).toBe(true)
    expect(orgGroup.safeParse({ ...VALID_GROUP, name: '' }).success).toBe(false)
    expect(orgGroup.safeParse({ ...VALID_GROUP, name: 'x'.repeat(GROUP_NAME_MAX) }).success).toBe(true)
    expect(orgGroup.safeParse({ ...VALID_GROUP, name: 'x'.repeat(GROUP_NAME_MAX + 1) }).success).toBe(false)
  })

  it('counts are non-negative integers — a rendered count must not be -1 or 1.5', () => {
    expect(orgGroup.safeParse({ ...VALID_GROUP, member_count: 0, app_count: 0 }).success).toBe(true)
    expect(orgGroup.safeParse({ ...VALID_GROUP, member_count: -1 }).success).toBe(false)
    expect(orgGroup.safeParse({ ...VALID_GROUP, app_count: 1.5 }).success).toBe(false)
  })

  it('is_org_admins and mcp_enabled are required booleans, never absent', () => {
    const { is_org_admins: _a, ...noFlag } = VALID_GROUP
    expect(orgGroup.safeParse(noFlag).success).toBe(false)
    const { mcp_enabled: _b, ...noMcp } = VALID_GROUP
    expect(orgGroup.safeParse(noMcp).success).toBe(false)
  })

  it('names the Org Admins group only as a starting value, bounded like any other name', () => {
    expect(ORG_ADMINS_GROUP_DEFAULT_NAME.length).toBeGreaterThan(0)
    expect(ORG_ADMINS_GROUP_DEFAULT_NAME.length).toBeLessThanOrEqual(GROUP_NAME_MAX)
    expect(orgGroup.safeParse({ ...VALID_GROUP, name: ORG_ADMINS_GROUP_DEFAULT_NAME, is_org_admins: true }).success).toBe(true)
  })
})

describe('createGroupRequest / patchGroupRequest — is_org_admins is never writable', () => {
  it('creates with a name, and mcp_enabled defaults to off', () => {
    const parsed = createGroupRequest.parse({ name: 'Warehouse crew' })
    expect(parsed).toMatchObject({ name: 'Warehouse crew', mcp_enabled: false })
    expect(createGroupRequest.safeParse({ name: 'Warehouse crew', mcp_enabled: true }).success).toBe(true)
  })

  it('refuses is_org_admins on create — a caller must not mint a second admin group', () => {
    expect(createGroupRequest.safeParse({ name: 'Sneaky', is_org_admins: true }).success).toBe(false)
  })

  it('refuses is_org_admins on patch — the flag is a server fact, not an editable one', () => {
    expect(patchGroupRequest.safeParse({ is_org_admins: true }).success).toBe(false)
    expect(patchGroupRequest.safeParse({ is_org_admins: false }).success).toBe(false)
  })

  it('refuses server-computed fields and any other stray key (strict)', () => {
    expect(createGroupRequest.safeParse({ name: 'A', member_count: 0 }).success).toBe(false)
    expect(createGroupRequest.safeParse({ name: 'A', id: GROUP }).success).toBe(false)
    expect(patchGroupRequest.safeParse({ name: 'A', app_count: 3 }).success).toBe(false)
    expect(patchGroupRequest.safeParse({ org_id: ORG }).success).toBe(false)
  })

  it('patch accepts a single field at a time and bounds the name identically', () => {
    expect(patchGroupRequest.safeParse({ name: 'Renamed' }).success).toBe(true)
    expect(patchGroupRequest.safeParse({ mcp_enabled: true }).success).toBe(true)
    expect(patchGroupRequest.safeParse({ name: '' }).success).toBe(false)
    expect(patchGroupRequest.safeParse({ name: 'x'.repeat(GROUP_NAME_MAX + 1) }).success).toBe(false)
  })
})

describe('createUserInviteRequest — the only way a user enters the pool', () => {
  const BASE = { email: 'new@example.com', group_id: GROUP, send_mail: true }

  it('accepts the minimum and the optional extras', () => {
    expect(createUserInviteRequest.safeParse(BASE).success).toBe(true)
    expect(
      createUserInviteRequest.safeParse({ ...BASE, display_name: 'New Person', tier: 'developer', mcp_access: 'denied' })
        .success,
    ).toBe(true)
  })

  it('requires an address that looks like one, and a group to land in', () => {
    expect(createUserInviteRequest.safeParse({ ...BASE, email: 'nope' }).success).toBe(false)
    const { group_id: _dropped, ...noGroup } = BASE
    expect(createUserInviteRequest.safeParse(noGroup).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, group_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('never carries a password or a hash — the invitee sets one when accepting', () => {
    expect(createUserInviteRequest.safeParse({ ...BASE, password: 'correct-horse-battery' }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, password_hash: 'x' }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, has_password: true }).success).toBe(false)
  })

  it('tier takes only the two org-admin tiers, and no stray key gets through (strict)', () => {
    expect(createUserInviteRequest.safeParse({ ...BASE, tier: 'member' }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, is_org_admins: true }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, role_id: ROLE }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, app_id: APP }).success).toBe(false)
  })

  it('bounds the display name', () => {
    expect(createUserInviteRequest.safeParse({ ...BASE, display_name: 'x'.repeat(USER_DISPLAY_NAME_MAX) }).success).toBe(true)
    expect(createUserInviteRequest.safeParse({ ...BASE, display_name: 'x'.repeat(USER_DISPLAY_NAME_MAX + 1) }).success).toBe(false)
    expect(createUserInviteRequest.safeParse({ ...BASE, display_name: '' }).success).toBe(false)
  })
})

describe('userInvite / pendingUserInvite / acceptUserInviteRequest', () => {
  const ISSUED = {
    id: '66666666-4666-8666-9666-666666666666',
    email: 'new@example.com',
    group_id: GROUP,
    expires_at: NOW,
    accept_url: 'https://console.fleetless.dev/accept-invite/tok',
    mail: 'not_configured' as const,
  }

  it('the issued invitation carries a usable link and a mail status', () => {
    expect(userInvite.safeParse(ISSUED).success).toBe(true)
    expect(userInvite.safeParse({ ...ISSUED, accept_url: 'not-a-url' }).success).toBe(false)
    expect(userInvite.safeParse({ ...ISSUED, mail: 'delivered' }).success).toBe(false)
  })

  it('bounds the accept link — an unbounded URL on a mailed shape is a size nobody chose', () => {
    const long = 'https://console.fleetless.dev/accept-invite/' + 'x'.repeat(600)
    expect(long.length).toBeGreaterThan(500)
    expect(userInvite.safeParse({ ...ISSUED, accept_url: long }).success).toBe(false)
    const ok = 'https://console.fleetless.dev/accept-invite/' + 'x'.repeat(400)
    expect(userInvite.safeParse({ ...ISSUED, accept_url: ok }).success).toBe(true)
  })

  /**
   * The list must not hand out live credentials — the same rule
   * `pendingDeveloperInvitation` carried, kept through the redesign. If
   * `accept_url` ever reappears here, every screenshot of that page is a
   * working login for somebody else's account.
   */
  it('the list entry has no accept_url, and the list strips one that is offered', () => {
    expect('accept_url' in pendingUserInvite.shape).toBe(false)
    const { accept_url: _dropped, ...listed } = ISSUED
    expect(pendingUserInvite.safeParse(listed).success).toBe(true)
    const parsed = userInviteListResponse.parse({ invitations: [ISSUED] })
    expect(parsed.invitations[0]).not.toHaveProperty('accept_url')
  })

  it('accepting spends a token and sets the password, under the shared length rule', () => {
    expect(acceptUserInviteRequest.safeParse({ token: 't', password: 'correct-horse-battery' }).success).toBe(true)
    expect(acceptUserInviteRequest.safeParse({ token: 't', password: 'short' }).success).toBe(false)
    expect(acceptUserInviteRequest.safeParse({ password: 'correct-horse-battery' }).success).toBe(false)
  })
})

describe('patchUserRequest — email is immutable, and a group move is not a patch', () => {
  it('accepts what a user edit may actually change', () => {
    expect(patchUserRequest.safeParse({ display_name: 'Renamed' }).success).toBe(true)
    expect(patchUserRequest.safeParse({ display_name: null }).success).toBe(true)
    expect(patchUserRequest.safeParse({ mcp_access: 'allowed' }).success).toBe(true)
    expect(patchUserRequest.safeParse({}).success).toBe(true)
  })

  /**
   * Email is org-wide unique and identifies the account everywhere — a PATCH
   * that could change it is an account-takeover surface and a uniqueness race.
   * `.strict()` is what makes the field's absence a refusal rather than a
   * silent drop, which is the failure this project has already had once.
   */
  it('refuses email outright rather than silently ignoring it', () => {
    expect('email' in patchUserRequest.shape).toBe(false)
    expect(patchUserRequest.safeParse({ email: 'new@example.com' }).success).toBe(false)
  })

  it('refuses group_id — a move deletes assignments and has its own acknowledged shape', () => {
    expect('group_id' in patchUserRequest.shape).toBe(false)
    expect(patchUserRequest.safeParse({ group_id: GROUP }).success).toBe(false)
  })

  it('refuses tier, has_password and any other stray key', () => {
    expect(patchUserRequest.safeParse({ tier: 'owner' }).success).toBe(false)
    expect(patchUserRequest.safeParse({ has_password: false }).success).toBe(false)
    expect(patchUserRequest.safeParse({ password_hash: 'x' }).success).toBe(false)
    expect(patchUserRequest.safeParse({ org_id: ORG }).success).toBe(false)
  })

  it('rejects an out-of-bounds display name', () => {
    expect(patchUserRequest.safeParse({ display_name: '' }).success).toBe(false)
    expect(patchUserRequest.safeParse({ display_name: 'x'.repeat(USER_DISPLAY_NAME_MAX + 1) }).success).toBe(false)
  })
})

describe('the cascade acknowledgement — an omitted ack must be indistinguishable from a refusal', () => {
  it('moveUserGroupRequest needs the target group AND the acknowledgement', () => {
    expect(moveUserGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: true }).success).toBe(true)
    expect(moveUserGroupRequest.safeParse({ group_id: GROUP }).success).toBe(false)
    expect(moveUserGroupRequest.safeParse({ acknowledge_assignment_loss: true }).success).toBe(false)
  })

  /**
   * `false` is refused, not treated as "no acknowledgement given". A boolean
   * that accepts both values makes `{ acknowledge_assignment_loss: false }` a
   * request the route has to remember to check; a literal makes it a request
   * that cannot be built.
   */
  it('refuses an acknowledgement of false, and anything that is not the literal true', () => {
    expect(moveUserGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: false }).success).toBe(false)
    expect(moveUserGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: 'true' }).success).toBe(false)
    expect(moveUserGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: 1 }).success).toBe(false)
  })

  it('is strict — no smuggled role, no second field to reinterpret', () => {
    expect(
      moveUserGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: true, role_id: ROLE }).success,
    ).toBe(false)
  })

  it('putAppGroupRequest carries the identical rule for the app re-link', () => {
    expect(putAppGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: true }).success).toBe(true)
    expect(putAppGroupRequest.safeParse({ group_id: GROUP }).success).toBe(false)
    expect(putAppGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: false }).success).toBe(false)
    expect(putAppGroupRequest.safeParse({ group_id: GROUP, acknowledge_assignment_loss: true, force: true }).success).toBe(false)
  })
})

describe('assignments — access is explicit, per user and per app', () => {
  it('appAssignment names the three ids and nothing else', () => {
    expect(appAssignment.safeParse({ user_id: USER, app_id: APP, role_id: ROLE }).success).toBe(true)
    for (const missing of ['user_id', 'app_id', 'role_id']) {
      const partial: Record<string, string> = { user_id: USER, app_id: APP, role_id: ROLE }
      delete partial[missing]
      expect(appAssignment.safeParse(partial).success, missing).toBe(false)
    }
  })

  it('putAssignmentRequest is strict { role_id } — the ids in the path are not repeated in the body', () => {
    expect(putAssignmentRequest.safeParse({ role_id: ROLE }).success).toBe(true)
    expect(putAssignmentRequest.safeParse({}).success).toBe(false)
    expect(putAssignmentRequest.safeParse({ role_id: 'not-a-uuid' }).success).toBe(false)
    expect(putAssignmentRequest.safeParse({ role_id: ROLE, user_id: USER }).success).toBe(false)
    expect(putAssignmentRequest.safeParse({ role_id: ROLE, app_id: APP }).success).toBe(false)
  })

  it('the list is never null — "nobody is assigned" and "we did not look" must differ', () => {
    expect(appAssignmentListResponse.safeParse({ assignments: [] }).success).toBe(true)
    expect(appAssignmentListResponse.safeParse({}).success).toBe(false)
    expect(appAssignmentListResponse.safeParse({ assignments: null }).success).toBe(false)
  })
})

describe('tierChangeRequest — owner|developer, and nothing else on the wire', () => {
  it('accepts the two tiers', () => {
    expect(tierChangeRequest.safeParse({ tier: 'owner' }).success).toBe(true)
    expect(tierChangeRequest.safeParse({ tier: 'developer' }).success).toBe(true)
  })

  it('refuses the pre-redesign name "member" — the rename is not an alias', () => {
    expect(tierChangeRequest.safeParse({ tier: 'member' }).success).toBe(false)
    expect(orgAdminTier.safeParse('member').success).toBe(false)
    expect(orgAdminTier.options).toEqual(['owner', 'developer'])
  })

  it('is strict and requires the field', () => {
    expect(tierChangeRequest.safeParse({}).success).toBe(false)
    expect(tierChangeRequest.safeParse({ tier: 'owner', user_id: USER }).success).toBe(false)
    expect(tierChangeRequest.safeParse({ tier: 'owner', group_id: GROUP }).success).toBe(false)
  })

  it('tierRequiredDetails speaks the new tiers on both sides', () => {
    expect(tierRequiredDetails.safeParse({ required: 'owner', actual: 'developer' }).success).toBe(true)
    expect(tierRequiredDetails.safeParse({ required: 'owner', actual: 'member' }).success).toBe(false)
  })
})

describe('groupUsageResponse — the blast radius, before the confirmation', () => {
  const USAGE = {
    target_group_id: GROUP,
    assignments_removed: 2,
    users_affected: 1,
    app_identifiers: ['warehouse-ops'],
  }

  it('accepts a preview and its harmless zero case', () => {
    expect(groupUsageResponse.safeParse(USAGE).success).toBe(true)
    expect(
      groupUsageResponse.safeParse({ ...USAGE, assignments_removed: 0, users_affected: 0, app_identifiers: [] }).success,
    ).toBe(true)
  })

  it('counts are non-negative integers and never optional', () => {
    expect(groupUsageResponse.safeParse({ ...USAGE, assignments_removed: -1 }).success).toBe(false)
    expect(groupUsageResponse.safeParse({ ...USAGE, users_affected: 0.5 }).success).toBe(false)
    const { assignments_removed: _dropped, ...partial } = USAGE
    expect(groupUsageResponse.safeParse(partial).success).toBe(false)
  })

  it('echoes the proposed target group — a count that cannot say which change it describes is not a preview', () => {
    const { target_group_id: _dropped, ...anonymous } = USAGE
    expect(groupUsageResponse.safeParse(anonymous).success).toBe(false)
  })
})

describe('list and session shapes speak the new model', () => {
  it('groupListResponse and orgUserListResponse carry the entities, never null', () => {
    expect(groupListResponse.safeParse({ groups: [VALID_GROUP] }).success).toBe(true)
    expect(groupListResponse.safeParse({ groups: null }).success).toBe(false)
    expect(orgUserListResponse.safeParse({ users: [VALID_USER] }).success).toBe(true)
    expect(orgUserListResponse.safeParse({}).success).toBe(false)
  })

  it('authMeResponse answers with an org user, not an org member', () => {
    const org = { id: ORG, name: 'Dehne Robotik', created_at: NOW }
    expect(authMeResponse.safeParse({ org, user: { ...VALID_USER, tier: 'owner' } }).success).toBe(true)
    // The pre-redesign key must not still satisfy the shape.
    expect(authMeResponse.safeParse({ org, member: { ...VALID_USER, tier: 'owner' } }).success).toBe(false)
  })

  it('signUpResponse hands back the founding owner as an org user', () => {
    const org = { id: ORG, name: 'Dehne Robotik', created_at: NOW }
    const tokens = { access_token: 'a', refresh_token: 'r', expires_in: 900 }
    expect(signUpResponse.safeParse({ org, user: { ...VALID_USER, tier: 'owner' }, tokens }).success).toBe(true)
    expect(signUpResponse.safeParse({ org, member: { ...VALID_USER, tier: 'owner' }, tokens }).success).toBe(false)
  })
})

describe('the old per-app end-user world is gone from the contract', () => {
  /**
   * D6 is a greenfield cut: the deleted shapes must not come back as aliases,
   * because an alias is how the two identity spaces would quietly survive the
   * merge. This is the check that the deletion stays done.
   */
  const DELETED = [
    'endUser',
    'invitation',
    'createInvitationRequest',
    'acceptInvitationRequest',
    'selfRegistration',
    'clientRegisterRequest',
    'clientRegisterResponse',
    'clientRegisterConfirm',
    'createDeveloperInvitationRequest',
    'developerInvitation',
    'pendingDeveloperInvitation',
    'developerInvitationListResponse',
    'acceptDeveloperInvitationRequest',
    'orgMember',
    'orgMemberRole',
    'patchOrgMemberRequest',
    // From `apps.ts`, and the one whose resurrection would be worst: it is
    // the only deleted shape that carried `end_user_id`, so a copy coming
    // back would reintroduce the deleted model's key, not just its name.
    // The list missed it for a round — a reviewer re-added the shape AND its
    // barrel export and the whole suite stayed green.
    'appMembership',
  ] as const

  it('exports none of them from the barrel', () => {
    for (const name of DELETED) {
      expect(name in barrel, name).toBe(false)
    }
  })

  it('exports none of them from the identity module either', () => {
    for (const name of DELETED) {
      expect(name in identity, name).toBe(false)
    }
  })

  /**
   * `appMembership` lived in `apps.ts`, so the module check above would pass
   * vacuously for it — it was never an `identity` export to begin with. The
   * barrel check is the one that binds for it, and this pins the module it
   * actually has to be absent from.
   */
  it('exports appMembership from neither the apps module nor the barrel', () => {
    expect('appMembership' in apps).toBe(false)
    expect('appAssignment' in barrel).toBe(true)
  })
})

describe('no identity schema carries a credential', () => {
  /**
   * A sweep rather than a per-shape assertion: the failure this guards against
   * is a **new** shape adding `password_hash`, and a hand-written list of
   * shapes is exactly the check that will not be told about the new one (the
   * barrel test learned this the hard way).
   */
  const FORBIDDEN = ['password_hash', 'passwordHash', 'hashed_password', 'client_secret_hash']

  const objectShapes: Array<[string, Record<string, unknown>]> = Object.entries(
    identity as Record<string, unknown>,
  ).flatMap(([name, value]) =>
    typeof value === 'object' && value !== null && 'shape' in value
      ? [[name, (value as { shape: Record<string, unknown> }).shape] as [string, Record<string, unknown>]]
      : [],
  )

  it('found schemas to sweep (a vacuous pass is the failure mode here)', () => {
    expect(objectShapes.length).toBeGreaterThan(10)
  })

  it('no exported object schema has a credential-shaped field', () => {
    const offenders: string[] = []
    for (const [name, shape] of objectShapes) {
      for (const forbidden of FORBIDDEN) {
        if (forbidden in shape) offenders.push(`${name}.${forbidden}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('mcpAccess is the data-model enum the MCP plan will later enforce', () => {
    expect(mcpAccess.options).toEqual(['default', 'allowed', 'denied'])
  })
})

describe('an app belongs to exactly one group (D2)', () => {
  const APP_ROW = {
    id: APP,
    org_id: ORG,
    name: 'Warehouse ops',
    identifier: 'warehouse-ops',
    group_id: GROUP,
    robot_ids: [],
    accepts_dynamic_clients: false,
    default_role_id: null,
    created_at: NOW,
  }

  it('group_id is required on the app row — "no group" is not a state', () => {
    expect(app.safeParse(APP_ROW).success).toBe(true)
    const { group_id: _dropped, ...groupless } = APP_ROW
    expect(app.safeParse(groupless).success).toBe(false)
    expect(app.safeParse({ ...APP_ROW, group_id: null }).success).toBe(false)
  })

  it('creation must name the group; there is no default to fall back on', () => {
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', group_id: GROUP }).success).toBe(true)
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops' }).success).toBe(false)
  })

  /**
   * The re-link is `putAppGroupRequest` on its own route, and
   * `updateAppRequest` is `.strict()` so asking for it here is a **refusal**,
   * not a silent strip. The absence-pin this test used to carry (`'group_id'
   * in shape` is false, and a parse drops it) could not tell *refused* from
   * *quietly ignored* — which was the whole complaint about the shape before
   * it became strict, so the assertion is now the stronger one.
   */
  it('updateAppRequest refuses group_id — a rename cannot smuggle a re-link', () => {
    expect('group_id' in updateAppRequest.shape).toBe(false)
    expect(updateAppRequest.safeParse({ name: 'Renamed', group_id: GROUP }).success).toBe(false)
    // The fields it does carry still work, one at a time.
    expect(updateAppRequest.safeParse({ name: 'Renamed' }).success).toBe(true)
    expect(updateAppRequest.safeParse({}).success).toBe(true)
  })

  /**
   * D1 put the default role in *app settings*, and these two assertions are
   * what keep it from becoming three different fields. `null` is a legal
   * value on the row (an app that has not chosen one yet — every app, the
   * moment it is created), and on the PATCH `null` is how you take it back
   * off, which an `.optional()`-only field could never express.
   */
  it('default_role_id is required-and-nullable on the app row', () => {
    expect(app.safeParse({ ...APP_ROW, default_role_id: ROLE }).success).toBe(true)
    expect(app.safeParse({ ...APP_ROW, default_role_id: null }).success).toBe(true)
    const { default_role_id: _dropped, ...without } = APP_ROW
    expect(app.safeParse(without).success).toBe(false)
    expect(app.safeParse({ ...APP_ROW, default_role_id: 'observe' }).success).toBe(false)
  })

  it('updateAppRequest can set the default role and can clear it', () => {
    expect(updateAppRequest.safeParse({ default_role_id: ROLE }).success).toBe(true)
    expect(updateAppRequest.safeParse({ default_role_id: null }).success).toBe(true)
    // Absent is "leave it alone" — distinct from the explicit `null` above.
    expect('default_role_id' in updateAppRequest.parse({ name: 'Renamed' })).toBe(false)
    expect(updateAppRequest.safeParse({ default_role_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('updateAppRequest refuses any unknown key, not only group_id', () => {
    // Strictness is the property; `group_id` is one instance of it. A typo
    // (`mcp_enable`) must not read as "leave it unchanged" either.
    expect(updateAppRequest.safeParse({ name: 'Renamed', nam: 'x' }).success).toBe(false)
    expect(updateAppRequest.safeParse({ mcp_enable: true }).success).toBe(false)
    expect(updateAppRequest.safeParse({ identifier: 'renamed' }).success).toBe(false)
  })
})

describe('the refusals this model needs are registered codes', () => {
  /**
   * `last_owner` was emitted by the cloud for a whole wave without being in
   * this list — `sendError` takes a bare string, so nothing compared the two.
   * A consumer switching exhaustively over `ERROR_CODES` could not handle a
   * code the server actually sends.
   */
  it('registers last_owner, group_not_deletable and group_in_use', () => {
    expect(ERROR_CODES).toContain('last_owner')
    expect(ERROR_CODES).toContain('group_not_deletable')
    // Registered ahead of its producer so the routes task needs no second
    // contracts commit and re-pin for one string — and unproduced until then,
    // which its own doc comment says.
    expect(ERROR_CODES).toContain('group_in_use')
  })

  /**
   * The two group refusals are separate because their remedies are: emptying
   * a group clears `group_in_use` and will never clear `group_not_deletable`.
   * One code for both would send an owner looking for a way to empty a group
   * that no amount of emptying lets them delete.
   */
  it('keeps the two group refusals apart', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes.indexOf('group_in_use')).not.toBe(codes.indexOf('group_not_deletable'))
  })

  it('keeps them distinct from the silent-about-existence refusals', () => {
    const codes: readonly string[] = ERROR_CODES
    for (const code of ['forbidden', 'tier_required', 'not_found']) {
      expect(codes).toContain(code)
      expect(codes.indexOf('last_owner')).not.toBe(codes.indexOf(code))
      expect(codes.indexOf('group_not_deletable')).not.toBe(codes.indexOf(code))
    }
  })
})
