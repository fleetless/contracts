// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { RESOURCE_HEALTH_STATES } from './rest.js'
import { MAX_PATIENCE_MS, MIN_PATIENCE_MS } from './protocol.js'
import { slug } from './common.js'
import { clientIdentity } from './client-auth.js'
import { job } from './jobs.js'

/**
 * Client realtime protocol: WebSocket subscriptions on datapoints, the
 * datapoint event stream, and full command parity with REST.
 */

/**
 * The first frame a client sends after the socket opens.
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

/**
 * Command parity: everything REST can do — invoke an action,
 * call a service, publish, cancel — also travels over this socket.
 *
 * **Every command carries a `request_id` and every reply echoes it.** A
 * subscribe that gets dropped is self-healing: the client resubscribes on
 * reconnect and nothing was promised. A *command* that gets dropped is an
 * instruction someone believes they issued and no one will ever run — on a
 * machine that may be moving. Correlation is what makes the difference
 * observable instead of silent.
 */
export const clientInvoke = z.object({
  type: z.literal('invoke'),
  request_id: z.string().min(1).max(64),
  robot_id: z.uuid(),
  slug,
  /** Parameters by field path, validated against the configuration's rules. */
  params: z.record(z.string(), z.unknown()),
  /**
   * How long this one call is worth waiting for — the same field, meaning and
   * cap as `invokeRequest.patience_ms`; absent means `DEFAULT_PATIENCE_MS`.
   *
   * It is here because **parity is a rule, not a preference**: what REST can do
   * travels over this socket. A field given to the REST body alone would be
   * unreachable to every caller that invokes over the realtime channel, while
   * still appearing in the documentation.
   */
  patience_ms: z.number().int().min(MIN_PATIENCE_MS).max(MAX_PATIENCE_MS).optional(),
})
export type ClientInvoke = z.infer<typeof clientInvoke>

export const clientCancel = z.object({
  type: z.literal('cancel'),
  request_id: z.string().min(1).max(64),
  robot_id: z.uuid(),
  /** Which slug — required, and the coarse address of a cancel. */
  slug,
  /**
   * Which job on that slug, or `null` for *whatever is running there*.
   *
   * The two are different requests and both are legitimate. An operator
   * hitting a stop button means the second: stop the machine, whatever it is
   * doing. A client cancelling the job it started means the first — and until
   * this field a client could not say so, and a cancel arriving just after its
   * own job ended would stop the next caller's job instead. Same slug, same
   * wire frame, entirely different machine behaviour, and nothing in the
   * protocol able to tell them apart.
   *
   * A named id that is not running answers `not_found` rather than falling
   * back to the slug. Falling back would be the platform deciding that the
   * caller did not really mean the id they typed.
   */
  job_id: z.uuid().nullable(),
})
export type ClientCancel = z.infer<typeof clientCancel>

export const clientPublish = z.object({
  type: z.literal('publish'),
  request_id: z.string().min(1).max(64),
  robot_id: z.uuid(),
  slug,
  message: z.record(z.string(), z.unknown()),
})
export type ClientPublish = z.infer<typeof clientPublish>

/**
 * The reply to exactly one command. `ok:false` carries the stable code —
 * `busy`, `robot_offline`, `parameter_invalid`, `forbidden` — so a caller
 * branches without parsing prose.
 *
 * **`request_id` is the only correlation, and the order these arrive in is
 * not promised.** Commands sent on one socket reach the robot in the order
 * they were sent — that ordering is guaranteed and is the point of the
 * command chain — but their *replies* may arrive in any order, and a client
 * that pairs them up by arrival order will attribute an outcome to the wrong
 * command.
 *
 * This is not theoretical and not jitter. The ordering chain is released once
 * a command has reached the bridge, deliberately, so that the next command —
 * a stop, say — is never held up behind bookkeeping. Work that follows the
 * send therefore runs unordered: a publish that *acquires* a slug writes an
 * audit record before answering, while an immediately following publish by the
 * now-current holder has nothing to write and answers at once. Its reply
 * overtakes. That reversal happens at most once per identity and slug, which
 * is what distinguishes it from a race.
 *
 * Serialising the replies would mean putting that bookkeeping in front of
 * every following command, including the stop. The ordering that matters is
 * the one on the wire to the robot, and it is kept.
 */
