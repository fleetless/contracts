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
 * Who the caller turned out to be. Returned by the "who am I" endpoint so a
 * client can render a session without decoding a token itself — decoding a
 * JWT in the client is how apps end up trusting claims nobody verified.
 */
export const clientIdentity = z.object({
  end_user_id: z.uuid().nullable(),
  server_key_id: z.uuid().nullable(),
  app_id: z.uuid(),
  role_id: z.uuid().nullable(),
  email: z.email().nullable(),
})
export type ClientIdentity = z.infer<typeof clientIdentity>
