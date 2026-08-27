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
  /**
   * Optional human name, shown by the console instead of the email where
   * present. Self-service via `PATCH /api/auth/me`; never used for auth.
   */
  display_name: z.string().min(1).max(120).nullable(),
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
export const pendingDeveloperInvitation = z.object({
  id: z.uuid(),
  email: z.email(),
  role: orgMemberRole,
  expires_at: z.iso.datetime(),
})
export type PendingDeveloperInvitation = z.infer<typeof pendingDeveloperInvitation>

export const developerInvitationListResponse = z.object({
  /** Pending only. An accepted invitation is history, not something to revoke. */
  invitations: z.array(pendingDeveloperInvitation),
})
export type DeveloperInvitationListResponse = z.infer<typeof developerInvitationListResponse>

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
/**
 * **The app's one answer to "somebody without a membership just showed up",
 * and it governs both login paths.**
 *
 * W7b briefly had a second: `idpConfig.default_role_id`, added on 2026-08-18
 * so a first-time *federated* identity had a defined role. It was a weaker
 * copy of this — a role and nothing else, no enabled flag beyond null-or-not,
 * no domain rule — and the federated path read it while reading none of this.
 * So a developer who had deliberately turned self-registration **off**, or
 * limited it to their own domain, had neither honoured on the federated side.
 *
 * That is precisely the back door the same day's reasoning had argued
 * against — *"a developer who had turned self-registration off would still be
 * handing out accounts through a door they never opened"* — and the lead
 * closed that door and then built a second one beside it instead of pointing
 * the first at both paths. **Found by André asking the question that made it
 * obvious: in which constellation does self-registration even happen, when
 * the developer invites proactively and assigns the role?**
 *
 * Removed on 2026-08-18. One policy, one screen, both paths. A federated
 * identity with no membership is admitted exactly when an integrated one
 * would be, by the same flag, the same domain list and the same role — and
 * refused with `identity_not_provisioned` otherwise.
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

/**
 * A developer's own OIDC identity provider, configured per app (§3.4:
 * *"Der Entwickler kann pro App eigene Identity Provider anbinden."*).
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

/** `GET /api/auth/me` — previously an inline shape in the cloud; named so the console can validate it. */
export const authMeResponse = z.object({ org, member: orgMember })
export type AuthMeResponse = z.infer<typeof authMeResponse>

/** `PATCH /api/org` — rename the org. Owner only. Same bounds as signup's `org_name`. */
export const patchOrgRequest = z.object({ name: z.string().min(1).max(120) }).strict()
export type PatchOrgRequest = z.infer<typeof patchOrgRequest>

/**
 * `PATCH /api/org/members/:id` — change a member's role. Owner only.
 * Demoting the last owner is refused with 409 `last_owner`, the same rule
 * (and the same error shape) as member deletion.
 */
export const patchOrgMemberRequest = z.object({ role: orgMemberRole }).strict()
export type PatchOrgMemberRequest = z.infer<typeof patchOrgMemberRequest>

/** `PATCH /api/auth/me` — the caller updates their own display name (null clears it). */
export const patchAuthMeRequest = z.object({ display_name: z.string().min(1).max(120).nullable() }).strict()
export type PatchAuthMeRequest = z.infer<typeof patchAuthMeRequest>
