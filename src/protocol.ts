import { z } from 'zod'
import { slug } from './common.js'
import { robotConfigDoc } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { rosTypeName } from './common.js'

/**
 * Bridge <-> cloud protocol, version 1.
 *
 * The version is exchanged in the hello handshake; the cloud refuses an
 * incompatible bridge with a clear message (spec §5).
 */
export const PROTOCOL_VERSION = 1

/** Re-exported so consumers keep importing wire names from one place. */
export { slug } from './common.js'

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
  robot_id: z.uuid(),
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
 * Latency probe, cloud → bridge. The cloud sends its own clock in `ts_ms`;
 * the bridge echoes it back untouched and the cloud derives the round-trip
 * latency shown as `bridge-state.latency_ms`.
 */
export const cloudPing = z.object({
  type: z.literal('ping'),
  ts_ms: z.number().int().nonnegative(),
})
export type CloudPing = z.infer<typeof cloudPing>

/** Immediate bridge answer to a `CloudPing`, `ts_ms` echoed unchanged. */
export const bridgePong = z.object({
  type: z.literal('pong'),
  ts_ms: z.number().int().nonnegative(),
})
export type BridgePong = z.infer<typeof bridgePong>

/**
 * The published configuration, cloud → bridge (spec §4.1: the bridge applies
 * the published version). Sent right after `hello_ok` and again on every
 * publish, so a bridge never has to ask.
 *
 * `version: 0` with an empty document means *nothing published yet* — a fresh
 * robot, not an error.
 */
export const cloudConfig = z.object({
  type: z.literal('config'),
  version: z.number().int().nonnegative(),
  doc: robotConfigDoc,
})
export type CloudConfig = z.infer<typeof cloudConfig>

/**
 * What the bridge made of it. A single unusable entry must never stop the
 * others: the bridge applies what it can, reports the rest per slug, and
 * sets `ok: false`. The console shows this as "published v2 · applied v1".
 */
export const bridgeConfigApplied = z.object({
  type: z.literal('config_applied'),
  version: z.number().int().nonnegative(),
  ok: z.boolean(),
  errors: z.array(z.object({ slug: z.string(), message: z.string().min(1) })),
})
export type BridgeConfigApplied = z.infer<typeof bridgeConfigApplied>

/** Cloud asks for a fresh ROS graph; `request_id` correlates the answer. */
export const cloudIntrospectRequest = z.object({
  type: z.literal('introspect_request'),
  request_id: z.string().min(1).max(64),
})
export type CloudIntrospectRequest = z.infer<typeof cloudIntrospectRequest>

/** The graph snapshot, bridge → cloud. */
export const bridgeIntrospect = z.object({
  type: z.literal('introspect'),
  request_id: z.string().min(1).max(64),
  graph: rosGraph,
})
export type BridgeIntrospect = z.infer<typeof bridgeIntrospect>

/**
 * Field trees are fetched on demand, not shipped with the graph: a robot with
 * hundreds of topics would otherwise push hundreds of kilobytes on every
 * refresh, for types nobody opened.
 */
export const cloudTypeRequest = z.object({
  type: z.literal('type_request'),
  request_id: z.string().min(1).max(64),
  type_names: z.array(rosTypeName).min(1).max(50),
})
export type CloudTypeRequest = z.infer<typeof cloudTypeRequest>

/**
 * The resolved definitions. Names the bridge cannot resolve in its sourced
 * workspace are listed in `unresolved` — an unknown type is an answer, not a
 * failed frame.
 */
export const bridgeTypeDefinitions = z.object({
  type: z.literal('type_definitions'),
  request_id: z.string().min(1).max(64),
  definitions: z.array(typeDefinition),
  unresolved: z.array(z.string()),
})
export type BridgeTypeDefinitions = z.infer<typeof bridgeTypeDefinitions>

/**
 * The built-in `bridge-state` datapoint every robot has (spec §4.3):
 * connection status plus latency, the basis for offline-aware client UIs.
 */
export const bridgeState = z.object({
  online: z.boolean(),
  latency_ms: z.number().nonnegative().nullable(),
})
export type BridgeState = z.infer<typeof bridgeState>
