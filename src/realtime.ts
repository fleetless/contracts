import { z } from 'zod'
import { slug } from './protocol.js'

/**
 * Client realtime protocol (spec §11.1): WebSocket subscriptions on
 * datapoints. W1 scope: subscribe/unsubscribe plus the datapoint event
 * stream; command parity arrives in W4.
 */

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
 */
export const subscribeError = z.object({
  type: z.literal('subscribe_error'),
  robot_id: z.uuid(),
  slug,
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
