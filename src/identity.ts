import { z } from 'zod'
import { appIdentifier } from './apps.js'

/**
 * Identity, **one pool per organisation** (spec
 * `2026-08-29-org-identity-redesign`, D1/D2/D6).
 *
 * The two identity spaces this file used to keep apart — *developers*, who own
 * an org and use the console, and *end users*, who belong to an app's pool —
 * are **merged**. There is one `users` table per org; every user belongs to
 * exactly one group; the **Org Admins** group is the only path into the
 * console and its members additionally carry a `tier` (`owner | developer`).
 * Access to an app is explicit: an `appAssignment` per (user, app) with a role.
 *
 * What that deleted, with no successor (D6): the per-app end-user pool shapes,
 * per-app self-registration, per-app invitations, and `org_members` as a thing
 * of its own. What it did **not** delete: the password rules, the session and
 * token shapes, and the enumeration-oracle reasoning on password reset — those
 * were never statements about which space a person lived in.
 *
 * **The one thing this merge loosened, said out loud:** `org_members.email`
 * was *globally* unique, and `users.email` is unique **per org** (D1). Every
 * shape here that identifies a person by a bare address — `developerLoginRequest`,
 * `passwordResetRequest` — therefore names something that can now match one
 * account *per org*. A schema cannot fix that; the resolution belongs to the
 * cloud's login path and is named on those shapes rather than implied away.
 */

/**
 * The password rule, stated once so the cloud, the console and the SDK refuse
 * the same inputs for the same reason. Length only: a rule a user cannot
 * predict is a rule they work around.
 */
export const password = z.string().min(12).max(256)

/** Group and user display names share one bound, so a rename cannot be legal in one place and refused in another. */
export const GROUP_NAME_MAX = 120
export const USER_DISPLAY_NAME_MAX = 120

/**
 * The name the Org Admins group is **created** with — and that is the whole of
 * what this constant says.
 *
 * The group is renamable (D1), so this value describes exactly one moment in
 * its life. **Nothing may identify the group by this string**: `is_org_admins`
 * is the fact, and a consumer matching on the name will silently stop finding
 * the group the day somebody renames it to "Platform team". Exported so the
 * cloud's org creation and any seed agree on the starting value, not so that
 * anyone can look the group up by it.
 */
export const ORG_ADMINS_GROUP_DEFAULT_NAME = 'Org Admins'

/**
 * The two tiers **inside the Org Admins group** (D1). Owner-exclusive: delete
 * the org, edit org settings, promote to owner, and later billing. Everything
 * else an org admin may do, a `developer` may do.
 *
 * `member` was renamed to `developer` in the redesign and is **not** accepted
 * as an alias anywhere — a wire that took both would leave two names for one
 * tier in every log, every audit detail and every console fixture, and the
 * older one would keep arriving forever.
 *
 * **This says nothing about anybody outside the Org Admins group.** A user in
 * a customer group has no tier at all; see `orgUser.tier`.
 */
export const orgAdminTier = z.enum(['owner', 'developer'])
export type OrgAdminTier = z.infer<typeof orgAdminTier>

/**
 * The per-user MCP override (D5's gating half, stored here).
 *
 * - `default` — follow the user's group (`orgGroup.mcp_enabled`).
 * - `allowed` — this user may use the MCP server even if their group does not.
 * - `denied`  — this user may not, whatever their group says.
 *
 * **This is the data model only. Nothing in this plan enforces it** — the
 * central-MCP plan is where the flag starts deciding anything, at token issue
 * *and* on every request. Said here because a stored permission field that
 * looks enforced is exactly the kind of second door this project keeps finding:
 * a console showing `denied` while every call still succeeds is worse than no
 * field at all.
 */
export const mcpAccess = z.enum(['default', 'allowed', 'denied'])
export type McpAccess = z.infer<typeof mcpAccess>

export const org = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
})
export type Org = z.infer<typeof org>

/**
 * **A group: the unit that owns apps, carries the auth provider, and gates the
 * MCP** (D1, D2). Exactly one group per org has `is_org_admins`; it is
 * renamable and never deletable.
 *
 * `member_count` and `app_count` are **computed when the row is read**. They
 * are there so a console list does not have to issue a query per row, and they
 * cannot say anything about the moment a caller acts on them: a group that
 * reads `member_count: 0` may have gained a member since. Anything destructive
 * re-counts server-side inside the transaction — these numbers are for showing,
 * never for deciding.
 */
