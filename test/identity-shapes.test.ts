/**
 * **The Fleetless-user half of the two identity spaces** (spec
 * `2026-09-05-app-user-auth`, D1): the org's team, its invitations and its
 * tiers. The per-app half is `app-users.test.ts`.
 *
 * These are behavioural pins, not a restatement of the schema. Each one names
 * the wrong outcome it exists to stop: a `password_hash` reaching the wire, a
 * team member arriving with no tier on the field that decides who can remove
 * whom, an invitation listing that hands back live credentials, an app shape
 * still carrying the group that owned it.
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import * as identity from '../src/identity.js'
import * as apps from '../src/apps.js'
import { ERROR_CODES } from '../src/errors.js'
import { app, createAppRequest, updateAppRequest } from '../src/index.js'
import {
  acceptTeamInviteRequest,
  authMeResponse,
  createTeamInviteRequest,
  fleetlessUser,
  fleetlessUserListResponse,
  orgAdminTier,
  patchFleetlessUserRequest,
  pendingTeamInvite,
  pendingTeamInviteListResponse,
  signUpResponse,
  teamInvite,
  tierChangeRequest,
  tierRequiredDetails,
  USER_DISPLAY_NAME_MAX,
} from '../src/index.js'

// zod 4's z.uuid() enforces version and variant nibbles, so
// `11111111-1111-1111-1111-111111111111` is refused (see org-events.test.ts).
const ORG = '11111111-4111-8111-9111-111111111111'
const USER = '22222222-4222-8222-9222-222222222222'
const APP = '44444444-4444-8444-9444-444444444444'
const ROLE = '55555555-4555-8555-9555-555555555555'
const NOW = '2026-09-05T10:00:00.000Z'

const VALID_USER = {
  id: USER,
  org_id: ORG,
  email: 'pilot@example.com',
  display_name: 'Pilot',
  tier: 'developer' as const,
  created_at: NOW,
}

describe('fleetlessUser — the team, and the wire says nothing about the credential', () => {
  it('accepts the full shape', () => {
    expect(fleetlessUser.safeParse(VALID_USER).success).toBe(true)
  })

  /**
   * The rule this platform keeps for server keys and provider secrets, applied
   * to the one shape a console renders on every page. A response that carries a
   * hash puts it in every log that ever captured a response.
   */
  it('has no password_hash field and strips one that is offered', () => {
    expect('password_hash' in fleetlessUser.shape).toBe(false)
    const parsed = fleetlessUser.parse({ ...VALID_USER, password_hash: 'argon2id$...' })
    expect('password_hash' in parsed).toBe(false)
  })

  /**
   * **The tier became required with the two-space cut, and that is the point of
   * this test.** It was optional while the org also held people with no console
   * powers to grade, and *"we did not load it"* was then indistinguishable from
   * *"they are an ordinary user"* on the field that decides who may delete the
   * org. There are no such people any more, so an absent tier is a mapper bug
   * and must not parse.
   */
  it('requires the tier: an absent one used to be a state and is now a bug', () => {
    const { tier, ...withoutTier } = VALID_USER
    void tier
    expect(fleetlessUser.safeParse(withoutTier).success).toBe(false)
    expect(fleetlessUser.safeParse({ ...VALID_USER, tier: 'owner' }).success).toBe(true)
  })

  it('refuses the pre-redesign tier name "member" — the rename is not an alias', () => {
    expect(fleetlessUser.safeParse({ ...VALID_USER, tier: 'member' }).success).toBe(false)
    expect(orgAdminTier.options).toEqual(['owner', 'developer'])
  })

  /**
   * Required-but-nullable rather than optional, so an absent key is not
   * silently read as "no name" — the distinction a `.optional()` would erase.
   */
  it('display_name is required-but-nullable', () => {
    const { display_name, ...withoutName } = VALID_USER
    void display_name
    expect(fleetlessUser.safeParse(withoutName).success).toBe(false)
    expect(fleetlessUser.safeParse({ ...VALID_USER, display_name: null }).success).toBe(true)
    expect(fleetlessUser.safeParse({ ...VALID_USER, display_name: '' }).success).toBe(false)
    expect(
      fleetlessUser.safeParse({ ...VALID_USER, display_name: 'x'.repeat(USER_DISPLAY_NAME_MAX + 1) }).success,
    ).toBe(false)
  })

  it('email must look like an address', () => {
    expect(fleetlessUser.safeParse({ ...VALID_USER, email: 'not-an-address' }).success).toBe(false)
  })

  /**
   * `has_password`, `group_id` and `mcp_access` all left this shape. The first
   * is the interesting one: it existed because a pool user might have been
   * provisioned by an identity provider and hold no Fleetless credential. The
   * console is password-only by design, so the field would report one value
   * forever — and a field with one value reads as a guarantee somebody will
   * eventually branch on.
   */
  it('carries none of the fields the deleted pool model needed', () => {
    for (const gone of ['group_id', 'mcp_access', 'has_password']) {
      expect(gone in fleetlessUser.shape, gone).toBe(false)
    }
  })
})

