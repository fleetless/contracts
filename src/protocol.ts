// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { assetFailure } from './assets.js'
import { applyError, slug } from './common.js'
import { robotConfigDoc } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { jobState } from './jobs.js'
import { rosTypeName } from './common.js'

/**
 * Bridge <-> cloud protocol, version 3.
 *
 * The version is exchanged in the hello handshake. Since 2026-09 the cloud
 * serves a **window** of versions, not one: every entry of
 * `PROTOCOL_VERSIONS` whose sunset has not passed. A version is deprecated
 * by the cloud release that supersedes it and sunset `PROTOCOL_SUNSET_DAYS`
 * later. Outside the window the cloud refuses with `protocol_mismatch`,
 * which names the window and reaches the robot's detail view as
 * `last_hello_error`.
 *
 * **3 (2026-09-21):** the ping carries `latency_ms` and `lag_ms`, the bridge
 * sends `link_mode`, `bridge_state` gains `low_bandwidth`, and the
 * `bridge_pressure` datapoint is gone. A protocol-2 bridge is served until
 * its sunset, and the cloud's protocol-2 adapter owes it two translations on
 * the way in: it drops its pressure datapoints, and it rewrites an
 * `asset_progress` failure of kind `too_large` — a kind protocol 3 no longer
 * has — to `refused` with `details: null`, because a 2.0.0 `bridgeAssetProgress`
 * refuses the frame outright otherwise.
 *
 * **2 (2026-08-21):** `config_applied.errors` entries gained `kind` and `code`
 * beside `message`.
 */
export const PROTOCOL_VERSION = 3

/** Days between a version's deprecation and its sunset. */
export const PROTOCOL_SUNSET_DAYS = 90

export interface ProtocolVersionEntry {
  version: number
  /** The first bridge package version that speaks this protocol. */
  bridge_from: string
  /** ISO date of the cloud release that superseded it; null while current. */
  deprecated_at: string | null
}

/**
 * Every protocol version the cloud has served, oldest first. A test keeps
 * exactly one entry current and equal to `PROTOCOL_VERSION`; `test/changelog.test.ts`
 * requires the CHANGELOG's current section to name the newest `bridge_from`
 * and the previous entry's `sunsetOf(...)` date, and `scripts/verify-version-tag.mjs`
 * requires a dated heading for the tag being released.
 */
export const PROTOCOL_VERSIONS: readonly ProtocolVersionEntry[] = [
  { version: 2, bridge_from: '3.0.0', deprecated_at: '2026-09-21' },
  { version: 3, bridge_from: '4.0.0', deprecated_at: null },
]

/** The newest bridge package. The cloud mails organisations still below it. */
export const LATEST_BRIDGE_VERSION = '4.0.0'

