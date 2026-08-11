import { z } from 'zod'
import { slug } from './common.js'
import { robotConfigDoc } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { jobState } from './jobs.js'
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
  /**
   * Every job this bridge still knows about, right now (spec §6.1, W4).
   *
   * A reconnect and a restart look **identical** on the wire otherwise: same
   * token, same version, same frame. But they must end differently — after a
   * dropped connection the running jobs are still running, after a restart
   * their results are gone forever. Asking the bridge to enumerate what it
   * still has settles it without either side guessing: the cloud marks every
   * job it believes is running on this robot and that is *not* named here as
   * `lost`.
   *
   * This deliberately needs no persistence at the bridge. A live process
   * lists its live jobs; a process that just started lists none, because it
   * has none — which is exactly the truth the cloud needs. A breadcrumb file
   * would only add a window in which the crash beat the write.
   *
   * Defaulted so pre-W4 bridges still parse; they had no jobs, so the empty
   * list is also the correct answer for them.
   */
  active_job_ids: z.array(z.uuid()).max(500).default([]),
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

/**
 * Commands, cloud → bridge (spec §6.1, §11.3). The **cloud** mints the
 * `job_id` before the bridge is asked to do anything, so a job exists —
 * and can be reported `lost` — even if the answer never comes back.
 */
export const cloudInvoke = z.object({
  type: z.literal('invoke'),
  job_id: z.uuid(),
  slug,
  /**
   * Already validated against §4.4 rules; the bridge validates structurally.
   *
   * **Flat, keyed by `parameterSpec.name`** — `{"target_pose.position.x": 1}`,
   * not a nested message tree. Three things follow from that and none of them
   * survive the nested form: the key a caller sends is the key a rule names,
   * so a `parameter_invalid` can report a `field` the caller can actually
   * find; the console binds one form input per spec; and a goal field that no
   * `parameterSpec` declares simply cannot be set, which is what §4.4 means by
   * the developer deciding what a client may pass. The bridge unflattens once,
   * on the way into the ROS goal or request.
   */
  params: z.record(z.string(), z.unknown()),
})
export type CloudInvoke = z.infer<typeof cloudInvoke>

/** Cancel by slug — the bridge must issue a real ROS goal cancel (§11.3). */
export const cloudCancel = z.object({
  type: z.literal('cancel'),
  slug,
})
export type CloudCancel = z.infer<typeof cloudCancel>

export const cloudPublish = z.object({
  type: z.literal('publish'),
  slug,
  /**
   * Flat and keyed by `parameterSpec.name`, exactly like `cloudInvoke.params`
   * — a publisher carries parameter specs and the same §4.4 validation, so it
   * must carry the same shape. Note this is *not* the shape of
   * `publisherConfig.failsafe`, which is a complete nested ROS message: the
   * failsafe is authored once by the developer against the type, never sent
   * by a caller and never rule-checked per field.
   */
  message: z.record(z.string(), z.unknown()),
})
export type CloudPublish = z.infer<typeof cloudPublish>

/**
 * Progress on a job, bridge → cloud. `timestamp_ms` is capture time, so a
 * burst delivered late after a reconnect is visibly late (§6.3).
 */
