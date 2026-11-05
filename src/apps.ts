// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { slug } from './common.js'
import { mcpRobotDatasheet } from './mcp.js'
import { accessKind, roleKey } from './rights.js'

/**
 * Apps, roles and rights.
 *
 * The rule that shapes all of this: **roles are the only filter**. A robot
 * assigned to an app exposes every one of its services to that app; what a
 * role does not grant does not exist for that user. There is no second
 * visibility mechanism, and adding one later would create two places to look
 * when someone cannot see something.
 */

/**
 * The app identifier a client sends at login. Same rule as a service slug:
 * stable, lowercase, underscore-separated.
 *
 * **Globally unique, not per org.** `clientLoginRequest` carries only the
 * identifier, the email and the password — there is no org context to
 * disambiguate with, so a per-org identifier could not be resolved at login.
 * A collision is refused with `identifier_taken`.
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
    description: 'The stable handle a client sends at login, lowercase and underscore-separated. **Globally unique, not per organisation** — `clientLoginRequest` carries no org context, so a collision is refused with `identifier_taken`.',
  }),
  /** Robots are referenced individually; tags never grant rights. */
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
   * Worth saying: it changes what a wrong value costs.
   * A prefill somebody can see and correct became a default applied on the
   * server, and the obvious next question — should it be required instead? —
   * has a deliberate answer: no, because an invitation resolves the role at
   * *creation* time and stores it, so an outstanding invitation is never
   * re-aimed by a later change here.
   *
   * `null` — and nullable rather than absent — means *this app has not chosen
   * one*. That is a normal state, not an unset field: every app is created
   * before anyone picks a default. A create or invite that omits `role_id`
   * against an app in that state is a `validation_error`, not a user with no
   * role.
   *
   * The role must belong to **this** app; the schema sees a uuid and cannot
   * check that, so `PATCH /api/apps/:id` does. No route creates, renames or
   * deletes an app's roles any more, so the id is one the app already has.
   */
  default_role_id: z.uuid().nullable().meta({
    description: 'The role an app user gets when created or invited without an explicit one. `null` means this app has not chosen a default, the normal state of an app until someone picks one — and then a create or invite that omits `role_id` gets `validation_error`, not a user with no role. An invitation resolves the role when issued, so changing this never re-aims an outstanding one. The role must belong to this app, which `PATCH /api/apps/:id` checks and the schema cannot. No route creates, renames or deletes an app\'s roles, so the id is one the app already has.',
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
 * What deleting an app would destroy — read before the irreversible click,
 * and carried again by the `app.deleted` audit event.
 *
 * **Six numbers, never a sum**, for the reason `robotDeletionSummary` states
 * at length: the console reads this aloud as one sentence, and a total would
 * describe six unrelated magnitudes with one figure on the one screen whose
 * entire justification is naming what cannot be undone.
 *
 * Robots are not here because they do not go: they belong to the
 * organization, not to the app. The audit trail is not here either — a record
 * of what happened outlives the thing it happened to.
 */
export const appDeletionSummary = z.object({
  user_count: z.number().int().nonnegative().meta({
    description: 'App users deleted with the app. They are the developer\'s own customers, not Fleetless users, and exist in no other app.',
  }),
  role_count: z.number().int().nonnegative().meta({
    description: 'Roles deleted with the app, each with its per-robot slug grants.',
  }),
  server_key_count: z.number().int().nonnegative().meta({
    description: 'Server keys deleted with the app. A client still holding one is refused at its next request.',
  }),
  invitation_count: z.number().int().nonnegative().meta({
    description: 'Outstanding invitations — unspent and unexpired — that will never be accepted.',
  }),
  oidc_provider_count: z.number().int().nonnegative().meta({
    description: 'Identity providers configured for this app. The providers themselves are somebody else\'s; only this app\'s configuration of them goes.',
  }),
  mail_template_count: z.number().int().nonnegative().meta({
    description: 'Custom mail templates, of at most three. A kind using the Fleetless default text is not counted — there is no row to lose.',
  }),
})
export type AppDeletionSummary = z.infer<typeof appDeletionSummary>

/**
 * **`robot_ids` is accepted here, and `.strict()` catches everything else.**
 * A create shape carrying `name` and `identifier` only would let zod strip an
 * offered `robot_ids`, so a caller creating an app *with* robots gets a `201`
 * and an app with none — a shape that reads as though it does something it does
 * not.
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
 * Without it, an offered field the route does not implement is *dropped* — the
 * caller gets a `200`, nothing changes, and nothing anywhere says so. It is the
 * same silence `createAppRequest` above describes. A caller who sends a field
 * this route does not do is asking for something, and the honest answer is
 * `400`, not a success that means less than it looks.
 *
 * Two fields are absent and worth naming, because neither has a successor here.
 * `accepts_dynamic_clients` gated app-level OAuth dynamic client registration,
 * which no longer exists: apps use the JSON client-auth API, and OAuth 2.1
 * remains only for MCP. `group_id` named a group that owned the app; who may
 * log into an app is the app's own user list.
 *
 * The route keeps its own check as belt-and-braces; a schema and a handler
 * agreeing is not two policies, it is one policy stated where each half can
 * enforce it.
 */
export const updateAppRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  robot_ids: z.array(z.uuid()).optional(),
  /**
   * `app.default_role_id`'s write half — an app *setting*, which is where the
 * two-identity-space model
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
 * A server key carries full app rights for server-side code — never for
 * clients. Same handling as the robot token: the value is returned exactly once
 * and only its hash is stored.
 */
export const serverKeyToken = z.string().regex(/^flk_[0-9a-f]{32}$/)

export const serverKey = z.object({
  id: z.uuid().meta({
    description: 'The key row, and what the rotate and delete routes address. It is not the key: this shape never carries the secret.',
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
    description: 'The app\'s server keys as metadata, oldest first by `created_at`. The raw secret is not here and never will be: it exists once, in the response that created or rotated the key.',
  }),
})
export type ServerKeyListResponse = z.infer<typeof serverKeyListResponse>

export const createServerKeyResponse = z.object({
  server_key: serverKey,
  key: serverKeyToken,
})
export type CreateServerKeyResponse = z.infer<typeof createServerKeyResponse>

/**
 * **What an app locks, and what it falls back on.** Roles decide who may use
 * what; an app can only take rights away from them, never add any. A lock wins
 * over every role and over the organization's defaults, and applies to the
 * app's users and to its server keys alike.
 *
 * Two ways to lock: a whole kind of access on every robot the app reaches
 * (`locked_kinds`), or single capabilities of single robots (`locked`). The
 * robot-wide `assets` and `job_history` can only be locked as a kind.
 */
export const appLock = z.object({
  robot_id: z.uuid().meta({
    description: 'The robot whose capabilities are locked for this app.',
  }),
  slugs: z.array(slug).min(1).meta({
    description: 'The slugs of that robot\'s exposures to lock, at least one. A slug the robot has no exposure for is accepted and warns, and locks nothing.',
  }),
}).strict()
export type AppLock = z.infer<typeof appLock>

/** The three fields `appAccess` and `appAccessResponse` share. */
const appAccessFields = {
  default_role: roleKey.nullable().meta({
    description:
      'The role, by key, that an app user gets when created, invited or self-registered without an explicit one. `null` means the app has none, ' +
      'and a create or invite that names no role is refused. A key that names no role is accepted and warns; it grants nothing.',
  }),
  locked_kinds: z.array(accessKind).meta({
    description:
      'Kinds of access locked for every user and server key of the app, on every robot it reaches: `read`, `invoke`, `publish`, `assets` or ' +
      '`job_history`. The only way to lock `assets` or `job_history`, which belong to the robot as a whole.',
  }),
  locked: z.array(appLock).meta({
    description: 'Single exposures locked on single robots. A lock never grants anything: it only takes away what a role would give.',
  }),
}

/**
 * `PUT /api/apps/:id/access`: the whole access of one app, **replaced**. Every
 * field is named on every write, so the body is exactly what the app has
 * afterwards; strict, so a field this route does not take is refused rather
 * than dropped.
 */
export const appAccess = z.object(appAccessFields).strict()
export type AppAccess = z.infer<typeof appAccess>

/**
 * Something in an app's access that grants or locks nothing as written. Never
 * a refusal: the access is stored as sent, and these say what is out of step.
 */
export const accessWarning = z.object({
  code: z.enum(['unknown_default_role', 'unknown_lock_slug', 'lock_robot_not_attached']).meta({
    description:
      '`unknown_default_role`: the default role names no role of the organization. `unknown_lock_slug`: a lock names a slug the robot has no ' +
      'published exposure for. `lock_robot_not_attached`: a lock names a robot that is not attached to the app.',
  }),
  message: z.string().min(1).meta({
    description: 'A sentence a person can read, naming the key, robot or slug.',
  }),
  robot_id: z.uuid().nullable().meta({
    description: 'The robot a lock warning is about; `null` for `unknown_default_role`.',
  }),
  slug: z.string().nullable().meta({
    description: 'The slug an `unknown_lock_slug` warning is about; `null` for the other warnings.',
  }),
})
export type AccessWarning = z.infer<typeof accessWarning>

/** What `GET` and `PUT /api/apps/:id/access` answer: the access as it stands, and what is out of step in it. */
export const appAccessResponse = z.object({
  ...appAccessFields,
  warnings: z.array(accessWarning).meta({
    description: 'What the access names that does not exist as written. Empty when nothing is out of step.',
  }),
})
export type AppAccessResponse = z.infer<typeof appAccessResponse>

/**
 * `GET /api/apps/:id/effective-rights`: look at the app as one role sees it,
 * or as one app user does. Exactly one of the two.
 *
 * The cross-field rule is a `.refine()`, which JSON Schema cannot express, so
 * `effective-rights-query.schema.json` describes two independent optional
 * parameters; the cloud is the only place both-or-neither is refused.
 */
export const effectiveRightsQuery = z.object({
  role: roleKey.optional().meta({
    description: 'A role key to look at the app as. A key that names no role is not an error: the answer says `role_known: false` and grants nothing.',
  }),
  user: z.uuid().optional().meta({
    description: 'An app user of this app, to look at the app as that user\'s role. A user of another app answers `404`.',
  }),
}).strict().refine((query) => (query.role === undefined) !== (query.user === undefined), {
  message: 'Name exactly one of role and user.',
})
export type EffectiveRightsQuery = z.infer<typeof effectiveRightsQuery>

/** One capability of one robot as a role sees it: granted or not, and why. */
export const effectiveCapability = z.object({
  name: slug.meta({
    description: 'The exposure\'s slug, or `assets` or `job_history` for the capabilities that belong to the robot as a whole.',
  }),
  kind: accessKind.meta({
    description: 'The kind of access the capability needs.',
  }),
  granted: z.boolean().meta({
    description: 'Whether the role may use it: its requirement is met and the app has not locked it.',
  }),
  requirement: z.array(z.string()).meta({
    description: 'The role keys that qualify, from the entry, the rule or the default that decided. Holding one of them, or inheriting from one, is enough. Empty when nobody qualifies.',
  }),
  source: z.enum(['entry', 'rule', 'robot', 'org_default']).meta({
    description:
      'Where the requirement came from: `entry` is the entry\'s own `role`, `rule` the first matching rule of `access.rules`, `robot` the robot\'s ' +
      '`access.assets` or `access.job_history`, and `org_default` the organization\'s default for the kind.',
  }),
  rule_index: z.number().int().nonnegative().nullable().meta({
    description: 'For `rule`, the position of the deciding rule in `access.rules`, counted from zero; `null` otherwise.',
  }),
  rule_match: z.string().nullable().meta({
    description: 'For `rule`, that rule\'s `match` glob; `null` otherwise.',
  }),
  satisfied_by: z.string().nullable().meta({
    description:
      'The key from `requirement` that the role holds through inheritance. `null` when the role is named in the requirement itself, and when it ' +
      'does not meet the requirement at all. Independent of locks.',
  }),
  locked: z.boolean().meta({
    description: 'Whether the app locks this capability, as a kind or as a single lock. A lock wins over the requirement.',
  }),
  unknown_roles: z.array(z.string()).meta({
    description: 'Keys in the requirement that name no role of the organization. They grant nothing.',
  }),
})
export type EffectiveCapability = z.infer<typeof effectiveCapability>

/** One attached robot as a role sees it. */
export const effectiveRobotRights = z.object({
  robot_id: z.uuid().meta({ description: 'The robot, one that is attached to the app.' }),
  robot_name: z.string().min(1).max(200).meta({ description: 'The robot\'s name.' }),
  published_version: z.number().int().positive().nullable().meta({
    description: 'The version of the robot\'s published `fleetless.yaml` that the answer was computed from; `null` when nothing is published.',
  }),
  capabilities: z.array(effectiveCapability).meta({
    description: 'Every capability of the published configuration, and `assets` and `job_history`, each granted or not.',
  }),
  datasheet: mcpRobotDatasheet.meta({
    description: 'The datasheet an MCP session of this role would get for the robot.',
  }),
})
export type EffectiveRobotRights = z.infer<typeof effectiveRobotRights>

/** What `GET /api/apps/:id/effective-rights` answers. */
export const effectiveRightsResponse = z.object({
  role: z.string().nullable().meta({
    description: 'The role key the answer is for: the one asked about, or the app user\'s own. `null` when the app user holds none.',
  }),
  role_known: z.boolean().meta({
    description: 'Whether the key names a role of the organization. `false` means every capability below is not granted.',
  }),
  user_id: z.uuid().nullable().meta({
    description: 'The app user asked about; `null` when a role was asked about.',
  }),
  robots: z.array(effectiveRobotRights).meta({
    description: 'The robots attached to the app, each with what the role may use.',
  }),
})
export type EffectiveRightsResponse = z.infer<typeof effectiveRightsResponse>
