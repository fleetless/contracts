// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { idpIssuer, mailStatus, password } from './identity.js'

/**
 * **App users: the per-app identity space** (spec `2026-09-05-app-user-auth`,
 * D1–D7).
 *
 * The 2026-08-29 model put developers and end users into one pool per org,
 * tied apps to groups, and let an org admin enter an app only by
 * impersonation. It modelled the wrong thing: the people who configure robots
 * in the console and the people who use a developer's app are different
 * populations with different lifecycles, and every mechanism that connected
 * them — groups, assignments, impersonation, the app-branded portal pages —
 * was cost without a product reason.
 *
 * So there are now **two identity spaces and nothing joins them**:
 *
 * - *Fleetless users* (`identity.ts`) — the org's team. Email globally unique,
 *   tier `owner | developer`, Fleetless password, console access.
 * - *app users* (this file) — one app each. Email unique **per app**,
 *   case-insensitively. The same address may exist in several apps of one org
 *   as unrelated accounts, and a Fleetless user who wants to use an app
 *   registers or is invited like anybody else.
 *
 * **Fleetless shows an app user no page** (D2). The developer's own UI owns
 * every screen and calls the JSON client-auth API (`client-auth.ts`). The one
 * Fleetless-rendered surface an app user can reach is the problem page for an
 * OIDC callback whose state no longer resolves to a redirect URI — every other
 * error is redirected to the app to render. That is why the four URLs on
 * `appAuthConfig` exist: Fleetless mails a link, and the link points into the
 * app.
 */

/** App-user display names share the Fleetless-user bound, so a rename cannot be legal in one space and refused in the other. */
export const APP_USER_DISPLAY_NAME_MAX = 120

/**
 * **A provider slug — hyphenated, and deliberately not the ROS slug grammar.**
 *
 * `appIdentifier` is `slug`: lowercase and *underscore*-separated, because it
 * names something that also appears in ROS. A provider slug appears in a URL
 * path (`/api/client/oidc/:slug/start`) and on the developer's own sign-in
 * buttons, where a hyphen is the conventional spelling — `azure-ad`, not
 * `azure_ad`.
 *
 * The two grammars are one character apart, which is exactly why this is its
 * own export with its own tests rather than a reuse: reusing the wrong one
 * would be invisible until a customer typed a hyphen.
 */
export const providerSlug = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'a provider slug is lowercase and hyphen-separated, starting with a letter')

/**
 * **The three states an app user can be in, and the order is the lifecycle.**
 *
 * - `pending_verification` — self-registered, mail sent, cannot log in yet.
 *   Without this state a domain allow-list would prove nothing: anybody could
 *   claim any address at an allowed domain.
 * - `active` — may log in.
 * - `blocked` — may not, and every refusal is the same `invalid_credentials`
 *   a wrong password gets. A block that announced itself would be an
 *   account-enumeration oracle with an extra step.
 *
 * `pending_verification` is reached exactly once and left only by spending the
 * mailed token, which is why `patchAppUserRequest` cannot set it: see there.
 */
export const appUserStatus = z.enum(['pending_verification', 'active', 'blocked'])
export type AppUserStatus = z.infer<typeof appUserStatus>

/**
 * **A user of one app.** Not a user of the org: `app_id` is the whole scope,
 * and the uniqueness constraint the cloud enforces is `(app_id, lower(email))`
 * rather than a global one. The same person at two apps of one org is two
 * unrelated rows, by design (D1).
 */
export const appUser = z.object({
  id: z.uuid().meta({
    description: 'The app user in the API, assigned by the cloud and stable for the life of the account.',
  }),
  app_id: z.uuid().meta({
    description: 'The app this user belongs to, and the whole of their scope. An app user of one app is nobody at another, even inside the same organisation.',
  }),
  email: z.email().meta({
    description: 'The address the account is identified by. Unique **per app**, case-insensitively — the same address may exist as an unrelated account in another app of the same organisation.',
  }),
  display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().meta({
    description: 'Optional human name, shown by the developer\'s own UI instead of the address where present. `null` when the user never supplied one; never used for authentication.',
  }),
  role_id: z.uuid().meta({
    description: 'The role that decides what this user may reach. Roles are the only visibility filter: what a role does not grant does not exist for that user.',
  }),
  status: appUserStatus.meta({
    description: 'Where the account is in its lifecycle. Only `active` may log in; `pending_verification` and `blocked` are both refused with the same `invalid_credentials` a wrong password gets, so a failed login is not an account-enumeration oracle.',
  }),
  /**
   * The wire's only statement about the credential, one bit on purpose: a
   * response that carries a hash puts it in every log that ever captured a
   * response. `false` is an OIDC-only account or an invitation not yet
   * accepted — it does not mean blocked and it does not mean without access.
   */
  has_password: z.boolean().meta({
    description: 'Whether this account has a Fleetless-held password at all. `false` is an identity-provider-only account, or an invitation not yet accepted — it does not mean blocked and it does not mean without access. No hash, no algorithm and no "last changed" travels here, and nothing on the wire can say whether a password is strong or already known to somebody else.',
  }),
  providers: z.array(providerSlug).max(20).meta({
    description: 'The slugs of the identity providers this account is linked to, empty for a password-only user. It is what lets a developer\'s user list say where an account came from without a second request.',
  }),
  last_login_at: z.iso.datetime().nullable().meta({
    description: 'When this user last signed in, or `null` if they never have. Required and nullable rather than optional, so *never logged in* stays distinguishable from *this field was not loaded*.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the account was created, as an ISO 8601 timestamp.',
  }),
})
export type AppUser = z.infer<typeof appUser>

