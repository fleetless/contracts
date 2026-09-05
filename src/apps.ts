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
    description: 'The display name, shown in the console and available to the developer\'s own pages through the `app.name` mail-template variable. Free text, changed through `PATCH /api/apps/:id`.',
  }),
  identifier: appIdentifier.meta({
    description: 'The stable handle a client sends at login, lowercase and underscore-separated. **Globally unique, not per organisation** — `clientLoginRequest` carries no org context to disambiguate with, so a collision is refused with `identifier_taken`.',
  }),
  /** Robots are referenced individually; tags never grant rights (§12.2). */
  robot_ids: z.array(z.uuid()).meta({
    description: 'The robots this app may reach, each referenced individually. Tags never grant rights, and a robot absent from this list is invisible to the app whatever a role grants.',
  }),
  /**
   * **The app's default role — and the two-space cut gave it a server-side
   * reader it did not have.**
   *
   * Through the assignment model this was a console prefill and nothing more:
   * `putAssignmentRequest` always carried the role explicitly, so no part of
   * the cloud authorized anybody with it. Assignments are gone. An app user is
   * created or invited **with** a role, and when the request omits one this is
   * the role they get — so the field now decides access on two write paths
   * (`createAppUserRequest`, `createAppInvitationRequest`) rather than
   * pre-filling a form.
   *
   * That is worth saying out loud because it changes what a wrong value costs.
   * A prefill somebody can see and correct became a default applied on the
   * server, and the obvious next question — should it be required instead? —
   * has a deliberate answer: no, because an invitation resolves the role at
   * *creation* time and stores it, so an outstanding invitation is never
   * re-aimed by a later change here.
   *
   * `null` — and nullable rather than absent — means *this app has not chosen
   * one*. That is a normal state, not an unset field: every app is created
   * before its roles are configured. A create or invite that omits `role_id`
   * against an app in that state is a `validation_error`, not a user with no
   * role.
   *
   * The role must belong to **this** app; the schema sees a uuid and cannot
   * check that, so `PATCH /api/apps/:id` does.
   */
  default_role_id: z.uuid().nullable().meta({
    description: 'The role an app user gets when they are created or invited without an explicit one. `null` means this app has not chosen a default, the normal state of an app created before its roles were configured — and then a create or invite that omits `role_id` is a `validation_error` rather than a user with no role. An invitation resolves the role when it is issued, so changing this never re-aims an outstanding one. The role must belong to this app, which `PATCH /api/apps/:id` checks and the schema cannot.',
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
}).strict()
export type CreateAppRequest = z.infer<typeof createAppRequest>

/**
 * **`.strict()` is what makes an absent field mean something here.**
 *
 * This shape was not strict until 2026-08-29, which meant an offered field the
 * route does not implement was *dropped* — the caller got a `200`, nothing
 * changed, and nothing anywhere said so. That is the exact silence
 * `createAppRequest` above already learned about in W7a (*"a create shape that
 * silently drops a field cost two people a day each"*), and the lesson had not
 * been carried one shape over. A caller who sends a field this route does not
 * do is asking for something, and the honest answer is `400`, not a success
 * that means less than it looks.
 *
 * Two fields left with the two-space cut and are worth naming, because both
 * were on this shape and neither has a successor here.
 * `accepts_dynamic_clients` gated app-level OAuth dynamic client registration,
 * which is deleted: apps use the JSON client-auth API and OAuth 2.1 remains
 * only for MCP. `group_id` named the group that owned the app, and groups are
 * gone; who may log into an app is now the app's own user list.
 *
 * The route keeps its own check as belt-and-braces; a schema and a handler
 * agreeing is not two policies, it is one policy stated where each half can
 * enforce it.
 */
export const updateAppRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  robot_ids: z.array(z.uuid()).optional(),
  /**
   * `app.default_role_id`'s write half — an app *setting*, which is where D1
   * put the default role, so it belongs on the app's own PATCH and not on a
   * route of its own.
   *
   * **`.nullable().optional()`, and the two mean different things.** Absent
   * leaves the current default alone; an explicit `null` clears it. A field
   * that could only be set and never unset would make "we changed our mind"
   * unreachable through the API — the same silence `.strict()` above exists to
   * avoid, from the other direction.
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
    description: 'The role, and what an app user\'s `role_id` and an app\'s `default_role_id` refer to.',
  }),
  app_id: z.uuid().meta({
    description: 'The app this role belongs to. Roles are never shared between apps, so a role id from another app reads as `not_found`.',
  }),
  name: z.string().min(1).max(60).meta({
    description: 'The role\'s name, shown wherever a user\'s access is chosen. The two roles every app starts with are named `observe` and `operate`.',
  }),
  builtin: z.boolean().meta({
    description: '`true` for the two roles every app starts with. Their **rights may be re-scoped** exactly like a custom role\'s, through `PUT /api/apps/:id/roles/:roleId/permissions` — the flag exists so the console can explain where they came from, not to protect them. It does not make them renamable or deletable, because no route renames or deletes any role.',
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

