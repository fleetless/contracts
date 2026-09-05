import { z } from 'zod'
import { slug } from './common.js'

/**
 * Apps, roles and rights (spec §3.2, §3.3, §12.2).
 *
 * The rule that shapes all of this: **roles are the only filter**. A robot
 * assigned to an app exposes every one of its services to that app; what a
 * role does not grant simply does not exist for that user. There is no second
 * visibility mechanism, and adding one later would create two places to look
 * when someone cannot see something.
 */

/**
 * The app identifier a client sends at login. Same rule as a service slug:
 * stable, lowercase, underscore-separated.
 *
 * **Globally unique, not per org.** `clientLoginRequest` carries only the
 * identifier, the email and the password — there is no org context to
 * disambiguate with, so a per-org identifier could not be resolved at login
 * at all. A collision is refused with `identifier_taken`.
 */
export const appIdentifier = slug

export const app = z.object({
  id: z.uuid().meta({
    description: 'The app in the API, assigned by the cloud and stable for the life of the app. Everything app-scoped takes this as its `:id`.',
  }),
  org_id: z.uuid().meta({
    description: 'The organisation that owns this app. Every developer route is already scoped to the caller\'s org, so this confirms what a client is looking at rather than being a filter it applies.',
  }),
  name: z.string().min(1).max(120).meta({
    description: 'The display name, shown in the console and on the hosted login and consent pages. Free text, changed through `PATCH /api/apps/:id`.',
  }),
  identifier: appIdentifier.meta({
    description: 'The stable handle a client sends at login, lowercase and underscore-separated. **Globally unique, not per organisation** — `clientLoginRequest` carries no org context to disambiguate with, so a collision is refused with `identifier_taken`.',
  }),
  /**
   * **Exactly one group owns this app** (2026-08-29 identity redesign, D2).
   * The app uses that group's auth provider, and only users of that group can
   * hold an assignment for it — which is why re-linking cascade-deletes the
   * assignments that stop being valid.
   *
   * Not nullable and not optional: "an app with no group" is not a state the
   * model has, and an optional field here would let a mapper that forgot the
   * column produce one anyway.
   *
   * Changing it is `PUT /api/apps/:id/group` with `putAppGroupRequest`, never
   * `updateAppRequest` — see the comment there.
   */
  group_id: z.uuid().meta({
    description: 'The one group that owns this app. The app uses that group\'s auth provider, and only users of that group may hold an assignment for it. Changed through `PUT /api/apps/:id/group`, never through `updateAppRequest`, because re-linking cascade-deletes the assignments that stop being valid.',
  }),
  /** Robots are referenced individually; tags never grant rights (§12.2). */
  robot_ids: z.array(z.uuid()).meta({
    description: 'The robots this app may reach, each referenced individually. Tags never grant rights, and a robot absent from this list is invisible to the app whatever a role grants.',
  }),
  /**
   * Whether this app accepts **self-registering** OAuth clients (RFC 7591).
   *
   * Off by default and per app, because a normal app has no reason to accept
   * them: its own client is registered by the developer with known redirect
   * URIs. An MCP app does, because the end user *"trägt nur die URL ein"*
   * (§17) and the client registers itself — nobody vetted it, and
   * `POST /oauth/register` is therefore an **unauthenticated write endpoint**
   * standing in front of tools that move a physical robot.
   *
   * The flag is app state rather than a deployment setting so that turning it
   * on is a decision somebody made about one app, visible in the console and
   * in the audit log.
   *
   * **It is the only switch left on an app, and the sibling it used to have
   * is worth remembering.** W7c added `mcp_enabled` beside it — "whether this
   * app serves a remote MCP server at `/mcp/<identifier>`" — and the
   * central-MCP cut (D5, 2026-08-29) deleted the per-app endpoint it named.
   * The field outlived its endpoint by a release, gating nothing but one
   * `resource` branch of the legacy OAuth stub, and was removed on
   * 2026-08-29. `orgGroup.mcp_enabled` in `identity.ts` is a **different**
   * field with a live door behind it (`cloud/src/mcp-access.ts`); the two
   * shared a name and never a meaning.
   */
  accepts_dynamic_clients: z.boolean().meta({
    description: 'Whether this app accepts **self-registering** OAuth clients through `POST /oauth/register`. Off by default and per app: a normal app\'s client is registered by the developer with known redirect URIs, and an app driven by an AI tool is the case that needs it.',
  }),
  /**
   * **The app's default role** (2026-08-29 identity redesign, D1: *"role +
   * rights matrix and default role in app settings"*).
   *
   * Two consumers, one field. The console prefills it when an admin assigns a
   * user (`putAssignmentRequest` still carries the role explicitly — a
   * prefill is not a default the server applies), and the cloud authorizes an
   * **org admin** with it: admins hold no assignments (see `appAssignment`),
   * so an app login by one has to get its role from somewhere, and until D4's
   * impersonation interstitial lands this is that somewhere.
   *
   * `null` — and nullable rather than absent — means *this app has not chosen
   * one*. That is a normal state, not an unset field: every app is created
   * before its roles are configured, and the cloud falls back to the
   * least-privileged builtin (`observe`) by name rather than picking a role by
   * position. An app whose default role is deleted lands back here.
   *
   * The role must belong to **this** app; the schema sees a uuid and cannot
   * check that, so `PATCH /api/apps/:id` does.
   */
  default_role_id: z.uuid().nullable().meta({
    description: 'The role the console prefills when an admin assigns a user, and the role an **org admin** logs in with — admins hold no assignments of their own. `null` means this app has not chosen one, which is the normal state of a freshly created app and where an app whose default role was deleted lands; the cloud then falls back to the built-in `observe` role by name. The role must belong to this app, which `PATCH /api/apps/:id` checks and the schema cannot.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the app was created, as an ISO 8601 timestamp. `GET /api/apps` orders by this field.',
  }),
})
export type App = z.infer<typeof app>