describe('the team invitation', () => {
  const VALID_INVITE = {
    id: USER,
    email: 'new@example.com',
    tier: 'developer' as const,
    expires_at: NOW,
    accept_url: 'https://auth.fleetless.dev/accept-invite/abc',
    mail: 'sent' as const,
  }

  /**
   * **`tier` is required on the create request, and that is the whole shape of
   * this invitation.** With an optional tier, *"I did not think about it"* and
   * *"I meant developer"* are the same request on the field that decides who
   * can remove whom.
   */
  it('createTeamInviteRequest requires the tier rather than defaulting it', () => {
    expect(
      createTeamInviteRequest.safeParse({ email: 'a@b.com', tier: 'owner', send_mail: false }).success,
    ).toBe(true)
    expect(createTeamInviteRequest.safeParse({ email: 'a@b.com', send_mail: false }).success).toBe(false)
  })

  it('createTeamInviteRequest never carries a password — the invitee sets one when accepting', () => {
    expect('password' in createTeamInviteRequest.shape).toBe(false)
    expect(
      createTeamInviteRequest.safeParse({ email: 'a@b.com', tier: 'owner', send_mail: false, password: 'x'.repeat(12) })
        .success,
    ).toBe(false)
  })

  it('createTeamInviteRequest carries no group, role or app — the deleted model had all three', () => {
    for (const gone of ['group_id', 'role_id', 'app_id', 'mcp_access']) {
      expect(gone in createTeamInviteRequest.shape, gone).toBe(false)
    }
  })

  it('the issued invitation carries a usable link and a mail status', () => {
    expect(teamInvite.safeParse(VALID_INVITE).success).toBe(true)
    expect(teamInvite.safeParse({ ...VALID_INVITE, mail: 'not_configured' }).success).toBe(true)
    expect(teamInvite.safeParse({ ...VALID_INVITE, mail: 'maybe' }).success).toBe(false)
  })

  /**
   * The Fleetless portal is a page this platform does serve, so a team
   * invitation always has a link — unlike an app invitation, whose link points
   * into the developer's app and is `null` when no `invite_url` is configured.
   * Pinned as a pair so the two do not drift into one rule.
   */
  it('the team accept link is never null, where an app invitation link can be', () => {
    expect(teamInvite.safeParse({ ...VALID_INVITE, accept_url: null }).success).toBe(false)
  })

  it('bounds the accept link — an unbounded URL on a mailed shape is a size nobody chose', () => {
    const long = `https://auth.fleetless.dev/accept-invite/${'a'.repeat(500)}`
    expect(teamInvite.safeParse({ ...VALID_INVITE, accept_url: long }).success).toBe(false)
  })

  /**
   * The listing exists so an owner can spot an invitation they did not
   * authorise and revoke it. Neither act needs the token, and a list carrying
   * one turns every screenshot and log line of that page into live credentials.
   */
  it('the list entry has no accept_url and no mail status, and strips an offered one', () => {
    expect('accept_url' in pendingTeamInvite.shape).toBe(false)
    expect('mail' in pendingTeamInvite.shape).toBe(false)
    const parsed = pendingTeamInvite.parse(VALID_INVITE)
    expect('accept_url' in parsed).toBe(false)
    expect(parsed.tier).toBe('developer')
  })

  it('the list is never null — "nothing outstanding" and "we did not look" must differ', () => {
    expect(pendingTeamInviteListResponse.safeParse({ invitations: [] }).success).toBe(true)
    expect(pendingTeamInviteListResponse.safeParse({}).success).toBe(false)
  })

  it('accepting spends a token and sets the password, under the shared length rule', () => {
    expect(acceptTeamInviteRequest.safeParse({ token: 'tok', password: 'x'.repeat(12) }).success).toBe(true)
    expect(acceptTeamInviteRequest.safeParse({ token: 'tok', password: 'short' }).success).toBe(false)
    expect(acceptTeamInviteRequest.safeParse({ token: '', password: 'x'.repeat(12) }).success).toBe(false)
    expect(
      acceptTeamInviteRequest.safeParse({ token: 'tok', password: 'x'.repeat(12), tier: 'owner' }).success,
    ).toBe(false)
  })
})

