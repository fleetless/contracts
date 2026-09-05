import { z } from 'zod'

/**
 * **Fleetless users: the org's team, and the only people who reach the
 * console** (spec `2026-09-05-app-user-auth`, D1).
 *
 * There are two identity spaces now and **nothing joins them**:
 *
 * - *Fleetless users*, this file. The people who configure robots in the
 *   console. Email globally unique, tier `owner | developer`, a Fleetless
 *   password, login through the auth portal. They always have MCP access, at
 *   the one central endpoint.
 * - *app users*, `app-users.ts`. The people who use a developer's app. One app
 *   each, email unique per app, authenticated through the JSON client-auth
 *   API that the developer's own UI calls.
 *
 * A Fleetless user who wants to use an app registers or is invited like
 * anybody else; there is no path from one space to the other.
 *
 * **What that deleted, with no successor** (D1): groups and the Org Admins
 * group, app assignments, impersonation, the per-user MCP override and the
 * org-level federation policy. The 2026-08-29 model had put developers and end
 * users into one pool per org and connected them with all of the above; in use
 * it turned out to model the wrong thing — the two populations have different
 * lifecycles, and every mechanism joining them was cost without a product
 * reason.
 *
 * What did **not** change: the password rules, the session and token shapes,
 * and the enumeration-oracle reasoning on password reset. None of those was
 * ever a statement about which space a person lived in.
 *
 * **Email is globally unique here** — `lower(email)` unique across all orgs, so
 * one address is exactly one Fleetless user in exactly one org. Every shape
 * that identifies a person by a bare address (`developerLoginRequest`,
 * `passwordResetRequest`) therefore resolves to at most one account with no org
 * context needed. App users are the opposite and say so on their own shape:
 * unique **per app**, so one address may be several unrelated app accounts.
 */

/**
 * The password rule, stated once so the cloud, the console and the SDK refuse
 * the same inputs for the same reason. Length only: a rule a user cannot
 * predict is a rule they work around.
 *
 * Shared by both identity spaces on purpose. A weaker rule for app users would
 * be a second policy for one decision, and the weaker one always wins by
 * accident.
 */
export const password = z.string().min(12).max(256)

/** The bound on a Fleetless user's display name; `APP_USER_DISPLAY_NAME_MAX` matches it, so a rename cannot be legal in one space and refused in the other. */
export const USER_DISPLAY_NAME_MAX = 120

/**
 * **The two tiers a Fleetless user can hold** (D1). Owner-exclusive: delete
 * the org, edit org settings, promote to owner, and later billing. Everything
 * else a Fleetless user may do, a `developer` may do.
 *
 * `member` was renamed to `developer` in the 2026-08-29 redesign and is **not**
 * accepted as an alias anywhere — a wire that took both would leave two names
 * for one tier in every log, every audit detail and every console fixture, and
 * the older one would keep arriving forever.
 *
 * **Every Fleetless user has one.** It used to be optional, because the pool
 * also held people who were not org admins and had no console powers to grade.
 * That pool is gone: a Fleetless user *is* a member of the team, so the field
 * is required and an absent one is a mapper bug rather than a state.
 */
export const orgAdminTier = z.enum(['owner', 'developer'])
export type OrgAdminTier = z.infer<typeof orgAdminTier>

export const org = z.object({
  id: z.uuid().meta({
    description: 'The organisation. Every developer route is scoped to the caller\'s org already, so a client rarely has to send this anywhere.',
  }),
  name: z.string().min(1).max(120).meta({
    description: 'The organisation\'s display name. Free text, changed through `PATCH /api/org`.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the organisation was created, as an ISO 8601 timestamp.',
  }),
})
export type Org = z.infer<typeof org>

/** What `PATCH /api/org` answers: the org as it now stands. */
export const patchOrgResponse = z.object({
  org: org.meta({
    description: 'The organisation as it now stands, after the patch was applied. The whole resource comes back, not only the fields that changed.',
  }),
})
export type PatchOrgResponse = z.infer<typeof patchOrgResponse>

/**
 * **A member of the org's team.** Console access, a tier, a Fleetless
 * password, and no relationship whatsoever to any app's users.
 *
 * `email` is **globally unique** — `lower(email)` unique across every org, a
 * constraint the cloud enforces in the database; a schema cannot see two rows
 * at once and this one makes no claim to. One address is one Fleetless user:
 * no two orgs may hold the same one.
 *
 * **What this shape lost with the two-space cut**: `group_id` (there are no
 * groups), `mcp_access` (a Fleetless user always has MCP access, at the
 * central endpoint), and `has_password`. The last is the interesting one — it
 * existed because a pool user might have been provisioned by an identity
 * provider and hold no Fleetless credential. A Fleetless user always holds
 * one: the console is password-only by design (D1), which removes the
 * IdP-lockout class entirely, so a field reporting whether the credential
 * exists would have exactly one value forever.
 */