/** `GET /api/apps/:id/users` — every app user of one app, never null: an app with no users answers an empty array. */
export const appUserListResponse = z.object({
  users: z.array(appUser).meta({
    description: 'Every user of this app. An app with no users answers an empty array, not an absent key.',
  }),
})
export type AppUserListResponse = z.infer<typeof appUserListResponse>

/**
 * **A developer creating an app user directly, password and all** — the door
 * that exists so a developer can seed an account without waiting for a mail.
 *
 * `.strict()`: `status` is absent and cannot arrive. A user created here is
 * `active`, because a developer who typed the password has already vouched for
 * the address; letting the body choose would give one route two lifecycles.
 */
export const createAppUserRequest = z
  .object({
    email: z.email().meta({
      description: 'The address, unique per app case-insensitively. An address this app already knows is refused with `email_taken` — a developer-authenticated route may say so, unlike the public registration route.',
    }),
    password: password.meta({
      description: 'The initial password. At least 12 characters: length only, because a rule a user cannot predict is a rule they work around.',
    }),
    display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'Optional human name. Absent leaves it unset; an explicit `null` is the same end state.',
    }),
    role_id: z.uuid().optional().meta({
      description: 'The role the new user holds. Absent means the app\'s `default_role_id`, and `409 target_state_conflict` when the app has none or its default no longer resolves; a role belonging to another app is `404 not_found`, the same refusal a role that never existed gets.',
    }),
  })
  .strict()
export type CreateAppUserRequest = z.infer<typeof createAppUserRequest>

/**
 * `PATCH /api/apps/:id/users/:userId` — **what a developer may change, and
 * what is absent rather than merely un-required.**
 *
 * `email` is not here: it is the identifier of the account, the value every
 * invitation, reset link and audit line names, and a PATCH that could change
 * it is both an account-takeover surface and a uniqueness race. Strict, so
 * offering it is a refusal rather than a silently dropped field.
 *
 * **`status` admits only `active` and `blocked`.** `pending_verification` is
 * reached once, by self-registration, and left by spending the mailed token
 * (D6). A developer able to set it back could void a verified address without
 * the user ever seeing a mail, and there is no route out of that state that
 * does not require a token nobody re-sent. So the narrower enum is the rule,
 * stated in the schema rather than left to a handler to remember.
 */
export const patchAppUserRequest = z
  .object({
    display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'The user\'s display name. Absent leaves it alone; an explicit `null` clears it.',
    }),
    role_id: z.uuid().optional().meta({
      description: 'The role the user holds from now on. A role belonging to another app is `404 not_found`, the same refusal a role that never existed gets; re-roling closes the user\'s live subscriptions.',
    }),
    status: z.enum(['active', 'blocked']).meta({
      description: 'Block the account or let it back in. **`pending_verification` cannot be set here**: it is reached only by self-registration and left only by spending the mailed verification token, so a developer setting it would strand the account in a state nothing re-mails them out of.',
    }).optional(),
  })
  .strict()
export type PatchAppUserRequest = z.infer<typeof patchAppUserRequest>

/**
 * **Inviting an address into an app.** The invitation carries the role, so the
 * person who accepts it lands with the access the developer chose rather than
 * with a default somebody has to remember to change afterwards.
 */
export const createAppInvitationRequest = z
  .object({
    email: z.email().meta({
      description: 'The address to invite. An invitation always bypasses the domain whitelist — a developer inviting somebody by hand has already made the decision the whitelist automates.',
    }),
    role_id: z.uuid().optional().meta({
      description: 'The role the invitee gets on acceptance. Absent means the app\'s `default_role_id`.',
    }),
    display_name: z.string().min(1).max(APP_USER_DISPLAY_NAME_MAX).nullable().optional().meta({
      description: 'An optional name to pre-fill the account with; the invitee can change it afterwards.',
    }),
    send_mail: z.boolean().meta({
      description: 'Whether Fleetless mails the invitation. **Refused with `409 target_state_conflict` naming `invite_url` when the app has configured none** — there would be nowhere for the link to point, and a mail carrying a Fleetless-hosted page is a surface this product does not have.',
    }),
  })
  .strict()
