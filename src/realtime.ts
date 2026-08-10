import { z } from 'zod'
import { slug } from './common.js'
import { clientIdentity } from './client-auth.js'

/**
 * Client realtime protocol (spec §11.1): WebSocket subscriptions on
 * datapoints. W1 scope: subscribe/unsubscribe plus the datapoint event
 * stream; command parity arrives in W4.
 */

/**
 * The first frame a client sends after the socket opens (W3, spec §3.4).
 *
 * A browser cannot set an `Authorization` header on a WebSocket handshake,
 * and a token in the query string would outlive the request in server,
 * proxy and browser-history logs. So `/realtime` authenticates the way
 * `/bridge` already does: with a frame. `token` is the same bearer value
 * REST takes — a user's JWT or a server key (`flk_…`), told apart by prefix.
 *
 * Any `subscribe` before `auth_ok` is refused, and a socket that sends no
 * auth frame in time is closed with **4002**, the code the bridge socket
 * already uses for a missing hello.
 */
export const clientAuth = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
})
export type ClientAuth = z.infer<typeof clientAuth>

/**
 * Who the socket turned out to belong to. Carrying the identity here means a
 * client never has to decode a JWT to render its own session — decoding a
 * token client-side is how apps end up trusting claims nobody verified.
 */
export const authOk = z.object({
  type: z.literal('auth_ok'),
  identity: clientIdentity,
})
export type AuthOk = z.infer<typeof authOk>

/** Refusal, followed by close 1008 — same shape as the bridge's hello_error. */
export const authError = z.object({
  type: z.literal('auth_error'),
  code: z.string().min(1),
  message: z.string().min(1),
})
export type AuthError = z.infer<typeof authError>

export const clientSubscribe = z.object({
  type: z.literal('subscribe'),
  robot_id: z.uuid(),
  slug,
})
export type ClientSubscribe = z.infer<typeof clientSubscribe>

export const clientUnsubscribe = z.object({
  type: z.literal('unsubscribe'),
  robot_id: z.uuid(),
  slug,
})
export type ClientUnsubscribe = z.infer<typeof clientUnsubscribe>

/**
 * Refusal of a subscribe, addressed by the (robot_id, slug) it refers to.
 * Codes follow the §11.5 error culture: stable code + human message.
 * robot_id/slug are plain strings ECHOING what the client sent — the frame
 * must be constructible precisely when those values are malformed, so that
 * a bad robot_id or slug gets a diagnosis instead of a dead socket.
 */
export const subscribeError = z.object({
  type: z.literal('subscribe_error'),
  robot_id: z.string(),
  slug: z.string(),
  code: z.string().min(1),
  message: z.string().min(1),
})
export type SubscribeError = z.infer<typeof subscribeError>

/**
 * One datapoint sample pushed to a subscriber. The current value arrives
 * immediately on subscribe, then every change. `timestamp_ms` semantics as
 * in `datapointValue` (capture time; cloud-observed for `bridge-state`).
 */
export const datapointEvent = z.object({
  type: z.literal('datapoint'),
  robot_id: z.uuid(),
  slug,
  value: z.unknown(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type DatapointEvent = z.infer<typeof datapointEvent>