export const orgGroup = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  name: z.string().min(1).max(GROUP_NAME_MAX),
  /**
   * **A server fact, never a request field.** The Org Admins group is created
   * with the org and is the only path into the console, so a caller able to
   * set this could mint themselves console access. Neither
   * `createGroupRequest` nor `patchGroupRequest` carries it, and both are
   * `.strict()` so offering it is a refusal rather than a silent drop.
   */
  is_org_admins: z.boolean(),
  /** Whether this group's users may reach the central MCP server — see `mcpAccess` for what is and is not enforced yet. */
  mcp_enabled: z.boolean(),
  member_count: z.number().int().nonnegative(),
  app_count: z.number().int().nonnegative(),
  created_at: z.iso.datetime(),
})
export type OrgGroup = z.infer<typeof orgGroup>

/**
 * **A user of the org's one pool** (D1) — the shape that replaced both
 * `orgMember` and `endUser`.
 *
 * `email` is **unique within the org**, and that is a constraint the cloud
 * enforces in the database; a schema cannot see two rows at once and this one
 * makes no claim to. Two orgs may hold the same address, and they are two
 * different people as far as anything here can tell.
 *
 * That is a **loosening** — `org_members.email` was globally unique — so a
 * bare address no longer resolves to one account on the login and reset
 * routes. Settled without a contract change (Andre, 2026-08-29): console login
 * verifies the password against every candidate row and refuses a double
 * match; reset mails every match with an org-scoped token. Both shapes stay
 * `{ email, … }`, which is precisely why that option was chosen.
 */
export const orgUser = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  /**
   * Optional human name, shown by the console instead of the email where
   * present. Self-service via `PATCH /api/auth/me`; never used for auth.
   */
  display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable(),
  /** Exactly one, always (D1). Moving is a deliberate act — see `moveUserGroupRequest`. */
  group_id: z.uuid(),
  /**
   * **The wire's only statement about the Fleetless credential, and it is one
   * bit on purpose.** No hash, no algorithm, no "last changed" — a response
   * that carries a hash puts it in every log that ever captured a response,
   * and this platform has already written that rule down for server keys and
   * IdP secrets.
   *
   * `false` means *this user has no Fleetless password* — an OIDC-provisioned
   * user, or an invitation not yet accepted. It does **not** mean blocked, and
   * it does **not** mean without access: such a user signs in through their
   * group's provider and a password reset answers them the same silent way as
   * an unknown address (D4).
   *
   * What it cannot say: whether the password is strong, old, or already known
   * to somebody else. Nothing on the wire can, and a field that looked like it
   * could would be read as an assurance.
   */
  has_password: z.boolean(),
  mcp_access: mcpAccess,
  /**
   * **Present only for members of the Org Admins group — and absent means "not
   * applicable", never "unknown".**
   *
   * A tier is a statement about console powers, and a user in a customer group
   * has none to grade; giving them a `developer` tier would invent a rank the
   * model does not have, and defaulting one would make "we did not load it"
   * indistinguishable from "they are an ordinary user" on the field that
   * decides who may delete the org.
   *
   * The schema cannot check the pairing: it sees a `group_id`, not whether
   * that group is the Org Admins one. The cloud is what refuses a tier on a
   * user outside that group and requires one inside it.
   */
  tier: orgAdminTier.optional(),
  created_at: z.iso.datetime(),
})
export type OrgUser = z.infer<typeof orgUser>

/**
 * **Explicit access: one (user, app) pair, one role** (D2). Without a row
 * here, a group user cannot log into the app at all — a group membership is
 * not access, it only makes access *assignable*.
 *
 * Two constraints the cloud enforces and this shape cannot see: the pair is
 * unique, and the app must belong to the user's group.
 *
 * **An empty assignment list for an org admin is not "no access".** Org Admins
 * never have assignments and may reach every app of the org through the
 * impersonation step (D4) — so a console that renders "no apps" from an empty
 * list is right for a customer-group user and wrong for an admin.
 */
export const appAssignment = z.object({
  user_id: z.uuid(),
  app_id: z.uuid(),
  role_id: z.uuid(),
})
export type AppAssignment = z.infer<typeof appAssignment>

/** `GET /api/org/groups` — never null: "this org has no custom groups" is `{ groups: [orgAdmins] }`, not an absent key. */
export const groupListResponse = z.object({ groups: z.array(orgGroup) })
export type GroupListResponse = z.infer<typeof groupListResponse>

/** `GET /api/org/users` — the whole pool, org admins included; filter by `group_id` client-side or per the route's query. */
export const orgUserListResponse = z.object({ users: z.array(orgUser) })
export type OrgUserListResponse = z.infer<typeof orgUserListResponse>

/** `GET /api/org/users/:id/assignments` and `GET /api/apps/:id/assignments` — see `appAssignment` on why an empty list is not an answer about admins. */
export const appAssignmentListResponse = z.object({ assignments: z.array(appAssignment) })
export type AppAssignmentListResponse = z.infer<typeof appAssignmentListResponse>