/** What `GET /api/apps` answers: every app in the caller's org, in one envelope. */
export const appListResponse = z.object({
  apps: z.array(app).meta({
    description: 'Every app of the caller\'s organisation, oldest first by `created_at`. The org scope is the whole filter — there is no id to narrow by and nothing to refuse.',
  }),
})
export type AppListResponse = z.infer<typeof appListResponse>

/**
 * **`robot_ids` is accepted here, and `.strict()` catches everything else
 * (W7a).** Through W7 this shape carried `name` and `identifier` only, robots
 * attached through `updateAppRequest`, and zod stripped the extra key — so a
 * caller creating an app *with* robots got a `201` and an app with none.
 * **Two people fell into it independently on the same day**, which is the
 * definition of a shape that reads as though it does something it does not.
 *
 * Both halves matter and neither alone is enough. Accepting `robot_ids` is
 * right because attaching robots at creation is the obvious operation and the
 * store already does the work for `PATCH`; refusing unknown keys is right
 * because the next field somebody assumes into existence should produce a
 * `400` naming it rather than a silence. Same reasoning as `cancelRequest`
 * and `releaseLiveQuery`: a request shape that strips is a request shape that
 * lies quietly.
 *
 * Optional rather than required — an app with no robots is a normal thing to
 * create, and a required empty array would be ceremony.
 */
export const createAppRequest = z.object({
  name: z.string().min(1).max(120),
  identifier: appIdentifier,
  robot_ids: z.array(z.uuid()).optional(),
  /** Optional, defaulting to `false` — same reasoning as `robot_ids` above: setting it at creation is the obvious operation, and refusing it here would make a `.strict()` request reject the field the caller can plainly see on `app`. */
  accepts_dynamic_clients: z.boolean().optional(),
  /**
   * Required, unlike the switch above: an app belongs to exactly one
   * group from the moment it exists (D2), there is no sensible default — the
   * Org Admins group would be the one group whose members never hold
   * assignments — and a defaulted answer here decides who can log into the app.
   */
  group_id: z.uuid(),
}).strict()
export type CreateAppRequest = z.infer<typeof createAppRequest>

/**
 * **`group_id` is absent here on purpose, and `.strict()` is what makes that
 * absence mean something.** Re-linking an app to another group cascade-deletes
 * every assignment that stops being valid, so it is its own route with its own
 * acknowledgement (`putAppGroupRequest`). A rename must not be able to arrive
 * carrying that.
 *
 * This shape was not strict until 2026-08-29, which meant an offered
 * `group_id` was *dropped* — the caller got a `200`, the app kept its old
 * group, and nothing anywhere said so. That is the exact silence
 * `createAppRequest` above already learned about in W7a (*"a create shape that
 * silently drops a field cost two people a day each"*), and the lesson had not
 * been carried one shape over. A caller who sends `group_id` here is asking
 * for something this route does not do, and the honest answer is `400`, not a
 * success that means less than it looks.
 *
 * The route keeps its own check as belt-and-braces; a schema and a handler
 * agreeing is not two policies, it is one policy stated where each half can
 * enforce it.
 */