export const bridgeJobUpdate = z.object({
  type: z.literal('job_update'),
  job_id: z.uuid(),
  slug,
  state: jobState,
  feedback: z.unknown().nullable(),
  progress: z.number().min(0).max(1).nullable(),
  result: z.unknown().nullable(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).nullable(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type BridgeJobUpdate = z.infer<typeof bridgeJobUpdate>

/**
 * Jobs the bridge can no longer account for **while connected** (§6.1) — a
 * tracker dropped, an action server that vanished mid-goal, anything where
 * the honest answer is "I lost this" rather than a state.
 *
 * The restart case is not this frame's job: a restarted bridge has nothing
 * left to enumerate, so it is `hello.active_job_ids` that closes that gap.
 * Both paths end in the same place — the cloud publishes `lost` rather than
 * leaving a job reading "running" because nobody contradicted it.
 */
export const bridgeJobLost = z.object({
  type: z.literal('job_lost'),
  job_ids: z.array(z.uuid()),
})
export type BridgeJobLost = z.infer<typeof bridgeJobLost>

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

/* ------------------------------------------------------------------ W5 --
 * Cameras (spec §10).
 */

/**
 * The header of a **binary** snapshot frame, bridge → cloud.
 *
 * A snapshot frame is laid out as:
 *
 *   [4-byte big-endian header length][UTF-8 JSON header][image bytes]
 *
 * Binary rather than base64 in a text frame, because base64 costs a third of
 * the robot's upstream for nothing. Self-contained rather than a JSON frame
 * followed by a binary one, because that pairing would depend on frame
 * ordering — and W4 established, at some cost, that ordering across a socket
 * is not something to lean on.
 *
 * `timestamp_ms` is the bridge's **capture** time (§6.3), which is what lets
 * every consumer state a snapshot's true age. A picture that lies about when
 * it was taken is this wave's version of a job that reads "running" when
 * nobody knows.
 */
/**
 * The largest a snapshot frame — header and image bytes together — may be on
 * the `/bridge` socket.
 *
 * This is a **byte** bound and not a pixel one, deliberately. A camera's
 * `width`/`height` govern the *live* stream, which travels through LiveKit
 * and never touches this socket, so capping resolution to protect the socket
 * would cost live quality to solve a snapshot problem.
 *
 * The bound exists because exceeding it is not a dropped frame: `ws` enforces
 * its payload limit before the frame is ever delivered and closes the
 * connection with 1009 — taking datapoints, jobs, commands and configuration
 * down with it. The bridge would then reconnect, receive the same
 * configuration, capture the same frame and be closed again: a robot that
 * will not stay online, from a configuration the platform accepted. Measured
 * during the W5 review, a 4K JPEG of real camera content lands around
 * 2.2 MiB and 1080p on a noisy scene within 40% of this number, so the margin
 * is thinner than it looks.
 *
 * **The bridge must degrade rather than exceed it** — lower JPEG quality,
 * then downscale, and if it still does not fit, skip the frame and say so.
 * A missing snapshot is a gap, and this wave already established that a gap
 * is an honest answer; a closed socket is not.
 */
export const SNAPSHOT_MAX_BYTES = 1_572_864 // 1.5 MiB, against a 2 MiB socket ceiling

export const snapshotHeader = z.object({
  type: z.literal('snapshot'),
  slug,
  /** `image/jpeg` in practice; stated so nothing has to sniff the bytes. */
  mime: z.string().min(1).max(64),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type SnapshotHeader = z.infer<typeof snapshotHeader>

/**
 * Cloud → bridge: start publishing this camera live.
 *
 * The **cloud** mints the room and the publisher token, for the same reason
 * it mints a `job_id` before asking anything (§6.1): the side that owns the
 * refcount must own the identity of the stream, or a robot could end up
 * publishing into a room nobody is watching.
 */
export const cloudCameraStart = z.object({
  type: z.literal('camera_start'),
  slug,
  url: z.string().min(1),
  room: z.string().min(1),
  token: z.string().min(1),
})
export type CloudCameraStart = z.infer<typeof cloudCameraStart>

/** Cloud → bridge: the last viewer left; stop publishing (§10 refcount). */
export const cloudCameraStop = z.object({
  type: z.literal('camera_stop'),
  slug,
})
export type CloudCameraStop = z.infer<typeof cloudCameraStop>

/**
 * What the bridge made of it. `publishing: false` with an `error` is how a
 * camera that cannot start says so — the cloud must not leave a viewer
 * watching a black rectangle while believing the stream is live.
 */
export const bridgeCameraState = z.object({
  type: z.literal('camera_state'),
  slug,
  publishing: z.boolean(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).nullable(),
})
export type BridgeCameraState = z.infer<typeof bridgeCameraState>