/**
 * Access plus refresh (spec §3.4). The access token is short-lived; the
 * refresh token rotates on every use, so a stolen one is detectable when the
 * original is presented again.
 */
export const sessionTokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})
export type SessionTokens = z.infer<typeof sessionTokens>

export const refreshRequest = z.object({ refresh_token: z.string().min(1) })
export type RefreshRequest = z.infer<typeof refreshRequest>

/**
 * Registering an org creates the org and its first owner in one step
 * (André, 2026-08-10): whoever registers the organisation is the owner.
 */
export const signUpRequest = z.object({
  org_name: z.string().min(1).max(120),
  email: z.email(),
  password,
})
export type SignUpRequest = z.infer<typeof signUpRequest>

/**
 * Registering answers with the founding **user** — an Org Admins member with
 * `tier: 'owner'` — where it used to answer with an `orgMember`. The key is
 * `user`, not `member`, deliberately: a renamed shape under the old key would
 * typecheck in every consumer that reads `.member.id` and mean something
 * subtly different, which is the quietest way for a merge like this to go
 * wrong.
 */
export const signUpResponse = z.object({
  org,
  user: orgUser,
  tokens: sessionTokens,
})
export type SignUpResponse = z.infer<typeof signUpResponse>

/**
 * Console login. Org Admins members only, always the Fleetless provider — a
 * group's OIDC provider never governs the console (D3), which removes the
 * IdP-lockout class entirely.
 *
 * **The residual D1 introduced, named rather than implied away:** this
 * resolves a person by address alone, and `users.email` is unique only *per
 * org*. Under `org_members` the address was globally unique and the schema
 * comment in the cloud said so explicitly — *"developer login takes only email
 * + password, no org context to disambiguate with"*. One address can now be an
 * org admin in two orgs, and nothing in this shape can tell the cloud which
 * one is meant.
 *
 * **Settled without changing this shape** (Andre, 2026-08-29): the login
 * verifies the password against every candidate row and refuses a double
 * match — an outcome nobody can provoke without already holding a password
 * that works in two orgs. The alternative, an org selector, would have told an
 * unauthenticated caller which orgs an address belongs to.
 */
export const developerLoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type DeveloperLoginRequest = z.infer<typeof developerLoginRequest>

/**
 * An invitation carries its own accept URL: the link is the primary path
 * (the developer shares it), mail is the second. A cloud with no SMTP
 * configured still issues invitations — it just cannot send them, and says so
 * via `mail_sent`.
 */
/**
 * What happened to the mail, in three words instead of one (W6c).
 *
 * `mail_sent: boolean` could not tell **"we have no SMTP configured"** from
 * **"we tried and the server refused"**, so the console had to pick a sentence
 * for a cause it could not know — and picked the reassuring one, because a
 * link-only invitation is a normal outcome and a bounced one is not. The two
 * need opposite actions from whoever reads them: configure a mail server, or
 * go and look at why the existing one rejected the message.
 *
 * - `sent`           — the SMTP server accepted the message. Not "delivered":
 *                      no sender can promise that, and this value must never
 *                      be rendered as if it could.
 * - `not_configured` — no SMTP is set up. **An expected state, not a failure**
 *                      (spec §3.2: invitations work without mail; the link is
 *                      the primary path). The console must not show it as an
 *                      error.
 * - `failed`         — SMTP was configured, was tried, and refused or was
 *                      unreachable. This one is worth someone's attention.
 */
export const mailStatus = z.enum(['sent', 'not_configured', 'failed'])
export type MailStatus = z.infer<typeof mailStatus>

/* ------------------------------------------- the org-central identity core --
 * Groups, users, assignments and tiers. One invitation shape, because there is
 * one pool: the two invitation families this file used to carry (developer,
 * end user) were the clearest expression of a split D1 deleted.
 */

/**
 * **Inviting a person into the org's pool — the only way a user appears
 * without an OIDC provider behind them** (D1, D3).
 *
 * One shape for every user, admin or not: the split that justified two of
 * these ("a credential from one space must never authenticate the other") is
 * gone with the spaces. What decides what the invitee becomes is `group_id`.
 *
 * `tier` is accepted **only when that group is the Org Admins group**, and the
 * schema cannot check that — it sees a uuid. The cloud refuses a tier for any
 * other group and requires one for that group, for the reason the old
 * developer invitation gave and which survived the redesign intact: *"I did
 * not think about it" and "I meant developer" produce the same request
 * otherwise, on the field that decides who can remove whom.*
 *
 * **No role and no app here.** An invitation puts somebody in a group;
 * `putAssignmentRequest` is what gives them an app. Folding an assignment into
 * the invite would make the two acts one audit event and one refusal, and the
 * app-belongs-to-the-user's-group constraint would then be checked against a
 * group the user does not yet have.
 */
