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
 * stable, lowercase, dash-separated.
 *
 * **Globally unique, not per org.** `clientLoginRequest` carries only the
 * identifier, the email and the password — there is no org context to
 * disambiguate with, so a per-org identifier could not be resolved at login
 * at all. A collision is refused with `identifier_taken`.
 */
export const appIdentifier = slug

export const app = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  name: z.string().min(1).max(120),
  identifier: appIdentifier,
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
  group_id: z.uuid(),
  /** Robots are referenced individually; tags never grant rights (§12.2). */
  robot_ids: z.array(z.uuid()),
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
   * in the audit log. It is also the precursor of W7c's MCP-App kind — the
   * model grows here rather than being retrofitted around it.
   */
  accepts_dynamic_clients: z.boolean(),
  /**
   * Whether this app serves a remote MCP server at `/mcp/<identifier>` (§17).
   *
   * **A switch, not an app kind.** §2 and §17 called the MCP app *"eine eigene
   * App-Art"*; André decided on 2026-08-18 that it is a per-app switch the
   * developer flips in the console, and §17 was reworded in the same wave
   * rather than left contradicting this field. The model grows here — which
   * is what the comment on `accepts_dynamic_clients` above predicted it would
   * do, one wave before there was anything to add.
   *
   * The two switches are related and not the same. `accepts_dynamic_clients`
   * decides whether a client may **register itself**; this one decides whether
   * there is anything for it to reach. An MCP app will usually want both,
   * because §17's end user *"trägt nur die URL ein"* and the AI tool registers
   * itself — but a developer who registers their own MCP client by hand wants
   * exactly this one, and coupling them would take that away.
   *
   * **Off means off at the metadata too.** With this false, `/mcp/<app>`
   * answers `404` and so do its discovery documents. A resource that is
   * advertised and not served sends a conforming client through the whole
   * discovery chain to a door that is not there — and W7b spent a wave making
   * that chain walkable.
   */
  mcp_enabled: z.boolean(),
  created_at: z.iso.datetime(),
})
export type App = z.infer<typeof app>

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
   * **W7c's playbook said this field would not be accepted here, and the
   * sentence above is why that was wrong.** The argument for refusing it was
   * W7's `robot_ids` finding — a create shape that silently drops a field cost
   * two people a day each. But that finding was closed by *accepting* the
   * field, not by refusing it, and this request is `.strict()`: refusing
   * `mcp_enabled` would make it `400` on a field the caller can plainly see on
   * `app`, which is the exact shape the line above rejects. One rule, both
   * switches.
   */
  mcp_enabled: z.boolean().optional(),
  /**
   * Required, unlike the two switches above: an app belongs to exactly one
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
  mcp_enabled: z.boolean().optional(),
}).strict()
export type UpdateAppRequest = z.infer<typeof updateAppRequest>

/**
 * A server key carries full app rights for server-side code (spec §3.4) —
 * never for clients. Same handling as the robot token from W1: the value is
 * returned exactly once and only its hash is stored.
 */
export const serverKeyToken = z.string().regex(/^flk_[0-9a-f]{32}$/)

export const serverKey = z.object({
  id: z.uuid(),
  app_id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
  /** Null until first use — the cheapest way to spot a key nobody needs. */
  last_used_at: z.iso.datetime().nullable(),
})
export type ServerKey = z.infer<typeof serverKey>

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
  id: z.uuid(),
  app_id: z.uuid(),
  name: z.string().min(1).max(60),
  builtin: z.boolean(),
})
export type Role = z.infer<typeof role>

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