export const fleetlessUser = z.object({
  id: z.uuid().meta({
    description: 'The Fleetless user in the API, assigned by the cloud and stable for the life of the account.',
  }),
  org_id: z.uuid().meta({
    description: 'The organisation this person belongs to. Every developer route is already scoped to the caller\'s org, so this confirms what a client is looking at rather than being a filter it applies.',
  }),
  email: z.email().meta({
    description: 'The address the account is identified by, **globally unique** across every organisation. Immutable after creation: it is what every invitation, reset link and audit line names.',
  }),
  display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().meta({
    description: 'Optional human name, shown by the console instead of the address where present. Self-service through `PATCH /api/auth/me`; never used for authentication. `null` when the person never supplied one.',
  }),
  tier: orgAdminTier.meta({
    description: 'The console powers this person holds. **Required** — every Fleetless user is a member of the team and has a tier; the optional version of this field existed only while the org also held people with no console powers to grade, and that pool is gone.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the account was created, as an ISO 8601 timestamp.',
  }),
})
export type FleetlessUser = z.infer<typeof fleetlessUser>

/** `GET /api/org/users` — the whole team. Never null: an org always has at least its owner. */
export const fleetlessUserListResponse = z.object({
  users: z.array(fleetlessUser).meta({
    description: 'Every Fleetless user of the caller\'s organisation. This is the team, not an app\'s users — those are listed per app.',
  }),
})
export type FleetlessUserListResponse = z.infer<typeof fleetlessUserListResponse>

/**
 * Access plus refresh (spec §3.4). The access token is short-lived; the
 * refresh token rotates on every use, so a stolen one is detectable when the
 * original is presented again.
 *
 * One shape for both identity spaces: a session is a session, and the claims
 * inside the token are what differ.
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
 * Registering answers with the founding **Fleetless user**, tier `owner`.
 *
 * The key is `user` rather than `member` or `owner`, and it has stayed `user`
 * through two identity redesigns deliberately: a renamed shape under a
 * renamed key would typecheck in every consumer that reads `.user.id` and mean
 * something subtly different, which is the quietest way for a cut like this to
 * go wrong.
 */
export const signUpResponse = z.object({
  org,
  user: fleetlessUser,
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
 * Console login. Fleetless users only, always the Fleetless password — the
 * console has no federated door at all (D1), which removes the IdP-lockout
 * class entirely.
 *
 * This resolves a person by address alone, and a Fleetless user's email is
 * **globally unique**, so a bare address names at most one account and no org
 * context is needed to disambiguate. An org selector was never needed and
 * would have told an unauthenticated caller which org an address belongs to.
 *
 * **It cannot be reached by an app user**, whatever their address: the two
 * spaces have separate tables and separate routes, and a credential from one
 * never authenticates the other.
 */
export const developerLoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type DeveloperLoginRequest = z.infer<typeof developerLoginRequest>

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
 *                      (invitations work without mail; the link is the primary
 *                      path). The console must not show it as an error.
 * - `failed`         — SMTP was configured, was tried, and refused or was
 *                      unreachable. This one is worth someone's attention.
 *
 * Shared with `appInvitation`, which answers the same three facts about the
 * same mailer.
 */
export const mailStatus = z.enum(['sent', 'not_configured', 'failed'])
export type MailStatus = z.infer<typeof mailStatus>

/* ----------------------------------------------------- the team invite --
 * One invitation family, for Fleetless users. The app-user invitation lives in
 * `app-users.ts` and is a different thing with a different link: this one
 * points at the Fleetless auth portal, that one points into the developer's
 * own app.
 */

/**
 * **Inviting somebody onto the team** — the only way a Fleetless user appears.
 *
 * `tier` is **required**, and that is the one decision this shape exists to
 * force. An optional tier would make *"I did not think about it"* and *"I meant
 * developer"* the same request, on the field that decides who can remove whom.
 * Inviting an owner is owner-only, checked by the route: the response hands
 * back the accept link, so an owner-tier invitation is a promotion with one
 * extra step.
 */
export const createTeamInviteRequest = z
  .object({
    email: z.email().meta({
      description: 'The address to invite. Globally unique across Fleetless users, so an address already on another org\'s team is refused with `email_taken`.',
    }),
    display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'An optional name to pre-fill the account with; the invitee can change it afterwards.',
    }),
    tier: orgAdminTier.meta({
      description: 'The tier the invitee holds on acceptance. **Required, not defaulted** — "I did not think about it" and "I meant developer" would otherwise be the same request, on the field that decides who can remove whom. Inviting an owner requires the owner tier.',
    }),
    send_mail: z.boolean().meta({
      description: 'Whether Fleetless mails the invitation. The link in the answer is the primary path either way: a deployment with no SMTP still issues invitations and says so through `mail`.',
    }),
  })
  .strict()