export const createUserInviteRequest = z
  .object({
    email: z.email(),
    display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().optional(),
    group_id: z.uuid(),
    /** Org Admins group only — see above; the cloud, not the schema, enforces the pairing. */
    tier: orgAdminTier.optional(),
    /** Absent means `default`: follow the group. Data model only until the MCP plan. */
    mcp_access: mcpAccess.optional(),
    send_mail: z.boolean(),
  })
  .strict()
export type CreateUserInviteRequest = z.infer<typeof createUserInviteRequest>

/**
 * The invitation as issued. The **link is the primary path** and mail is the
 * second, so this is complete and usable with `mail: 'not_configured'` — a
 * deployment with no SMTP still issues invitations, it just cannot send them
 * and says so.
 */
export const userInvite = z.object({
  id: z.uuid(),
  email: z.email(),
  group_id: z.uuid(),
  expires_at: z.iso.datetime(),
  /** Bounded like `idpIssuer`: an unbounded URL on a shape that gets mailed, logged and rendered is a size nobody chose. */
  accept_url: z.url().max(500),
  /** Replaces `mail_sent: boolean` — see `mailStatus` for why one bit was not enough. */
  mail: mailStatus,
})
export type UserInvite = z.infer<typeof userInvite>

/**
 * A pending invitation as an Owner sees it in the list — **without its
 * `accept_url`**, and that omission is the point.
 *
 * The list exists so an Owner can see what is outstanding and revoke it. Neither
 * of those needs the token, and a list that carries it turns every screenshot,
 * every log line and every browser history entry of that page into live
 * credentials for somebody else's account. It is the same rule
 * `auditEvent.details` already states — *never credentials, never tokens* —
 * applied to a read surface rather than a write one.
 *
 * There is no escalation either way: an Owner can already create an invitation
 * for any address. The reason to withhold it is not what an Owner could do with
 * it, but that a page nobody thinks of as sensitive stops being sensitive.
 *
 * `mail` is omitted for a duller reason: it described what happened at creation
 * time, and re-serving it in a list invites a reader to take it as current.
 */
export const pendingUserInvite = z.object({
  id: z.uuid(),
  email: z.email(),
  group_id: z.uuid(),
  expires_at: z.iso.datetime(),
})
export type PendingUserInvite = z.infer<typeof pendingUserInvite>

export const userInviteListResponse = z.object({
  /** Pending only. An accepted invitation is history, not something to revoke. */
  invitations: z.array(pendingUserInvite),
})
export type UserInviteListResponse = z.infer<typeof userInviteListResponse>

/** Accepting it: the token proves the invitation, the password creates the login. */
export const acceptUserInviteRequest = z.object({
  token: z.string().min(1),
  password,
})
export type AcceptUserInviteRequest = z.infer<typeof acceptUserInviteRequest>

/**
 * `PATCH /api/org/users/:id` — **what an admin may change about a user, and
 * the two things that are absent rather than merely un-required.**
 *
 * `email` is not here. It is the org-unique identifier of the account, the
 * value every invitation, reset link and audit line names, and a PATCH that
 * could change it is both an account-takeover surface and a uniqueness race.
 * *Immutable after create* is a sentence a strict schema can actually keep:
 * offering `email` is a refusal, not a silently ignored field — which is the
 * failure mode this project has already paid for once (`toHaveBeenCalledWith`
 * could not tell *field sent* from *field missing*).
 *
 * `group_id` is not here either, and neither is `tier`. Both have consequences
 * a PATCH body cannot carry: a move deletes assignments (see
 * `moveUserGroupRequest`) and a tier change is owner-only with a last-owner
 * guard (`tierChangeRequest`). Merging them in would give one route three
 * refusal reasons and one audit event.
 */
export const patchUserRequest = z
  .object({
    display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().optional(),
    mcp_access: mcpAccess.optional(),
  })
  .strict()
export type PatchUserRequest = z.infer<typeof patchUserRequest>

/**
 * **A group move, and the acknowledgement that makes it a decision rather than
 * a surprise** (spec, error handling: *"cascade-deletes now-invalid
 * assignments — only behind an explicit confirm with counts"*).
 *
 * An app belongs to exactly one group, so moving a user out of a group deletes
 * every assignment of theirs that named an app of the old group. That is
 * silent data loss dressed as a routine edit.
 *
 * **Why a shape of its own rather than an optional `group_id` on
 * `patchUserRequest` with a conditional acknowledgement** (the alternative the
 * brief offered): a conditional requirement is a guard that has to fire, and
 * this project's own list of failure modes has *"a narrowing condition that
 * makes the guard unreachable"* in it twice. Here the requirement is
 * unconditional — there is no request of this shape without an
 * acknowledgement, and no code path that has to remember to look.
 *
 * **`z.literal(true)`, not `z.boolean()`.** With a boolean,
 * `{ acknowledge_assignment_loss: false }` is a well-formed request whose
 * meaning the route must interpret, and "the caller said no" would arrive at
 * the handler looking exactly like "the caller said yes" to anyone reading the
 * key's presence. The literal makes the refusal the schema's, and identical
 * for an omitted flag and a `false` one.
 *
 * **What the acknowledgement cannot say:** that the caller saw *this* preview.
 * `groupUsageResponse` is fetched before the move and the counts can change in
 * between; nothing here carries the number back for the server to compare
 * against. A confirm-with-counts is an interface promise, not a lock — if that
 * window ever matters, the fix is echoing the counts, not a stronger boolean.
 */