export interface ProtocolStatus {
  status: 'current' | 'deprecated' | 'unsupported'
  /** ISO date, or null for a current or unknown version. */
  sunset_at: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function sunsetOf(entry: ProtocolVersionEntry): string | null {
  if (entry.deprecated_at === null) return null
  return isoDate(new Date(Date.parse(entry.deprecated_at + 'T00:00:00Z') + PROTOCOL_SUNSET_DAYS * DAY_MS))
}

/**
 * The window rule itself: `protocolStatus` and `minimumProtocolVersion` are
 * this function over `PROTOCOL_VERSIONS`, and the cloud calls it directly.
 *
 * The table is a parameter because callers pass one with a deprecated entry —
 * tests, and any caller reasoning about a sunset. The real table has none
 * until the first bump, so a hard-coded `PROTOCOL_VERSIONS` would leave the
 * deprecated and unsupported branches unreachable.
 */
export function statusFromTable(
  table: readonly ProtocolVersionEntry[],
  version: number,
  today: Date,
): ProtocolStatus {
  const entry = table.find((candidate) => candidate.version === version)
  if (!entry) return { status: 'unsupported', sunset_at: null }
  const sunset = sunsetOf(entry)
  if (sunset === null) return { status: 'current', sunset_at: null }
  return { status: isoDate(today) < sunset ? 'deprecated' : 'unsupported', sunset_at: sunset }
}

export function protocolStatus(version: number, today: Date = new Date()): ProtocolStatus {
  return statusFromTable(PROTOCOL_VERSIONS, version, today)
}

/** The lowest version still inside its window today. */
export function minimumProtocolVersion(today: Date = new Date()): number {
  const alive = PROTOCOL_VERSIONS.filter((entry) => statusFromTable(PROTOCOL_VERSIONS, entry.version, today).status !== 'unsupported')
  return alive[0]?.version ?? PROTOCOL_VERSION
}

/**
 * The bridge socket close code for "this robot no longer exists".
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
 * The bridge socket close code for "the token you connected with is gone".
 *
 * The cloud closes a robot's live socket with this after the robot's token was
 * rotated. A 4.0.0 bridge reads it the way it reads `invalid_token` — stop,
 * exit 2 — because the secret it holds is no longer a secret anyone accepts,
 * and no amount of reconnecting produces the new one. A 3.x bridge does not
 * know the code, reconnects, and is refused at hello; that ends the same way,
 * one round trip later.
 *
 * Its own code rather than `CLOSE_ROBOT_DELETED`, which would tell an operator
 * their robot had been deleted when it very much still exists.
 */
export const CLOSE_TOKEN_ROTATED = 4005

/**
 * How long a command waits for its answer when the caller names no patience
 * of its own.
 *
 * 15 s, stated once here rather than once in the cloud and once in the bridge.
 * Two constants that happen to match are not one number: neither side can be
 * told otherwise for a single call, and when they drift nobody can say whose
 * deadline a caller hit.
 *
 * A caller who knows their robot's work takes longer says so per call.
 */
export const DEFAULT_PATIENCE_MS = 15_000

/**
 * The longest patience a caller may ask for.
 *
 * A waiting REST request is a held-open connection, so an unbounded
 * `patience_ms` is a way to pin the cloud's sockets open. Two minutes is long
 * enough for the robot work this API is meant for (a planner, a docking
 * manoeuvre, an arm trajectory) and short enough that a thousand of them is
 * still a bounded amount of cloud.
 *
 * Raising it is a conversation about rate limiting, not a one-line change
 * here.
 */
export const MAX_PATIENCE_MS = 120_000

/**
 * The shortest patience a caller may ask for.
 *
 * A floor exists because **impatience reaches the robot**. A `patience_ms` of
 * 1 on an action makes the bridge report `goal_timeout` and then issue a
 * *corrective cancel* against a goal the action server accepts a moment later
 * — so a caller who asks for an unreachable deadline does not merely get an
 * error, they cause a cancellation on the machine.
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
 * One job the bridge still has, as reported in the handshake.
 *
 * It carries the **slug and the state**, not only the id, because the cloud's
 * reconciliation needs both and had neither. Reading `active_job_ids` as bare
 * uuids, a restarted cloud could only ask "is this job still alive?" for jobs
 * it already knew about — not what the robot is doing, not whether a
 * `running` job had actually finished while the cloud was down, and nothing
 * at all about a job it never recorded because it crashed between minting the
 * id and writing the row.
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
   * Every job this bridge still knows about, right now.
   *
   * A reconnect and a restart look **identical** on the wire — same token,
   * same version, same frame — but must end differently: after a dropped
   * connection the running jobs are still running, after a restart their
   * results are gone forever. Enumerating what the bridge still has settles
   * it without either side guessing: the cloud marks every job it believed
   * running that is *not* named here as `lost`.
   *
   * Deliberately needs no persistence at the bridge: a live process lists its
   * live jobs, a process that just started lists none — exactly the truth
   * the cloud needs. A breadcrumb file would only add a window in which the
   * crash beat the write.
   *
   * Defaulted, so a bridge that sends no such field still parses; no jobs
   * and no report both mean the same thing to the cloud: nothing to keep
   * alive.
   */
  active_jobs: z.array(activeJob).max(500).default([]),
})
export type BridgeHello = z.infer<typeof bridgeHello>

/**
 * Cloud accepts the bridge: the robot is online from here on.
 *
 * `protocol` and `bridge` are optional so that a bridge parsing `hello_ok`
 * strictly still parses one from an older cloud. `status` here is never
 * `unsupported`: an unsupported version gets `hello_error`, not this frame.
 */