export const updateAppRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  robot_ids: z.array(z.uuid()).optional(),
  accepts_dynamic_clients: z.boolean().optional(),
  /**
   * `app.default_role_id`'s write half — an app *setting*, which is where D1
   * put the default role, so it belongs on the app's own PATCH and not on a
   * route of its own.
   *
   * **`.nullable().optional()`, and the two mean different things.** Absent
   * leaves the current default alone; an explicit `null` clears it. A field
   * that could only be set and never unset would make "we changed our mind"
   * unreachable through the API — the same silence `group_id` above was made
   * strict to avoid, from the other direction.
   *
   * Unlike `group_id`, this carries no cascade: changing it invalidates no
   * assignment and cuts nobody off, so it needs no acknowledgement and no
   * route of its own.
   */
  default_role_id: z.uuid().nullable().optional(),
}).strict()
export type UpdateAppRequest = z.infer<typeof updateAppRequest>

/**
 * A server key carries full app rights for server-side code (spec §3.4) —
 * never for clients. Same handling as the robot token from W1: the value is
 * returned exactly once and only its hash is stored.
 */
export const serverKeyToken = z.string().regex(/^flk_[0-9a-f]{32}$/)

export const serverKey = z.object({
  id: z.uuid().meta({
    description: 'The key row, and what the rotate and delete routes address. It is not the key: the secret itself is never carried by this shape.',
  }),
  app_id: z.uuid().meta({
    description: 'The app whose full rights this key carries. A key is never shared between apps.',
  }),
  name: z.string().min(1).max(120).meta({
    description: 'A label the developer chose, so a key can be recognised before it is rotated or deleted.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the key was minted, as an ISO 8601 timestamp. `GET /api/apps/:id/server-keys` orders by this field.',
  }),
  /** Null until first use — the cheapest way to spot a key nobody needs. */
  last_used_at: z.iso.datetime().nullable().meta({
    description: 'When this key last authenticated a request, or `null` if it never has — the cheapest way to spot a key nobody needs.',
  }),
})
export type ServerKey = z.infer<typeof serverKey>

/** What `GET /api/apps/:id/server-keys` answers — metadata only; the raw secret exists once, in `createServerKeyResponse`, and never here. */
export const serverKeyListResponse = z.object({
  server_keys: z.array(serverKey).meta({
    description: 'The app\'s server keys as metadata, oldest first by `created_at`. The raw secret is not here and never will be: it exists once, in the answer to the request that created or rotated the key.',
  }),
})
export type ServerKeyListResponse = z.infer<typeof serverKeyListResponse>

export const createServerKeyResponse = z.object({
  server_key: serverKey,
  key: serverKeyToken,
})
export type CreateServerKeyResponse = z.infer<typeof createServerKeyResponse>

/**
 * Every app starts with `observe` and `operate`; custom roles are allowed
 * from v1 (§3.3). `builtin` marks the two starting roles — they may be
 * edited like any other, the flag exists so the console can explain where
 * they came from.
 */
export const role = z.object({
  id: z.uuid().meta({
    description: 'The role, and what `putAssignmentRequest` and an app\'s `default_role_id` refer to.',
  }),
  app_id: z.uuid().meta({
    description: 'The app this role belongs to. Roles are never shared between apps, so a role id from another app reads as `not_found`.',
  }),
  name: z.string().min(1).max(60).meta({
    description: 'The role\'s name, shown wherever a user\'s access is chosen. The two roles every app starts with are named `observe` and `operate`.',
  }),
  builtin: z.boolean().meta({
    description: '`true` for the two roles every app starts with. They may be renamed and re-scoped like any other role; the flag exists so the console can explain where they came from, not to protect them.',
  }),
})
export type Role = z.infer<typeof role>

/** What `GET /api/apps/:id/roles` answers: the app's roles, builtin and custom alike. */
export const roleListResponse = z.object({
  roles: z.array(role).meta({
    description: 'The app\'s roles, built-in and custom alike, ordered by `created_at` and then by `name`. The tie-break is not cosmetic — the two built-in roles are inserted in one statement and share a creation time to the microsecond, so never read a role by position.',
  }),
})
export type RoleListResponse = z.infer<typeof roleListResponse>

/**
 * The rights matrix of one role: which slugs of which robot it may use, plus
 * the capabilities roles also govern (§3.3). `capabilities`' own doc comment
 * below says which of them are enforced today and which is still a switch
 * that changes nothing.
 */