export const moveUserGroupRequest = z
  .object({
    group_id: z.uuid(),
    acknowledge_assignment_loss: z.literal(true),
  })
  .strict()
export type MoveUserGroupRequest = z.infer<typeof moveUserGroupRequest>

/**
 * **Re-linking an app to another group — the same cascade, from the other
 * side** (D2). Every assignment naming this app whose user is not in the new
 * group dies with the change; one such move can cut a whole team off at once,
 * which is why the acknowledgement is the identical literal and not a laxer
 * one.
 *
 * Deliberately not folded into the app's own PATCH: an app rename must not be
 * able to arrive carrying a group change, and this route's refusals are about
 * groups rather than about apps.
 */
export const putAppGroupRequest = z
  .object({
    group_id: z.uuid(),
    acknowledge_assignment_loss: z.literal(true),
  })
  .strict()
export type PutAppGroupRequest = z.infer<typeof putAppGroupRequest>

/**
 * `PUT /api/org/users/:userId/assignments/:appId` — **give this user this app,
 * in this role.** Idempotent: the same call with a different `role_id` changes
 * the role, which is why it is a PUT and not a POST.
 *
 * The body carries only the role. The user and the app are in the path and
 * repeating them in the body creates a request that can disagree with itself —
 * and then a handler that has to choose which half to believe.
 *
 * Two things the cloud checks and this cannot: that `role_id` belongs to *this
 * app's* role set, and that the app belongs to the user's group.
 */
export const putAssignmentRequest = z.object({ role_id: z.uuid() }).strict()
export type PutAssignmentRequest = z.infer<typeof putAssignmentRequest>

/**
 * `PUT /api/org/users/:id/tier` — **owner-only, and the last owner is
 * neither demotable nor deletable** (D1; the rule carries over unchanged from
 * the Owner/Member world, refused with 409 `last_owner`).
 *
 * Legal only for a member of the Org Admins group: there is no tier to change
 * on anybody else. `tier_required` keeps its exact semantics — it says what
 * the *caller's* tier is and what was needed, and nothing about the target.
 */
export const tierChangeRequest = z.object({ tier: orgAdminTier }).strict()
export type TierChangeRequest = z.infer<typeof tierChangeRequest>

/**
 * **The blast radius of a group change, fetched before the confirmation** —
 * the `slugUsageResponse` pattern, applied to the other destructive edit this
 * platform has.
 *
 * Two callers, one shape: *move user U into group G* and *re-link app A to
 * group G*. Both answer the same question — which assignments would this
 * delete — and splitting the shape would give the console two dialogs to keep
 * in step for one sentence.
 *
 * `target_group_id` is echoed for `orgLatencyResponse`'s reason: a rendered
 * count has to be able to say which proposal it describes, or a stale response
 * confirms the wrong change.
 *
 * **These counts are for showing, not for deciding.** The transaction that
 * performs the move re-counts server-side; between this read and that write a
 * new assignment can appear. A preview that could promise otherwise would be
 * claiming a lock it does not hold.
 */
export const groupUsageResponse = z.object({
  /** The group the change would move the subject **into**. */
  target_group_id: z.uuid(),
  /** Assignments the change would delete. `0` means the change is not destructive. */
  assignments_removed: z.number().int().nonnegative(),
  /**
   * Distinct users who would lose access. For a *user* move this is 0 or 1 and
   * adds nothing to `assignments_removed`; it exists for the *app re-link*,
   * where one edit can cut many people off and a count of assignments alone
   * reads far smaller than the thing actually being decided.
   */
  users_affected: z.number().int().nonnegative(),
  /**
   * The apps whose assignments would die, by identifier — a bare count cannot
   * be read by whoever has to approve it. For an app re-link this is the one
   * app being moved.
   */
  app_identifiers: z.array(z.string()),
})
export type GroupUsageResponse = z.infer<typeof groupUsageResponse>