export const commandResult = z.object({
  type: z.literal('command_result'),
  request_id: z.string().min(1).max(64),
  ok: z.boolean(),
  /**
   * The job this reply is *about* — which is not always the caller's own.
   *
   * - `ok:true` on an invoke or a call: the job that was just created.
   * - `ok:true` on a cancel: the job the cancel was sent to.
   * - `ok:false, code:'busy'`: **the job that is already running** — the
   *   caller has none. Naming what is already running is the whole reason a
   *   busy refusal is useful: the caller learns whether to wait or to give up
   *   (see `busyDetails`).
   * - any other refusal: `null`.
   */
  job: job.nullable(),
  /**
   * The **kind** of the slug this command addressed, when the slug resolved.
   *
   * Invoke and call share a route on purpose — both create the job on the
   * slug — but a *client* library distinguishes them: `services.call` waits
   * for a terminal state, `actions.invoke` does not. Without the kind coming
   * back, calling a service helper on an action slug **starts the real action
   * on the robot** and then blames the robot for not finishing, half a minute
   * later. Returning the kind lets a client refuse its own mistake at once,
   * instead of reporting it as the machine's.
   */
  kind: z.enum(['datapoint', 'action', 'service', 'publisher', 'camera']).nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  /**
   * The same payload the REST envelope carries in `apiError.details` — for
   * `parameter_invalid`, a `parameterInvalidDetails`.
   *
   * It is here because this socket does *everything* REST can do, and without
   * it a `parameter_invalid` arriving here would have nowhere to put its
   * violations — the same refusal actionable over HTTP and opaque over the
   * socket. A client cannot bind an error to the input that caused it from a
   * code alone, which is the entire point of the flat parameter shape.
   */
  details: z.unknown().optional(),
})
export type CommandResult = z.infer<typeof commandResult>

/**
 * A well-formed frame this server does not understand. The socket **stays
 * open** — closing it would mean a newer client against an older cloud
 * reconnects, resends, and takes every unrelated subscription down with it
 * on every attempt. Close 1008 is reserved for frames that are not parseable
 * JSON objects at all.
 */
export const errorFrame = z.object({
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string().min(1),
})
export type ErrorFrame = z.infer<typeof errorFrame>

/**
 * Subscribe to a slug's stream — **state is observed by slug**.
 *
 * Which kinds are subscribable, and why it is not a matter of taste:
 *
 * - **datapoint** — its values.
 * - **action** — its `jobEvent`s.
 * - **service** — its `jobEvent`s too. A service call mints a job like an
 *   action does; the only difference is that the caller usually gets the
 *   result inline. But when they do *not* — a socket that died before the
 *   reply, answered with `command_outcome_unknown` — the documented recovery
 *   is to observe the slug. Refusing that leaves the caller with an error
 *   that names a remedy the platform does not offer.
 * - **publisher** — not subscribable: there is no job and no stream. It must
 *   still be refused *honestly*, with a code saying so, and never as though
 *   the slug did not exist. A caller who was granted a slug is entitled to
 *   be told the truth about it.
 */