export type CreateAppInvitationRequest = z.infer<typeof createAppInvitationRequest>

/**
 * The invitation as issued.
 *
 * **`accept_url` is nullable, and that is a policy rather than a convenience.**
 * The link points into the developer's app, at their configured `invite_url`.
 * An app that has configured none has nowhere for it to point, so there is no
 * link to hand back — `null` says that outright, where an absent key would be
 * indistinguishable from a mapper that dropped the field and a fabricated
 * Fleetless-hosted URL would name a page this product does not serve (D2).
 */
export const appInvitation = z.object({
  id: z.uuid().meta({ description: 'The invitation, as listed and revoked by the developer.' }),
  app_id: z.uuid().meta({ description: 'The app the invitee will belong to.' }),
  email: z.email().meta({ description: 'The address the invitation was addressed to.' }),
  role_id: z.uuid().meta({ description: 'The role the invitee holds once they accept. Resolved at creation, so a later change to the app\'s default role does not silently re-aim an outstanding invitation.' }),
  expires_at: z.iso.datetime().meta({ description: 'When the token stops working. Seven days from issue; an expired token answers exactly as an unknown one does.' }),
  accept_url: z.url().max(500).nullable().meta({
    description: 'The link to give the invitee, built from the app\'s `invite_url` with the token substituted for `{token}`. **`null` when the app has configured no `invite_url`** — there is nowhere for the link to point, and Fleetless serves no page of its own for an app user. Bounded like every other URL that gets mailed, logged and rendered.',
  }),
  mail: mailStatus.meta({
    description: 'What happened to the mail: `sent` means the SMTP server accepted it, not that it was delivered; `not_requested` means none was attempted — the caller asked for none, or the app has no `invite_url` for a link to point at; `not_configured` is an expected state and not a failure; `failed` is the one worth somebody\'s attention.',
  }),
})
export type AppInvitation = z.infer<typeof appInvitation>

/**
 * A pending invitation as the developer sees it in the list — **without its
 * `accept_url`**, and that omission is the point.
 *
 * The list exists so a developer can see what is outstanding and revoke it.
 * Neither needs the token, and a list that carries it turns every screenshot,
 * log line and browser-history entry of that page into live credentials for
 * somebody else's account. The same rule `pendingUserInvite` already keeps.
 *
 * `mail` is omitted for a duller reason: it described what happened at
 * creation time, and re-serving it invites a reader to take it as current.
 */
export const pendingAppInvitation = appInvitation.omit({ accept_url: true, mail: true })
export type PendingAppInvitation = z.infer<typeof pendingAppInvitation>

/** `GET /api/apps/:id/invitations` — pending only. An accepted invitation is history, not something to revoke. */
export const appInvitationListResponse = z.object({
  invitations: z.array(pendingAppInvitation).meta({
    description: 'The app\'s outstanding invitations, without their tokens. An accepted one is history and does not appear.',
  }),
})
export type AppInvitationListResponse = z.infer<typeof appInvitationListResponse>

/**
 * **An app's OIDC provider, as read back** (D4). Any number per app, unlike
 * the group provider this replaces — a developer serving two customers needs
 * two, and the old at-most-one rule was a property of groups rather than of
 * identity.
 *
 * **No secret, by construction.** The client secret goes in through the create
 * and patch requests and never comes back out: a secret a response can carry
 * is a secret in every log that ever captured a response, the same rule the
 * server key and the group provider already kept.
 *
 * `issuer` is `idpIssuer` — http(s) only, no credentials, query or fragment.
 * **This is not the SSRF defence.** It cannot tell the dev IdP
 * (`http://localhost:8081/realms/…`) from `http://127.0.0.1:5432`, both being
 * loopback http; the real defence refuses loopback, link-local and private
 * ranges at the discovery fetch, in the cloud, and names DNS rebinding as its
 * own residual.
 */