/**
 * `POST /api/org/groups` — `.strict()`, and **`is_org_admins` is absent**: the
 * one group carrying it is created with the org, and a caller able to set it
 * would be minting themselves console access.
 *
 * `mcp_enabled` defaults to off. Absence-is-safe rather than
 * absence-is-a-question, unlike `tier` on an invitation: the wrong default
 * there hands somebody powers, the wrong default here withholds a feature that
 * a later PATCH turns on.
 */
export const createGroupRequest = z
  .object({
    name: z.string().min(1).max(GROUP_NAME_MAX),
    mcp_enabled: z.boolean().default(false),
  })
  .strict()
export type CreateGroupRequest = z.infer<typeof createGroupRequest>

/**
 * `PATCH /api/org/groups/:id` — rename, or flip the MCP gate. The Org Admins
 * group is renamable through exactly this route (D1), which is why nothing
 * here refuses it by name.
 *
 * `is_org_admins` is absent for the reason it is absent from create, and
 * `member_count`/`app_count` because they are counted, not stored.
 */
export const patchGroupRequest = z
  .object({
    name: z.string().min(1).max(GROUP_NAME_MAX).optional(),
    mcp_enabled: z.boolean().optional(),
  })
  .strict()
export type PatchGroupRequest = z.infer<typeof patchGroupRequest>

/**
 * What a `forbidden` refusal carries when the reason is the caller's **tier**
 * rather than a missing grant (W6c).
 *
 * §3.3 makes `forbidden` deliberately silent about *existence*, and that stays
 * true — this says nothing about what the target is. But "your role does not
 * permit this" and "there is no such thing" are the same answer today, and a
 * developer cannot tell *ask an owner* from *you have the wrong id*. Naming
 * the required tier reveals only what the caller could read off the docs.
 */
export const tierRequiredDetails = z.object({
  required: orgAdminTier,
  /** The caller's own tier — theirs to know, and it is what makes the message actionable. */
  actual: orgAdminTier,
})
export type TierRequiredDetails = z.infer<typeof tierRequiredDetails>

/* ---------------------------------------------------------- D6, deleted --
 * **Self-registration and the per-app pool are gone, with no successor.**
 *
 * `selfRegistration` (enabled/all_domains/domains/role_id), `clientRegisterRequest`,
 * `clientRegisterResponse` and `clientRegisterConfirm` described a way for a
 * stranger to acquire an identity in **an app's** pool. There are no per-app
 * pools any more (D1) and the redesign says it plainly: *"Without a provider,
 * a group grows by invitation only. The old per-app self-registration (domain
 * filter) dies with no successor."*
 *
 * The reasoning those shapes carried is not lost, because its successor needs
 * every word of it: JIT provisioning through a group's OIDC provider (D3) is
 * the only remaining way a user appears without an invitation, and it inherits
 * both hard-won rules — an unknown identity is admitted only where the
 * *developer* configured it, and an email collision is a **refusal, never an
 * auto-link**. That lands in the oidc-federation plan; nothing here half-builds
 * it.
 */

/**
 * Changing your own password while logged in.
 *
 * `current_password` is required even though the session already proves
 * identity: it is what makes a stolen *session* insufficient to take the
 * *account*. Every other session is revoked on success; the one that made the
 * change survives, because logging someone out of the tab they just used is
 * indistinguishable from the change having failed.
 */
export const passwordChangeRequest = z.object({
  current_password: z.string().min(1),
  new_password: password,
})
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequest>

/**
 * Asking for a reset link.
 *
 * **The response never says whether the address exists.** It is unauthenticated
 * and would otherwise be an account-enumeration oracle — the one place where
 * §3.3's "reveal nothing about what exists" is not a preference but the whole
 * point. So this answers the same way for a known and an unknown address, in
 * status, body **and timing**, and any consumer that renders "no such account"
 * from it has reintroduced the oracle.
 *
 * **The console half of the D1 residual.** This shape assumed a globally
 * unique address (`org_members.email`) and resolved to exactly one account.
 * `users.email` is unique per org, so a bare address can now name one org
 * admin per org, and the route cannot ask which — asking is itself the oracle
 * this shape exists to avoid. **Settled without changing this shape** (Andre,
 * 2026-08-29): every match is mailed, each with an org-scoped token. An
 * unknown address still sees the identical `202`, which is the constraint that
 * ruled out every option that would have had to ask.
 */
export const passwordResetRequest = z.object({
  email: z.email(),
})
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>

