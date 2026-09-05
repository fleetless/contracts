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
 * **Email is globally unique** (Andre, 2026-08-29). The merge briefly
 * loosened `org_members.email`'s platform-wide uniqueness to per-org (D1), but
 * that was reversed the same day: `lower(email)` is unique across **all** orgs,
 * so one address is exactly one `users` row in exactly one org. Every shape
 * here that identifies a person by a bare address — `developerLoginRequest`,
 * `passwordResetRequest` — therefore resolves to at most one account, with no
 * org context needed to disambiguate. The multi-org-same-person case is gone
 * by design; the consultant who wanted one address in several orgs now needs
 * one address per org.
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
 * The per-user MCP override for a **customer-group** user (D5's gating half).
 *
 * - `default` — follow the user's group (`orgGroup.mcp_enabled`).
 * - `allowed` — this user may use the MCP server even if their group does not.
 * - `denied`  — this user may not, whatever their group says.
 *
 * **Enforced since 0.5.0**, by one door called at both enforcement points
 * (`cloud/src/mcp-access.ts`): at token issue, so a gated-out user never gets
 * an `mcp_session`, and again on **every** MCP request, re-read from the
 * current row rather than cached off the token — so a flip to `denied` bites
 * at the next call, not the next refresh. Written down because a stored
 * permission field that only *looks* enforced is the kind of second door this
 * project keeps finding.
 *
 * **It does not decide for an Org Admins user, in either direction.** The door
 * checks `is_org_admins` first and permits unconditionally (Andre,
 * 2026-08-29): neither `denied` here nor a group flag turned off can refuse an
 * org admin. A console that renders this field for an admin is showing a
 * setting nothing reads. When billing lands, admin MCP becomes a paid feature
 * and that exception grows a subscription condition.
 */
export const mcpAccess = z.enum(['default', 'allowed', 'denied'])
export type McpAccess = z.infer<typeof mcpAccess>

export const org = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
})
export type Org = z.infer<typeof org>

