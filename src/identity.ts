import { z } from 'zod'
import { appIdentifier } from './apps.js'

/**
 * Identity (spec §3). Two spaces that never mix: **developers**, who own an
 * org and use the console, and **end users**, who belong to an org's pool and
 * use apps. A credential from one space must never authenticate the other
 * (§3.1, §3.4) — the shapes are kept apart here so that nothing accidentally
 * accepts both.
 */

/**
 * The password rule, stated once so the cloud, the console and the SDK refuse
 * the same inputs for the same reason. Length only: a rule a user cannot
 * predict is a rule they work around.
 */
export const password = z.string().min(12).max(256)

/** Org access comes in two tiers (spec §3.1). */
export const orgMemberRole = z.enum(['owner', 'member'])
export type OrgMemberRole = z.infer<typeof orgMemberRole>

export const org = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
})
export type Org = z.infer<typeof org>

export const orgMember = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  role: orgMemberRole,
  created_at: z.iso.datetime(),
})
export type OrgMember = z.infer<typeof orgMember>

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

export const signUpResponse = z.object({
  org,
  member: orgMember,
  tokens: sessionTokens,
})
export type SignUpResponse = z.infer<typeof signUpResponse>

export const developerLoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type DeveloperLoginRequest = z.infer<typeof developerLoginRequest>

/**
 * An end user of the org's pool (spec §3.2). Blocked users keep their
 * memberships — blocking is reversible and must not silently drop role
 * assignments.
 */
export const endUser = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  status: z.enum(['invited', 'active', 'blocked']),
  created_at: z.iso.datetime(),
})
export type EndUser = z.infer<typeof endUser>

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

export const invitation = z.object({
  id: z.uuid(),
  email: z.email(),
  app_id: z.uuid(),
  role_id: z.uuid(),
  expires_at: z.iso.datetime(),
  accept_url: z.url(),
  /** Replaces `mail_sent: boolean` — see `mailStatus` for why one bit was not enough. */
  mail: mailStatus,
})
export type Invitation = z.infer<typeof invitation>

export const createInvitationRequest = z.object({
  email: z.email(),
  app_id: z.uuid(),
  role_id: z.uuid(),
  send_mail: z.boolean(),
})
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>

export const acceptInvitationRequest = z.object({
  token: z.string().min(1),
  password,
})
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>


/* ------------------------------------------------------------------ W6c --
 * Developer identity: the tiers that exist as data and that no route reads,
 * the invitation that lets a second person into an org at all, and the two
 * ways an account recovers itself.
 */

/**
 * Inviting a **developer** into the org (spec §3.1) — not to be confused with
 * `createInvitationRequest`, which invites an **end user** into an app's pool.
 * They are deliberately separate shapes rather than one with a discriminator:
 * they live in different identity spaces (§3.1, §3.4), a credential from one
 * must never authenticate the other, and a single shape is one careless
 * `as` away from letting it.
 *
 * `role` is the tier the invitee gets, and it is required rather than
 * defaulted: "I did not think about it" and "I meant Member" produce the same
 * request otherwise, on the field that decides who can remove whom.
 */
export const createDeveloperInvitationRequest = z.object({
  email: z.email(),
  role: orgMemberRole,
  send_mail: z.boolean(),
})
export type CreateDeveloperInvitationRequest = z.infer<typeof createDeveloperInvitationRequest>

/**
 * The invitation as issued. Like an end-user invitation, the **link is the
 * primary path** and mail is the second — so this is complete and usable with
 * `mail: 'not_configured'`.
 */
export const developerInvitation = z.object({
  id: z.uuid(),
  email: z.email(),
  role: orgMemberRole,
  expires_at: z.iso.datetime(),
  accept_url: z.url(),
  mail: mailStatus,
})
export type DeveloperInvitation = z.infer<typeof developerInvitation>

/** Accepting it: the token proves the invitation, the password creates the login. */
export const acceptDeveloperInvitationRequest = z.object({
  token: z.string().min(1),
  password,
})
export type AcceptDeveloperInvitationRequest = z.infer<typeof acceptDeveloperInvitationRequest>

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
  required: orgMemberRole,
  /** The caller's own tier — theirs to know, and it is what makes the message actionable. */
  actual: orgMemberRole,
})
export type TierRequiredDetails = z.infer<typeof tierRequiredDetails>