/**
 * Asking for a reset link **through an app**.
 *
 * Same act, different shape, because the two surfaces identify a person
 * differently. A user's address is unique only per `(org_id, email)` — the
 * same address can belong to several orgs' pools — so a bare email has nothing
 * to scope the lookup to and the route would have to guess which account the
 * caller meant (Nimbus-W6c, building it; the reasoning outlived the pool split
 * that prompted it and now applies to the console route too — see
 * `passwordResetRequest`).
 *
 * `app_identifier` is what every other client-auth shape already carries
 * (`clientLoginRequest`) for exactly this reason: on this surface a person is
 * identified by **app and address**, never by address alone. The app resolves
 * the org, and D2 makes that resolution sharper than it was: an app belongs to
 * one group, so the address is looked up in one pool.
 *
 * The response is still identical for a known and an unknown pair, and for an
 * app that does not exist — otherwise this becomes the enumeration oracle the
 * console route was carefully built not to be.
 */
export const clientPasswordResetRequest = z.object({
  app_identifier: appIdentifier,
  email: z.email(),
})
export type ClientPasswordResetRequest = z.infer<typeof clientPasswordResetRequest>

/**
 * Using the link. The token is **single-use and expires**; spending it revokes
 * every session of that subject, because a forgotten password is one of the
 * two states where somebody else may be holding one. `token_spent` covers used
 * and expired alike — telling them apart tells a stranger whether a token ever
 * existed.
 */
export const passwordResetConfirm = z.object({
  token: z.string().min(1),
  new_password: password,
})
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirm>

/**
 * A developer's own OIDC identity provider, configured per app (§3.4:
 * *"Der Entwickler kann pro App eigene Identity Provider anbinden."*).
 *
 * **A seam, not a settled shape.** D3 moves the provider from the app to the
 * **group** — at most one per group, the Org Admins group never carrying one —
 * and adds JIT provisioning with its grants. That is the oidc-federation plan;
 * these shapes stay as they are until it lands rather than being half-moved
 * here, and the reasoning below (issuer SSRF residual, write-only secret,
 * link-only-when-verified) transfers to the group provider unchanged.
 *
 * Fleetless is the **relying party** here — the opposite direction from
 * `oauth.ts`, where it is the authorization server. Both live in the same
 * end-user identity space and §3.4 requires both to converge: *"Beide Wege
 * enden im selben Fleetless-Token."*
 */
export const idpClaimMapping = z.object({
  /** Which claim is the stable identity. `sub` unless the developer knows better. */
  subject_claim: z.string().min(1).max(100).default('sub'),
  email_claim: z.string().min(1).max(100).default('email'),
})

/**
 * An IdP issuer URL — **an attacker-supplied string that decides where the
 * *server* connects.**
 *
 * `redirectUri` in `oauth.ts` got a parsed scheme check and an explicit
 * loopback allow-list, with the reasoning written down, because it decides
 * where a *credential* goes. This field got `z.url()` — in the same file, in
 * the same wave. Argus-W7b found it and stored `file:///etc/passwd`,
 * `http://169.254.169.254/latest/meta-data` and `http://infra-postgres-1:5432`
 * through `PUT /api/apps/:id/idp`, then caught the outbound discovery fetch on
 * a listener he stood up. **That is this project's own question — which rules
 * have we already written down, and where else do they apply — answered
 * badly, one field over.**
 *
 * **What this shape can decide, it now decides:** http(s) only (so no `file:`,
 * `gopher:`, `data:`), no credentials in the URL, no fragment, no query. RFC
 * 8414 §3 builds the discovery URL from the issuer's path, so a query string
 * there is meaningless and a `@` is a redirect trick.
 *
 * **What it cannot decide, stated rather than implied:** it cannot tell
 * `http://localhost:8081/realms/fleetless-test` — the dev IdP this project
 * ships — from `http://127.0.0.1:5432`. Both are loopback http. So **this is
 * not the SSRF defence and must not be mistaken for one.** The defence belongs
 * at the fetch, in the cloud: refuse loopback, link-local and private ranges
 * unless something explicitly opts in for development. A schema that quietly
 * looked sufficient here would be worse than one that says where the real
 * check has to live.
 */
export const idpIssuer = z
  .url()
  .max(500)
  .refine(
    (v) => {
      let url: URL
      try {
        url = new URL(v)
      } catch {
        return false
      }
      if (!['http:', 'https:'].includes(url.protocol)) return false
      if (url.username !== '' || url.password !== '') return false
      if (url.hash !== '' || url.search !== '') return false
      return url.hostname.length > 0
    },
    { message: 'issuer must be an http(s) URL with no credentials, query or fragment' },
  )
export type IdpIssuer = z.infer<typeof idpIssuer>

