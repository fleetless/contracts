// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { assetFailure } from './assets.js'
import { applyError, slug } from './common.js'
import { robotConfigDoc } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { jobState } from './jobs.js'
import { rosTypeName } from './common.js'

/**
 * Bridge <-> cloud protocol, version 2.
 *
 * The version is exchanged in the hello handshake; the cloud refuses an
 * incompatible bridge with a clear message (spec §5) — `ws/bridge.ts`'s
 * `protocol_mismatch`, which names both versions and lands on the robot
 * detail page as `last_hello_error`.
 *
 * **2 (2026-08-21):** `config_applied.errors` entries gained `kind` and `code`
 * beside `message`. The check is `!==`, not a floor, so a bridge that is not
 * exactly this version is refused entirely. That is deliberate: a cloud and a
 * bridge that disagree about the wire should not pretend otherwise.
 */
export const PROTOCOL_VERSION = 2

/**
 * The bridge socket close code for "this robot no longer exists" (W6a).
 *
 * Deliberately distinct from the auth failures: a deleted robot must **stop**,
 * and a token that was valid a second ago is indistinguishable from one that
 * was revoked unless the cloud says which. Without its own code the bridge
 * reconnects forever against a robot that will never come back — a permanent
 * load on the cloud, and a robot on someone's shelf whose logs say nothing
 * more informative than "connection closed".
 */
export const CLOSE_ROBOT_DELETED = 4004

/**
 * How long a command waits for its answer when the caller names no patience
 * of its own (W6b).
 *
 * 15 s, which is what both halves already used independently: the cloud's
 * `commandTimeoutMs` and the bridge's `GOAL_ACCEPT_TIMEOUT_S`. That they
 * agreed was a coincidence of two separate decisions, and neither side could
 * be told otherwise for a single call. Naming the number once, here, is what
 * makes it one number rather than two that happen to match.
 *
 * A caller who knows their robot's work takes longer says so per call. A
 * caller who says nothing gets exactly today's behaviour — which is the point
 * of picking today's number as the default rather than a nicer one.
 */
export const DEFAULT_PATIENCE_MS = 15_000

/**
 * The longest patience a caller may ask for.
 *
 * A waiting REST request is a held-open connection, and there is **no rate
 * limiting** on this platform until W8 — so an unbounded `patience_ms` is an
 * unauthenticated way to pin the cloud's sockets open. Two minutes is long
 * enough for the robot work anybody has described (a planner, a docking
 * manoeuvre, an arm trajectory) and short enough that a thousand of them is
 * still a bounded amount of cloud.
 *
 * Raising it is a W8 conversation, after rate limiting exists — not a
 * one-line change here.
 */
export const MAX_PATIENCE_MS = 120_000

/**
 * The shortest patience a caller may ask for.
 *
 * A floor exists because **impatience reaches the robot**. Measured in W6b's
 * review: `patience_ms: 1` on an action makes the bridge report `goal_timeout`
 * and then issue a *corrective cancel* against a goal the action server
 * accepts a moment later — so a caller who asks for an unreachable deadline
 * does not merely get an error, they cause a cancellation on the machine.
 * Repeatable, and on a platform with no rate limiting until W8.
 *
 * One second, because it has to be longer than a goal-acceptance round trip on
 * a healthy robot and shorter than any wait a human would call patient. It is
 * a guard against a number that cannot be satisfied, not a policy about how
 * long work takes — `MAX_PATIENCE_MS` is the end that bounds the platform,
 * this end bounds what the caller can do to the robot.
 */
export const MIN_PATIENCE_MS = 1_000

/** Re-exported so consumers keep importing wire names from one place. */
export { slug } from './common.js'

/**
 * One job the bridge still has, as reported in the handshake (W6b).
 *
 * It carries the **slug and the state**, not only the id, because the cloud's
 * reconciliation needs both and had neither. Reading `active_job_ids` as bare
 * uuids, a restarted cloud could answer exactly one question — "is this job
 * still alive?" — for jobs it already knew about. It could not name what the
 * robot is doing, could not tell a job that is still `running` from one that
 * finished while the cloud was down, and had nothing at all to say about a
 * job it never recorded because it crashed between minting the id and writing
 * the row.
 *
 * `state` is the bridge's own current answer, not a history. A bridge that
 * has a terminal result still in hand reports it here and the cloud writes it
 * down, instead of publishing `lost` over a job that in fact succeeded.
 */
