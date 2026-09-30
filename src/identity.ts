// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * **Fleetless users: the org's team, and the only people who reach the
 * console.**
 *
 * There are two identity spaces now and **nothing joins them**:
 *
 * - *Fleetless users*, this file. The people who configure robots in the
 *   console. Email globally unique, tier `owner | developer`, sign-in through
 *   the auth portal by a code mailed to them or by a passkey — **no
 *   password** — with an optional second factor the organisation may require.
 *   They always have MCP access, at the one central endpoint.
 * - *app users*, `app-users.ts`. The people who use a developer's app. One app
 *   each, email unique per app, authenticated through the JSON client-auth
 *   API that the developer's own UI calls.
 *
 * A Fleetless user who wants to use an app registers or is invited like
 * anybody else; there is no path from one space to the other.
 *
 * **What that deleted, with no successor**: groups and the Org Admins
 * group, app assignments, impersonation, the per-user MCP override and the
 * org-level federation policy. The 2026-08-29 model pooled developers and end
 * users per org and joined them with all of the above. In use, wrong model:
 * the two populations have different lifecycles, and every joining mechanism
 * was cost without a product reason.
 *
 * What did **not** change: the session and token shapes, and the
 * enumeration-oracle reasoning. Neither was ever a statement about which space
 * a person lived in.
 *
 * **Developers have no password any more.** They sign in with a six-digit
 * code mailed to them, or with a passkey, which proves possession and user
 * verification at once and so completes a sign-in on its own. After a code,
 * a developer with a second factor — a passkey or an authenticator app —
 * gives it; ten recovery codes are the fallback. The password sign-in, the
 * password change, the reset pages and `POST /api/auth/signup` are gone: the
 * portal's sign-up (email, code, organisation) is the one door in.
 *
 * **Email is globally unique here** — `lower(email)` unique across all orgs, so
 * one address is exactly one Fleetless user in exactly one org. A bare address
 * therefore resolves to at most one account with no org context needed. App
 * users are the opposite and say so on their own shape: unique **per app**, so
 * one address may be several unrelated app accounts.
 */

/**
 * The password rule, stated once so the cloud, the console and the SDK refuse
 * the same inputs for the same reason. Length only: a rule a user cannot
 * predict is a rule they work around.
 *
 * App users only: Fleetless users sign in by emailed code or passkey and hold
 * no password.
 */
export const password = z.string().min(12).max(256)

/** The bound on a Fleetless user's display name; `APP_USER_DISPLAY_NAME_MAX` matches it, so a rename cannot be legal in one space and refused in the other. */
export const USER_DISPLAY_NAME_MAX = 120

/**
 * **The two tiers a Fleetless user can hold**. Owner-exclusive: delete
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
  require_two_factor: z.boolean().meta({
    description: 'Whether every member must have a second factor — a passkey or an authenticator app. A member without one sets it up at their next sign-in, before any session exists; nobody is signed out when it is switched on. It covers the console and the central MCP endpoint; server keys and robot bridges are not people and are not affected. Owners change it through `PATCH /api/org`.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the organisation was created, as an ISO 8601 timestamp.',
  }),
})
export type Org = z.infer<typeof org>

/** What `PATCH /api/org` answers: the org as it now stands. */
export const patchOrgResponse = z.object({
  org: org.meta({
    description: 'The organisation as it now stands, after the patch. The whole resource comes back, not only the changed fields.',
  }),
})
export type PatchOrgResponse = z.infer<typeof patchOrgResponse>

/**
 * **A member of the org's team.** Console access, a tier, a sign-in by
 * emailed code or passkey, and no relationship whatsoever to any app's users.
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
 * provider and hold no Fleetless credential. Every Fleetless user signs in by
 * a code mailed to their address, so the console has no federated door and
 * no IdP-lockout class, and a field about a password would describe nothing.
 * What varies is the second factor, which `two_factor` reports.
 */
