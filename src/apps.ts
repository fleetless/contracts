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
}).strict()
export type CreateAppRequest = z.infer<typeof createAppRequest>

export const updateAppRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  robot_ids: z.array(z.uuid()).optional(),
  accepts_dynamic_clients: z.boolean().optional(),
})
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
 * the two capabilities roles also govern (§3.3). Both capabilities are
 * defined here and enforced in W4, when the action history and presence they
 * gate come into existence.
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
   * **A capability here is a promise, and two of them have not been kept.**
   * `action_history` and `presence` have been gated by this object since W4
   * and are implemented nowhere — no route, no SDK method, no realtime frame
   * (register row 8). A console can therefore switch them on and nothing
   * changes, which is worse than their absence: the developer believes they
   * granted something.
   *
   * `assets` (W7) must not become the third. It gates §4.6's asset store,
   * which is not covered by `grants` because **assets are not slugs** — and it
   * is its own decision rather than a side effect of reaching the robot,
   * because a mesh set gives away the machine's build.
   */
  capabilities: z.object({
    action_history: z.boolean(),
    presence: z.boolean(),
    assets: z.boolean(),
  }),
})
export type RolePermissions = z.infer<typeof rolePermissions>

/** An end user has exactly one role per app (spec §3.2). */
export const appMembership = z.object({
  end_user_id: z.uuid(),
  app_id: z.uuid(),
  role_id: z.uuid(),
})
export type AppMembership = z.infer<typeof appMembership>

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