export const clientSubscribe = z.object({
  type: z.literal('subscribe'),
  robot_id: z.uuid(),
  slug,
  /**
   * What the subscriber expects, and how it wants it.
   *
   * `kind` lets the server answer **`wrong_kind`** instead of accepting a
   * subscribe the client will then filter to silence — and silence is
   * indistinguishable from an idle slug, so it tells a developer nothing.
   * Optional, so an older client that omits it keeps today's behaviour.
   *
   * `options` is where a camera says what it wants; a datapoint needs none.
   */
  /**
   * `publisher` is here even though a publisher is not subscribable: a client
   * that models the five grantable kinds and honestly names one gets the
   * informative `not_subscribable` the cloud already computes, instead of a
   * `validation_error` reciting an enum. Refusing the *word* rather than the
   * request was the same mistake as the silent wrong-verb subscribe this
   * field was added to fix.
   */
  kind: z.enum(['datapoint', 'action', 'service', 'publisher', 'camera']).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
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
 * Codes follow the same error culture as REST: stable code plus human message.
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
 * in `datapointValue` (capture time; cloud-observed for `bridge_state`).
 */
export const datapointEvent = z.object({
  type: z.literal('datapoint'),
  robot_id: z.uuid(),
  slug,
  value: z.unknown(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type DatapointEvent = z.infer<typeof datapointEvent>

/**
 * A change in the health of something the developer configured.
 *
 * The push half of `resourceHealthState`; the REST list is the snapshot half,
 * and neither is useful alone — a page that loads after the change would see
 * nothing, and a page that never reloads would never learn.
 *
 * Delivered on the **developer** socket and scoped to the org, not to a
 * subscription: the whole point is to reach somebody who is *not* currently
 * looking at the thing that broke.
 */
/**
/**
 * Why a live camera session ended.
 *
 * **The reason travels WITH the ending, rather than being read afterwards from
 * a state.** Some of these states are sticky — nothing moves a camera out of
 * `stopped_by_config_change` — so a client that reads the current state at the
 * moment a stream ends reports a configuration change from hours ago as the
 * cause of an unrelated ending.
 *
 * A state read after the fact answers "what is true now". A viewer needs "what
 * happened to my session", and only an event carries that.
 */
export const liveSessionEndReason = z.enum([
  /** Another holder of this camera released it — another tab, or another client. */
  'released_by_peer',
  /** The robot's configuration was published and this camera changed with it. */
  'config_changed',
  /** The robot said it could not publish. `detail` carries its own words. */
  'publish_failed',
  /** The bridge stopped answering. */
  'robot_offline',
  /** The grant this session was minted under was withdrawn. */
  'revoked',
  /** The session's own lifetime ran out. */
  'expired',
  /** The robot was deleted out from under the session. */
  'robot_deleted',
  /**
   * The cloud ended it and cannot say which of the above applied. **Kept
   * deliberately**: a channel that cannot say "I do not know" will say
   * something false instead, and this project has paid for that four times in
   * the camera path alone.
   */
  'unknown',
])
export type LiveSessionEndReason = z.infer<typeof liveSessionEndReason>

/**
/**
 * A live camera session ended, told to the **client that holds it**.
 *
 * Without this frame the only vehicle is `camera_state`, which the cloud stores
 * and reads in exactly one place — refusing a *later* joiner — so a failure
 * reported through it is written to a dead end.
 *
 * Unlike `resourceHealthEvent`, which is developer-only and org-scoped, this
 * one is addressed to the **holder of the session**: it names `session_id` and
 * is delivered only to the identity that session was minted for. A developer
 * watching the same robot learns about the *resource* health; the viewer learns
 * about *their own session*. Two questions, two channels, on purpose.
 */
export const liveSessionEvent = z.object({
  type: z.literal('live_session'),
  robot_id: z.uuid(),
  slug,
  session_id: z.uuid(),
  state: z.literal('ended'),
  reason: liveSessionEndReason,
  /**
   * **Classified text the cloud produced, never text the robot sent.**
   *
   * It is **not** the robot's own words. Nothing sanitises
   * `bridgeCameraState.error.message`, and a camera password reaches a
   * developer surface through exactly that route — which is why the cloud maps
   * a robot's diagnosis to fixed strings rather than forwarding it.
   *
   * So: `null` unless the cloud itself has something classified to say. If a
   * developer needs the robot's own diagnosis later, it arrives as a mapped
   * code with fixed text, the way camera health already does it — not as
   * forwarded foreign text on a channel a client reads.
   */
  detail: z.string().max(200).nullable(),
  /** When it ended — not when this frame was sent. Same reasoning as `changed_at_ms`. */
  ended_at_ms: z.number().int().nonnegative(),
})
export type LiveSessionEvent = z.infer<typeof liveSessionEvent>

/**
 * A resource's health entry was **withdrawn**.
 *
 * Withdrawing a claim nobody can currently stand behind looks like it needs no
 * event: the next `GET` already reflects it. That holds for a page that loads
 * later. **It is false for a page that is already open, because there is no
 * next `GET`** — a client fetches the snapshot once and then only ever writes
 * keys the event stream gives it. A camera retargeted to a source that never
 * reports, which is the case the clearing exists for, would leave an open tab
 * showing the old value indefinitely.
 *
 * **A separate event type rather than a nullable `state` on the existing
 * one**, so a consumer's `switch` has to name it. A nullable field invites
 * `if (state)` and fails silently when somebody forgets; an unhandled variant
 * fails `tsc`, which is the difference between a rule and a mechanism.
 */
export const resourceHealthCleared = z.object({
  type: z.literal('resource_health_cleared'),
  robot_id: z.uuid(),
  kind: z.enum(['camera']),
  ref: z.string().min(1).max(64),
  facet: z.enum(['source', 'publish']),
  cleared_at_ms: z.number().int().nonnegative(),
})
export type ResourceHealthCleared = z.infer<typeof resourceHealthCleared>

export const resourceHealthEvent = z.object({
  type: z.literal('resource_health'),
  robot_id: z.uuid(),
  kind: z.enum(['camera']),
  ref: z.string().min(1).max(64),
  /** Which of the two questions this entry answers — see `resourceHealthState.facet`. */
  facet: z.enum(['source', 'publish']),
  state: z.enum(RESOURCE_HEALTH_STATES),
  reason: z.string().max(200).nullable(),
  changed_at_ms: z.number().int().nonnegative(),
})
export type ResourceHealthEvent = z.infer<typeof resourceHealthEvent>

/**
 * One line of the developer console's activity panel.
 *
 * **This is an activity log for humans, not a complete feed.** It is throttled
 * and sampled. `orgEventDropped` reports a drop on the wire, but no Fleetless
 * surface renders it, so a reader of this stream cannot tell a complete window
 * from a sampled one unless their own client shows the drop. Anything that
 * needs completeness reads the audit log or the job-run history, both durable,
 * both 90 days.
 */
export const ORG_EVENT_SAMPLE_INTERVAL_MS = 1_000
/** The backstop above the per-slug cap: a fleet larger than the panel could serve anyway. */
export const ORG_EVENT_ORG_CEILING_PER_SECOND = 50
/** Roughly 25 screens of scrollback. */
export const ORG_EVENT_BUFFER_SIZE = 200
/** An org's buffer is dropped after this long without an event, so memory follows active orgs rather than all of them. */
export const ORG_EVENT_BUFFER_IDLE_MS = 3_600_000
/** A log line, not a payload: a datapoint value is `unknown` and a LaserScan is megabytes. */
export const ORG_EVENT_DETAIL_MAX_BYTES = 4_096

/**
 * `'alert'` — a transition of a datapoint alert (`ok ⇄ firing`). A firing
 * event carries the alert's own `severity`; a resolved event is always `info` —
 * resolving is good news regardless of how bad the firing was.
 *
 * `'datapoint'` — **no producer emits this kind**: per-slug sampling on this
 * stream made it redundant with what the datapoint history route already
 * serves. The member stays in the enum rather than being removed, because a
 * reader may still hold an older frame of this kind in a buffer (a reconnect
 * replay, a client that has not refreshed) and must be able to parse it rather
 * than fail closed on an old, valid value.
 */
export const orgEventKind = z.enum(['datapoint', 'health', 'job', 'bridge', 'audit', 'alert'])
export type OrgEventKind = z.infer<typeof orgEventKind>

/**
 * Assigned by the **producer**, never derived by the reader. The console's
 * `errors` filter cuts across all five kinds, and only the source knows whether
 * an `auth_failed` is bad. A reader guessing from `detail` guesses differently
 * for each source.
 */
export const orgEventSeverity = z.enum(['info', 'warning', 'error'])
export type OrgEventSeverity = z.infer<typeof orgEventSeverity>

export const orgEvent = z
  .object({
    type: z.literal('org_event'),
    /**
     * **Per org, per process.** Like `job.seq` and unlike `job_runs.seq`, which
     * is a postgres `bigserial` and durable. All three say which they are,
     * because anyone who confuses them will confuse them in both directions.
     */
    seq: z.number().int().positive(),
    at: z.iso.datetime(),
    kind: orgEventKind,
    severity: orgEventSeverity,
    /** `null` for an org-level event — an invitation, a quota change — which belongs to no robot. */
    robot_id: z.uuid().nullable(),
    /** What the line is about: a slug, a camera, an actor's email. */
    subject: z.string().min(1).max(200),
    /**
     * Kind-specific, and **capped at `ORG_EVENT_DETAIL_MAX_BYTES`** — above it
     * the producer substitutes `{ omitted: 'too_large', bytes }`. Truncated,
     * and saying so.
     *
     * Never a pre-formatted line: the reader decides language, number format
     * and truncation, so changing how a line reads is not a cloud deploy.
     */
    detail: z.unknown().nullable(),
  })
  .strict()
export type OrgEvent = z.infer<typeof orgEvent>

/** Sent by a developer's socket to start the stream. Answered by `orgEventReplay`, then live `orgEvent`s. */
export const orgEventSubscribe = z.object({ type: z.literal('org_event_subscribe') }).strict()
export type OrgEventSubscribe = z.infer<typeof orgEventSubscribe>

export const orgEventUnsubscribe = z.object({ type: z.literal('org_event_unsubscribe') }).strict()
export type OrgEventUnsubscribe = z.infer<typeof orgEventUnsubscribe>

/**
 * What the cloud still remembers, oldest first, sent once before the live
 * stream starts — so the panel is filled on arrival rather than blank until
 * something happens. A blank panel is indistinguishable from a broken one.
 */
export const orgEventReplay = z
  .object({
    type: z.literal('org_event_replay'),
    events: z.array(orgEvent).max(ORG_EVENT_BUFFER_SIZE),
    /**
     * **`false` means three different things, on purpose**: the buffer was
     * already full, the cloud restarted, or this org's buffer had expired. All
     * three mean the same thing to a reader — *something is missing above this
     * line* — and a field separating them would claim a distinction nobody
     * would act on differently.
     */
    complete: z.boolean(),
  })
  .strict()
export type OrgEventReplay = z.infer<typeof orgEventReplay>

/**
 * Events this socket will never see. Two causes, reported alike: the cloud
 * sampled them away, or this socket's send buffer was too far behind. Both mean
 * *there was more than you are being shown*.
 */
export const orgEventDropped = z
  .object({
    type: z.literal('org_event_dropped'),
    /**
     * **An epoch instant in milliseconds (`Date.now()`), not a duration.**
     * The moment this socket last reported a drop — or the moment it
     * subscribed, if this is its first such frame. The window the `dropped`
     * count covers is `since_ms` to now, so a reader wanting an age
     * subtracts: `Date.now() - since_ms`. Spelled out because the type
     * admits both readings and the wrong one is silent: a consumer treating
     * it as "milliseconds ago" renders a drop that happened seconds ago as
     * having happened in 1970.
     */
    since_ms: z.number().int().nonnegative(),
    /** Always at least one — a frame reporting nothing lost is noise on a channel built to be quiet. */
    dropped: z.number().int().positive(),
  })
  .strict()
export type OrgEventDropped = z.infer<typeof orgEventDropped>