export const fleetlessUser = z.object({
  id: z.uuid().meta({
    description: 'The Fleetless user in the API, assigned by the cloud and stable for the life of the account.',
  }),
  org_id: z.uuid().meta({
    description: 'The organisation this person belongs to. Every developer route is already scoped to the caller\'s org, so this confirms what a client is looking at, not a filter it applies.',
  }),
  email: z.email().meta({
    description: 'The address the account is identified by, **globally unique** across every organisation. Immutable after creation: it is what every invitation, reset link and audit line names.',
  }),
  display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().meta({
    description: 'Optional human name, shown by the console instead of the address where present. Self-service through `PATCH /api/auth/me`; never used for authentication. `null` when the person never supplied one.',
  }),
  tier: orgAdminTier.meta({
    description: 'The console powers this person holds. **Required** — every Fleetless user has a tier; it was optional only while the org also held people with no console powers to grade, and that pool is gone.',
  }),
  two_factor: z
    .object({
      passkeys: z.number().int().min(0).meta({ description: 'How many passkeys the person has registered.' }),
      authenticator: z.boolean().meta({ description: 'Whether the person has a confirmed authenticator app.' }),
    })
    .meta({
      description: 'The person\'s second factors, as the team list shows them: none, passkeys, an authenticator, or both. No credential travels here. An owner resets them through `DELETE /api/org/users/:id/two-factor`.',
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
 * Access plus refresh. The access token is short-lived; the
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

/* ------------------------------------------- codes and second factors --
 * Shared by both identity spaces, like `password` and `sessionTokens`: a
 * six-digit code and a recovery code are the same thing whoever types them,
 * and two spellings would be two rules for one decision.
 */

/**
 * **A six-digit code**: the emailed sign-in code (valid ten minutes, five
 * wrong attempts) and an authenticator's time-based code alike. Exactly six
 * digits on the wire, leading zeros included — the portal and hosted forms
 * strip spaces before they send it, the JSON API does not.
 */
export const loginCode = z.string().regex(/^\d{6}$/, 'must be exactly six digits')

/** An authenticator app's code (TOTP, RFC 6238: SHA-1, six digits, thirty-second steps). The same shape as `loginCode`. */
export const totpCode = loginCode

/**
 * **A recovery code as typed**: two groups of five base32 characters,
 * `xxxxx-xxxxx`, in either case — the cloud lower-cases before it compares.
 * Single use.
 */
export const recoveryCode = z.string().regex(/^[a-zA-Z2-7]{5}-[a-zA-Z2-7]{5}$/, 'must be two groups of five characters, xxxxx-xxxxx')

/**
 * **The ten recovery codes, as issued**: lowercase, shown once. Generating a
 * new set voids the old one.
 */
export const recoveryCodesList = z.array(z.string().regex(/^[a-z2-7]{5}-[a-z2-7]{5}$/)).length(10)

/**
 * **An authenticator being set up**: the secret to type in, and the same
 * secret as an `otpauth://` URL for a QR code. Nothing is stored as
 * confirmed until a code from it is confirmed.
 */
export const twoFactorSetupResponse = z.object({
  secret: z.string().min(1).meta({
    description: 'The shared secret, base32, for an authenticator app that cannot scan a QR code. Shown once; the cloud stores it encrypted.',
  }),
  otpauth_url: z.string().startsWith('otpauth://totp/').meta({
    description: 'The same secret as an `otpauth://totp/` URL, to render as a QR code. It carries the secret: never log it.',
  }),
})
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponse>

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
 * What happened to the mail, in four words instead of one.
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
 * - `not_requested`  — no mail was attempted: the caller asked for none
 *                      (`send_mail: false`). **A fourth word rather than a
 *                      reuse of `not_configured`**: the deployment's mailer
 *                      is irrelevant there, and a
 *                      console reading "mail server not configured" beside an
 *                      invitation whose mail checkbox was off would send a
 *                      developer to fix something that is not broken.
 * - `not_configured` — no SMTP is set up. **An expected state, not a failure**
 *                      (invitations work without mail; the link is the primary
 *                      path). The console must not show it as an error.
 * - `failed`         — SMTP was configured, was tried, and refused or was
 *                      unreachable. This one is worth someone's attention.
 *
 * Shared with `appInvitation`, which answers the same four facts about the
 * same mailer.
 */
export const mailStatus = z.enum(['sent', 'not_requested', 'not_configured', 'failed'])
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

/**
 * Accepting it: the token proves the invitation, and the mailed link proves
 * the address, so accepting needs no code and takes **no password** — the
 * new member signs in by emailed code from then on.
 */
export const acceptTeamInviteRequest = z
  .object({
    token: z.string().min(1).meta({
      description: 'The opaque invitation token from the link. Unknown, expired and already-accepted all collapse into `410 token_spent` — telling them apart would say whether a token ever existed.',
    }),
    display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'An optional name, overriding whatever the invitation pre-filled. Absent keeps it.',
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
 * rather than a missing grant.
 *
 * `forbidden` is deliberately silent about *existence*, and that stays true —
 * this says nothing about what the target is. But "your role does not
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
 * An app user changing their own password while signed in
 * (`POST /api/client/password/change`). Fleetless users have no password.
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
 * An IdP issuer URL — **an attacker-supplied string that decides where the
 * *server* connects.**
 *
 * `redirectUri` in `oauth.ts` carries a parsed scheme check and an explicit
 * loopback allow-list because it decides where a *credential* goes. A bare
 * `z.url()` here would accept `file:///etc/passwd`, a cloud metadata address or
 * an internal database host, and the server would then fetch it during issuer
 * discovery. The same rule applies one field over.
 *
 * **What this shape can decide, it now decides:** http(s) only (so no `file:`,
 * `gopher:`, `data:`), no credentials in the URL, no fragment, no query. RFC
 * 8414 builds the discovery URL from the issuer's path, so a query string
 * there is meaningless and a `@` is a redirect trick.
 *
 * **What it cannot decide, stated rather than implied:** it cannot tell
 * a development identity provider on `http://localhost:8081` from a database
 * on `http://127.0.0.1:5432`. Both are loopback http. So **this is
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
 * only a group provider had. Fleetless users sign in by emailed code or
 * passkey, with no group providers, so the flow that produced these codes cannot start; the
 * route is gone from this manifest and from the cloud.
 *
 * The per-app OIDC vocabulary is `clientOidcErrorCode` in `client-auth.ts`: a
 * different list, for a different flow, redirected to the developer's own page
 * rather than rendered by Fleetless. Two callback error enums coexisting is how
 * the wrong one gets picked up when per-app OIDC arrives, which is why this
 * one is deleted rather than left standing for it.
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

/**
 * `PATCH /api/org` — rename the org, require two-factor for its members, or
 * both. Owner only. At least one field: an empty patch is a refusal rather
 * than a write that changed nothing.
 */
export const patchOrgRequest = z
  .object({
    name: z.string().min(1).max(120).optional().meta({
      description: 'The organisation\'s new display name. Absent leaves it alone.',
    }),
    require_two_factor: z.boolean().optional().meta({
      description: 'Whether every member must have a second factor. Turning it on signs nobody out: each member without one sets it up at their next sign-in. Absent leaves it alone.',
    }),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.require_two_factor !== undefined, { message: 'Send name, require_two_factor, or both.' })
export type PatchOrgRequest = z.infer<typeof patchOrgRequest>

/** `PATCH /api/auth/me` — the caller updates their own display name (null clears it). */
export const patchAuthMeRequest = z.object({ display_name: z.string().min(1).max(USER_DISPLAY_NAME_MAX).nullable() }).strict()
export type PatchAuthMeRequest = z.infer<typeof patchAuthMeRequest>

/* ----------------------------------------- a developer's second factors --
 * Settings › Profile › Security in the console. Several passkeys, at most one
 * authenticator app, and ten recovery codes issued with the first factor.
 * Passkeys are for Fleetless users only; app users have the authenticator.
 */

/**
 * **A WebAuthn JSON document, opaque here.** The `PublicKeyCredential*JSON`
 * shapes of the WebAuthn Level 3 specification — creation and request options
 * going out, the browser's credential coming back. The browser API and the
 * server library define them; a second, hand-written copy here would be one
 * that drifts.
 */
export const webauthnJson = z.record(z.string(), z.unknown())

/**
 * **Options for a WebAuthn ceremony**, to hand to the browser as they are.
 * The relying party is `fleetless.dev`, so the auth portal and the console
 * both accept the same passkey; user verification is required.
 */
export const webauthnOptionsResponse = z.object({
  options: webauthnJson.meta({
    description: 'The `PublicKeyCredentialCreationOptionsJSON` or `PublicKeyCredentialRequestOptionsJSON` to pass to the browser. Its challenge is single-use and short-lived.',
  }),
})
export type WebauthnOptionsResponse = z.infer<typeof webauthnOptionsResponse>

/** **One registered passkey**, as Settings › Profile lists it. No key material travels here. */
export const developerPasskey = z.object({
  id: z.uuid().meta({ description: 'The passkey in the API, as renamed and removed through `/api/auth/passkeys/:id`.' }),
  name: z.string().min(1).max(80).meta({ description: 'What the person called it, such as the device it lives on.' }),
  created_at: z.iso.datetime().meta({ description: 'When it was registered.' }),
  last_used_at: z.iso.datetime().nullable().meta({ description: 'When it last signed the person in or confirmed a sign-in, or `null` if never.' }),
  synced: z.boolean().nullable().meta({
    description: 'Whether the authenticator reported the passkey as syncable across the person\'s devices (the backup-eligible flag), or `null` when it said nothing.',
  }),
})
export type DeveloperPasskey = z.infer<typeof developerPasskey>

/** **`GET /api/auth/two-factor`** — the caller's own second factors, in full. */
export const developerTwoFactor = z.object({
  passkeys: z.array(developerPasskey).meta({ description: 'Every passkey the caller has registered, oldest first. Empty when none.' }),
  authenticator: z
    .object({ created_at: z.iso.datetime().meta({ description: 'When the authenticator was confirmed.' }) })
    .nullable()
    .meta({ description: 'The confirmed authenticator app, or `null` when there is none. At most one.' }),
  recovery_codes_left: z.number().int().min(0).max(10).meta({
    description: 'How many of the ten recovery codes are unspent. `0` while the caller has no second factor.',
  }),
  required_by_org: z.boolean().meta({
    description: 'Whether the organisation requires a second factor. While it does, the last one cannot be removed.',
  }),
})
export type DeveloperTwoFactor = z.infer<typeof developerTwoFactor>

/** **Registering a passkey**: the name, and the browser's answer to the creation options. */
export const createPasskeyRequest = z
  .object({
    name: z.string().min(1).max(80).meta({ description: 'What to call the passkey, such as the device it lives on.' }),
    credential: webauthnJson.meta({ description: 'The browser\'s `RegistrationResponseJSON` for the options `POST /api/auth/passkeys/options` answered.' }),
  })
  .strict()
export type CreatePasskeyRequest = z.infer<typeof createPasskeyRequest>

/**
 * **The registered passkey**, and the ten recovery codes when it is the
 * account's first second factor — `null` otherwise, since the existing codes
 * stay valid.
 */
export const createPasskeyResponse = z.object({
  passkey: developerPasskey.meta({ description: 'The passkey as it is now stored.' }),
  recovery_codes: recoveryCodesList.nullable().meta({
    description: 'The ten recovery codes, shown once, when this passkey is the account\'s first second factor; `null` when the account already had one and its codes stay valid.',
  }),
})
export type CreatePasskeyResponse = z.infer<typeof createPasskeyResponse>

/** **Renaming a passkey.** The name is the only thing about one that can change. */
export const renamePasskeyRequest = z
  .object({
    name: z.string().min(1).max(80).meta({ description: 'The new name.' }),
  })
  .strict()
export type RenamePasskeyRequest = z.infer<typeof renamePasskeyRequest>

/** **Confirming a new authenticator** with a code it shows now. */
export const totpConfirmRequest = z
  .object({
    code: totpCode.meta({ description: 'A code the new authenticator shows now. It proves the secret was copied correctly before anything depends on it.' }),
  })
  .strict()
export type TotpConfirmRequest = z.infer<typeof totpConfirmRequest>

/**
 * **The confirmed authenticator.** Ten recovery codes when it is the
 * account's first second factor; `null` when it replaces an authenticator or
 * joins passkeys, whose codes stay valid.
 */
export const totpConfirmResponse = z.object({
  recovery_codes: recoveryCodesList.nullable().meta({
    description: 'The ten recovery codes, shown once, when this is the account\'s first second factor; `null` otherwise.',
  }),
})
export type TotpConfirmResponse = z.infer<typeof totpConfirmResponse>

/** **A fresh set of ten recovery codes**, shown once. The previous set stops working. */
export const recoveryCodesResponse = z.object({
  recovery_codes: recoveryCodesList.meta({ description: 'The ten new recovery codes, lowercase, shown once. Every earlier code is void.' }),
})
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponse>