/**
 * Whether strangers may register themselves into **an app's end-user pool**,
 * and who counts as a stranger (spec §3.2).
 *
 * **This hangs off an app, not an org, and it creates an end user, not a
 * developer.** §3.2 is explicit and the first version of this shape got it
 * backwards: *"Wege in den Pool: Einladung über die Console, oder
 * Selbstregistrierung über eine App — pro App aktivierbar, wahlweise für alle
 * E-Mail-Domains oder eine definierte Auswahl."* Self-registration is a way
 * into the **pool**. There is no self-registration for developers anywhere in
 * the spec, and inventing one would have opened a path into the org that owns
 * the robots — the opposite identity space from the one §3.2 describes
 * (Threepio-W6c, before anything was built on it).
 *
 * `role_id` is required because §3.2's neighbouring sentence is equally
 * explicit: *"pro App erhält er genau eine Rolle."* A pool member with no role
 * is not a state this platform has, so the app must say which role a
 * self-registered user gets — and an app owner choosing that deliberately is
 * the whole security decision here.
 *
 * **`domains: []` with `enabled: true` means nobody may self-register**, not
 * everybody — the empty list is a filter that matches nothing, and reading it
 * the other way turns a half-finished configuration into an open door on a
 * public endpoint. Stated because that is exactly the reading somebody will
 * make at 2 a.m. §3.2's "wahlweise für alle E-Mail-Domains" is expressed by
 * `all_domains: true`, not by an empty list.
 */
export const selfRegistration = z.object({
  enabled: z.boolean(),
  /**
   * Accept any address. Deliberately its own flag rather than a magic value
   * in `domains`, so "open to everyone" is something an app owner has to say,
   * not something that falls out of leaving a list empty.
   */
  all_domains: z.boolean(),
  /** Lower-case bare domains, no `@`: `['dehne-robotik.de']`. Ignored when `all_domains`. */
  domains: z.array(z.string().min(1).max(253)),
  /** The role every self-registered member of this pool receives (§3.2: exactly one per app). */
  role_id: z.uuid(),
})
export type SelfRegistration = z.infer<typeof selfRegistration>

/**
 * Registering yourself into an app's pool (spec §3.2) — an **end user**, so it
 * answers on the client-auth surface and never mints a developer session.
 *
 * **It does not mint any session either.** The first version of this shape
 * answered `sessionTokens` directly, and that is an impersonation path: a
 * domain filter gates *which domains* may register, never *whether the caller
 * owns the address*. With self-registration enabled for `example.com`, anybody
 * who knows the pattern could have registered as `ceo@example.com` and
 * received a pool identity carrying whatever role the app assigns — which in
 * this platform can mean permission to move a robot.
 *
 * So registering creates a **pending** member and sends a confirmation link;
 * `clientRegisterConfirm` spends it and returns the session. Same single-use,
 * expiring token machinery as the password reset, and the same `token_spent`
 * for used-or-expired. The spec is silent on verification (checked: it says
 * nothing about it anywhere), so this is a decision the contracts make rather
 * than one they inherit — found by Threepio-W6c reading §3.2 against the delta
 * a second time, after the first reading had already moved it into the right
 * identity space.
 *
 * `app_identifier` rather than an app uuid, matching `clientLoginRequest`: it
 * is the value an app already ships, and it reveals nothing a caller of that
 * app does not have.
 */
export const clientRegisterRequest = z.object({
  app_identifier: appIdentifier,
  email: z.email(),
  password,
})
export type ClientRegisterRequest = z.infer<typeof clientRegisterRequest>

/**
 * What registering answers — deliberately **the same for an address that is
 * new and one that already has an account**.
 *
 * Anything else is an account-enumeration oracle on an unauthenticated route,
 * the same reasoning `passwordResetRequest` carries. An address that already
 * exists still gets a mail, saying so; the caller cannot tell which mail was
 * sent, and there is nothing in this response to tell them.
 *
 * `mail` is safe to return because it describes **the server's configuration**,
 * not the address: `not_configured` means this deployment has no SMTP, which
 * is true regardless of who registered. Note that a deployment with no mail
 * server cannot complete a self-registration at all — the link is the only way
 * through, unlike an invitation, where a developer can hand it over directly.
 */
export const clientRegisterResponse = z.object({
  mail: mailStatus,
})
export type ClientRegisterResponse = z.infer<typeof clientRegisterResponse>

/**
 * Spending the confirmation link. The password was set when registering; this
 * proves the address and returns the session.
 */
export const clientRegisterConfirm = z.object({
  token: z.string().min(1),
})
export type ClientRegisterConfirm = z.infer<typeof clientRegisterConfirm>

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
 */
export const passwordResetRequest = z.object({
  email: z.email(),
})
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>

/**
 * Asking for a reset link **as an end user**.
 *
 * Same act, different shape, because the two identity spaces identify a person
 * differently. A developer's address is globally unique on `org_members`, so
 * `{ email }` resolves to exactly one account. An end user's is unique only per
 * `(org_id, email)` — the same address can be a pool member of several orgs'
 * apps — so a bare email has nothing to scope the lookup to, and the route
 * would have to guess which account the caller meant (Nimbus-W6c, building it).
 *
 * `app_identifier` is what every other client-auth shape already carries
 * (`clientLoginRequest`, `clientRegisterRequest`) for exactly this reason: on
 * this surface a person is identified by **app and address**, never by address
 * alone. Sharing one shape across both spaces was the lead's convenience, not
 * a principle, and it did not survive the first route that had to resolve an
 * end user by it.
 *
 * The response is still identical for a known and an unknown pair, and now
 * also for an app that does not exist — otherwise this becomes the enumeration
 * oracle the developer route was carefully built not to be.
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
