import { z } from 'zod'
import { bridgeState, MAX_PATIENCE_MS } from './protocol.js'
import { slug, rosTypeName } from './common.js'
import { configState, datapointRange, datapointRate, robotConfigDoc, validationIssue } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { job } from './jobs.js'

/**
 * REST shapes of the robot resource (spec §11.1). W1 scope: create, list,
 * get, and the built-in `bridge-state` datapoint read.
 */

export const robot = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(63),
  created_at: z.iso.datetime(),
})
export type Robot = z.infer<typeof robot>

export const createRobotRequest = z.object({
  name: z.string().min(1).max(63),
})
export type CreateRobotRequest = z.infer<typeof createRobotRequest>

/**
 * The robot token binds one bridge to one robot (spec §5). It is returned
 * exactly once, here; the cloud stores only a hash of it.
 */
export const robotToken = z.string().regex(/^frt_[0-9a-f]{32}$/)

export const createRobotResponse = z.object({
  robot,
  token: robotToken,
})
export type CreateRobotResponse = z.infer<typeof createRobotResponse>

/** A robot as listed, with its current built-in `bridge-state`. */
export const robotListItem = z.object({
  ...robot.shape,
  bridge_state: bridgeState,
})
export type RobotListItem = z.infer<typeof robotListItem>

export const robotListResponse = z.object({
  robots: z.array(robotListItem),
})
export type RobotListResponse = z.infer<typeof robotListResponse>

/**
 * The REST read of one datapoint. For bridge-captured data `timestamp_ms`
 * is the capture time at the bridge (spec §6.3); for the cloud-observed
 * built-in `bridge-state` it is the time the cloud observed the state.
 */