describe('patchFleetlessUserRequest — email is immutable, and a tier change is not a patch', () => {
  it('accepts what a team edit may actually change', () => {
    expect(patchFleetlessUserRequest.safeParse({ display_name: 'Ada' }).success).toBe(true)
    expect(patchFleetlessUserRequest.safeParse({ display_name: null }).success).toBe(true)
    expect(patchFleetlessUserRequest.safeParse({}).success).toBe(true)
  })

  /**
   * Strict, so an offered field is a refusal rather than a silent drop — the
   * failure mode this project has already paid for once, where *field sent* and
   * *field missing* produced the same outcome.
   */
  it('refuses email, tier and any other stray key outright', () => {
    expect(patchFleetlessUserRequest.safeParse({ email: 'new@example.com' }).success).toBe(false)
    expect(patchFleetlessUserRequest.safeParse({ tier: 'owner' }).success).toBe(false)
    expect(patchFleetlessUserRequest.safeParse({ display_name: 'Ada', anything: 1 }).success).toBe(false)
  })

  it('rejects an out-of-bounds display name', () => {
    expect(
      patchFleetlessUserRequest.safeParse({ display_name: 'x'.repeat(USER_DISPLAY_NAME_MAX + 1) }).success,
    ).toBe(false)
  })
})

describe('tierChangeRequest — owner|developer, and nothing else on the wire', () => {
  it('accepts the two tiers and refuses the retired name', () => {
    expect(tierChangeRequest.safeParse({ tier: 'owner' }).success).toBe(true)
    expect(tierChangeRequest.safeParse({ tier: 'developer' }).success).toBe(true)
    expect(tierChangeRequest.safeParse({ tier: 'member' }).success).toBe(false)
  })

  it('is strict and requires the field', () => {
    expect(tierChangeRequest.safeParse({}).success).toBe(false)
    expect(tierChangeRequest.safeParse({ tier: 'owner', user_id: USER }).success).toBe(false)
  })

  it('tierRequiredDetails speaks the tiers on both sides, and says nothing about the target', () => {
    expect(tierRequiredDetails.safeParse({ required: 'owner', actual: 'developer' }).success).toBe(true)
    expect(tierRequiredDetails.safeParse({ required: 'owner', actual: 'developer', target_id: USER }).success).toBe(true)
    expect('target_id' in tierRequiredDetails.shape).toBe(false)
  })
})

describe('the session shapes speak the new model', () => {
  it('fleetlessUserListResponse carries the team, never null', () => {
    expect(fleetlessUserListResponse.safeParse({ users: [] }).success).toBe(true)
    expect(fleetlessUserListResponse.safeParse({}).success).toBe(false)
    expect(fleetlessUserListResponse.safeParse({ users: [VALID_USER] }).success).toBe(true)
  })

  /**
   * The route always answered with a tier here and the shape could not say so,
   * which is precisely the gap between a route's guarantee and a contract. The
   * required tier on `fleetlessUser` closes it, so this asserts the *absence*
   * of a tier is now refused by the response shape itself.
   */
  it('authMeResponse answers a Fleetless user whose tier is not optional', () => {
    expect(authMeResponse.safeParse({ org: { id: ORG, name: 'Acme', created_at: NOW }, user: VALID_USER }).success).toBe(true)
    const { tier, ...noTier } = VALID_USER
    void tier
    expect(authMeResponse.safeParse({ org: { id: ORG, name: 'Acme', created_at: NOW }, user: noTier }).success).toBe(false)
  })

  it('signUpResponse hands back the founding owner as a Fleetless user', () => {
    expect(
      signUpResponse.safeParse({
        org: { id: ORG, name: 'Acme', created_at: NOW },
        user: { ...VALID_USER, tier: 'owner' },
        tokens: { access_token: 'a', refresh_token: 'r', expires_in: 900 },
      }).success,
    ).toBe(true)
  })
})