export const cloudHelloOk = z.object({
  type: z.literal('hello_ok'),
  robot_id: z.uuid(),
  protocol: z
    .object({
      status: z.enum(['current', 'deprecated']).meta({
        description: '`current` or `deprecated` — never `unsupported`, which is a `hello_error`.',
      }),
      sunset_at: z.iso.date().nullable().meta({
        description: 'ISO date a deprecated version stops being served; `null` when current.',
      }),
    })
    .optional()
    .meta({ description: "The cloud's verdict on the announced protocol version; absent from an older cloud." }),
  bridge: z
    .object({
      latest_version: z.string().min(1).meta({
        description: "The newest published fleetless-bridge package version, for the bridge's own upgrade hint.",
      }),
    })
    .optional()
    .meta({ description: 'What the cloud knows about bridge packages; absent from an older cloud.' }),
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
 * never the receive time — so clients compute age themselves.
 *
 * Which is exactly why `backfill` has to be on the frame. A replayed sample
 * carries the capture time it had during the outage, so a cloud that measures
 * lag from every arriving frame reads a two-hour disconnect as two hours of
 * lag the moment the bridge reconnects — and reports a healthy link as the
 * worst one it has ever seen. Only the bridge knows which frames came out of
 * its buffer, so only the bridge can say.
 */
export const datapointFrame = z.object({
  type: z.literal('datapoint'),
  slug,
  value: z.unknown(),
  timestamp_ms: z.number().int().nonnegative(),
  backfill: z.boolean().optional().meta({ description: 'true when the sample was captured while the bridge was disconnected and is being replayed after the reconnect. The cloud keeps such a sample out of its lag measure; absent means live.' }),
})
export type DatapointFrame = z.infer<typeof datapointFrame>

/**
 * Latency probe, cloud → bridge. The cloud sends its own clock in `ts_ms`;
 * the bridge echoes it back untouched and the cloud derives the round-trip
 * latency shown as `bridge_state.latency_ms`.
 *
 * Sent every `pingIntervalMs`; the bridge answers with `pong`. Since protocol
 * 3 it also carries what the cloud measured about this link, so the bridge
 * can decide on its low-bandwidth mode with an end-to-end number: the
 * round trip of the last pong, and the datapoint lag — the median over the
 * last five seconds of (receive time − `timestamp_ms`) minus the minimum of
 * the last ten minutes, which cancels the robot's clock offset. `null` until
 * the cloud has a sample. A protocol-2 bridge reads only `ts_ms`.
 */
export const cloudPing = z.object({
  type: z.literal('ping'),
  ts_ms: z.number().int().nonnegative(),
  latency_ms: z.number().nonnegative().nullable().meta({ description: 'Round trip of the last pong in milliseconds; null before the first.' }),
  lag_ms: z.number().nonnegative().nullable().meta({ description: 'Datapoint lag over the link: median of the last five seconds minus the ten-minute minimum, in milliseconds; null until a sample exists, and null again whenever no live sample arrived in the last five seconds, because a stale median would be a lie.' }),
})
export type CloudPing = z.infer<typeof cloudPing>

/** Immediate bridge answer to a `CloudPing`, `ts_ms` echoed unchanged. */
export const bridgePong = z.object({
  type: z.literal('pong'),
  ts_ms: z.number().int().nonnegative(),
})
export type BridgePong = z.infer<typeof bridgePong>

/**
 * The bridge's low-bandwidth mode changed. Sent on every transition and once
 * after `hello_ok`, at tier 0 like the pong: the cloud folds it into
 * `bridge_state.low_bandwidth`, and a frame that waited behind bulk would
 * describe a state that is already over.
 */
export const bridgeLinkMode = z.object({
  type: z.literal('link_mode'),
  low_bandwidth: z.boolean().meta({ description: 'Whether the mode is active after this transition.' }),
  reason: z.enum(['lag', 'dwell', 'forced', 'recovered']).meta({ description: '`lag`: the cloud-measured lag crossed the threshold; `dwell`: the bridge-measured queue dwell did; `forced`: `mode: on` or `off`; `recovered`: both measures stayed at or below the exit threshold.' }),
  at_ms: z.number().int().nonnegative().meta({ description: 'Bridge time of the transition, epoch milliseconds.' }),
})
export type BridgeLinkMode = z.infer<typeof bridgeLinkMode>

/**
 * The published configuration, cloud → bridge — the bridge applies the
 * published version. Sent right after `hello_ok` and again on every publish,
 * so a bridge never has to ask.
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
 * Commands, cloud → bridge. The **cloud** mints the
 * `job_id` before the bridge is asked to do anything, so a job exists —
 * and can be reported `lost` — even if the answer never comes back.
 */
export const cloudInvoke = z.object({
  type: z.literal('invoke'),
  job_id: z.uuid(),
  slug,
  /**
   * Already validated against the configuration's parameter rules; the bridge
   * validates structurally.
   *
   * **Flat, keyed by parameter name** — `{"target_x": 1}`. The key is a key of
   * the entry's `parameters` mapping, not a path into the message. The two are
   * deliberately decoupled: a parameter keeps its name when the field it fills
   * moves in the message tree, which is the same reason a slug is not a topic
   * name.
   *
   * Three things follow: the key a caller sends is the key a rule names, so a
   * `parameter_invalid` reports something the caller can find; a UI binds one
   * input per parameter; and a position the template does not mark with
   * `${…}` cannot be set by any caller at all, structurally — the value has
   * nowhere to go.
   *
   * The bridge substitutes these values into the entry's `message` template
   * at its placeholder positions. It no longer unflattens a dotted path;
   * there is no dotted path to unflatten.
   */
  params: z.record(z.string(), z.unknown()),
  /**
   * How long this one call is worth waiting for, already resolved by the
   * cloud — the caller's `invokeRequest.patience_ms`, or
   * `DEFAULT_PATIENCE_MS` when they named none.
   *
   * **Required here, optional at REST**, deliberately. At the REST edge an
   * absent value is a caller who did not care and gets the default. By the
   * time the frame is on this socket somebody has decided, and the bridge
   * must never be in the position of picking a number the cloud is already
   * counting against. Two independent constants that happen to match give up
   * at the same moment by accident, with no way to tell whose deadline a
   * caller actually hit.
   */
  patience_ms: z.number().int().min(MIN_PATIENCE_MS).max(MAX_PATIENCE_MS),
})
export type CloudInvoke = z.infer<typeof cloudInvoke>

/**
 * Cancel — the bridge must issue a real ROS goal cancel.
 *
 * `slug` stays, and stays required: it is how the bridge finds the tracker,
 * and it is what a cancel with no id means.
 *
 * `job_id` is what makes a cancel say *which* job. Without it a cancel
 * arriving a moment after one job ended and another began on the
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
 * burst delivered late after a reconnect is visibly late.
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
 * Jobs the bridge can no longer account for **while connected** — a
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
 * The built-in `bridge_state` datapoint every robot has: connection status
 * plus latency, the basis for offline-aware client UIs.
 *
 * `online` and `latency_ms` are cloud-observed (the socket, the pong);
 * `low_bandwidth` is bridge-reported through `link_mode` and `false` for a
 * bridge that never sends one.
 */
export const bridgeState = z.object({
  online: z.boolean(),
  latency_ms: z.number().nonnegative().nullable(),
  low_bandwidth: z.boolean().meta({ description: 'Whether the bridge is in its low-bandwidth mode: datapoints capped, cameras reduced or stopped. Bridge-reported.' }),
})
export type BridgeState = z.infer<typeof bridgeState>

/* ------------------------------------------------------------------------
 * Cameras.
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
 * ordering, and ordering across a socket is not something to lean on.
 *
 * `timestamp_ms` is the bridge's **capture** time, which is what lets every
 * consumer state a snapshot's true age. A picture that lies about when it was
 * taken is as bad as a job that reads "running" when nobody knows.
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
 * will not stay online, from a configuration the platform accepted. The margin
 * is thinner than it looks — a 4K JPEG of real camera content lands around
 * 2.2 MiB, and 1080p on a noisy scene comes within half of this number.
 *
 * **The bridge must degrade rather than exceed it** — lower JPEG quality, then
 * downscale, and if it still does not fit, skip the frame and say so. A missing
 * snapshot is a gap, and a gap is an honest answer; a closed socket is not.
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
 * it mints a `job_id` before asking anything: the side that owns the
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
   * Names **this attempt**, and is echoed in the `camera_state` that answers
   * it.
   *
   * `camera_state.cause` says what kind of event a frame is; a cause is not a
   * correlation, and this is the other half. Start a camera, have it fail
   * slowly, start it again: the first attempt's failure arrives while
   * the second is in flight, matches on slug, and resolves the attempt it
   * knows nothing about. The viewer is then told the running stream failed,
   * for a reason belonging to an attempt that is already over.
   */
  request_id: z.string().min(1).max(64),
})
export type CloudCameraStart = z.infer<typeof cloudCameraStart>