export type CreateTeamInviteRequest = z.infer<typeof createTeamInviteRequest>

/**
 * The invitation as issued. The **link is the primary path** and mail is the
 * second, so this is complete and usable with `mail: 'not_configured'` — a
 * deployment with no SMTP still issues invitations, it just cannot send them
 * and says so.
 */
export const teamInvite = z.object({
  id: z.uuid().meta({ description: 'The invitation, as listed and revoked by the team.' }),
  email: z.email().meta({ description: 'The address the invitation was addressed to.' }),
  tier: orgAdminTier.meta({ description: 'The tier the invitee holds on acceptance, fixed when the invitation was created.' }),
  expires_at: z.iso.datetime().meta({ description: 'When the token stops working. Seven days from issue; an expired token answers exactly as an unknown one does.' }),
  accept_url: z.url().max(500).meta({
    description: 'The link to give the invitee, on the Fleetless auth portal. Bounded like `idpIssuer`: an unbounded URL on a shape that gets mailed, logged and rendered is a size nobody chose. Unlike an app invitation\'s link this is never `null` — the portal is a page Fleetless does serve.',
  }),
  mail: mailStatus.meta({ description: 'What happened to the mail. `not_configured` is an expected state and not a failure; the link above is the primary path.' }),
})
export type TeamInvite = z.infer<typeof teamInvite>

/**
 * A pending invitation as the team sees it in the list — **without its
 * `accept_url`**, and that omission is the point.
 *
 * The list exists so a team can see what is outstanding and revoke it. Neither
 * needs the token, and a list that carries it turns every screenshot, every log
 * line and every browser history entry of that page into live credentials for
 * somebody else's account. It is the same rule `auditEvent.details` already
 * states — never credentials, never tokens — applied to a read surface.
 *
 * There is no escalation either way: an owner can already create an invitation
 * for any address. The reason to withhold it is not what an owner could do with
 * it, but that a page nobody thinks of as sensitive stops being sensitive.
 *
 * `mail` is omitted for a duller reason: it described what happened at creation
 * time, and re-serving it in a list invites a reader to take it as current.
 */
export const pendingTeamInvite = z.object({
  id: z.uuid().meta({ description: 'The invitation, as revoked and re-issued by the team.' }),
  email: z.email().meta({ description: 'The address the invitation was addressed to.' }),
  tier: orgAdminTier.meta({ description: 'The tier the invitee would hold. Visible so an owner can spot an owner-tier invitation they did not authorise.' }),
  expires_at: z.iso.datetime().meta({ description: 'When the token stops working.' }),
})
export type PendingTeamInvite = z.infer<typeof pendingTeamInvite>

export const pendingTeamInviteListResponse = z.object({
  invitations: z.array(pendingTeamInvite).meta({
    description: 'Pending invitations only. An accepted invitation is history, not something to revoke.',
  }),
})
export type PendingTeamInviteListResponse = z.infer<typeof pendingTeamInviteListResponse>

/** Accepting it: the token proves the invitation, the password creates the login. */
export const acceptTeamInviteRequest = z
  .object({
    token: z.string().min(1).meta({
      description: 'The opaque invitation token from the link. Unknown, expired and already-accepted all collapse into `410 token_spent` — telling them apart would say whether a token ever existed.',
    }),
    password: password.meta({
      description: 'The password the new Fleetless account will use. At least 12 characters.',
    }),
  })
  .strict()
export type AcceptTeamInviteRequest = z.infer<typeof acceptTeamInviteRequest>

/**
 * `PATCH /api/org/users/:id` — **what an admin may change about a team member,
 * and the two things that are absent rather than merely un-required.**
 *
 * `email` is not here. It is the identifier of the account, the value every
 * invitation, reset link and audit line names, and a PATCH that could change it
 * is both an account-takeover surface and a uniqueness race. *Immutable after
 * create* is a sentence a strict schema can actually keep: offering `email` is
 * a refusal, not a silently ignored field — which is the failure mode this
 * project has already paid for once (`toHaveBeenCalledWith` could not tell
 * *field sent* from *field missing*).
 *
 * `tier` is not here either. A tier change is owner-only with a last-owner
 * guard (`tierChangeRequest`), and merging it in would give one route two
 * refusal reasons and one audit event.
 *
 * So exactly one field remains, and the shape is kept rather than collapsed
 * into a bare string: the next thing a team member gains will be optional here,
 * and a route whose body is a naked value has nowhere to put it.
 */
export const patchFleetlessUserRequest = z
  .object({
    display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'The member\'s display name. Absent leaves it alone; an explicit `null` clears it.',
    }),
  })
  .strict()
export type PatchFleetlessUserRequest = z.infer<typeof patchFleetlessUserRequest>