export const datapointValue = z.object({
  slug,
  value: z.unknown(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type DatapointValue = z.infer<typeof datapointValue>

/* ------------------------------------------------------------------ W2 --
 * Exposure: the configuration resource, introspection, types, and the
 * datapoint surface generated from the published configuration (spec §4,
 * §11.2).
 */

/**
 * One robot in full: what the list shows, plus what only the detail view
 * needs — which bridge build is connected, why the last hello was refused,
 * and where the configuration stands (spec §15.2, tab 1).
 */
export const robotDetailResponse = z.object({
  ...robotListItem.shape,
  bridge_version: z.string().min(1).nullable(),
  last_hello_error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      at: z.iso.datetime(),
    })
    .nullable(),
  config: configState,
})
export type RobotDetailResponse = z.infer<typeof robotDetailResponse>

/**
 * The editable configuration. `issues` is recomputed on every read and
 * write, so the editor never has to guess whether it may publish.
 */
export const configDraftResponse = z.object({
  doc: robotConfigDoc,
  updated_at: z.iso.datetime().nullable(),
  issues: z.array(validationIssue),
})
export type ConfigDraftResponse = z.infer<typeof configDraftResponse>

export const putConfigDraftRequest = z.object({ doc: robotConfigDoc })
export type PutConfigDraftRequest = z.infer<typeof putConfigDraftRequest>

/** Publishing freezes the draft into the next immutable version. */
export const publishConfigResponse = z.object({
  version: z.number().int().positive(),
  published_at: z.iso.datetime(),
})
export type PublishConfigResponse = z.infer<typeof publishConfigResponse>

export const configVersionsResponse = z.object({
  versions: z.array(
    z.object({
      version: z.number().int().positive(),
      published_at: z.iso.datetime(),
    }),
  ),
})
export type ConfigVersionsResponse = z.infer<typeof configVersionsResponse>

export const configVersionResponse = z.object({
  version: z.number().int().positive(),
  published_at: z.iso.datetime(),
  doc: robotConfigDoc,
})
export type ConfigVersionResponse = z.infer<typeof configVersionResponse>

/**
 * The cached ROS graph. It survives the bridge going offline on purpose —
 * a developer keeps configuring while the robot is off; `stale` says the
 * bridge is not connected right now, `fetched_at` how old the picture is.
 */
export const introspectionResponse = z.object({
  graph: rosGraph,
  fetched_at: z.iso.datetime(),
  stale: z.boolean(),
})
export type IntrospectionResponse = z.infer<typeof introspectionResponse>

export const typesResponse = z.object({
  types: z.array(typeDefinition),
})
export type TypesResponse = z.infer<typeof typesResponse>

/** Fetch (and store) type definitions for this robot from its bridge. */
export const fetchTypesRequest = z.object({
  type_names: z.array(rosTypeName).min(1).max(50),
})
export type FetchTypesRequest = z.infer<typeof fetchTypesRequest>

export const fetchTypesResponse = z.object({
  types: z.array(typeDefinition),
  unresolved: z.array(z.string()),
})
export type FetchTypesResponse = z.infer<typeof fetchTypesResponse>

/**
 * What a client can read on this robot: the built-ins plus everything the
 * published configuration exposes. This is the seed of the generated
 * per-robot API (§11.2, whose OpenAPI rendering arrives in W4).
 */
export const datapointDescriptor = z.object({
  slug,
  builtin: z.boolean(),
  unit: z.string().nullable(),
  range: datapointRange.nullable(),
  rate: datapointRate.nullable(),
})
export type DatapointDescriptor = z.infer<typeof datapointDescriptor>

export const datapointListResponse = z.object({
  datapoints: z.array(datapointDescriptor),
})
export type DatapointListResponse = z.infer<typeof datapointListResponse>

/**
 * The built-in `robot-details` datapoint (spec §4.3): static properties the
 * developer maintains. Bounded so one robot cannot become a document store.
 */
export const robotDetailsDoc = z.record(
  z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  z.union([z.string().max(4096), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
)
export type RobotDetailsDoc = z.infer<typeof robotDetailsDoc>

export const putRobotDetailsRequest = z.object({ details: robotDetailsDoc })
export type PutRobotDetailsRequest = z.infer<typeof putRobotDetailsRequest>


/* ------------------------------------------------------------------ W4 --
 * The command surface (spec §11.1, §11.3) and what a role may be granted.
 *
 * The routes, written down because cloud, console and SDK each need them and
 * a body schema does not imply a path:
 *
 * | route | body | answers |
 * |---|---|---|
 * | `POST /api/robots/:id/jobs/:slug`        | `invokeRequest` | `invokeResponse` (action) or `serviceCallResponse` (service) |
 * | `GET /api/robots/:id/jobs/:slug`         | —               | `jobResponse` (the current job, or null) |
 * | `POST /api/robots/:id/jobs/:slug/cancel` | —               | `jobResponse` |
 * | `POST /api/robots/:id/publishers/:slug`  | `publishRequest`| 204 |
 * | `GET /api/robots/:id/exposures`          | —               | `exposureListResponse` |
 *
 * **Commands are addressed by slug, never by kind.** Slugs are one namespace
 * across all kinds (§4.1) and a role grant is `{robot, slug}` with no kind in
 * it — so a path segment naming the kind would demand a fact the permission
 * model deliberately does not carry. The cloud already knows from the
 * published configuration whether a slug is an action or a service; a caller
 * who wants to know asks `/exposures`.
 *
 * That is also why invoking and calling are the same route: both create the
 * job on that slug. They differ only in what the cloud waits for before it
 * answers — a service call awaits the terminal update and returns the result
 * inline, an action returns as soon as the job exists. Publishing is not a
 * job and so is not under `/jobs`.
 */

/**
 * Invoke an action or call a service; parameters by field path (§4.4).
 *
 * Flat, keyed by `parameterSpec.name` — see `cloudInvoke.params` for why the
 * flat form is the one that makes a refusal legible.
 */
export const invokeRequest = z.object({
  params: z.record(z.string(), z.unknown()),
  /**
   * How long **this call** is worth waiting for, in milliseconds (W6b).
   *
   * **Absent means `DEFAULT_PATIENCE_MS`** — today's behaviour, unchanged, for
   * every caller who does not care. It is optional because most callers have
   * no opinion, and forcing one on them would mean every SDK example carries a
   * number its author guessed.
   *
   * It exists because patience was a **server constant** and could therefore
   * only ever be wrong in one of two directions at a time: long enough for a
   * planner meant a dead service also took that long to report, and short
   * enough for a snappy lookup meant a legitimate slow job was reported as
   * `bridge_timeout` — a healthy robot, described as broken, with nothing the
   * caller could do about it.
   *
   * The number travels with the call to the bridge (`cloudInvoke.patience_ms`)
   * so that **one** deadline governs both sides. Capped at
   * `MAX_PATIENCE_MS`; above that the call is refused with
   * `validation_error` rather than silently clamped, because a caller who
   * asked for ten minutes and was quietly given two would read the timeout as
   * the robot's failure.
   *
   * For a service call this is the whole wait. For an action it bounds goal
   * *acceptance* — once a goal is accepted the job runs as long as it runs,
   * and is observed, not awaited.
   */
  patience_ms: z.number().int().positive().max(MAX_PATIENCE_MS).optional(),
})
export type InvokeRequest = z.infer<typeof invokeRequest>

/**
 * The answer to an invoke. The job id is informative (§11.3): state is
 * observed by slug afterwards, over polling or a subscription.
 */
export const invokeResponse = z.object({
  job,
  /** The slug's kind — see `commandResult.kind` for why the caller needs it. */
  kind: z.enum(['action', 'service']),
})
export type InvokeResponse = z.infer<typeof invokeResponse>

/** A service call answers with its result directly — no job to observe. */
export const serviceCallResponse = z.object({
  result: z.unknown(),
})
export type ServiceCallResponse = z.infer<typeof serviceCallResponse>

export const publishRequest = z.object({
  message: z.record(z.string(), z.unknown()),
})
export type PublishRequest = z.infer<typeof publishRequest>

/**
 * The **most recent** job on a slug — running or already finished — or null
 * only when nothing has ever run there.
 *
 * It said "the job currently running" until W4's review, and that quietly
 * made §11.3's first sentence false. The spec offers two equal ways to
 * observe a slug — *"Polling (REST) oder Subscription (Realtime)"* — but a
 * route that forgets a job the moment it settles lets a poller see only
 * `running`, then `null`. Succeeded, failed, cancelled, `lost` and
 * never-invoked all become the same answer, so §6.1's promise that a lost
 * job is *said out loud* held for subscribers and silently did not hold for
 * anyone polling. It is also the recovery `command_outcome_unknown` points
 * a caller to.
 *
 * Read `job.state` to tell a live job from a finished one; that is what the
 * field is for.
 */
export const jobResponse = z.object({ job: job.nullable() })
export type JobResponse = z.infer<typeof jobResponse>

/**
 * Every slug of a robot that a role can be granted, **with its kind**.
 *
 * The roles matrix was built in W3 against the datapoint list, which was the
 * only kind that existed. With four kinds it needs one list that names them,
 * or the matrix silently cannot grant an action.
 */
export const exposure = z.object({
  slug,
  kind: z.enum(['datapoint', 'action', 'service', 'publisher', 'camera']),
  builtin: z.boolean(),
})
export type Exposure = z.infer<typeof exposure>

export const exposureListResponse = z.object({
  exposures: z.array(exposure),
})
export type ExposureListResponse = z.infer<typeof exposureListResponse>

/* ------------------------------------------------------------------ W5 --
 * Cameras (spec §10). Routes, written down as the W4 command routes are:
 *
 * | route | answers |
 * |---|---|
 * | `GET /api/robots/:id/cameras`                    | `cameraListResponse` |
 * | `GET /api/robots/:id/cameras/:slug/snapshot`     | the image bytes, plus the headers below |
 * | `GET /api/robots/:id/cameras/:slug/snapshot/meta`| `snapshotMetaResponse` — age without the bytes |
 * | `POST /api/robots/:id/cameras/:slug/live`        | `liveSessionResponse` — takes a refcount hold |
 * | `DELETE /api/robots/:id/cameras/:slug/live`      | 204 — releases this viewer's hold |
 */

/**
 * The response headers a binary snapshot carries, named here so the cloud and
 * every client agree without negotiating:
 *
 * - `Content-Type`      — the image's mime, standard rather than invented.
 * - `X-Fleetless-Age-Ms`      — how old the frame is, **computed by the cloud**.
 * - `X-Fleetless-Timestamp-Ms`— the bridge's capture time.
 * - `X-Fleetless-Width` / `X-Fleetless-Height`.
 *
 * A client must take `age_ms` from the header and **never** recompute it as
 * `Date.now() - timestamp_ms`: the cloud is the one clock that knows how long
 * it has actually been holding the frame, and recomputing reintroduces the
 * viewer's clock skew as a source of lying about freshness.
 */
export const SNAPSHOT_HEADERS = {
  ageMs: 'x-fleetless-age-ms',
  timestampMs: 'x-fleetless-timestamp-ms',
  width: 'x-fleetless-width',
  height: 'x-fleetless-height',
} as const

export const cameraDescriptor = z.object({
  slug,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  snapshot_interval_ms: z.number().int().positive(),
})
export type CameraDescriptor = z.infer<typeof cameraDescriptor>

export const cameraListResponse = z.object({ cameras: z.array(cameraDescriptor) })
export type CameraListResponse = z.infer<typeof cameraListResponse>

/**
 * What a viewer needs to join, and **what it costs them to hold**.
 *
 * `POST` takes a refcount hold and `DELETE` releases it; the first hold
 * starts the robot publishing and the last release stops it (§10). A client
 * that forgets to release keeps a robot streaming to nobody, so the SDK hands
 * back a `release()` rather than a bare token.
 *
 * **`expires_at` is a join deadline, not a session backstop.** A LiveKit
 * token is checked when a participant connects and not again afterwards, so a
 * viewer who has already joined keeps receiving video straight past this
 * moment. Do not design cleanup around it. What actually ends a session is
 * `release()` together with disconnecting the room, the cloud reconciling the
 * hold away against LiveKit's real participants, or a revocation kicking the
 * participant out. This comment previously claimed the opposite and the SDK
 * inherited the claim from here — a developer reading it would reasonably
 * have skipped cleanup on purpose.
 */
export const liveSessionResponse = z.object({
  /**
   * This viewer's hold, and the **only** thing `DELETE` should be given
   * (W6b).
   *
   * A hold was addressed by `{identity, robot, slug}` and nothing else, so
   * two tabs of one logged-in user were one hold as far as the refcount could
   * see. Closing either tab released it: the second tab kept its LiveKit
   * connection — the token is checked at join and never again — and went on
   * rendering a video that the robot had already stopped producing. The
   * viewer sees a frozen picture, not an ended session, which is the failure
   * this project rejects everywhere else.
   *
   * `DELETE` without a session id keeps today's meaning — *release my holds
   * on this camera* — because an SDK that has lost its id, or a client that
   * is going away entirely, still needs a way to let go. It is the blunt
   * form, and it is the one that strands other tabs; new callers pass the id.
   */
  session_id: z.uuid(),
  url: z.string().min(1),
  room: z.string().min(1),
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
})
export type LiveSessionResponse = z.infer<typeof liveSessionResponse>

/**
 * The snapshot read **without the bytes**.
 *
 * A viewer polling at the camera's interval otherwise re-downloads a whole
 * image to discover whether a new one exists. This is the cheap question —
 * *how old is what you have?* — so a client can fetch pixels only when the
 * timestamp actually moved. It matters most on the console's snapshot view,
 * which polls continuously while a tab is open.
 *
 * `age_ms` is not a convenience: a cached frame served without its age is
 * indistinguishable from a live one, and §10 makes snapshots deliberately
 * cheap and therefore deliberately old. `null` values mean nothing has been
 * captured yet — which is an answer, not an error.
 */
export const snapshotMetaResponse = z.object({
  slug,
  timestamp_ms: z.number().int().nonnegative().nullable(),
  age_ms: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mime: z.string().nullable(),
})
export type SnapshotMetaResponse = z.infer<typeof snapshotMetaResponse>

// ---------------------------------------------------------------------------
// W6 — retention, history and org quotas (§8, §12.4)
// ---------------------------------------------------------------------------

/**
 * A history query (§8). `from`/`to` accept **either** a relative expression
 * (`now-30s`, `now-5m`, `now-1h`) **or** absolute unix milliseconds, because
 * a chart asks the first way and a report asks the second, and making a
 * client convert is making it guess our clock.
 *
 * `window` without `agg` is meaningless and `agg` without `window` is
 * ambiguous — both are refused rather than assigned a default, since a
 * silently chosen aggregation is a chart that lies quietly.
 */
export const historyQuery = z.object({
  from: z.string().min(1).max(32),
  /** Defaults to now. */
  to: z.string().min(1).max(32).optional(),
  /** Bucket width, e.g. `10s`, `1m`. Absent means raw samples. */
  window: z.string().min(2).max(16).optional(),
  agg: z.enum(['min', 'max', 'avg']).optional(),
  /** A numeric field inside an object value, e.g. `pose.x` (§4.4 paths). */
  field: z.string().min(1).max(128).optional(),
  /**
   * `z.coerce` because this schema describes a **query string**, where every
   * value arrives as text. A bare `z.number()` would make each route coerce
   * `limit` by hand before parsing — Nimbus had to, and flagged that the next
   * query-taking route would have to as well. A schema that does not match
   * the wire it describes exports its problem to every consumer.
   */
  limit: z.coerce.number().int().positive().max(10_000).optional(),
})
export type HistoryQuery = z.infer<typeof historyQuery>

/**
 * Raw samples. `timestamp_ms` is the **bridge's capture time** (§6.3) — the
 * same instant the live value carried, so a recorded point and a live one can
 * be placed on one axis without apology.
 *
 * `truncated` says the response was cut short. A short array that does not
 * admit it is indistinguishable from a quiet period, and the two lead a
 * developer to opposite conclusions.
 */
export const historySamplesResponse = z.object({
  slug,
  kind: z.literal('samples'),
  samples: z.array(z.object({ timestamp_ms: z.number().int().nonnegative(), value: z.unknown() })),
  truncated: z.boolean(),
  /**
   * Why it was cut, `null` when it was not — because the two causes have
   * **different remedies** and a single boolean cannot tell them apart:
   *
   *   `'limit'`  too many rows. Raise `limit` (up to 10 000).
   *   `'bytes'`  the rows are large. Raising `limit` will not help — narrow
   *              the range, or name a numeric `field` so whole messages are
   *              not carried.
   *
   * A caller cannot derive this: comparing `samples.length` against `limit`
   * only works if they sent one, and the server's default is not in the
   * response. So without this field, "raise the limit" is the natural next
   * move in both cases, and in the second it changes nothing.
   *
   * Nullable rather than optional on purpose: `.default()` publishes as
   * `required` in the JSON Schema artifacts, which is the contradiction this
   * project has now hit five times.
   */
  truncated_by: z.enum(['limit', 'bytes']).nullable(),
})
export type HistorySamplesResponse = z.infer<typeof historySamplesResponse>

/**
 * Aggregated buckets — a **separate shape**, not the samples shape with nulls
 * in it, so a client knows by type what it received rather than by
 * inspection.
 *
 * `sample_count` exists because an empty bucket and a bucket whose average is
 * zero are different facts. W5 established at some cost what happens when two
 * facts share one representation, and a chart is the easiest place in this
 * product to draw a gap as a line.
 */
export const historyBucketsResponse = z.object({
  slug,
  kind: z.literal('buckets'),
  window_ms: z.number().int().positive(),
  agg: z.enum(['min', 'max', 'avg']),
  buckets: z.array(
    z.object({
      bucket_start_ms: z.number().int().nonnegative(),
      /**
       * The aggregate over this bucket's **numeric** samples — or `null` when
       * none of them were numeric, which is **not** the same as the bucket
       * being empty. `sample_count` is the field that separates those facts:
       *
       *     value: null,  sample_count: 0    nothing was recorded — a gap
       *     value: null,  sample_count: 3    three samples, none of them numeric
       *     value: 0,     sample_count: 3    three samples, and the average is zero
       *
       * A chart must draw the first as a break in the line and must **not**
       * draw the second as one: data exists there, it simply has no height.
       *
       * This sentence previously read "`null` only ever means 'no samples in
       * this bucket'", and the implementation counted numeric contributors,
       * so the second row above was indistinguishable from the first and the
       * console rendered "empty — no samples" over live data.
       */
      value: z.number().nullable(),
      /**
       * Every sample that landed in this bucket and inside the queried range,
       * whether or not it contributed to `value` — which is the point of the
       * field, since only a count of *all* samples can prove a bucket empty
       * rather than merely unplottable.
       *
       * Two consequences, stated rather than left to be discovered:
       *
       * - `value` is not an average *of* `sample_count` samples when a
       *   datapoint's values are mixed, so **`value * sample_count` is not a
       *   sum**.
       * - On a first or last bucket the count reflects the **range**, not the
       *   bucket: an edge bucket can begin before `from` or extend past `to`,
       *   and only in-range samples are counted. A low edge count is a
       *   boundary effect, not a quiet period.
       */
      sample_count: z.number().int().nonnegative(),
    }),
  ),
})
export type HistoryBucketsResponse = z.infer<typeof historyBucketsResponse>

/**
 * W6a — deletion, and the one channel that reports health.
 *
 * | Route | Body | Answer |
 * |---|---|---|
 * | `DELETE /api/robots/:id` | — | `204`. `?force=true` to proceed while a live session is open; without it, `409 robot_in_use` |
 * | `GET /api/robots/:id/deletion-preview` | — | `robotDeletionSummary` — the same shape the audit event carries |
 * | `GET /api/org/health` | — | `resourceHealthListResponse`; `?robot_id=` narrows it to one robot |
 *
 * Plus `resourceHealthEvent`, pushed on the **developer** realtime socket
 * and scoped to the org — not to a subscription, because its job is to reach
 * somebody who is *not* looking at the thing that broke.
 *
 * Two of these paths are worth stating rather than inferring:
 *
 * **The preview exists because a confirmation must be able to name what it
 * destroys.** `DELETE` answers `204` with no body, so the counts only ever
 * appear on the audit event — written *after* the irreversible click. A
 * dialog built on that can say nothing better than "are you sure?". The
 * preview returns the *same shape* as the audit record on purpose: the
 * warning and the receipt then agree by construction, and a disagreement
 * between them is a real finding rather than two estimates drifting.
 *
 * **The snapshot and the event share the org's scope**, and the snapshot
 * takes an optional `robot_id` filter rather than living at a per-robot
 * path.
 *
 * The first version of this table said the opposite, with a justification
 * that sounded right and was incomplete: it reasoned only from a page that
 * has just opened one robot. But the console shows health on the **robot
 * list** too, and a per-robot path makes that N requests to render one
 * screen — while the event that must keep it fresh arrives org-wide anyway.
 * A snapshot and a channel that disagree about scope are not two halves of
 * one thing; they are two things that have to be reconciled by every
 * consumer, separately, forever.
 *
 * So: same scope, one route, and `?robot_id=` for the narrow question. The
 * cloud owner proposed this while unblocking the console, and was right.
 *
 * This table was missing from the first W6a delta, and a teammate had to ask
 * three separate people for the paths — which is how a route becomes a fact
 * that lives only in an inbox.
 */

/**
 * What a `robot.deleted` audit event carries (W6a).
 *
 * A deletion record that says only *that* something was destroyed is a
 * receipt for an unknown amount. This names it: how many configured slugs,
 * how many stored samples, how many bytes that freed against the retention
 * quota, which cameras existed, and whether somebody was watching at the
 * time. Those are the questions asked afterwards, and afterwards is the one
 * moment the data cannot be consulted.
 */
export const robotDeletionSummary = z.object({
  /**
   * Datapoints, actions, services and publishers in the **published**
   * configuration — what the robot was actually running. **Cameras are not
   * counted here**; they are the `cameras` array below.
   *
   * The split has to be stated because the summary carries both, and the
   * console renders them in one sentence: *"this deletes N published slugs …
   * and M cameras"*. With cameras inside `slug_count` that sentence counts
   * them twice, on the one screen whose whole justification is naming what an
   * irreversible click destroys (Momus, W6a review — the cloud summed all
   * five and the console then added the cameras again).
   *
   * A draft is destroyed too and is described by `had_unpublished_draft`
   * rather than by either of these: describing three things with two numbers
   * would make each of them mean something else.
   */
  slug_count: z.number().int().nonnegative(),
  sample_rows: z.number().int().nonnegative(),
  bytes_freed: z.number().int().nonnegative(),
  cameras: z.array(slug),
  had_live_session: z.boolean(),
  /**
   * Whether an unpublished draft went with it — separately, because the
   * counts above deliberately do not include it and a record that silently
   * omitted the draft would be a receipt for less than was destroyed.
   *
   * `true` also covers the robot that was configured but never published:
   * there the counts are zero and this is the only field saying anything
   * was there at all.
   */
  had_unpublished_draft: z.boolean(),
})
export type RobotDeletionSummary = z.infer<typeof robotDeletionSummary>

/**
 * The seven health states, declared **once** (W6a review).
 *
 * `resourceHealthState` and `resourceHealthEvent` are the snapshot and the
 * push of the same thing, and they had the same seven values written out
 * twice, linked by nothing — the artifacts published two independent copies
 * with no `$ref`. They agreed only because whoever added `unknown` remembered
 * to add it in both places, on the wave's last contract commit.
 *
 * One concept rendering as two artifacts that nothing keeps in step is its
 * own class of artifact-versus-source defect, distinct from `.default()`
 * publishing as `required` and from `z.coerce`'s unrepresentable input.
 */
export const RESOURCE_HEALTH_STATES = [
  'ok',
  /** The host did not answer. Not the same as refusing the password. */
  'unreachable',
  /** The host answered and rejected the credentials. */
  'auth_failed',
  /** The stored password cannot be decrypted — see `credentialSummary.readable`. */
  'unreadable_credential',
  /**
   * A camera names a credential that **does not exist** in this org — deleted,
   * mistyped, or belonging to somebody else (W6a review).
   *
   * Separate from `unreadable_credential` because that one asserts a
   * decryption that was attempted and failed, and here nothing was ever
   * encrypted: the developer is sent to a page where the credential is not
   * listed at all, to rotate something that is not there. And separate from
   * `unknown`, which means "the robot reported a failure we cannot classify"
   * — a different fact with a different fix.
   *
   * It is reachable by a typo: `cloud-config-frame.ts` deliberately tolerates
   * an unresolved `credentials_ref` at publish time, so this is an ordinary
   * developer mistake rather than an edge case.
   */
  'credential_missing',
  /** A configuration change stopped this stream, deliberately. */
  'stopped_by_config_change',
  /** Publishing failed after the session was already granted. */
  'publish_failed',
  /**
   * Something is wrong and this platform cannot say what.
   *
   * The alternative was worse. A bridge error code the mapping table does not
   * know had two possible fallbacks: report `ok`, which hides a real failure,
   * or fold it into `unreachable`, which **asserts a cause nobody
   * established** — sending a developer to check a network when the problem
   * may be a password. The map falls back here and logs the unmapped code
   * loudly, so the gap in the table is visible instead of confident.
   */
  'unknown',
] as const

/**
 * The health of one thing a developer configured, as the platform currently
 * sees it (W6a).
 *
 * This exists because four separate findings turned out to be one absence:
 * nothing carried the state of a camera, a source or a credential to a
 * developer who was not, at that exact moment, pressing a button. A publish
 * failure after the `201` never reached the viewer holding the token; a
 * source whose password was wrong failed at config-apply time with nobody
 * watching and stayed silent until someone pressed "Go live" days later; a
 * viewer could not learn *why* a stream ended, so the console had to offer
 * two possibilities and rank neither; and an undecryptable credential
 * reported as healthy.
 *
 * One shape, because four patches against four symptoms is how W5 nearly
 * wrote a failure report into `publishState` — a field the cloud writes and
 * reads in exactly one place, which would have been a dead end.
 *
 * `reason` is for a human and is **never** built from an exception message:
 * W6 found a camera password in a log through `log.exception`, and again in
 * `LiveStartError`'s message, which travels to the cloud on this very path.
 * Type names and fixed strings only.
 */
export const resourceHealthState = z.object({
  robot_id: z.uuid(),
  kind: z.enum(['camera', 'credential']),
  /** The camera slug, or the credential name. */
  ref: z.string().min(1).max(64),
  state: z.enum(RESOURCE_HEALTH_STATES),
  /** A short human-readable reason, or `null`. Never an exception message. */
  reason: z.string().max(200).nullable(),
  /**
   * When this state was entered — not when it was sent. A page that loads
   * late must be able to tell a failure from a minute ago from one from
   * yesterday, and a state with only a send time cannot.
   */
  changed_at_ms: z.number().int().nonnegative(),
})
export type ResourceHealthState = z.infer<typeof resourceHealthState>

/**
 * The current state of everything in the **org**.
 *
 * This doc said "on one robot" until the W6a review found it: the route moved
 * to org scope in `2bb67c5` and the route table forty lines above spends a
 * paragraph explaining why the per-robot reading was wrong — while the schema
 * it describes still said the old thing. Cloud, console and SDK all implement
 * org-wide correctly; contracts was the only place still saying otherwise,
 * and it is the first place a fourth consumer reads.
 *
 * A channel with no snapshot cannot answer "what is the state now?" for a
 * page that just loaded — it can only report the next change, which may be
 * hours away. Both halves or neither.
 */
export const resourceHealthListResponse = z.object({
  resources: z.array(resourceHealthState),
})
export type ResourceHealthListResponse = z.infer<typeof resourceHealthListResponse>

/**
 * Org protection quotas (§12.4) — generous, server-side adjustable, visible
 * in Settings. Protection against runaway use, not a business model; a later
 * one docks onto the same dials.
 */
export const orgQuotas = z.object({
  max_robots: z.number().int().positive(),
  max_apps: z.number().int().positive(),
  max_end_users: z.number().int().positive(),
  max_retention_bytes: z.number().int().nonnegative(),
  max_retention_writes_per_minute: z.number().int().nonnegative(),
  max_realtime_connections: z.number().int().positive(),
})
export type OrgQuotas = z.infer<typeof orgQuotas>

/**
 * What an org is **actually using**, per quota.
 *
 * A separate shape rather than `orgQuotas.partial()`, which is what this was
 * first — and that was wrong in a way its own tests caught: a limit is
 * `positive()` because a quota of zero would forbid everything, but a
 * **usage** of zero is the honest answer for every org on the day it signs
 * up. Reusing one schema for a limit and a measurement is the same mistake as
 * letting an empty bucket and a zero average share a representation, which
 * this wave spent a lot of care avoiding one layer up.
 *
 * Every field is optional because a quota we do not measure must be
 * **absent**, never reported as `0` — "not measured" and "measured as zero"
 * are different facts, and a dashboard that renders the first as the second
 * is lying quietly.
 */
export const orgQuotaUsageCounts = z.object({
  max_robots: z.number().int().nonnegative(),
  max_apps: z.number().int().nonnegative(),
  max_end_users: z.number().int().nonnegative(),
  max_retention_bytes: z.number().int().nonnegative(),
  max_retention_writes_per_minute: z.number().int().nonnegative(),
  max_realtime_connections: z.number().int().nonnegative(),
}).partial()
export type OrgQuotaUsageCounts = z.infer<typeof orgQuotaUsageCounts>

/** Limits beside what is actually used — a limit alone tells nobody where they stand. */
export const orgQuotaUsage = z.object({ quotas: orgQuotas, usage: orgQuotaUsageCounts })
export type OrgQuotaUsage = z.infer<typeof orgQuotaUsage>

/**
 * A named credential as the API is willing to describe it (§10, W6).
 *
 * **There is no password field here, and there is no route that returns one.**
 * A secret you can read back is not a secret; `set` and `username` are enough
 * to manage a credential and not enough to be a leak.
 *
 * `used_by` is what makes sharing safe: one site account typically serves many
 * cameras across several robots, and rotating it blind is how one of them
 * silently stops working. Deleting a credential still named by a camera is
 * refused for the same reason.
 */
export const credentialSummary = z.object({
  name: z.string().min(1).max(64),
  username: z.string().nullable(),
  /**
   * Whether a password has ever been stored for this name.
   *
   * **Always `true` today**, and stated so rather than left to be inferred:
   * `credentialWriteRequest` requires a non-empty password, so no row can
   * exist without one, and both write paths set this literally. A consumer
   * branching on `set === false` is writing dead code — the SDK README
   * currently teaches exactly that (Momus, W6a review).
   *
   * The field is kept because the fact it names is the one `readable`
   * qualifies, and because a username-only credential is a plausible future
   * shape. If that never arrives, this should be removed rather than left as
   * a permanent constant wearing the costume of a question.
   */
  set: z.boolean(),
  /**
   * Whether that password can still be **decrypted** — a different fact from
   * `set`, and deliberately a second field rather than a tri-state on the
   * first (W6a).
   *
   * They come apart when `CAMERA_CREDENTIALS_KEY` is rotated, unset or wrong,
   * or when a row is corrupt. W6 made that survivable: one unreadable
   * credential costs the cameras that reference it instead of taking the
   * robot offline. But the surviving failure was **invisible** — this route
   * answered `set: true` with `used_by` naming the dependent camera, for a
   * credential that ships as `credentials: {}` on every config frame, and the
   * only evidence was a server log no developer can read.
   *
   * `set: true, readable: false` is therefore the shape that says "a password
   * is stored and this platform can no longer use it" — which is a thing to
   * act on, and nothing else in the API could say it.
   */
  readable: z.boolean(),
  used_by: z.array(z.object({ robot_id: z.uuid(), slug })),
})
export type CredentialSummary = z.infer<typeof credentialSummary>

export const credentialListResponse = z.object({ credentials: z.array(credentialSummary) })
export type CredentialListResponse = z.infer<typeof credentialListResponse>

/** Write-only. The only shape that carries a password anywhere in the REST API. */
export const credentialWriteRequest = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
})
export type CredentialWriteRequest = z.infer<typeof credentialWriteRequest>