export const activeJob = z.object({
  job_id: z.uuid(),
  slug,
  state: jobState,
})
export type ActiveJob = z.infer<typeof activeJob>

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
   *
   * **Renamed from `active_job_ids` in W6b**, when the entries stopped being
   * ids. A field called `_ids` holding objects is the shape this project has
   * repeatedly been caught by — a name that describes what the field used to
   * carry, kept because renaming looked like churn. Nothing is deployed yet
   * (W8 is the first deployment), so the old name is gone rather than
   * accepted alongside the new one: two accepted spellings would have to be
   * supported and reconciled forever, and nobody is asking for that.
   */
  active_jobs: z.array(activeJob).max(500).default([]),
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
 * latency shown as `bridge_state.latency_ms`.
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
/**
 * Cloud → bridge: the configuration to apply.
 *
 * **`doc` is the whole of it.** Camera credentials travel inline in
 * `doc.cameras[].source`, per `config.ts`'s `cameraCredentials` — there is no
 * side channel any more. That was a deliberate, recorded trade-off: a
 * password here is in every published version, and those are immutable. The
 * bound on that decision is elsewhere and load-bearing — the publish audit
 * event and the org event stream must not carry the document body.
 *
 * **The bridge does not persist configuration.** It holds this frame in
 * memory and is sent it again on every reconnect, and that is the only thing
 * keeping camera passwords off the robot's disk. The retired side channel
 * carried this warning with an escape hatch attached — cache the config, just
 * exclude the `credentials` field. There is no such field now: the secrets are
 * inside `doc`, so caching the configuration caches the passwords, with
 * nothing left to leave out. The warning survives its own mechanism, narrower
 * and harder to satisfy than when it was written.
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
  errors: z.array(applyError),
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
   * **Flat, keyed by parameter name** — `{"target_x": 1}`. The key is a key of
   * the entry's `parameters` mapping, not a path into the message. Those were
   * the same thing until FL-002 and are now deliberately decoupled: a
   * parameter keeps its name when the field it fills moves in the message
   * tree, which is the same reason a slug is not a topic name.
   *
   * Three things follow, and the last one got stronger rather than weaker:
   * the key a caller sends is the key a rule names, so a `parameter_invalid`
   * reports something the caller can find; the console binds one input per
   * parameter; and a position the template does not mark with `${…}` cannot
   * be set by any caller at all. That last one used to be a rule about what
   * no `parameterSpec` declared. It is now structural — the value has nowhere
   * to go.
   *
   * The bridge substitutes these values into the entry's `message` template
   * at its placeholder positions. It no longer unflattens a dotted path;
   * there is no dotted path to unflatten.
   */
  params: z.record(z.string(), z.unknown()),
  /**
   * How long this one call is worth waiting for (W6b), already resolved by
   * the cloud — the caller's `invokeRequest.patience_ms`, or
   * `DEFAULT_PATIENCE_MS` when they named none.
   *
   * **Required here, optional at REST**, deliberately. At the REST edge an
   * absent value is a caller who did not care and gets the default. By the
   * time the frame is on this socket somebody has decided, and the bridge
   * must never be in the position of picking a number the cloud is already
   * counting against — which is what two independent 15 s constants meant in
   * practice: a bridge that gave up at 15.0 s and a cloud that gave up at
   * 15.0 s, agreeing only by accident, with no way to tell whose deadline a
   * caller had actually hit.
   */
  patience_ms: z.number().int().min(MIN_PATIENCE_MS).max(MAX_PATIENCE_MS),
})
export type CloudInvoke = z.infer<typeof cloudInvoke>

/**
 * Cancel — the bridge must issue a real ROS goal cancel (§11.3).
 *
 * `slug` stays, and stays required: it is how the bridge finds the tracker,
 * and it is what a cancel with no id means.
 *
 * `job_id` is what W6b adds, and what makes a cancel say *which* job. Without
 * it a cancel arriving a moment after one job ended and another began on the
 * same slug stops the **new** one — the caller asked to stop something that
 * had already finished and stopped a machine that had just started moving.
 * That is not a race anybody had to lose: the caller knew the id, and the
 * wire had nowhere to put it.
 *
 * `null` keeps today's meaning and must be read as exactly that: *cancel
 * whatever is running on this slug*. It is a real request — an operator
 * hitting stop wants the robot stopped, not a lecture about job identity —
 * and it stays available for that. A bridge given an id that does not match
 * what is running cancels **nothing** and says so; it must not fall back to
 * the slug, because a caller who named an id has ruled that out.
 */