export const rolePermissions = z.object({
  role_id: z.uuid(),
  /**
   * **A slug is unique per robot across ALL service kinds** (spec §4.1:
   * "Jeder Dienst erhält einen Slug" — one namespace, not one per kind), and
   * the cloud's config validation enforces that with a kind-agnostic
   * collection pass. That is why this list carries slugs and not
   * (kind, slug) pairs: when W4 adds actions, services and publishers, a
   * grant keeps meaning exactly what it means today, and this shape does not
   * change. What W4 does need is an endpoint that lists every *grantable*
   * slug of a robot with its kind, so the console's matrix can offer them —
   * today it enumerates datapoints only, which is the seam that would
   * otherwise force a rebuild.
   */
  grants: z.array(
    z.object({
      robot_id: z.uuid(),
      slugs: z.array(slug),
    }),
  ),
  /**
   * App-wide abilities a role grants, as opposed to per-slug grants above.
   *
   * **A capability here is a promise, and one of them is still not kept.**
   * `action_history` and `presence` were both gated by this object from W4
   * and implemented nowhere — no route, no SDK method, no realtime frame
   * (register row 8). A console could therefore switch them on and nothing
   * changed, which is worse than their absence: the developer believes they
   * granted something. **This paragraph stays** whatever the current tally
   * is: it is the only place that says a switch in the console may change
   * nothing, and it is how the next unkept capability gets caught.
   *
   * `assets` (W7) was the first one redeemed. It gates §4.6's asset store,
   * which is not covered by `grants` because **assets are not slugs** — and it
   * is its own decision rather than a side effect of reaching the robot,
   * because a mesh set gives away the machine's build.
   *
   * **`action_history` is kept as of the run-history delta.** It gates
   * `GET /api/robots/:id/jobs/history` — an end user whose role lacks it is
   * refused `403 capability_required`, naming the capability so the developer
   * knows which switch is off. It was unkeepable while nothing durable
   * recorded what had run; `jobRun` and `job_runs` are that record.
   *
   * **What granting it discloses.** A `jobRun` names the actor who invoked
   * it, and `jobActor.label` is an email — so an end user holding this
   * capability learns which *other* people have been driving that robot.
   * That is inherent in "may read the history" rather than an oversight, and
   * it is written down here because the switch lives in the console while its
   * consequence does not.
   *
   * **`presence` is still not implemented.** Nothing in the cloud, the SDK or
   * the realtime protocol consults it. It remains exactly what the first
   * paragraph describes.
   */
  capabilities: z.object({
    action_history: z.boolean(),
    presence: z.boolean(),
    assets: z.boolean(),
  }),
})
export type RolePermissions = z.infer<typeof rolePermissions>

/* `appMembership` (end_user_id, app_id, role_id) was deleted on 2026-08-29:
 * it is `appAssignment` in `identity.ts` now, keyed by `user_id` because there
 * is one pool. Not renamed in place — the field name was the whole of what
 * changed, and a shape that kept `end_user_id` would have let the deleted
 * model survive in every consumer that only reads keys. */

/**
 * Per-app branding for the hosted login page (André, 2026-08-18).
 *
 * **Neutral Fleetless is the default and the absence of this object means
 * exactly that** — there is no "unbranded" state to distinguish from "not
 * configured", so nothing here is nullable-with-a-meaning.
 *
 * **Why the logo is a bounded data URI and not a URL or an asset.** Three
 * options existed and two are worse. The asset store is robot-scoped; giving
 * it an app scope is a subsystem nobody asked for in this wave. An external
 * URL means the page that collects credentials makes an outbound request to a
 * host the developer controls — a CSP hole and a beacon on every login
 * attempt, on the most security-sensitive page the platform serves. So the
 * bytes travel in the config, bounded.
 *
 * **SVG is refused, and that is not an oversight.** An SVG is a script host:
 * it can carry `<script>`, `onload` handlers and foreign objects. Rendering
 * one inside the login page would put developer-supplied script next to a
 * password field. Raster only until somebody sanitises, and sanitising an SVG
 * properly is its own project.
 */
/**
 * Per-app branding for the hosted login page (§3.4). Neutral Fleetless when
 * absent, which is the default for every app that never configures one.
 *
 * **Deliberately not a field on `app`.** A logo is up to 256 KiB, and putting
 * it on the app shape means every list of apps carries every logo — a cost
 * nobody asked for, paid on the request that least needs it. It is a
 * sub-resource of an app, fetched when the login page is served and when the
 * branding editor opens, and nowhere else. `idpConfig` is separate for the
 * stronger version of the same reason: it carries secret state.
 */
export const brandingConfig = z.object({
  /** `#rrggbb`, lowercase — one canonical spelling so two configs that look identical are identical. */
  primary_color: z.string().regex(/^#[0-9a-f]{6}$/, 'primary_color must be lowercase #rrggbb'),
  /**
   * 256 KiB of raw image at most. Base64 costs 4 bytes per 3, so the encoded
   * ceiling is stated here in encoded characters — the unit the validator can
   * actually count, rather than one it would have to infer.
   */
  logo_data_uri: z
    .string()
    .max(349_528)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/, 'logo must be a base64 data URI of image/png or image/jpeg')
    .optional(),
  footer_text: z.string().min(1).max(200).optional(),
})
export type BrandingConfig = z.infer<typeof brandingConfig>