export const appOidcProvider = z.object({
  id: z.uuid().meta({ description: 'The provider row, as listed, patched and deleted by the developer.' }),
  app_id: z.uuid().meta({ description: 'The app this provider signs users in to.' }),
  slug: providerSlug.meta({
    description: 'The stable handle in the sign-in URL (`/api/client/oidc/:slug/start`) and on the developer\'s own button. Unique per app, lowercase and hyphen-separated — **not** the underscore-separated grammar `identifier` uses. Immutable: linked identities are keyed by it.',
  }),
  name: z.string().min(1).max(80).meta({
    description: 'What the developer\'s sign-in page calls this provider, e.g. "Sign in with Azure AD". Free text; the only field of this shape the public `GET /api/client/providers` reveals besides the slug.',
  }),
  issuer: idpIssuer.meta({
    description: 'The provider\'s issuer URL, from which discovery and the JWKS are read. http(s) only, with no credentials, query or fragment — RFC 8414 §3 builds the discovery URL from the issuer\'s path, so a query there is meaningless and an `@` is a redirect trick. **This is not the SSRF defence**: it cannot tell a loopback dev provider from a loopback database, and the real check refuses loopback, link-local and private ranges at the fetch.',
  }),
  client_id: z.string().min(1).max(200).meta({
    description: 'The OAuth client the developer registered at their provider for Fleetless.',
  }),
  scopes: z.array(z.string().min(1).max(60)).min(1).max(20).meta({
    description: 'The scopes requested at the provider. At least one — a request that asks for nothing learns nothing — and bounded, because an unbounded array on a stored, logged and rendered shape is a size nobody chose.',
  }),
  link_verified_emails: z.boolean().meta({
    description: 'Whether a federated login may join an **existing** app user with the same address. It needs the provider to assert `email_verified` as well: either condition alone is account takeover, since a provider that lets anyone type any address into a profile would otherwise hand over every matching account, and a developer who connects a provider for a subset of their users would otherwise silently merge strangers.',
  }),
  enabled: z.boolean().meta({
    description: 'Whether this provider is offered at all. A disabled provider disappears from `GET /api/client/providers` and refuses a start with `provider_disabled`, without the row and its linked identities being deleted.',
  }),
  created_at: z.iso.datetime().meta({ description: 'When the provider was configured, as an ISO 8601 timestamp.' }),
}).strict()
export type AppOidcProvider = z.infer<typeof appOidcProvider>

/** `GET /api/apps/:id/oidc-providers` — every provider of the app, enabled or not; the public client route lists only the enabled ones. */
export const appOidcProviderListResponse = z.object({
  providers: z.array(appOidcProvider).meta({
    description: 'Every provider configured on this app, disabled ones included — this is the developer\'s management view, unlike the public `GET /api/client/providers`, which lists only what a user can actually press.',
  }),
})
export type AppOidcProviderListResponse = z.infer<typeof appOidcProviderListResponse>

/**
 * **Creating a provider** — `.strict()`, and the only place besides the patch
 * that carries the client secret.
 *
 * The secret is **required here and optional on the patch**: a provider with
 * no secret cannot exchange a code, so a create without one would store a row
 * that can never work; a patch without one keeps the stored value, so a
 * routine edit of the scopes does not force the secret back onto the wire.
 * The minimum length refuses a trivial value — a one-character client secret
 * is a misconfiguration, not a rotation.
 */
export const createAppOidcProviderRequest = z
  .object({
    slug: providerSlug.meta({
      description: 'The handle for this provider, unique per app. Immutable once created — identities are keyed by it, so a rename would orphan every linked account.',
    }),
    name: z.string().min(1).max(80).meta({ description: 'What the developer\'s sign-in page calls this provider.' }),
    issuer: idpIssuer.meta({
      description: 'The provider\'s issuer URL. Shape-checked here (http(s), no credentials, query or fragment); the authoritative SSRF defence is at the discovery fetch.',
    }),
    client_id: z.string().min(1).max(200).meta({ description: 'The OAuth client registered at the provider for Fleetless.' }),
    client_secret: z.string().min(16).max(500).meta({
      description: 'The client secret, **write-only**: it is stored encrypted and comes back through nothing — not the read, not this route\'s own answer, not an audit detail. Required on create, since a provider with no secret cannot exchange a code; the minimum length refuses a value that is a misconfiguration rather than a secret.',
    }),
    scopes: z.array(z.string().min(1).max(60)).min(1).max(20).default(['openid', 'email', 'profile']).meta({
      description: 'The scopes to request. Defaults to `openid email profile`, which is what the linking rules in this design actually read: the subject, the address and its verified flag, and a name.',
    }),
    link_verified_emails: z.boolean().default(false).meta({
      description: 'Whether a federated login may join an existing app user by verified address. **Defaults to off**, because relaxing later is additive and admitting duplicates now and tightening afterwards is not.',
    }),
    enabled: z.boolean().default(true).meta({
      description: 'Whether the provider is offered immediately. Defaults to on: a developer who just typed a client secret is configuring a provider they mean to use.',
    }),
  })
  .strict()
export type CreateAppOidcProviderRequest = z.infer<typeof createAppOidcProviderRequest>

/**
 * **Patching a provider** — every field optional, and `slug` absent.
 *
 * The slug is in the path and is what `app_user_identities` rows are keyed by,
 * so renaming it would orphan every linked account. Strict, so offering it is
 * a `400` naming the field rather than a `200` that changed nothing — the
 * silence `updateAppRequest` was made strict to avoid.
 */