export const cloudCancel = z.object({
  type: z.literal('cancel'),
  slug,
  job_id: z.uuid().nullable(),
})
export type CloudCancel = z.infer<typeof cloudCancel>

export const cloudPublish = z.object({
  type: z.literal('publish'),
  slug,
  /**
   * Flat and keyed by parameter name, exactly like `cloudInvoke.params` — a
   * publisher declares parameters and takes the same validation, so it takes
   * the same shape.
   *
   * This is *not* the shape of `publisherConfig.failsafe.message`, which is a
   * complete ROS message template. The failsafe is authored once against the
   * type, sent by the bridge with no caller present, and refused outright if
   * it contains a placeholder — there would be nobody to fill it.
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
  /** Same shape as `job.error`, `details` included — see `jobs.ts`. */
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1), details: z.unknown().optional() })
    .nullable(),
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
 * The built-in `bridge_state` datapoint every robot has (spec §4.3):
 * connection status plus latency, the basis for offline-aware client UIs.
 */
export const bridgeState = z.object({
  online: z.boolean(),
  latency_ms: z.number().nonnegative().nullable(),
})
export type BridgeState = z.infer<typeof bridgeState>

/** One tier's counters, `tiers` below carries six of these under string keys. */
const bridgePressureTier = z.object({
  sent: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  drops: z.number().int().nonnegative(),
  high_water: z.number().int().nonnegative(),
})

/**
 * The built-in `bridge_pressure` datapoint (spec §4.3, the pressure-telemetry
 * design's "The decision that shapes everything"): the bridge's own
 * bandwidth-shaping state, sent on the same reserved-slug path as
 * `bridge_state` so history, realtime, REST and MCP exposure fall out of the
 * ordinary datapoint machinery for free.
 */
export const bridgePressure = z.object({
  link: z.object({
    /** bytes/s the socket demonstrably drains, from sends >= 64 KiB
     *  only; null until the first large send of the session. */
    rate_bps: z.number().nonnegative().nullable(),
    /**
     * the byte target snapshots are currently encoded to fit.
     *
     * `.nonnegative()`, not `.positive()`: the target is derived from
     * `rate_bps`, and a link measured below 0.5 B/s floors to 0 here. A
     * schema that rejects 0 does not prevent that link — it only makes the
     * frame reporting it unparseable, and a console that cannot parse a
     * pressure frame shows "no feed", i.e. reports a struggling robot as an
     * *old* one. Zero is a legitimate reading and says something true.
     */
    snapshot_max_bytes: z.number().int().nonnegative(),
  }),
  /**
   * String keys "0".."5" because JSON has no integer keys. Counters are
   * cumulative per session and reset on reconnect; clients window by
   * differencing two samples.
   *
   * **What this schema does not decide:** it does not guarantee all six
   * keys are present (`z.record` over the six literals is exhaustive in
   * zod 4 — tested here, it required every key and rejected none, the
   * opposite of what a partial sample needs — so this is a
   * `.strictObject().partial()` over the same six literal keys instead, a
   * deliberate deviation from the originally sketched `z.record` shape with
   * the same runtime behaviour). A missing tier key reads as zeros; the
   * schema names what it cannot decide rather than implying a completeness
   * it cannot check.
   */
  tiers: z
    .strictObject({
      '0': bridgePressureTier,
      '1': bridgePressureTier,
      '2': bridgePressureTier,
      '3': bridgePressureTier,
      '4': bridgePressureTier,
      '5': bridgePressureTier,
    })
    .partial(),
  video: z.object({
    active_streams: z.number().int().nonnegative(),
    bitrate_sum_kbps: z.number().int().nonnegative(),
    /**
     * The uplink budget the bridge was configured with
     * (`FLEETLESS_UPLINK_KBPS`), or `null` when none was set.
     *
     * `.nonnegative()`, not `.positive()`: `FLEETLESS_UPLINK_KBPS=0` is a
     * documented setting meaning "no video budget at all", and the bridge
     * emits that 0 verbatim. `.positive()` made every frame from such a
     * robot fail the console's `safeParse`, which renders an unparseable
     * frame as "no pressure feed" — so the one robot that had *deliberately*
     * turned video off was the one diagnosed as running a bridge too old to
     * report pressure. A value the producer legitimately sends must parse;
     * `null` is the only "not set" this field has.
     */
    uplink_kbps: z.number().int().nonnegative().nullable(),
    override_kbps: z.number().int().nonnegative().nullable(),
    video_budget_kbps: z.number().int().nonnegative().nullable(),
    reserve_kbps: z.number().int().nonnegative(),
  }),
})
export type BridgePressure = z.infer<typeof bridgePressure>
export const PRESSURE_SLUG = 'bridge_pressure' as const

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
  /**
   * Names **this attempt** (W6b), and is echoed in the `camera_state` that
   * answers it.
   *
   * W6a gave `camera_state` a `cause` and said in the same comment that a
   * cause is not a correlation. This is the other half. Start a camera, have
   * it fail slowly, start it again: the first attempt's failure arrives while
   * the second is in flight, matches on slug, and resolves the attempt it
   * knows nothing about. The viewer is then told the running stream failed,
   * for a reason belonging to an attempt that is already over.
   */
  request_id: z.string().min(1).max(64),
})
export type CloudCameraStart = z.infer<typeof cloudCameraStart>

