import { z } from 'zod'
import { bridgeState } from './protocol.js'
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
 * `truncated` says the limit was hit. A short array that does not admit it is
 * indistinguishable from a quiet period, and the two lead a developer to
 * opposite conclusions.
 */
export const historySamplesResponse = z.object({
  slug,
  kind: z.literal('samples'),
  samples: z.array(z.object({ timestamp_ms: z.number().int().nonnegative(), value: z.unknown() })),
  truncated: z.boolean(),
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
      /** `null` only ever means "no samples in this bucket". */
      value: z.number().nullable(),
      sample_count: z.number().int().nonnegative(),
    }),
  ),
})
export type HistoryBucketsResponse = z.infer<typeof historyBucketsResponse>

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

/** Limits beside what is actually used — a limit alone tells nobody where they stand. */
export const orgQuotaUsage = z.object({ quotas: orgQuotas, usage: orgQuotas.partial() })
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
  set: z.boolean(),
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