export const patchAppOidcProviderRequest = z
  .object({
    name: z.string().min(1).max(80).optional().meta({ description: 'A new display name for the provider.' }),
    issuer: idpIssuer.optional().meta({ description: 'A new issuer URL. Changing it re-runs discovery; identities linked under the old one keep their `(provider, subject)` key.' }),
    client_id: z.string().min(1).max(200).optional().meta({ description: 'A new client id.' }),
    client_secret: z.string().min(16).max(500).optional().meta({
      description: 'A replacement client secret. **Absent means keep the stored one**, so a routine edit need not put the secret back on the wire; it is never echoed back by any route.',
    }),
    scopes: z.array(z.string().min(1).max(60)).min(1).max(20).optional().meta({ description: 'A replacement scope list. A replace, not a merge.' }),
    link_verified_emails: z.boolean().optional().meta({ description: 'Whether a federated login may join an existing app user by verified address.' }),
    enabled: z.boolean().optional().meta({ description: 'Turn the provider off or back on without deleting it or its linked identities.' }),
  })
  .strict()
export type PatchAppOidcProviderRequest = z.infer<typeof patchAppOidcProviderRequest>

/**
 * **The placeholder each configurable app URL must carry, declared once.**
 *
 * Three of the four take a `{token}` and the fourth an `{interaction}`, and
 * the difference is not cosmetic: the MCP login URL is handed an interaction
 * id, not a credential. Exported so the console's help text, the cloud's
 * substitution and this file's validators cannot spell them differently —
 * `OAUTH_PATHS`' lesson, applied before there are five hand-written copies.
 */
export const APP_URL_PLACEHOLDERS = {
  invite_url: '{token}',
  verify_url: '{token}',
  reset_url: '{token}',
  mcp_login_url: '{interaction}',
} as const

/**
 * **An app-hosted URL template: https (or loopback http) carrying its
 * placeholder exactly once.**
 *
 * Two rules, each with a failure it exists to prevent.
 *
 * *The scheme.* These links are mailed and carry a single-use credential in
 * their path; over plain http on a public host that credential is readable by
 * every hop. `localhost` and `127.0.0.1` are the exception because a developer
 * building their app has no certificate, and a rule that made local
 * development impossible would be worked around with a proxy nobody reviewed.
 *
 * *Exactly once.* The cloud substitutes the token with a plain string replace,
 * which takes the **first** occurrence. A template naming the placeholder
 * twice would therefore get one occurrence substituted and one left literal,
 * and the link would 404 for the person who received the mail rather than fail
 * for the developer who wrote it. Refusing at configuration time is the only
 * place that mistake is cheap. A template with no placeholder is refused for
 * the mirror reason: it would mail every recipient the same link.
 *
 * **What it cannot check**: that the URL resolves, that the app serves that
 * path, or that the developer's page knows what to do with the token. Nothing
 * a schema can see says any of that, and a validator that looked sufficient
 * here would be read as an assurance.
 */
