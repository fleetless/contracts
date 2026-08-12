import { z } from 'zod'
import { slug } from './common.js'
import { clientIdentity } from './client-auth.js'
import { job } from './jobs.js'

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

/**
 * Command parity (spec §11.1): everything REST can do — invoke an action,
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
  /** Parameters by field path, validated against the config's rules (§4.4). */
  params: z.record(z.string(), z.unknown()),
})
export type ClientInvoke = z.infer<typeof clientInvoke>

export const clientCancel = z.object({
  type: z.literal('cancel'),
  request_id: z.string().min(1).max(64),
  robot_id: z.uuid(),
  /** Cancel is addressed by slug (§11.3), not by job id. */
  slug,
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
 * audit record before answering, while an immediately following publish by
 * the now-current holder has nothing to write and answers at once. Its reply
 * overtakes. Measured in W5: exactly one reversal in fifty-six zero-gap
 * bursts, which is the signature of that cause — it can happen only once per
 * identity and slug — and not of a race.
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
   *   caller has none. This is the §11.3 "inkl. Information, was läuft", and
   *   it is the whole reason a busy refusal is useful: the caller learns
   *   whether to wait or to give up (see `busyDetails`).
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
   * Added because it was missing, and its absence quietly broke §11.1: this
   * socket is supposed to do *everything* REST can do, but a
   * `parameter_invalid` arriving here had nowhere to put its violations, so
   * the same refusal was actionable over HTTP and opaque over the socket.
   * A client cannot bind an error to the input that caused it from a code
   * alone — which is the entire point of the flat parameter shape.
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
 * Subscribe to a slug's stream (spec §11.3: **state is observed by slug**).
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
   * What the subscriber expects, and how it wants it (W5).
   *
   * `kind` lets the server answer **`wrong_kind`** instead of accepting a
   * subscribe the client will then filter to silence — and silence is
   * indistinguishable from an idle slug, so it tells a developer nothing.
   * Optional, so an older client that omits it keeps today's behaviour.
   *
   * `options` is where a camera says what it wants; a datapoint needs none.
   * It exists now rather than later because adding a field to a frame three
   * repos parse is cheap once and expensive twice.
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

/**
 * A change in the health of something the developer configured (W6a).
 *
 * The push half of `resourceHealthState`; the REST list is the snapshot half,
 * and neither is useful alone — a page that loads after the change would see
 * nothing, and a page that never reloads would never learn.
 *
 * Delivered on the **developer** socket and scoped to the org, not to a
 * subscription: the whole point is to reach somebody who is *not* currently
 * looking at the thing that broke.
 */
export const resourceHealthEvent = z.object({
  type: z.literal('resource_health'),
  robot_id: z.uuid(),
  kind: z.enum(['camera', 'credential']),
  ref: z.string().min(1).max(64),
  state: z.enum([
    'ok',
    'unreachable',
    'auth_failed',
    'unreadable_credential',
    'stopped_by_config_change',
    'publish_failed',
    /** See `resourceHealthState.state` — the honest fallback for an unmapped code. */
    'unknown',
  ]),
  reason: z.string().max(200).nullable(),
  changed_at_ms: z.number().int().nonnegative(),
})
export type ResourceHealthEvent = z.infer<typeof resourceHealthEvent>