/**
 * `PUT /api/org/users/:id/tier` — **owner-only, and the last owner is
 * neither demotable nor deletable** (refused with 409 `last_owner`).
 *
 * `tier_required` keeps its exact semantics — it says what the *caller's* tier
 * is and what was needed, and nothing about the target.
 */
export const tierChangeRequest = z.object({ tier: orgAdminTier }).strict()
export type TierChangeRequest = z.infer<typeof tierChangeRequest>

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

/**
 * Changing your own password while logged in.
 *
 * `current_password` is required even though the session already proves
 * identity: it is what makes a stolen *session* insufficient to take the
 * *account*. Every other session is revoked on success; the one that made the
 * change survives, because logging someone out of the tab they just used is
 * indistinguishable from the change having failed.
 *
 * Shared with the app-user surface (`POST /api/client/password/change`): the
 * argument is about credentials and sessions, not about which space the person
 * lives in.
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
 * Asking for a reset link, **as a Fleetless user**.
 *
 * **The response never says whether the address exists.** It is unauthenticated
 * and would otherwise be an account-enumeration oracle — the one place where
 * §3.3's "reveal nothing about what exists" is not a preference but the whole
 * point. So this answers the same way for a known and an unknown address, in
 * status, body **and timing**, and any consumer that renders "no such account"
 * from it has reintroduced the oracle.
 *
 * A bare address resolves to at most one account: a Fleetless user's email is
 * **globally unique**, so the reset mails the one match, if any, with a token
 * bound to that account.
 *
 * The app-user equivalent is `clientPasswordResetRequest` in `client-auth.ts`
 * and carries an `app_identifier`, because on that surface a person is
 * identified by app *and* address. Two shapes rather than one, because the two
 * surfaces identify a person differently — not because the reasoning differs.
 */
export const passwordResetRequest = z.object({
  email: z.email(),
})
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>

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
 * An IdP issuer URL — **an attacker-supplied string that decides where the
 * *server* connects.**
 *
 * `redirectUri` in `oauth.ts` got a parsed scheme check and an explicit
 * loopback allow-list, with the reasoning written down, because it decides
 * where a *credential* goes. This field got `z.url()` — in the same file, in
 * the same wave. Argus-W7b found it and stored `file:///etc/passwd`,
 * `http://169.254.169.254/latest/meta-data` and `http://infra-postgres-1:5432`
 * through the app's IdP route, then caught the outbound discovery fetch on a
 * listener he stood up. **That is this project's own question — which rules
 * have we already written down, and where else do they apply — answered badly,
 * one field over.**
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
 * unless something explicitly opts in for development, and it names DNS
 * rebinding as its own residual. A schema that quietly looked sufficient here
 * would be worse than one that says where the real check has to live.
 *
 * It lives in this file rather than beside its one consumer because it is a
 * rule about URLs the server dereferences, and the next such field should find
 * it already written down. `appOidcProvider` is that consumer today.
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
 * **The federated callback error vocabulary is deleted, with no successor
 * here.** `oidcCallbackErrorCode` and `oidcCallbackError` described the page
 * `GET /mcp/oauth/idp-callback` rendered when a group's identity provider sent
 * a browser back — `jit_disabled` and `email_collision` name provisioning steps
 * only a group provider had. D1 makes Fleetless users password-only and deletes
 * group providers, so the flow that produced these codes cannot start; the
 * route is gone from this manifest and from the cloud.
 *
 * The per-app OIDC vocabulary is `clientOidcErrorCode` in `client-auth.ts`: a
 * different list, for a different flow, redirected to the developer's own page
 * rather than rendered by Fleetless. Two callback error enums coexisting is how
 * the wrong one gets picked up by the train that adds per-app OIDC, which is
 * why this one is deleted rather than left standing for it.
 */

/**
 * `GET /api/auth/me` — named so the console can validate it.
 *
 * `user` is a `fleetlessUser`, and its `tier` is required, so this response
 * always states the caller's console powers. It used to be an `orgUser` whose
 * tier was optional and *always present in practice on this route* — a
 * guarantee the route made and the schema could not, which is exactly the kind
 * of gap this file keeps finding. The two-space cut closed it by making the
 * field required on the shape itself.
 */
export const authMeResponse = z.object({ org, user: fleetlessUser })
export type AuthMeResponse = z.infer<typeof authMeResponse>

/** `PATCH /api/org` — rename the org. Owner only. Same bounds as signup's `org_name`. */
export const patchOrgRequest = z.object({ name: z.string().min(1).max(120) }).strict()
export type PatchOrgRequest = z.infer<typeof patchOrgRequest>

/** `PATCH /api/auth/me` — the caller updates their own display name (null clears it). */
export const patchAuthMeRequest = z.object({ display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable() }).strict()
export type PatchAuthMeRequest = z.infer<typeof patchAuthMeRequest>