export function appUrlTemplate(placeholder: string) {
  return z
    .string()
    .max(500)
    .refine(
      (v) => {
        try {
          const u = new URL(v.replace(placeholder, 'x'))
          const schemeOk =
            u.protocol === 'https:' ||
            (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
          return schemeOk && v.split(placeholder).length === 2
        } catch {
          return false
        }
      },
      { message: `must be an https URL (or http://localhost) containing ${placeholder} exactly once` },
    )
}

/**
 * **An origin, and nothing longer than an origin.**
 *
 * This list is both the CORS allow-list and the redirect-URI check, and a
 * browser's `Origin` header is a bare origin: scheme, host, port. An entry
 * carrying a path would compare unequal forever — a rule that silently never
 * matches, which is worse than one that refuses, because the developer sees
 * their own app rejected with nothing naming the typo.
 *
 * `u.origin === v` is the whole check for that: it rejects a trailing slash, a
 * path, a query and a fragment in one comparison, and it does so against the
 * browser's own normalisation rather than against a regex somebody has to keep
 * in step with it.
 */
export const allowedOrigin = z
  .string()
  .max(200)
  .refine(
    (v) => {
      try {
        const u = new URL(v)
        return (
          u.origin === v &&
          (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1')
        )
      } catch {
        return false
      }
    },
    { message: 'must be a bare origin (scheme, host, port) over https, or over http on localhost' },
  )

/**
 * **A domain for the self-registration whitelist, in one canonical spelling.**
 *
 * The list is compared against the domain part of an address the cloud has
 * already lowercased, so an entry carrying a capital could never match — and
 * the developer who typed it would see self-registration refuse everybody with
 * nothing saying why. Lowercase is therefore the rule rather than a
 * normalisation applied later in one of the two places that compare.
 *
 * The pattern is the ordinary LDH rule: labels of letters, digits and internal
 * hyphens, at least two labels, a TLD of letters. 253 characters is the DNS
 * name limit.
 */
export const emailDomain = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'must be a lowercase domain name with at least two labels',
  )

/**
 * **The app's auth settings: one row per app, configured by a Fleetless user**
 * (D3).
 *
 * `self_registration` and `allowed_domains` are **one policy for one
 * decision** — they govern registration by password and registration through
 * an identity provider alike (D4). An invitation always bypasses both, because
 * a developer inviting somebody by hand has already made the decision the
 * whitelist automates.
 *
 * The four URLs are what makes D2 work: Fleetless mails a link, and the link
 * points into the developer's app. An app that has configured none of them
 * still works for password login — it simply cannot send a mail that leads
 * anywhere, and `send_mail` is refused rather than silently sending a dead
 * link.
 */
export const appAuthConfig = z.object({
  self_registration: z.boolean().meta({
    description: 'Whether a stranger may create an account in this app. Off refuses `POST /api/client/register` with `403 registration_closed`, and refuses an unknown identity at an OIDC callback with the same reasoning — one switch for one decision, whichever door the person arrives at.',
  }),
  allowed_domains: z.array(emailDomain).max(50).meta({
    description: 'The email domains self-registration accepts, lowercase. An empty list means no domain restriction, not "nobody" — the switch above is what closes the door. **An invitation always bypasses this**, by password and through a provider alike.',
  }),
  allowed_origins: z.array(allowedOrigin).max(20).meta({
    description: 'The origins the client auth API answers CORS for, and the only origins an OIDC `redirect_uri` may name. Bare origins: scheme, host and port, with no path — a browser sends nothing longer, so an entry carrying one could never match.',
  }),
  mcp_enabled: z.boolean().meta({
    description: 'Whether this app serves an MCP endpoint at `/mcp/<identifier>`. Off refuses the whole OAuth surface for the app, not merely the tool calls, and is re-read on every request rather than cached off a token.',
  }),
  invite_url: appUrlTemplate('{token}').nullable().meta({
    description: 'The page in the developer\'s app that accepts an invitation, with `{token}` where the token goes. `null` when unconfigured, and then an invitation still issues but `send_mail` is refused with `409 target_state_conflict` — there would be nowhere for the link to point.',
  }),
  verify_url: appUrlTemplate('{token}').nullable().meta({
    description: 'The page that confirms a new address, with `{token}` where the token goes. Self-registration needs it: without a page to send people to, a registration would leave an account nobody can activate.',
  }),
  reset_url: appUrlTemplate('{token}').nullable().meta({
    description: 'The page that takes a new password, with `{token}` where the token goes.',
  }),
  mcp_login_url: appUrlTemplate('{interaction}').nullable().meta({
    description: 'The page an MCP authorization redirects to, with `{interaction}` where the interaction id goes. Not a token: the id names a pending request the server already holds, and the app authenticates the user itself before approving it.',
  }),
  oidc_callback_url: z.url().meta({
    description: 'The one callback URL to register at every identity provider, the same for every app and every provider. **Read-only** — it is minted by the cloud from its own public base URL, and a writable version of this field would let a caller point the return leg, which carries an authorization code, at a host they own.',
  }),
  updated_at: z.iso.datetime().meta({ description: 'When the configuration was last written, as an ISO 8601 timestamp.' }),
})
export type AppAuthConfig = z.infer<typeof appAuthConfig>

/**
 * `PUT /api/apps/:id/auth-config` — a replace, not a merge, and `.strict()`.
 *
 * `oidc_callback_url` and `updated_at` are omitted because both are the
 * server's: see the callback URL's own note for why a writable one would be a
 * redirect-target hole rather than a convenience.
 */
export const putAppAuthConfigRequest = appAuthConfig
  .omit({ oidc_callback_url: true, updated_at: true })
  .strict()
export type PutAppAuthConfigRequest = z.infer<typeof putAppAuthConfigRequest>

/**
 * The three mails a developer may replace with their own template (D5).
 * Mails to *Fleetless* users — a team invitation, a console password reset —
 * stay Fleetless default and are deliberately not customisable: they are
 * about this platform, not about the developer's product.
 */
export const mailTemplateKind = z.enum(['invite', 'verify', 'reset'])
export type MailTemplateKind = z.infer<typeof mailTemplateKind>

/**
 * **Every variable a template may name, and the list is closed.**
 *
 * Liquid runs in strict mode: an unknown variable is an error at save time and
 * in the preview, rather than an empty string in a mail somebody already
 * received. That is only worth anything if the permitted set is written down
 * where the renderer, the console's completion and the docs all read the same
 * one.
 */
export const MAIL_TEMPLATE_VARIABLES = [
  'app.name',
  'org.name',
  'user.email',
  'user.display_name',
  'role.name',
  'link',
  'expires_in_hours',
] as const

/**
 * **The Fleetless default text for the three app mails.**
 *
 * It lives here rather than in the cloud because two products send the same
 * words: the cloud renders these when an app has no template of its own, and
 * the console seeds its editor with them when a developer presses *Customise*.
 * They were written twice, in different words, and a developer comparing the
 * editor against a mail they had received would have found two Fleetless
 * defaults that disagreed. One text, one place, and neither consumer may hold
 * a copy.
 *
 * These are Liquid templates like any custom one — the same variables, the
 * same renderer, the same bounds — so the cloud's fallback path cannot become
 * a second, weaker mechanism that merely looks like the real one.
 *
 * **Text-only (`html: null`).** A text part is a complete mail, and a default
 * that shipped markup would make every app that never opens the Mails tab send
 * Fleetless-styled HTML on behalf of a product that is not Fleetless.
 *
 * The voice is plain and short, names the app rather than this platform, and
 * says what the link does, how long it lasts, and what to do if it was not
 * you.
 *
 * **`verify` and `reset` greet by the address, not by the display name**, and
 * that is a security decision rather than a style one. `display_name` on those
 * two mails comes from `POST /api/client/register`, which is unauthenticated:
 * whoever typed the address also chose 120 characters of text that Fleetless
 * then renders into a mail sent from the *developer's* own sender to an
 * address the same caller chose. "Hello Account suspended — verify at
 * https://evil.example now," is a phishing line with a real product's return
 * address on it. The recipient's own address is the one value in that mail
 * they can check, and it is the greeting. `invite` keeps the display name:
 * that one is written by an authenticated developer about somebody they
 * invited.
 *
 * **`expires_in_hours` is the only lifetime variable a template gets**, and
 * the three values are 1, 24 and 168. "The next 168 hours" is not how a person
 * says a week, so each default converts: 48 and up reads in days, exactly one
 * reads "1 hour", everything else reads in hours. The conversion is in the
 * template rather than in a new variable because a custom template has the
 * same problem and this is the spelling it can copy.
 *
 * **What contracts does NOT assert about these.** That they compile as Liquid
 * is the cloud's business — contracts has no renderer and adding one to check
 * its own constant would be a second, weaker copy of the thing that actually
 * sends mail. Here they are pinned as a complete, non-empty set; the cloud
 * asserts that the mail it sends for each kind is this exact text.
 */
export const DEFAULT_MAIL_TEMPLATES: Record<MailTemplateKind, { subject: string, text: string, html: null }> = {
  invite: {
    subject: "You're invited to {{ app.name }}",
    text: `Hello {{ user.display_name | default: user.email }},

{{ org.name }} has invited you to {{ app.name }} as {{ role.name }}.

Accept the invitation and choose a password:
{{ link }}

The link works for the next {% if expires_in_hours >= 48 %}{{ expires_in_hours | divided_by: 24 }} days{% elsif expires_in_hours == 1 %}1 hour{% else %}{{ expires_in_hours }} hours{% endif %}. If you were not expecting this invitation, ignore this mail — no account is created until you accept.
`,
    html: null,
  },
  verify: {
    subject: 'Confirm your email for {{ app.name }}',
    text: `Hello {{ user.email }},

Confirm this address so you can sign in to {{ app.name }}:
{{ link }}

The link works for the next {% if expires_in_hours >= 48 %}{{ expires_in_hours | divided_by: 24 }} days{% elsif expires_in_hours == 1 %}1 hour{% else %}{{ expires_in_hours }} hours{% endif %}. If you did not create this account, ignore this mail — the account stays unconfirmed and cannot be used.
`,
    html: null,
  },
  reset: {
    subject: 'Reset your {{ app.name }} password',
    text: `Hello {{ user.email }},

Someone asked to reset the password for this address at {{ app.name }}.

Choose a new password:
{{ link }}

The link works for the next {% if expires_in_hours >= 48 %}{{ expires_in_hours | divided_by: 24 }} days{% elsif expires_in_hours == 1 %}1 hour{% else %}{{ expires_in_hours }} hours{% endif %}. If it was not you, ignore this mail — your current password keeps working and nothing changes.
`,
    html: null,
  },
}

/**
 * One stored template. `html` is nullable because the mailer's HTML part is
 * optional — a text-only mail is a complete mail, and an app that wants one
 * should not have to write the same words twice.
 */
export const appMailTemplate = z.object({
  kind: mailTemplateKind.meta({ description: 'Which of the three mails this template replaces.' }),
  subject: z.string().min(1).max(200).meta({ description: 'The subject line, a Liquid template. Bounded because a subject is rendered into a header.' }),
  text: z.string().min(1).max(20_000).meta({ description: 'The plain-text body, a Liquid template. Required even when an HTML part is given: a mail with no text part is unreadable to a client that refuses HTML.' }),
  html: z.string().min(1).max(100_000).nullable().meta({ description: 'The optional HTML body, a Liquid template. `null` means this template is text-only, which is a complete mail and not a half-configured one.' }),
  updated_at: z.iso.datetime().meta({ description: 'When the template was last written, as an ISO 8601 timestamp.' }),
})
export type AppMailTemplate = z.infer<typeof appMailTemplate>

/** `GET /api/apps/:id/mail-templates` — **only the kinds that have a custom template.** An absent kind is one using the Fleetless default, which is a state and not a gap. */
export const appMailTemplateListResponse = z.object({
  templates: z.array(appMailTemplate).max(3).meta({
    description: 'The app\'s custom templates. A kind that does not appear is one using the Fleetless default text — an ordinary state, not a missing row.',
  }),
})
export type AppMailTemplateListResponse = z.infer<typeof appMailTemplateListResponse>

/**
 * The body both the PUT and the preview take: `kind` is in the path and
 * `updated_at` is a server fact, so neither may arrive — a body carrying
 * `kind` could disagree with the path and leave the handler to choose which
 * half to believe.
 *
 * `html` becomes `.optional()` as well as nullable here. Absent and `null` are
 * the same end state on a write (text-only), and requiring the key would make
 * the common case ceremony.
 */
const mailTemplateBody = appMailTemplate
  .omit({ kind: true, updated_at: true })
  .extend({ html: z.string().min(1).max(100_000).nullable().optional() })

export const putAppMailTemplateRequest = mailTemplateBody.strict()
export type PutAppMailTemplateRequest = z.infer<typeof putAppMailTemplateRequest>

/**
 * **The preview takes the same document the PUT does — as a second object,
 * not as an alias.**
 *
 * The fields are defined once (`mailTemplateBody` above) and `.strict()` twice,
 * so there is one definition and two values. An alias would be one value under
 * two contract names, and the export registry resolves an artifact by object
 * identity: it refuses a schema registered twice, because the artifact a route
 * points at would otherwise be a coin toss.
 */
export const mailTemplatePreviewRequest = mailTemplateBody.strict()
export type MailTemplatePreviewRequest = z.infer<typeof mailTemplatePreviewRequest>

/** What the preview renders, with the sample data filled in. The developer reads this before anybody receives it. */
export const mailTemplatePreviewResponse = z.object({
  subject: z.string().meta({ description: 'The rendered subject line.' }),
  text: z.string().meta({ description: 'The rendered plain-text body.' }),
  html: z.string().nullable().meta({ description: 'The rendered HTML body, or `null` when the template is text-only.' }),
})
export type MailTemplatePreviewResponse = z.infer<typeof mailTemplatePreviewResponse>

/**
 * The `details` of a `422 template_invalid`: **which part failed**, not merely
 * that something did.
 *
 * A template has three independently-rendered parts, and an error that did not
 * say which one leaves the developer re-reading all three. `message` is the
 * renderer's own — it names the unknown variable or the syntax error — and
 * carries nothing else: it is written into an audit event as well, where the
 * rule is that no credential, token or password may appear.
 */
export const mailTemplateProblemDetails = z.object({
  part: z.enum(['subject', 'text', 'html']).meta({ description: 'Which of the three rendered parts failed.' }),
  message: z.string().meta({ description: 'The renderer\'s own message — the unknown variable, or the syntax error and where it is.' }),
})
export type MailTemplateProblemDetails = z.infer<typeof mailTemplateProblemDetails>

/**
 * **What a `202` says when the only thing that happened was a mail.**
 *
 * Three routes do one act and answer nothing about it — re-sending a user's
 * reset link, mailing an invitation, sending a test template. A bare `202`
 * with an empty body would be honest about the *acceptance* and silent about
 * the one fact the developer needs next, which is whether a mail actually left:
 * an app with no SMTP configured looks exactly like one that mailed, and the
 * developer waits for a message nobody sent.
 *
 * So the body is `{ "mail": mailStatus }` and nothing else. `sent` means the
 * SMTP server accepted it, not that it was delivered; `not_configured` is an
 * expected state on a deployment without a mailer and is not a failure;
 * `failed` is the one worth somebody's attention.
 *
 * It is its own object rather than a reuse of `appInvitation`'s field because
 * the export registry resolves an artifact by object identity — one schema
 * under two contract names would make the artifact a route points at a coin
 * toss, the same reason `mailTemplatePreviewRequest` is a second `.strict()`
 * rather than an alias.
 */
export const mailOutcome = z.object({
  mail: mailStatus.meta({
    description: 'What happened to the mail this call triggered. `sent` means the SMTP server accepted it, not that it was delivered; `not_requested` means none was attempted, because the caller asked for none or there was no link to carry; `not_configured` is an expected state and not a failure; `failed` is the one worth somebody\'s attention.',
  }),
})
export type MailOutcome = z.infer<typeof mailOutcome>