/**
 * **The linking rule, decided with André on 2026-08-18, and it needs both
 * conditions — but the flag itself moved off this object on 2026-08-19
 * (W9c, DEF-094). See `orgFederationPolicy` below.**
 *
 * When a federated login asserts an email that already belongs to an
 * integrated user of the same app, the accounts are joined **only if** the IdP
 * says `email_verified` **and** the developer set this flag. Otherwise a
 * separate identity is created.
 *
 * Either condition alone is account takeover. Without `email_verified`, an IdP
 * that lets anyone type any address into a profile hands over every existing
 * account with a matching one. Without the flag, a developer who connects an
 * IdP for a *subset* of their users silently merges strangers.
 *
 * **The three outcomes must stay distinguishable** — off, on-and-verified,
 * on-and-unverified — because a rule with two conditions that produces two
 * outcomes has stopped reading one of them.
 */
export const idpConfig = z.object({
  app_id: z.uuid(),
  issuer: idpIssuer,
  client_id: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(60)).min(1).max(20),
  claims: idpClaimMapping,
  /** Never the secret itself — see `idpConfigRequest`. */
  has_client_secret: z.boolean(),
  updated_at: z.iso.datetime(),
})
export type IdpConfig = z.infer<typeof idpConfig>

/**
 * `.strict()`, and the secret is write-only: it goes in here and never comes
 * back out of `idpConfig`. Same shape as the server key (§3.4) — a secret a
 * response can return is a secret in every log that ever captured a response.
 */
export const idpConfigRequest = z
  .object({
    issuer: idpIssuer,
    client_id: z.string().min(1).max(200),
    client_secret: z.string().min(1).max(500).optional(),
    scopes: z.array(z.string().min(1).max(60)).min(1).max(20),
    claims: idpClaimMapping.optional(),
  })
  .strict()
export type IdpConfigRequest = z.infer<typeof idpConfigRequest>

/**
 * **Whether a federated login may join an existing account — one answer per
 * org, because there is one account (W9c, DEF-094, André 2026-08-19).**
 *
 * This flag used to live on `idpConfig`, which is per app. The object it
 * decides about is not: §3.2 says end users *"werden zentral pro Org
 * verwaltet"* and `end_users` is unique on `(org_id, email)`. So one real
 * person with one address had **two** policies claiming authority over their
 * account, and the register row measured what that produces: opt-in on for app
 * A, off for app B. Their first federated login through A links. A later one
 * through B — same person, same address — gets `identity_conflict`
 * **forever**, because B's config says do not link and the row now exists.
 * Nothing the user or either developer can do resolves it.
 *
 * **What stayed per app, deliberately:** which IdP, which client, which
 * scopes, which claim names. Those are statements about a *login route*, and
 * §3.4 wants them per app — one org may serve two customers with two IdPs.
 * Only the sentence about *identity* moved, because identity is org-scoped.
 *
 * This is the same shape W7b already resolved once and wrote down: *two
 * policies for one decision, and the newer one is always the weaker.* There,
 * `idpConfig.default_role_id` was removed because `selfRegistration` had
 * governed exactly that since W6c. The lesson did not generalise on its own;
 * the second instance sat one field away in the same object.
 *
 * **Absence is the safe answer.** No row means `false` — do not link — which
 * is what W7b chose deliberately: relaxing later is additive, admitting
 * duplicates now and tightening afterwards is not.
 */
export const orgFederationPolicy = z.object({
  /**
   * Joins a federated login to an existing integrated account **only if** the
   * IdP also asserts `email_verified`. Either condition alone is account
   * takeover: without `email_verified`, an IdP that lets anyone type any
   * address into a profile hands over every matching account; without this
   * flag, a developer who connects an IdP for a *subset* of their users
   * silently merges strangers.
   */
  link_verified_emails: z.boolean(),
  updated_at: z.iso.datetime(),
})
export type OrgFederationPolicy = z.infer<typeof orgFederationPolicy>

export const orgFederationPolicyRequest = z.object({
  link_verified_emails: z.boolean(),
}).strict()
export type OrgFederationPolicyRequest = z.infer<typeof orgFederationPolicyRequest>

/**
 * `GET /api/auth/me` — named so the console can validate it.
 *
 * `user`, not `member`: the caller is a row of the org's one pool, and since
 * only Org Admins reach the console, `user.tier` is always present on this
 * response in practice. The schema keeps it optional because `orgUser` is one
 * shape for the whole pool — the guarantee belongs to the route, and a second
 * shape asserting it here would be a second policy for one decision.
 */
export const authMeResponse = z.object({ org, user: orgUser })
export type AuthMeResponse = z.infer<typeof authMeResponse>

/** `PATCH /api/org` — rename the org. Owner only. Same bounds as signup's `org_name`. */
export const patchOrgRequest = z.object({ name: z.string().min(1).max(120) }).strict()
export type PatchOrgRequest = z.infer<typeof patchOrgRequest>

/** `PATCH /api/auth/me` — the caller updates their own display name (null clears it). */
export const patchAuthMeRequest = z.object({ display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable() }).strict()
export type PatchAuthMeRequest = z.infer<typeof patchAuthMeRequest>
