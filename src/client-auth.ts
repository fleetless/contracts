import { z } from 'zod'
import { appIdentifier } from './apps.js'

/**
 * What a client app sends to become someone (spec §3.4, §11.1).
 *
 * Two kinds of caller reach the client API, and both use the `Authorization:
 * Bearer` header:
 *
 * - an **end user**, with the JWT access token issued here;
 * - a **server key** (`flk_…`), for server-side code, carrying full app
 *   rights.
 *
 * The cloud tells them apart by shape — a `flk_` prefix is a server key,
 * anything else is parsed as a JWT. That rule is written down once, here, so
 * the SDK and the cloud cannot drift into disagreeing about it.
 *
 * The credentials path is the whole of W3. The OIDC redirect flow of §3.4
 * arrives in W7 with the hosted login page, and ends in exactly these same
 * tokens.
 */

export const clientLoginRequest = z.object({
  app_identifier: appIdentifier,
  email: z.email(),
  password: z.string().min(1),
})
export type ClientLoginRequest = z.infer<typeof clientLoginRequest>

export const clientRefreshRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientRefreshRequest = z.infer<typeof clientRefreshRequest>

/**
 * Logging out revokes the whole token family server-side. Without this, a
 * refresh token stolen before the user pressed "log out" keeps working —
 * clearing a client-side store is a UI gesture, not a revocation.
 */
export const clientLogoutRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientLogoutRequest = z.infer<typeof clientLogoutRequest>

/**
 * Who the caller turned out to be. Returned by the "who am I" endpoint and by
 * the realtime `auth_ok` frame, so a client can render a session without
 * decoding a token itself — decoding a JWT in the client is how apps end up
 * trusting claims nobody verified.
 *
 * **Three kinds of caller reach the client API, not two.** Besides end users
 * and server keys, a **developer** does: spec §15.2 says the console's
 * playground runs over the real client API and appears in the audit as the
 * developer, and the console's own live views (robot list badges, the Live
 * tab) subscribe on `/realtime` as one. A developer is **org-scoped, not
 * app-scoped** — they own the configuration of every robot in their org — so
 * `app_id` and `role_id` are null for them, and roles do not filter what they
 * see. `kind` states this explicitly rather than leaving it to be inferred
 * from which id happens to be set.
 */
export const clientIdentity = z.object({
  kind: z.enum(['developer', 'end_user', 'server_key']),
  developer_id: z.uuid().nullable(),
  end_user_id: z.uuid().nullable(),
  server_key_id: z.uuid().nullable(),
  app_id: z.uuid().nullable(),
  role_id: z.uuid().nullable(),
  email: z.email().nullable(),
})
export type ClientIdentity = z.infer<typeof clientIdentity>