describe('the group-and-assignment model is gone from the contract', () => {
  /**
   * A greenfield cut: the deleted shapes must not come back as aliases, because
   * an alias is how a deleted model quietly survives. This is the check that
   * the deletion stays done — and the previous version of this list earned its
   * keep by missing one shape for a round, during which a reviewer re-added
   * both the shape and its barrel export with the whole suite green.
   */
  const DELETED = [
    // The org pool and its group machinery.
    'orgUser',
    'orgUserListResponse',
    'orgGroup',
    'groupListResponse',
    'createGroupRequest',
    'patchGroupRequest',
    'groupUsageResponse',
    'groupFilterQuery',
    'groupPreviewQuery',
    'moveUserGroupRequest',
    'putAppGroupRequest',
    'GROUP_NAME_MAX',
    'ORG_ADMINS_GROUP_DEFAULT_NAME',
    'mcpAccess',
    // Assignments: access is the app user's own row now.
    'appAssignment',
    'appAssignmentListResponse',
    'putAssignmentRequest',
    // The team invitation family under its old names.
    'createUserInviteRequest',
    'userInvite',
    'pendingUserInvite',
    'userInviteListResponse',
    'acceptUserInviteRequest',
    'patchUserRequest',
    // Federation at org and group scope, and impersonation.
    'orgFederationPolicy',
    'orgFederationPolicyRequest',
    'groupOidcProvider',
    'putGroupOidcProviderRequest',
    'jitGrant',
    'idpClaimMapping',
    'idpConfig',
    'idpConfigRequest',
    'impersonationChoice',
    // The per-app end-user pool this model had already replaced once.
    'endUser',
    'selfRegistration',
    'orgMember',
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
   * `appMembership` and `brandingConfig` lived in `apps.ts`, so the module
   * check above passes vacuously for them — they were never `identity` exports.
   * The barrel check binds; this pins the module they actually have to be
   * absent from, and asserts a live symbol so the check is not itself vacuous.
   */
  it('exports appMembership and brandingConfig from neither the apps module nor the barrel', () => {
    expect('appMembership' in apps).toBe(false)
    expect('brandingConfig' in apps).toBe(false)
    expect('brandingConfig' in barrel).toBe(false)
    expect('app' in apps).toBe(true)
  })
})

describe('an app no longer belongs to a group', () => {
  const APP_ROW = {
    id: APP,
    org_id: ORG,
    name: 'Warehouse ops',
    identifier: 'warehouse_ops',
    robot_ids: [],
    default_role_id: ROLE,
    created_at: NOW,
  }

  it('accepts an app row with neither group_id nor accepts_dynamic_clients', () => {
    expect(app.safeParse(APP_ROW).success).toBe(true)
    for (const gone of ['group_id', 'accepts_dynamic_clients']) {
      expect(gone in app.shape, gone).toBe(false)
    }
  })

  it('creation needs a name and an identifier and nothing else', () => {
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops' }).success).toBe(true)
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', group_id: ORG }).success).toBe(false)
    expect(
      createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', accepts_dynamic_clients: true }).success,
    ).toBe(false)
  })

  it('updateAppRequest refuses the two retired fields rather than dropping them', () => {
    expect(updateAppRequest.safeParse({ name: 'Ops 2' }).success).toBe(true)
    expect(updateAppRequest.safeParse({ group_id: ORG }).success).toBe(false)
    expect(updateAppRequest.safeParse({ accepts_dynamic_clients: false }).success).toBe(false)
    expect(updateAppRequest.safeParse({ name: 'Ops 2', anything: 1 }).success).toBe(false)
  })

  /**
   * `default_role_id` gained a server-side reader with this cut: it is the role
   * an app user gets when a create or invite omits one. Still nullable, because
   * an app is created before its roles are.
   */
  it('default_role_id is required-and-nullable on the app row, and settable and clearable on the patch', () => {
    expect(app.safeParse({ ...APP_ROW, default_role_id: null }).success).toBe(true)
    const { default_role_id, ...withoutIt } = APP_ROW
    void default_role_id
    expect(app.safeParse(withoutIt).success).toBe(false)
    expect(updateAppRequest.safeParse({ default_role_id: ROLE }).success).toBe(true)
    expect(updateAppRequest.safeParse({ default_role_id: null }).success).toBe(true)
  })
})

describe('the refusals this model needs are registered codes', () => {
  const codes = new Set<string>(ERROR_CODES)

  it('registers the codes the team routes answer', () => {
    for (const code of ['last_owner', 'tier_required', 'email_taken', 'token_spent', 'target_state_conflict']) {
      expect(codes.has(code), code).toBe(true)
    }
  })

  /**
   * The group refusals and the per-user MCP refusal named states this model no
   * longer has. Removing an enum member is a change consumers absorb, and the
   * alternative — a code standing for a state nothing can enter — is the
   * "documented absence" this list keeps paying for.
   */
  it('has dropped the codes whose states no longer exist', () => {
    for (const code of ['group_not_deletable', 'group_in_use', 'mcp_access_denied', 'identity_conflict', 'identity_not_provisioned']) {
      expect(codes.has(code), code).toBe(false)
    }
  })

  it('registers the codes the app-user surface introduces', () => {
    for (const code of [
      'registration_closed',
      'domain_not_allowed',
      'email_unverified',
      'origin_not_allowed',
      'template_invalid',
      'provider_disabled',
      'invalid_redirect_uri',
      'interaction_expired',
    ]) {
      expect(codes.has(code), code).toBe(true)
    }
  })

  it('keeps the honest policy refusals distinct from the silent-about-existence ones', () => {
    for (const code of ['forbidden', 'not_found', 'invalid_credentials']) {
      expect(codes.has(code), code).toBe(true)
    }
    expect(codes.has('registration_closed')).toBe(true)
  })
})
