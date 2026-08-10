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
  created_at: z.iso.datetime(),
})
export type App = z.infer<typeof app>

export const createAppRequest = z.object({
  name: z.string().min(1).max(120),
  identifier: appIdentifier,
})
export type CreateAppRequest = z.infer<typeof createAppRequest>

export const updateAppRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  robot_ids: z.array(z.uuid()).optional(),
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
  capabilities: z.object({
    action_history: z.boolean(),
    presence: z.boolean(),
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