/** Cloud → bridge: the last viewer left; stop publishing (§10 refcount). */
/**
 * Assets (spec §4.6, W7): the bridge **reports availability and transfers
 * nothing** until asked.
 *
 * **The bytes never travel on this socket.** `server.ts` caps a frame at
 * 2 MiB, a single mesh exceeds that routinely, and raising the cap is already
 * tied to W8's rate limiting in the deferral register because it amplifies an
 * unauthenticated path. So the socket carries the *conversation* — what exists,
 * transfer this, here is how far I got — and the bytes go over HTTP with the
 * robot's own credential.
 *
 * That split is the whole design: a 40 MB mesh cannot stall the frames that
 * keep a robot answerable, and a failed upload cannot take the control channel
 * down with it.
 */
export const bridgeAssetsAvailable = z.object({
  type: z.literal('assets_available'),
  /** Whether `/robot_description` (or the configured source) yielded a URDF. */
  urdf: z.boolean(),
  /**
   * Every `package://` URI the URDF references, verbatim and unresolved —
   * including the ones this bridge cannot find in its workspace. Reporting
   * only the resolvable ones would make an incomplete workspace look like a
   * complete robot, and the cloud would have nothing to show as missing.
   */
  meshes: z.array(z.string().min(1)),
})
export type BridgeAssetsAvailable = z.infer<typeof bridgeAssetsAvailable>

/**
 * The explicit request §4.6 requires — nothing moves without it.
 *
 * The upload credential is minted per sync and travels here rather than being
 * derived from the robot token: it is scoped to one robot's assets and one
 * sync, so a bridge cannot be talked into uploading somewhere else, and an
 * expired one fails a sync instead of failing a robot.
 */
export const cloudAssetRequest = z.object({
  type: z.literal('asset_request'),
  sync_id: z.uuid(),
  upload_url: z.url(),
  token: z.string().min(1),
  /** Which URIs to send. Empty means the URDF only. */
  meshes: z.array(z.string().min(1)),
})
export type CloudAssetRequest = z.infer<typeof cloudAssetRequest>

/**
 * How far a sync got, and — required, not optional — what it could not do.
 *
 * `failed` carries the URIs that did not resolve. A sync that quietly drops
 * three meshes and reports success moves the failure into somebody else's
 * renderer, where it appears as a robot with missing limbs and no cause.
 */