/** What `PATCH /api/org` answers: the org as it now stands. */
export const patchOrgResponse = z.object({ org })
export type PatchOrgResponse = z.infer<typeof patchOrgResponse>

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
  /**
   * Whether this **customer** group's users may reach the central MCP server,
   * enforced since 0.5.0 at token issue and on every request
   * (`cloud/src/mcp-access.ts`), with the per-user `mcpAccess` override
   * winning over it in both directions.
   *
   * **On the Org Admins group it decides nothing.** The door permits a member
   * of `is_org_admins` unconditionally (Andre, 2026-08-29) before it reads
   * either this flag or the user's override; turning it off there refuses
   * nobody. Stored and settable all the same, so the group shape stays one
   * shape — but it is a customer-group control, and only that.
   */
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
 * `email` is **globally unique** (Andre, 2026-08-29) — `lower(email)` unique
 * across every org, a constraint the cloud enforces in the database; a schema
 * cannot see two rows at once and this one makes no claim to. One address is
 * one person: no two orgs may hold the same one.
 *
 * The 2026-08-29 redesign briefly made this per-org (a loosening of
 * `org_members.email`'s global uniqueness), which is why the login and reset
 * routes once verified against multiple candidate rows. That was reversed the
 * same day: a bare address resolves to at most one account again, both shapes
 * stay `{ email, … }`, and no org context is needed to disambiguate.
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

/** `GET /api/org/users/:id/assignments` — see `appAssignment` on why an empty list is not an answer about admins. (There is no app-scoped assignment list route; the live cloud serves only the per-user one.) */
export const appAssignmentListResponse = z.object({ assignments: z.array(appAssignment) })
export type AppAssignmentListResponse = z.infer<typeof appAssignmentListResponse>

/**
 * Access plus refresh (spec §3.4). The access token is short-lived; the
 * refresh token rotates on every use, so a stolen one is detectable when the
 * original is presented again.
 */
export const sessionTokens = z.object({
  access_token: z.string().min(1).meta({
    description: 'The token to send as `Authorization: Bearer <token>` on every call. Short-lived: read `expires_in` rather than assuming a lifetime.',
  }),
  refresh_token: z.string().min(1).meta({
    description: 'The token that buys the next access token. It rotates on every use, so a value presented twice is detectable theft and ends the whole family.',
  }),
  expires_in: z.number().int().positive().meta({
    description: 'How long the access token stays valid, in **seconds** from now. Not a timestamp, and not milliseconds.',
  }),
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
 * The landing page's waiting list (public site, 2026-09-04): one address,
 * posted from fleetless.dev while sign-up is closed. The route answers
 * `202` whether or not the address was already listed.
 *
 * The address is bounded at 254 characters, the RFC 5321 forward-path limit.
 * `z.email()` alone is length-unbounded, and `waitlist.email` carries a unique
 * btree index, which raises above roughly 2704 bytes — so an unbounded address
 * turns an unauthenticated public route into a `500`.
 */
export const waitlistRequest = z.object({ email: z.email().max(254) })
export type WaitlistRequest = z.infer<typeof waitlistRequest>

/**
 * Console login. Org Admins members only, always the Fleetless provider — a
 * group's OIDC provider never governs the console (D3), which removes the
 * IdP-lockout class entirely.
 *
 * This resolves a person by address alone, and `users.email` is **globally
 * unique** (Andre, 2026-08-29), so a bare address names at most one account
 * and no org context is needed to disambiguate. The 2026-08-29 redesign
 * briefly made email per-org, which forced the login to verify against every
 * candidate row and refuse a double match; that machinery is retired now that
 * one address is one account. An org selector was never needed and would have
 * told an unauthenticated caller which org an address belongs to.
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
  current_password: z.string().min(1).meta({
    description: 'The password in use right now. It is required even though the session already proves identity: it is what makes a stolen *session* insufficient to take the *account*.',
  }),
  new_password: password.meta({
    description: 'The replacement password. Every other session is revoked when it is accepted, while the session that made the change survives — logging somebody out of the tab they just used is indistinguishable from the change having failed.',
  }),
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
 * A bare address resolves to at most one account: `users.email` is **globally
 * unique** (Andre, 2026-08-29), so the reset mails the one match, if any, with
 * a token bound to that account. The 2026-08-29 redesign briefly made email
 * per-org, which had this route mail *every* match; that is retired with the
 * multi-candidate machinery. An unknown address still sees the identical
 * `202`, which is the property this shape exists to preserve.
 */
export const passwordResetRequest = z.object({
  email: z.email(),
})
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>

/**
 * Asking for a reset link **through an app**.
 *
 * Same act, different shape, because the two surfaces identify a person
 * differently. Email is globally unique (Andre, 2026-08-29), so a bare address
 * does resolve to one account — but a client authenticates **per app**, and
 * this surface stays symmetric with the rest of client-auth rather than
 * reaching across apps from an address alone (Nimbus-W6c, building it).
 *
 * `app_identifier` is what every other client-auth shape already carries
 * (`clientLoginRequest`) for exactly this reason: on this surface a person is
 * identified by **app and address**. The app resolves the org, and D2 makes
 * that resolution sharper than it was: an app belongs to one group, so the
 * address is looked up in one pool.
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

/* ------------------------------------------------- oidc-federation, D3/D4 --
 * **The provider moved from the app to the group** (spec
 * `2026-08-29-org-identity-redesign`, D3). `idpConfig`/`idpConfigRequest`
 * above are the per-app seam D3 supersedes — kept until the cloud drops the
 * `idp_configs` table, not half-moved here — and the reasoning they carried
 * (issuer SSRF residual, write-only secret, link-only-when-verified) is the
 * reasoning below, unchanged. What is new is JIT: a group provider may admit
 * unknown identities, and the grants it hands them are provider config.
 */

/**
 * **One grant a JIT-provisioned user receives** (D3): an app and the role they
 * get in it. Materialised as an `appAssignment` the first time an unknown
 * `(issuer, sub)` signs in through a group whose provider has `jit_enabled`.
 *
 * `.strict()` — a stray key here is a misconfiguration that would silently
 * grant the wrong thing. The schema cannot check that `role_id` belongs to
 * `app_id`'s role set, nor that `app_id` belongs to the provider's group, nor
 * that no two grants name the same app: those are the cloud's, the same three
 * checks `putAssignmentRequest` already delegates.
 */
export const jitGrant = z.object({
  app_id: z.uuid(),
  role_id: z.uuid(),
}).strict()
export type JitGrant = z.infer<typeof jitGrant>

/**
 * **A group's OIDC provider, as read back** (D3) — at most one per group, and
 * **never the Org Admins group's** (console login is always the Fleetless
 * password provider, which removes the IdP-lockout class entirely). The schema
 * cannot see which group is the admin one; it sees a `group_id`. The cloud
 * refuses to attach a provider to the Org Admins group, and that refusal is
 * `target_state_conflict` — a target in a state that forbids the operation.
 *
 * **No secret, by construction.** The client secret goes in through
 * `putGroupOidcProviderRequest` and never comes back out — a secret a response
 * can carry is a secret in every log that ever captured a response, the same
 * rule the server key and `idpConfig` already keep. This shape is `.strict()`
 * so a `client_secret` offered here is a refusal, not a silently dropped
 * field: *field present* and *field absent* must never be the same outcome on
 * a credential.
 *
 * `jit_grants` is meaningful only when `jit_enabled`; the schema does not
 * couple them (an empty list is legal either way) because the coupling is a
 * statement about behaviour the cloud enforces, and a shape that looked like
 * it enforced it would be a second door.
 */
export const groupOidcProvider = z.object({
  group_id: z.uuid(),
  issuer: idpIssuer,
  client_id: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(60)).min(1).max(20),
  /** Whether an unknown `(issuer, sub)` is provisioned rather than refused (D3). */
  jit_enabled: z.boolean(),
  /**
   * The grants an unknown user receives on their first federated login.
   * Bounded for the reason `scopes` and `accept_url` are: an unbounded array
   * on a shape that is stored, logged and rendered is a size nobody chose.
   */
  jit_grants: z.array(jitGrant).max(50),
  created_at: z.iso.datetime(),
}).strict()
export type GroupOidcProvider = z.infer<typeof groupOidcProvider>

/**
 * **Writing a group's provider** — `PUT /api/org/groups/:id/oidc-provider`,
 * `.strict()`, and the **only** shape that carries the client secret.
 *
 * No `group_id`: it is in the path, and a body that repeated it could disagree
 * with the path and leave a handler to choose which to believe
 * (`putAssignmentRequest`'s reasoning).
 *
 * `client_secret` is **write-only and optional**. Optional is the
 * rotate-only-when-present rule `idpConfigRequest` already set: a PUT that
 * omits it keeps the stored secret, so a routine edit of scopes or grants does
 * not force the secret back onto the wire. **The cloud requires it on the
 * first write** (a provider with no secret cannot exchange a code) — a
 * create-vs-update distinction a single PUT shape cannot see, named here
 * rather than pretended away. The minimum length refuses a trivial value: a
 * one-character client secret is a misconfiguration, not a rotation.
 *
 * `issuer` is `idpIssuer` — http(s) only, no credentials, query or fragment.
 * **This is not the SSRF defence.** It cannot tell the dev IdP
 * (`http://localhost:8081/...`) from `http://127.0.0.1:5432`, both loopback
 * http; the real defence refuses loopback, link-local and private ranges at
 * the discovery fetch, in the cloud. Said on `idpIssuer` at length; repeated
 * here because this is a second field, in a second file, that decides where
 * the *server* connects.
 */
export const putGroupOidcProviderRequest = z.object({
  issuer: idpIssuer,
  client_id: z.string().min(1).max(200),
  /** Write-only; absent means keep the stored secret. Never echoed by `groupOidcProvider`. */
  client_secret: z.string().min(16).max(500).optional(),
  scopes: z.array(z.string().min(1).max(60)).min(1).max(20),
  jit_enabled: z.boolean().default(false),
  jit_grants: z.array(jitGrant).max(50).default([]),
}).strict()
export type PutGroupOidcProviderRequest = z.infer<typeof putGroupOidcProviderRequest>

/**
 * **Why a federated callback failed, in words safe to show the person who hit
 * it** (D4, Error handling). The custom-OIDC login ends at the cloud's
 * callback; when the exchange or the claims fail, the cloud renders an honest
 * error page and **never falls back to the Fleetless login form** — a form
 * that asked for a Fleetless password after an IdP round-trip is a phishing
 * door the spec closes by name.
 *
 * The `code` is for the page to branch on and for an operator to grep; the
 * `message` is the sentence the user reads, so it must carry no issuer, no
 * `invalid_grant` internals, no stack — only what a person can act on, which
 * for most of these is *"contact your administrator"*.
 */
export const oidcCallbackErrorCode = z.enum([
  /** The IdP could not be reached, or its discovery document could not be read. */
  'idp_unreachable',
  /** The authorization code could not be exchanged for tokens (`invalid_grant` and friends). */
  'exchange_failed',
  /** The IdP answered, but the token is missing a `sub` or `email` the flow needs. */
  'claims_incomplete',
  /** An unknown identity on a group with JIT off — no route in, by design (D3). */
  'jit_disabled',
  /**
   * JIT would provision, but the asserted email already belongs to a user —
   * of this org or any other, since email is globally unique (Andre,
   * 2026-08-29). **Refusal, never auto-link** (account-takeover guard, D3);
   * resolution is manual, by an org admin.
   */
  'email_collision',
  /** The provider is set up wrong (bad client, secret rejected) — the developer's to fix. */
  'provider_misconfigured',
])
export type OidcCallbackErrorCode = z.infer<typeof oidcCallbackErrorCode>

export const oidcCallbackError = z.object({
  code: oidcCallbackErrorCode,
  /** Safe user-facing text — no issuer, no token internals; bounded because it is rendered. */
  message: z.string().min(1).max(300),
}).strict()
export type OidcCallbackError = z.infer<typeof oidcCallbackError>

/**
 * **The interstitial's choice: an org admin entering an app picks how**
 * (D4). An Org Admins member holds no assignment for any app, so on an app
 * login the authorize step offers two ways in — **as a role** (a preview of
 * what that role can do) or **as a specific user** of the app's group. Admins
 * never appear in that user list: there is no admin-impersonates-admin.
 *
 * A **strict discriminated union**, so *"as a role"* cannot also smuggle a
 * `user_id` and vice versa — the two choices must stay two, or the handler
 * receives one ambiguous body and has to guess which the admin meant. The
 * resulting token carries the effective identity/role **and** the real admin
 * (`clientIdentity.act`), so every action audits as "Admin A as User B /
 * as role X".
 */
export const impersonationChoice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('role'), role_id: z.uuid() }).strict(),
  z.object({ mode: z.literal('user'), user_id: z.uuid() }).strict(),
])
export type ImpersonationChoice = z.infer<typeof impersonationChoice>

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