/** Cloud → bridge: the last viewer left; stop publishing. */
/**
 * Assets: the bridge **reports availability and transfers nothing** until
 * asked.
 *
 * **The bytes never travel on this socket.** A frame is capped at 2 MiB and a
 * single mesh exceeds that routinely; raising the cap amplifies an
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
 * The explicit request that starts a transfer — nothing moves without it.
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
   * kinds and why one word is not enough. The bound is `assets.ts`'s too: a
   * single `.dae` can carry tens of thousands of unresolvable internal
   * references, which is enough to push this frame past
   * `MAX_WS_PAYLOAD_BYTES`. That limit is enforced **before** delivery, so the
   * outcome is not a dropped frame but the robot's own socket closed mid-sync
   * by a file in its workspace. A producer at its own ceiling reports **one**
   * `refused` entry naming the file, not one per reference.
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
   * resolved* and *was never attempted* — one field carrying two facts, each
   * overwriting the other.
   *
   * So: `running` while work is happening, `finished` when the bridge will
   * send no more for this sync, `refused_busy` when it never started because
   * another sync was in flight. `failed` keeps its single meaning.
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
   * Why this frame was sent.
   *
   * Without it, `{publishing: false, error: null}` is sent for **three
   * different things** — an answer to `camera_stop`, a stream stopped by a
   * configuration change, and a source that recovered — and the cloud can only
   * tell them apart by remembering what it saw before. A cause derived from
   * remembered state is a guess.
   *
   * `'command'`       this frame answers a `camera_start` / `camera_stop`.
   * `'source'`        unsolicited: the source's own health changed, whether or
   *                   not anybody is watching. This is the frame that makes a
   *                   wrong password visible without a viewer.
   * `'config_change'` a configuration change stopped this stream. Not a
   *                   failure, and it must not be logged as one.
   * `'live_lost'`     publishing ended unexpectedly after it had started.
   *
   * It does **not** answer "which attempt is this?" — `request_id` beside it
   * does. `cause` says what kind of event this is; correlation is a separate
   * fact, and giving one field both jobs would be the same mistake again.
   *
   * Required, not optional: an absent cause would default to whatever reading
   * the receiver happens to assume, and every frame's sender knows its own
   * reason.
   */
  cause: z.enum(['command', 'source', 'config_change', 'live_lost']),
  /**
   * When the **robot** observed this state — bridge capture time, never
   * receive time, the same discipline `timestamp_ms` follows for samples.
   *
   * It exists because a cloud that stamps `resourceHealthState.changed_at_ms`
   * with its own clock dates every **restatement** to the moment it restarted
   * — a restatement is by definition an old state re-sent into an empty map.
   * That destroys exactly what `changed_at_ms` is for: a page that loads late
   * must be able to tell a failure from a minute ago from one from yesterday.
   *
   * On a restatement this carries **when the state was first observed**, not
   * when the frame was sent. A bridge that re-states a failure it has held for
   * an hour says so.
   */
  observed_at_ms: z.number().int().nonnegative(),
  /**
   * Which request this frame answers, or `null` when it answers none.
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
   * JSON Schema, which is what a non-TypeScript bridge validates against. The
   * cloud would reject frames the bridge had validated as correct — the same
   * artifact-versus-runtime divergence that `.default()` publishing as
   * `required` produces, pointing the other way. The rule is enforced
   * where the correlation is used, in the cloud's bridge frame handler, and
   * stated here so nobody has to derive it from that code.
   */
  request_id: z.string().min(1).max(64).nullable(),
})
export type BridgeCameraState = z.infer<typeof bridgeCameraState>