export const bridgeAssetProgress = z.object({
  type: z.literal('asset_progress'),
  sync_id: z.uuid(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /**
   * **Each entry says why** — see `assetFailure` in `assets.ts` for the three
   * kinds and why one word was not enough. The bound is `assets.ts`'s too: a
   * `.dae` with 17,331 unresolvable internal references produced a frame 32
   * bytes over `MAX_WS_PAYLOAD_BYTES`, and `ws` enforces that **before**
   * delivery — so the outcome was the robot's own socket closed, mid-sync, by
   * a file in its workspace (Kassandra-W7a). A producer at its own ceiling
   * reports **one** `refused` entry naming the file, not one per reference.
   */
  failed: z.array(assetFailure).max(1000),
  /**
   * Three values, because a boolean `finished` had nowhere to put a refusal.
   *
   * A second `asset_request` arriving while one is in flight has to be
   * answered with something. The bridge's guard is a backstop — the cloud owns
   * sync lifecycle and refuses a concurrent one first — but a backstop that
   * answers with silence is a backstop nobody can debug, and the alternative
   * on the table was to report every requested URI in `failed`. That would
   * have made `failed` mean two different things at once — *could not be
   * resolved* and *was never attempted* — which is the one-field-two-facts
   * defect this project has now split five times (`set`/`readable`,
   * `truncated`/`truncated_by`, `value`/`sample_count`, `publishing`/`cause`,
   * and camera health's own).
   *
   * So: `running` while work is happening, `finished` when the bridge will
   * send no more for this sync, `refused_busy` when it never started because
   * another sync was in flight. `failed` keeps its single meaning.
   *
   * Raised by Rosie-W7, who found the gap by asking what a second request
   * should do rather than picking the silent option.
   */
  state: z.enum(['running', 'finished', 'refused_busy']),
})
export type BridgeAssetProgress = z.infer<typeof bridgeAssetProgress>

export const cloudCameraStop = z.object({
  type: z.literal('camera_stop'),
  slug,
  /** Names this stop, echoed by the `camera_state` that answers it — see `cloudCameraStart.request_id`. */
  request_id: z.string().min(1).max(64),
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
  /**
   * Why this frame was sent (W6a).
   *
   * Without it, `{publishing: false, error: null}` is sent for **three
   * different things** — an answer to `camera_stop`, a stream stopped by a
   * configuration change, and a source that recovered — and the cloud can
   * only tell them apart by remembering what it saw before. Deriving a cause
   * from remembered state is precisely the inference this project keeps
   * finding to be wrong, and W6a exists because four failures had been
   * sharing one silence.
   *
   * `'command'`       this frame answers a `camera_start` / `camera_stop`.
   * `'source'`        unsolicited: the source's own health changed, whether or
   *                   not anybody is watching. This is the frame that makes a
   *                   wrong password visible without a viewer.
   * `'config_change'` a configuration change stopped this stream. Not a
   *                   failure, and it must not be logged as one.
   * `'live_lost'`     publishing ended unexpectedly after it had started.
   *
   * Note it does **not** answer "which attempt is this?" — `camera_state`
   * still has no request id, and that remains a named deferral in cluster C.
   * `cause` says what kind of event this is; correlation is a separate fact
   * and giving one field both jobs would be the same mistake again.
   *
   * Required, not optional: an absent cause would default to the reading
   * somebody happens to assume, and every frame's sender knows its own
   * reason. Old bridges fail validation on this frame — acceptable while
   * nothing is deployed, and W8 is the first deployment.
   */
  cause: z.enum(['command', 'source', 'config_change', 'live_lost']),
  /**
   * When the **robot** observed this state — bridge capture time, never
   * receive time, the same discipline `timestamp_ms` follows for samples
   * (spec §6.3).
   *
   * It exists because the cloud stamped `resourceHealthState.changed_at_ms`
   * with its own `Date.now()`, and a **restatement** is by definition an old
   * state re-sent into an empty map. So after a cloud restart every failure —
   * including one from yesterday — was dated to the restart, in the one
   * scenario `changed_at_ms`'s own doc comment was written for: *"a page that
   * loads late must be able to tell a failure from a minute ago from one from
   * yesterday"*.
   *
   * On a restatement this carries **when the state was first observed**, not
   * when the frame was sent. A bridge that re-states a failure it has held for
   * an hour says so.
   */
  observed_at_ms: z.number().int().nonnegative(),
  /**
   * Which request this frame answers (W6b), or `null` when it answers none.
   *
   * `null` is not a gap and must not be treated as one: a `cause: 'source'`
   * frame — the unsolicited health report that makes a wrong password visible
   * with nobody watching — answers no request by definition, and so does a
   * `config_change` stop. Those are the majority of frames on a healthy
   * system.
   *
   * A frame with `cause: 'command'` carries the `request_id` of the
   * `camera_start` or `camera_stop` it answers. **The cloud resolves a
   * pending attempt only on a matching id**, and drops a `command` frame
   * whose id it no longer recognises rather than applying it to whatever is
   * pending — a late answer to a cancelled attempt is stale, not current.
   *
   * **The pairing rule is not in this schema, deliberately.** "Non-null iff
   * `cause === 'command'`" is a cross-field constraint; a zod `.refine()`
   * would express it at runtime and then **disappear** from the generated
   * JSON Schema, which is what the bridge vendors. The cloud would reject
   * frames the bridge had validated as correct — the same artifact/runtime
   * divergence that `.default()` publishing as `required` has produced four
   * times in this project, only pointing the other way. The rule is enforced
   * where the correlation is used, in the cloud's bridge frame handler, and
   * stated here so nobody has to derive it from that code.
   */
  request_id: z.string().min(1).max(64).nullable(),
})
export type BridgeCameraState = z.infer<typeof bridgeCameraState>
