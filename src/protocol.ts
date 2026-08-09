import { z } from 'zod'

/**
 * Bridge <-> cloud protocol, version 1.
 *
 * The version is exchanged in the hello handshake; the cloud refuses an
 * incompatible bridge with a clear message (spec §5).
 */
export const PROTOCOL_VERSION = 1

/**
 * A slug names an exposed service or datapoint: lowercase, dash-separated,
 * letter-initial, 2..63 characters. Slugs are stable and decoupled from ROS
 * names (spec §4.1) — every wave inherits this rule.
 */
export const slug = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/)

/** First frame a bridge sends after the socket opens. */
export const bridgeHello = z.object({
  type: z.literal('hello'),
  protocol_version: z.number().int().positive(),
  token: z.string().min(1),
  bridge_version: z.string().min(1),
})
export type BridgeHello = z.infer<typeof bridgeHello>

/** Cloud accepts the bridge: the robot is online from here on. */
export const cloudHelloOk = z.object({
  type: z.literal('hello_ok'),
  robot_id: z.string().min(1),
})
export type CloudHelloOk = z.infer<typeof cloudHelloOk>

/** Cloud refuses the bridge (bad token, incompatible protocol, ...). */
export const cloudHelloError = z.object({
  type: z.literal('hello_error'),
  code: z.string().min(1),
  message: z.string().min(1),
})
export type CloudHelloError = z.infer<typeof cloudHelloError>

/**
 * One datapoint sample. `timestamp_ms` is the capture time at the bridge —
 * never the receive time — so clients compute age themselves (spec §6.3).
 */
export const datapointFrame = z.object({
  type: z.literal('datapoint'),
  slug,
  value: z.unknown(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type DatapointFrame = z.infer<typeof datapointFrame>

/**
 * The built-in `bridge-state` datapoint every robot has (spec §4.3):
 * connection status plus latency, the basis for offline-aware client UIs.
 */
export const bridgeState = z.object({
  online: z.boolean(),
  latency_ms: z.number().nonnegative().nullable(),
})
export type BridgeState = z.infer<typeof bridgeState>
