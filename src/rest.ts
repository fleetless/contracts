// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { bridgeState, MAX_PATIENCE_MS, MIN_PATIENCE_MS } from './protocol.js'
import { slug, rosTypeName, wireTimestampMs } from './common.js'
import { configState, rateThrottleHz, robotConfigDoc, snapshotIntervalSeconds, validationIssue } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { job } from './jobs.js'

/**
 * REST shapes of the robot resource: create, list, get, and the built-in
 * `bridge_state` datapoint read.
 */

export const robot = z.object({
  id: z.uuid().meta({
    description: 'The robot, and what every robot-scoped route takes as its `:id`.',
  }),
  name: z.string().min(1).max(63).meta({
    description: 'The robot\'s display name, at most 63 characters. Free text, changed through `PATCH /api/robots/:id`.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the robot was created, as an ISO 8601 timestamp.',
  }),
})
export type Robot = z.infer<typeof robot>

/** What `PATCH /api/robots/:id` answers: the robot as it now stands. */
export const patchRobotResponse = z.object({
  robot: robot.meta({
    description: 'The robot as it now stands, after the patch. The whole resource comes back, not only the changed fields.',
  }),
})
export type PatchRobotResponse = z.infer<typeof patchRobotResponse>

export const createRobotRequest = z.object({
  name: z.string().min(1).max(63),
})
export type CreateRobotRequest = z.infer<typeof createRobotRequest>

/**
 * The robot token binds one bridge to one robot. It is returned exactly once,
 * here; the cloud stores only a hash of it.
 */
export const robotToken = z.string().regex(/^frt_[0-9a-f]{32}$/)

export const createRobotResponse = z.object({
  robot,
  token: robotToken,
})
export type CreateRobotResponse = z.infer<typeof createRobotResponse>

/**
 * What a rotation hands back: the new token, once.
 *
 * The same shape as the creation response minus the robot, because nothing
 * about the robot changed — only its credential. `createRobotResponse`'s own
 * rule applies unchanged: the cloud stores a hash, so this is the only moment
 * the raw token exists outside the caller's hands.
 */
export const robotTokenRotateResponse = z.object({
  token: robotToken.meta({
    description: 'The robot\'s new bridge token. Returned exactly once; the previous token stops working at the bridge\'s next hello.',
  }),
})
export type RobotTokenRotateResponse = z.infer<typeof robotTokenRotateResponse>

/**
 * Which datapoint drives the joints of this robot's URDF, or none.
 *
 * `null` is the clearing value, which is why `slug` is required rather than
 * optional: an absent field and a cleared mapping would be the same request
 * and mean different things, and the one a client sends by accident is the
 * first.
 *
 * The cloud refuses a slug that is not a whole-message
 * `sensor_msgs/msg/JointState` datapoint of the **published** document — a
 * mapping that may point anywhere is a viewer animating a battery reading.
 */
export const jointStatePutRequest = z.object({
  slug: slug.nullable().meta({
    description: 'The datapoint to read joint positions from, or `null` to choose none. It must name a whole-message `sensor_msgs/msg/JointState` datapoint of the published configuration; anything else is a `validation_error` naming the rule.',
  }),
})
export type JointStatePutRequest = z.infer<typeof jointStatePutRequest>

/** The mapping as it now stands — the same field `GET /api/robots/:id/assets` reports. */
export const jointStatePutResponse = z.object({
  joint_state_slug: slug.nullable().meta({
    description: 'The stored mapping after the call, `null` when none is chosen. The same value `assetListResponse.joint_state_slug` carries.',
  }),
})
export type JointStatePutResponse = z.infer<typeof jointStatePutResponse>

/**
 * How many things a robot exposes, per kind.
 *
 * **Five numbers, never a sum.** `robotDeletionSummary.slug_count` makes the
 * same call for the same reason: fold cameras in and the sentence "this deletes
 * N slugs and M cameras" counts them twice. A list row has the same problem.
 *
 * **Counted from the published configuration, and excluding the built-ins.**
 * `GET /api/robots/:id/exposures` answers *which* slugs and prepends the
 * built-in datapoints — `bridge_state` and `robot_details` — as
 * `builtin: true`; this answers *how many* and counts only what somebody
 * configured. So a robot with an empty published config reports
 * `datapoints: 0` here and two entries there. That is intentional, and it is
 * written on both sides so the disagreement is never mistaken for a bug.
 *
 * The number was "three" while `bridge_pressure` existed and is "two" since
 * protocol 3 dropped it; the cloud builds that prefix from its own built-in
 * set rather than a literal, so the next built-in moves this count again.
 * Read the count off that set, not off this sentence, before filing the bug
 * this comment exists to prevent.
 */
export const exposureCounts = z.object({
  datapoints: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  services: z.number().int().nonnegative(),
  publishers: z.number().int().nonnegative(),
  cameras: z.number().int().nonnegative(),
})
export type ExposureCounts = z.infer<typeof exposureCounts>

/**
 * Where a robot's bridge stands against the protocol window.
 * `refused`: its last hello was refused for its version — it is offline
 * until upgraded. Computed by the cloud from `protocol_version` and
 * `last_hello_error`, never stored.
 */
export const protocolStatusValue = z.enum(['current', 'deprecated', 'refused'])
export type ProtocolStatusValue = z.infer<typeof protocolStatusValue>

/** A robot as listed, with its current built-in `bridge_state`. */
export const robotListItem = z.object({
  ...robot.shape,
  bridge_state: bridgeState,
  /** Required, not optional: "we did not look" and "it exposes nothing" must not render the same. */
  exposes: exposureCounts,
  protocol_status: protocolStatusValue.optional().meta({
    description:
      'Where this robot\'s bridge stands against the protocol window: `current`, `deprecated` (still served, sunset date on the detail), or `refused` (its last hello was refused for its version; offline until upgraded). Absent from a cloud older than 0.21.0; read absence as `current`.',
  }),
})
export type RobotListItem = z.infer<typeof robotListItem>

export const robotListResponse = z.object({
  robots: z.array(robotListItem),
})
export type RobotListResponse = z.infer<typeof robotListResponse>

/**
 * The REST read of one datapoint. For bridge-captured data `timestamp_ms`
 * is the capture time at the bridge; for the cloud-observed
 * built-in `bridge_state` it is the time the cloud observed the state.
 */
export const datapointValue = z.object({
  slug: slug.meta({ description: 'The datapoint this value belongs to.' }),
  value: z.unknown().meta({
    description: 'The value, shaped by the datapoint: a number, a boolean, a string, or the whole ROS message where the configuration names no field inside it. Any `scale` and `offset` the configuration declares have already been applied, at the robot.',
  }),
  timestamp_ms: z.number().int().nonnegative().meta({
    description: 'When the value was captured, as a unix timestamp in milliseconds. The **bridge\'s capture time**, never the time the cloud received it — the one exception is the built-in `bridge_state`, which the cloud observes by construction.',
  }),
})
export type DatapointValue = z.infer<typeof datapointValue>

/* ------------------------------------------------------------------------
 * Exposure: the configuration resource, introspection, types, and the
 * datapoint surface generated from the published configuration.
 */

/**
 * One robot in full: what the list shows, plus what only the detail view
 * needs — which bridge build is connected, why the last hello was refused,
 * and where the configuration stands.
 */
export const robotDetailResponse = z.object({
  ...robotListItem.shape,
  bridge_version: z.string().min(1).nullable(),
  protocol_version: z.number().int().positive().nullable().optional().meta({
    description:
      'The protocol version the bridge announced in its last accepted hello; `null` before the first. Absent from a cloud older than 0.21.0.',
  }),
  protocol: z
    .object({
      status: protocolStatusValue.meta({ description: 'Same values as `protocol_status`.' }),
      sunset_at: z.iso.date().nullable().meta({
        description: 'ISO date the announced version stops being served; `null` when current or unknown.',
      }),
    })
    .optional()
    .meta({ description: 'The window verdict for `protocol_version`.' }),
  /**
   * Cleared (set back to null) by the next successful hello from this
   * robot's bridge — a warning that outlives the condition it warns
   * about would be read as current state, and was.
   */
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
 *
 * **`source` is the author's text and `doc` is what it parses to.** Both are
 * sent because they answer different questions: an editor renders the text a
 * developer wrote, comments and key order intact, while every other consumer —
 * the robot page, the MCP tools, the bridge frame — reads the parsed document
 * and should never have to parse YAML to do it.
 *
 * **`doc` is null when the text is valid YAML but not a fleetless document.**
 * A draft is saved whenever it parses as YAML; publish is the gate that asks
 * for a document. So a stored draft can genuinely have no document, and `null`
 * says exactly that: *this text does not currently parse to a configuration*.
 * It does **not** mean "nothing is configured" — the last published version is
 * untouched — and a reader that renders a tree from `doc` has to tell those two
 * apart before it draws anything.
 *
 * The alternative was to put the raw parsed YAML value in `doc`. It was
 * rejected because a reader could then no longer tell whether what it holds is
 * a document: every consumer would have to re-validate to find out, and the one
 * that forgot would render a stranger's mapping as a configuration. `null`
 * forces the question at the point of reading.
 *
 * `source` is never null, and that is what makes the pair `doc: null,
 * source: null` unrepresentable here rather than merely discouraged. A draft
 * exists from the moment a robot does, before anyone has typed anything; for
 * that one the server renders the document instead, so a reader always has text
 * to show and — when there is no document — always has the text that failed to
 * become one.
 */
export const configDraftResponse = z.object({
  doc: robotConfigDoc.nullable(),
  source: z.string(),
  updated_at: z.iso.datetime().nullable(),
  issues: z.array(validationIssue),
})
export type ConfigDraftResponse = z.infer<typeof configDraftResponse>

/**
 * A write carries the **text only**, and that is the point.
 *
 * If it carried both the text and the parsed document, the two could
 * disagree. Sending only the source makes that unrepresentable on the wire:
 * the server parses it, and there is exactly one account of what the
 * configuration says.
 *
 * It also settles who owns parsing. The **server** refuses text that is not
 * valid YAML, with the line and column, and stores everything else — including
 * valid YAML that is not a fleetless document, which comes back with
 * `doc: null` and its issues. An editor may check as you type so the answer is
 * immediate; the server checks because it is the one that decides. Two checks
 * of one question, and the server's is the one that binds.
 *
 * A stored source that does not parse to a document is therefore a
 * **represented state**, not an error: no document at all. See
 * `configDraftResponse` above.
 */
export const putConfigDraftRequest = z.object({ source: z.string().max(1_000_000) })
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

/**
 * One published version, with the text it was published from.
 *
 * The text is what makes a version diff readable and a restore honest: a
 * restore that returned only the document would hand back a configuration
 * stripped of every comment the author wrote, which is the loss this format
 * exists to prevent.
 */
export const configVersionResponse = z.object({
  version: z.number().int().positive(),
  published_at: z.iso.datetime(),
  doc: robotConfigDoc,
  source: z.string(),
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
 * per-robot API.
 *
 * **The OpenAPI rendering is `artifacts/openapi.json`**, derived from the
 * route manifest in `routes.ts` and these schemas by
 * `scripts/export-schemas.ts`.
 */
export const datapointDescriptor = z.object({
  slug: slug.meta({ description: 'The name a client reads this datapoint by.' }),
  builtin: z.boolean().meta({
    description: '`true` for the datapoints every robot has — `bridge_state` and `robot_details` — and `false` for everything the published configuration adds.',
  }),
  unit: z.string().nullable().meta({
    description: 'The unit the value carries **after** any scale and offset, shown beside the number so nobody has to guess whether `15` means percent, volts or minutes. `null` when the configuration names none.',
  }),
  /**
   * `null` for a built-in and for a datapoint published with no throttle —
   * the same "no ceiling configured" fact `datapointConfig.rate_throttle_hz`
   * itself carries as `0` or absence, just re-spelled nullable rather than
   * optional because this shape is a read response, not a document a caller
   * writes. Reuses `rateThrottleHz` so the 20 Hz ceiling is written once.
   */
  rate_throttle_hz: rateThrottleHz.nullable().meta({
    description: 'The ceiling on how often this datapoint is sent, in hertz. `null` means no ceiling is configured, which is also the answer for every built-in. A ceiling, not a clock: a slow topic stays slow and no value is repeated to manufacture a rate.',
  }),
})
export type DatapointDescriptor = z.infer<typeof datapointDescriptor>

export const datapointListResponse = z.object({
  datapoints: z.array(datapointDescriptor).meta({
    description: 'Everything a client may read on this robot: the two built-ins, plus every datapoint the published configuration exposes and the caller\'s role grants.',
  }),
})
export type DatapointListResponse = z.infer<typeof datapointListResponse>

/**
 * The built-in `robot_details` datapoint: static properties the developer
 * maintains. Bounded so one robot cannot become a document store.
 */
export const robotDetailsDoc = z.record(
  z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  z.union([z.string().max(4096), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
)
export type RobotDetailsDoc = z.infer<typeof robotDetailsDoc>

/** What `PUT /api/robots/:id/details` answers: the stored document, which is the one that was sent. */
export const putRobotDetailsResponse = z.object({
  details: robotDetailsDoc.meta({
    description: 'The stored `robot_details` document, which is the one that was just sent — this route **replaces** the document rather than merging into it. Keys are the developer\'s own, lowercase and at most 64 characters; a value is a string of at most 4096 characters, a number, a boolean, an array or an object.',
  }),
})
export type PutRobotDetailsResponse = z.infer<typeof putRobotDetailsResponse>

export const putRobotDetailsRequest = z.object({ details: robotDetailsDoc })
export type PutRobotDetailsRequest = z.infer<typeof putRobotDetailsRequest>


/* ------------------------------------------------------------------------
 * The command surface, and what a role may be granted.
 *
 * The routes, written down because cloud, console and SDK each need them and
 * a body schema does not imply a path:
 *
 * | route | body | answers |
 * |---|---|---|
 * | `POST /api/robots/:id/jobs/:slug`        | `invokeRequest` | `invokeResponse` (action) or `serviceCallResponse` (service) |
 * | `GET /api/robots/:id/jobs/:slug`         | —               | `jobResponse` (the current job, or null) |
 * | `POST /api/robots/:id/jobs/:slug/cancel` | `cancelRequest` | `jobResponse` |
 * | `POST /api/robots/:id/publishers/:slug`  | `publishRequest`| 204 |
 * | `GET /api/robots/:id/exposures`          | —               | `exposureListResponse` |
 *
 * **Commands are addressed by slug, never by kind.** Slugs are one namespace
 * across all kinds and a role grant is `{robot, slug}` with no kind in
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
 * Invoke an action or call a service; parameters by field path.
 *
 * Flat, keyed by `parameterSpec.name` — see `cloudInvoke.params` for why the
 * flat form is the one that makes a refusal legible.
 */
export const invokeRequest = z.object({
  params: z.record(z.string(), z.unknown()).meta({
    description: 'The values this call needs, keyed by **parameter name** rather than by field path — so a name survives the field moving inside the message. Every parameter without a default must be present, and the bounds the configuration declares are enforced in the cloud, before anything reaches the robot.',
  }),
  /**
   * How long **this call** is worth waiting for, in milliseconds.
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
  patience_ms: z.number().int().min(MIN_PATIENCE_MS).max(MAX_PATIENCE_MS).optional().meta({
    description: 'How long **this call** is worth waiting for, in milliseconds; absent means the platform default. The number travels to the robot too, so one deadline governs both sides. Above the maximum the call is refused rather than quietly clamped, because a caller given less than they asked for would read the timeout as the robot\'s failure.',
  }),
})
export type InvokeRequest = z.infer<typeof invokeRequest>

/**
 * The answer to an invoke. The job id is informative: state is observed by
 * slug afterwards, over polling or a subscription.
 */
/**
 * The body of a cancel. **Every field optional, and the body itself may be
 * absent** — `POST .../cancel` takes no body at all in its simplest form, and
 * a schema that demanded one would break every caller on the one verb that
 * stops a machine.
 *
 * **`.strict()`, and that is the whole point of the shape.** A plain object
 * strips unknown keys, so a caller who *means* to name a job and misspells the
 * field — `jobId` for `job_id` — has their id silently removed and gets the
 * **slug-wide** cancel instead: the most destructive reading of a request they
 * did not make. A `?force=true` flag fails *safe* on a typo, because a
 * misspelled `force` simply does not force. Stripping here fails unsafe, so
 * unknown keys are refused instead.
 *
 * `job_id` absent and `job_id: null` mean the **same** thing here, and that is
 * deliberate: over REST an absent body is how a caller says "cancel whatever is
 * running". On the socket, `clientCancel.job_id` is required-and-nullable
 * instead, because a frame is assembled fresh by a client that knows this
 * contract — there, `null` is a decision and an omission is a bug.
 */
export const cancelRequest = z.object({
  job_id: z.uuid().nullable().optional().meta({
    description: 'The one job to stop. Absent or `null` cancels whatever is currently running on the slug, which is what every caller written before this field existed means. Unknown keys are refused rather than stripped, so a misspelling cannot silently become the slug-wide cancel.',
  }),
}).strict()
export type CancelRequest = z.infer<typeof cancelRequest>

/**
 * The query of a live release: `DELETE .../live?session_id=<uuid>`.
 *
 * A query parameter rather than a body, following `?force=true` on robot
 * deletion. A body on a DELETE is carried inconsistently by proxies and by
 * `fetch` itself, and this call runs from a browser tab that is often closing.
 *
 * **`.strict()`, for the reason `cancelRequest` is** — `?sessionid=` instead of
 * `?session_id=` would release **every** one of an identity's holds and strand
 * its other tabs, which is precisely what this field exists to prevent. A
 * refused typo costs a round trip; a stripped one stops a robot somebody else
 * is watching.
 *
 * Absent means today's meaning: release **all** of this identity's holds on
 * this camera. A client that has lost its id, or is going away entirely, still
 * needs a way to let go — it is the blunt form, and it is the one that strands
 * the identity's other tabs.
 */
export const releaseLiveQuery = z.object({
  session_id: z.uuid().optional().meta({
    description: 'The one hold to release, as the live session returned it. Absent releases **all** of this identity\'s holds on this camera — the blunt form, still needed by a client that has lost its id or is going away, and the one that strands the identity\'s other tabs.',
  }),
}).strict()
export type ReleaseLiveQuery = z.infer<typeof releaseLiveQuery>

export const invokeResponse = z.object({
  job: job.meta({
    description: 'The job that now exists on this slug. It is returned as soon as the goal is accepted, so `state` is `running` here — the outcome is observed afterwards, by slug, over polling or a subscription.',
  }),
  /** The slug's kind — see `commandResult.kind` for why the caller needs it. */
  kind: z.enum(['action', 'service']).meta({
    description: 'Always `action` in this shape. A caller sends the same request for both kinds and cannot tell from a role grant which it invoked, so the answer says which it was rather than leaving it to be inferred from the shape.',
  }),
})
export type InvokeResponse = z.infer<typeof invokeResponse>

/** A service call answers with its result directly — no job to observe. */
export const serviceCallResponse = z.object({
  result: z.unknown().meta({
    description: 'What the service returned, shaped by the ROS service. A service call is awaited to completion, so there is no job to observe afterwards and no id to hold on to.',
  }),
})
export type ServiceCallResponse = z.infer<typeof serviceCallResponse>

/**
 * **What `POST /api/robots/:id/jobs/:slug` answers, which is one of two
 * shapes.**
 *
 * One route serves both kinds, because a path segment naming the kind would
 * demand a fact a role grant does not carry. **The slug's kind decides, and
 * nothing in the request does**: an *action* answers `202` with an
 * `invokeResponse` the moment the job exists, a *service* answers `200` with
 * a `serviceCallResponse` once the result is in. They differ only in what the
 * cloud waits for before it answers.
 *
 * The two are told apart without inspecting the status code: `invokeResponse`
 * carries `kind` and `job`, `serviceCallResponse` carries `result` alone.
 *
 * **This union exists so the route can name a response at all.** The entry
 * carried `response: null` while the handler demonstrably answers something,
 * which reads in the generated reference as *this route returns nothing* —
 * a documented absence. A `null` there should
 * mean `204`, and on this route it did not.
 */
export const invokeOrServiceResponse = z.union([invokeResponse, serviceCallResponse])
export type InvokeOrServiceResponse = z.infer<typeof invokeOrServiceResponse>

export const publishRequest = z.object({
  message: z.record(z.string(), z.unknown()).meta({
    description: 'The values to publish, keyed by the **parameter names** the publisher declares — the same flat form an invoke takes for `params`. They are checked against the declared bounds in the cloud before anything reaches the robot, and a slug another caller is still holding is refused with the remaining wait.',
  }),
})
export type PublishRequest = z.infer<typeof publishRequest>

/**
 * The **most recent** job on a slug — running or already finished — or null
 * only when nothing has ever run there.
 *
 * A slug can be observed two equally valid ways, by polling this route or by
 * subscribing. A route that forgot a job the moment it settled would let a
 * poller see only `running`, then `null`: succeeded, failed, cancelled, `lost`
 * and never-invoked would all become the same answer, and the promise that a
 * lost job is said out loud would hold for subscribers and silently not hold
 * for anyone polling. It is also the recovery `command_outcome_unknown` points
 * a caller to.
 *
 * Read `job.state` to tell a live job from a finished one; that is what the
 * field is for.
 */
export const jobResponse = z.object({
  job: job.nullable().meta({
    description: 'The **most recent** job on this slug, running or already finished, and `null` only when nothing has ever run there. Read `state` to tell a live job from a settled one: a route that forgot a job the moment it settled would let a poller see `running` and then nothing.',
  }),
})
export type JobResponse = z.infer<typeof jobResponse>

/**
 * Every job the platform currently believes this robot has — `GET
 * /api/robots/:id/jobs`.
 *
 * `jobResponse` answers "what is on this slug", which requires knowing the
 * slug first. Two kinds of job break that assumption: a reconnecting bridge
 * can name a job the cloud has **no row for**, and the cloud adopts it; and a
 * configuration change can leave a job on a slug the document no longer
 * contains. Both are jobs nobody can ask about, because asking requires
 * already knowing what to ask for.
 *
 * So this route answers the question the per-slug route cannot: not "is
 * something running here", but "what is this robot doing". A cloud that has
 * just reconciled a robot's `hello.active_jobs` has exactly this list.
 *
 * The array is ordered newest first and is **never null**: a robot doing
 * nothing answers `{ jobs: [] }`. "Nothing is running" and "we did not look"
 * are different facts, and a nullable list would merge them — the same
 * distinction `robotDeletionSummary` was made all-required for.
 *
 * **At most one entry per slug: the current job there, exactly what
 * `jobResponse` would answer for that slug.** This is not a history endpoint.
 * Returning every job a registry still holds is unbounded in both count and
 * payload for a robot that has been working all day, and the one thing this
 * route exists to answer — *what is this robot doing* — would be the first
 * line of a scroll. The durable history has its own routes.
 *
 * A settled job stays visible as its slug's current entry until something
 * else runs there, which is what makes a job that just failed still findable.
 * Read `state` to tell a live one from a finished one, exactly as with
 * `jobResponse`.
 */
/* ------------------------------------------------------------------------
 * Identity. Written down here for the same reason the command routes are:
 * **a body schema does not imply a path**, and every consumer would otherwise
 * derive nine paths independently from one implementation.
 *
 * **Two identity spaces, two prefixes.** The
 * `/api/org/` vs `/api/end-users/` split this table once insisted on, and the
 * one pool that replaced it, are both gone. `/api/org/users` is the **team**:
 * Fleetless users, console access, a tier each. An app's users live under
 * `/api/apps/:id/users` and authenticate through `/api/client/`, and nothing
 * joins the two — a credential from one never authenticates the other, and the
 * same address in both is two unrelated accounts.
 *
 * **`src/routes.ts` is the manifest of record, and this table was not.** Every
 * route, its schemas, its `errors` list and its guard are declared there, and
 * the cloud's `route-manifest.test.ts` asserts set equality with the running
 * server in both directions. This block kept a hand-written copy beside it and
 * the copy drifted: it went on describing groups, assignments, a group's OIDC
 * provider and the app OAuth flow after each was deleted. The table is removed
 * rather than re-typed, because a second list is how the first one stops being
 * read.
 *
 * What stays here is the *reasoning* the manifest has no field for. Each
 * paragraph below is a decision, not a route listing.
 *
 * **Deleted with no successor, listed so a consumer looking for them finds the
 * reason rather than a `404`:** every `/api/org/groups*` route, the per-user
 * `assignments`, `move-group` and `usage` routes, `/api/org/federation`, the
 * app's `group`, `group-usage`, `branding` and `oauth-clients` routes, the whole
 * app OAuth sign-in flow (`/oauth/*` and `/login`), and `/api/client/grants*`.
 * There are no compatibility aliases, because an alias here is how a deleted
 * model survives in production while the contract says otherwise.
 *
 * **`POST /api/auth/password/reset` answers `202` for every well-formed
 * address**, known or not. It is the one route where saying nothing about
 * whether an account exists is not a preference but the entire point: any
 * status, body or timing difference between the two cases is an
 * account-enumeration oracle. Note *timing* — a route that only sends mail for
 * a real address must not become measurably faster for an unknown one. Email is
 * **globally unique**, so a bare address names at most one account and the
 * route mails the one match, if any. See `passwordResetRequest`.
 *
 * **Both surfaces get the password routes, mirrored.** An end user and a
 * console user each need a way to change and to reset a password.
 * `passwordChangeRequest` is shared because the operation is identical; the
 * **prefix** is what says
 * which session is being spent, exactly as it does for `login`. The two *reset*
 * requests are separate shapes rather than one, because the surfaces identify a
 * person differently: a Fleetless user by a globally unique address, an app
 * user by app **and** address.
 *
 * **A password change answers with fresh `sessionTokens`, not `204`.** The
 * promise is that the session which made the change survives while every other
 * one dies — and `passwordChangeRequest` carries nothing that identifies the
 * caller's refresh family, so a route given only that shape cannot spare one.
 * Re-issuing is the honest way to keep the promise: revoke everything, hand the
 * caller a new pair. Anything else means the caller keeps working until their
 * access token expires and is then silently logged out, which is
 * indistinguishable from the change having failed.
 *
 * **Every mailed link must carry what the page needs to act on it.** The
 * failure mode is a link mailed to a page that cannot handle it: a reset link
 * pointing at the *request* page, an accept link pointing at a `404`. Worse and
 * quieter: **both surfaces mailing the identical reset URL**, when the page it
 * points at posts to only one of the two routes, so the other surface's token
 * answers `token_spent` forever. A URL that does not say which
 * surface minted it cannot be routed correctly by anything.
 *
 * So the link shapes are fixed here rather than in whichever repo builds them.
 * **They moved to the auth portal**: the
 * console serves no credential page at all any more, and `{portal}` is the
 * cloud's `AUTH_PUBLIC_URL` — `auth.fleetless.dev` where the deployment has
 * that vhost, the cloud's own base where it does not, since the cloud renders
 * these pages itself either way.
 *
 * | purpose | URL |
 * |---|---|
 * | password reset, Fleetless user | `{portal}/reset-password/{token}` |
 * | team invitation                | `{portal}/accept-invite/{token}` |
 *
 * **An app user's links are not in this table, and cannot be** (2026-09-05,
 * Fleetless renders an app user no page, so there is no `{portal}` path
 * to name: the link points into the **developer's own app**, at the template
 * they configured (`appAuthConfig.invite_url`, `verify_url`, `reset_url`), with
 * the token substituted for `{token}`. That is why those fields are validated
 * as templates rather than as URLs, and why an app with none configured is
 * refused a `send_mail` instead of being mailed a link to nowhere.
 *
 * The paragraph this replaces said an app-user reset *"is a feature to design,
 * not a row to restore"*. It was designed; the answer was that the row belongs
 * to the developer and not to this table.
 *
 * The strings themselves live server-side, read by the
 * route that serves each page AND by the builder that mails it — one constant,
 * because the defect this table records happened again after it was written:
 * the mailer, the page and this table can each spell a path differently, and
 * nothing catches it because nothing shares a string.
 *
 * ## The asset store
 *
 * | route | who | role capability |
 * |---|---|---|
 * | `GET /api/robots/{id}/assets` | developer **or** end user | `assets`, end users only |
 * | `GET /api/robots/{id}/assets/{assetId}` | developer **or** end user | `assets`, end users only |
 * | `GET /api/robots/{id}/assets/missing?name=` | developer **or** end user | `assets`, end users only |
 * | `GET /api/robots/{id}/urdf` | developer **or** end user | `assets`, end users only |
 * | `POST /api/robots/{id}/assets/sync` | developer, **Owner** tier | — |
 * | `GET /api/robots/{id}/assets/sync/{syncId}` | developer | — |
 * | `POST /api/bridge/assets` | robot token, per sync | — |
 *
 * **The read routes are dual-mode.** `assets` is an *app-role* capability, and
 * developers are not in any app's role system at all — two identity spaces, and
 * a credential from one never authenticates the other. Reading the table as
 * developer-only would mean an end user could never fetch a URDF, which is the
 * audience the asset store exists for.
 *
 * So: a developer reaches the robot because it belongs to their org; an end
 * user reaches it when their role grants `assets`.
 *
 * **The rewritten mesh URIs in a served URDF are absolute, not
 * root-relative.** A relative URL resolves against *the consumer's* origin,
 * and the consumers here are apps on other domains — so `/api/robots/…` would
 * 404 against the customer's own site. **A URL handed to somebody else's
 * browser must never be relative to ours.**
 *
 * **There is no per-asset `DELETE`, and its absence is the design.** Symmetry
 * is not a reason. Assets are immutable and content-addressed, and the
 * operation a developer actually performs is *the URDF changed, sync again*: a
 * **re-sync reconciles**, so assets the new URDF no longer references stop
 * belonging to that robot. One mechanism instead of two, and robot deletion is
 * already a cascade.
 *
 * Reading is a role capability; **changing the store is Owner-tier** — a sync
 * spends the org's asset quota and a deletion breaks every app rendering that
 * robot, so neither is a Member's to do.
 *
 * **`GET .../assets/missing` is the sole producer of `asset_missing`.** It
 * never succeeds,
 * and that is what it is for: when the served URDF is rewritten, a reference
 * the store cannot answer has to be rewritten into *something*, and a URL that
 * 404s `asset_missing` naming the reference is the only option that leaves the
 * renderer's own error legible. The alternatives are worse — leaving the
 * `package://` URI in place hands a browser a scheme it cannot fetch, and
 * dropping the element silently deletes a limb.
 *
 * `?name=` is that reference, verbatim and URL-encoded: the same string
 * `asset.name` stores and `urdfCompleteness.missing` reports, so what a
 * developer sees in a failed network request matches what the completeness
 * list told them to go fix. `asset_missing` is deliberately not `not_found`:
 * "this robot does not exist" and "this mesh was never synced" send a
 * developer to two different places.
 *
 * A route with a producer, a consumer and no entry in this table is how an
 * error code ends up with no documented way to provoke it.
 *
 * `GET .../assets/{assetId}` answers **bytes**, not JSON, with
 * `Cache-Control: private, immutable` and never `public`: a shared cache must
 * not be invited to store a response to an authorized request. It is the one
 * route in this API whose body is not an `apiError` on failure — a client
 * fetching bytes must still be able to branch, so failures answer the normal
 * envelope with `content-type: application/json`.
 *
 * `POST /api/bridge/assets` is the **first route authenticated by the robot
 * credential over HTTP**. Everything the bridge does today goes over the
 * WebSocket, so this is new surface, not a variation of something existing —
 * and it accepts bodies far larger than any other route on the platform. It is
 * where a rate limit and a size ceiling matter most, and where the general
 * rule applies hardest: the refusal must precede the work, not follow it.
 *
 * The end-user links carry `app_identifier` because the page cannot act
 * without it: `clientPasswordResetRequest` requires it, and an end user is
 * identified by **app and address**, never address alone. The token alone is
 * not enough, and a page that guesses the app is a page that guesses wrong.
 *
 * **This is a stopgap and should be named as one.** An app's users landing on
 * the Fleetless console to reset a password is wrong — the page belongs to the
 * app, and an app has no configured base URL to send them to yet. Until it
 * does, the console hosts both, and the URL carries the app so that moving it
 * later is a redirect rather than a redesign.
 *
 * **`DELETE /api/org/members/:id` is not a row deletion.** A token minted
 * before the removal must stop working; sessions are revoked for the subject.
 */

/**
 * What a `rate_limited` refusal tells the caller.
 *
 * One number, and it is the only one that matters: **when to come back.** A
 * limit that says "too many" without saying "in 800 ms" produces a client that
 * retries immediately, which is the behaviour the limit exists to stop — so
 * omitting it would make the refusal part of the attack.
 *
 * Deliberately **not** carrying the limit, the window, or how many attempts
 * remain: those describe the defence to whoever is probing it, and none of
 * them changes what an honest caller does.
 */
export const rateLimitDetails = z.object({
  retry_after_ms: z.number().int().nonnegative(),
})
export type RateLimitDetails = z.infer<typeof rateLimitDetails>

/**
 * Every job this robot's registry currently holds, **ordered newest first by
 * `started_at`, with `seq` as the tiebreaker**.
 *
 * The tiebreaker is named rather than left implicit, because it matters twice
 * over:
 *
 * 1. **`started_at` alone is not a total order.** Two jobs minted in the same
 *    millisecond sorted against each other arbitrarily — differently on each
 *    query — so a reader could see one twice and the other not at all. `seq`
 *    is monotonic in mint order and settles it. Note its scope, which is in
 *    `job.seq`'s own comment: per cloud process, per run, because job state
 *    lives in memory and the counter restarts with the registry it orders.
 * 2. **For an adopted job, `started_at` is adoption time, not the real
 *    start.** The cloud learns of it at `hello`, having never minted it, and
 *    has no other honest value to put there. So this list is newest-*known*
 *    first, and a job the robot has been running for an hour can sit above one
 *    started a minute ago. Stated rather than smoothed over: the console's own
 *    "Known running since" wording exists for the same reason, and a contract
 *    that quietly implies otherwise would send somebody to debug the sort.
 */
export const robotJobsResponse = z.object({
  jobs: z.array(job).meta({
    description: 'At most one entry per slug — the current job there — ordered newest **known** first, and never `null`: a robot doing nothing answers an empty array. This is not a history endpoint. For an adopted job `started_at` is adoption time, so a job that has been running for an hour can sit above one started a minute ago.',
  }),
})
export type RobotJobsResponse = z.infer<typeof robotJobsResponse>

/**
 * Every slug of a robot that a role can be granted, **with its kind**.
 *
 * A roles matrix built against the datapoint list alone cannot grant an
 * action, a service or a publisher. One list that names every kind, with its
 * kind, is what a matrix needs.
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

/* ------------------------------------------------------------------------
 * Cameras. Routes, written down as the command routes are:
 *
 * | route | answers |
 * |---|---|
 * | `GET /api/robots/:id/cameras`                    | `cameraListResponse` |
 * | `GET /api/robots/:id/cameras/:slug/snapshot`     | the image bytes, plus the headers below |
 * | `GET /api/robots/:id/cameras/:slug/snapshot/meta`| `snapshotMetaResponse` — age without the bytes |
 * | `POST /api/robots/:id/cameras/:slug/live`        | `liveSessionResponse` — takes a refcount hold |
 * | `DELETE /api/robots/:id/cameras/:slug/live?session_id=` | 204 — releases **that** hold; without the parameter, all of this identity's holds on the camera |
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

/**
 * The metadata an asset upload carries beside its raw body.
 *
 * Written here rather than left as a convention each side documents for
 * itself. **A string shared by two implementations and defined in both is a
 * string that drifts**, and a header is the easiest place for that to happen
 * unnoticed: a zod schema cannot validate one, which is an argument for
 * writing the names down once, not an argument for writing them down twice.
 *
 * `name` is the `package://` URI verbatim for a mesh — the same string
 * `asset.name` stores, and the same one `urdfCompleteness.missing` reports, so
 * a failed upload and a missing mesh can be matched by eye.
 */
/**
 * **`name` travels percent-encoded in a second header.**
 *
 * HTTP header values are latin-1. A texture called `textures/日本語.png` cannot
 * be put in one at all: in Python it raises a `UnicodeEncodeError` inside
 * `urllib` — a `ValueError`, caught by neither `HTTPError` nor `URLError` — so
 * a single non-ASCII filename can fail an entire sync with no cause on the
 * wire. Non-ASCII names are ordinary rather than exotic, because `.dae`
 * internal names come from 3D-authoring tools.
 *
 * The encoding is not invented here. **`GET .../assets/missing?name=` already
 * carries this exact string percent-encoded**, because a query parameter is
 * percent-encoded by definition — same value, same wire, question already
 * answered.
 *
 * **It is a SECOND header, and that is the whole design rather than a
 * detail.** Overloading `name` itself — the producer encodes, the store
 * decodes — decodes identically for every name without a `%`, so an older
 * producer and a newer store agree by luck right up until a name contains
 * `%2f`, which the store would then silently turn into a `/`. A wire change
 * whose breakage is invisible in the common case and silent in the uncommon
 * one is the worst of both.
 *
 * So `name` keeps meaning exactly what it always meant, and `nameEncoded`
 * carries the percent-encoded UTF-8 form. **The store prefers `nameEncoded`
 * when present and uses `name` otherwise**, so:
 *
 * - a producer that sends only `name` behaves exactly as it always did;
 * - a producer that sends both can carry a name latin-1 cannot express;
 * - no value is ever ambiguous about which encoding it is in.
 *
 * A producer that can send `nameEncoded` should send both, so a store older
 * than this contract keeps working too. Agreement by construction, not by the
 * absence of a `%`.
 */
export const ASSET_UPLOAD_HEADERS = {
  kind: 'x-fleetless-asset-kind',
  name: 'x-fleetless-asset-name',
  nameEncoded: 'x-fleetless-asset-name-encoded',
  syncId: 'x-fleetless-sync-id',
  /**
   * **The announced size, and it is what makes a structured store refusal
   * reachable at all.**
   *
   * A server-side body limit is applied by the content-type parser, before the
   * handler runs, so an upload with no room left can only be refused with a
   * bare `413` carrying none of the three numbers — and the refusal
   * `assetStoreRefusedDetails` describes would have no producer.
   *
   * With the size announced in a header the cloud can check `used + size`
   * against `ROBOT_ASSET_STORE_BYTES` where it can still say something: before
   * a byte is buffered, with all three numbers.
   *
   * The header is an **announcement, not a proof**: a sender can lie. The
   * store still applies to the bytes that arrive — this does not replace
   * enforcement, it only makes the refusal answerable.
   */
  size: 'x-fleetless-asset-size',
} as const

export const cameraDescriptor = z.object({
  slug: slug.meta({ description: 'The name a client addresses this camera by.' }),
  width: z.number().int().positive().meta({
    description: 'Frame width in pixels, as the published configuration declares it.',
  }),
  height: z.number().int().positive().meta({
    description: 'Frame height in pixels, as the published configuration declares it.',
  }),
  fps: z.number().int().positive().meta({
    description: 'How many frames per second the camera is configured to publish while somebody is watching live.',
  }),
  /**
   * Seconds, as the document spells it, reusing `snapshotIntervalSeconds` so
   * the 1–3600 bound is written once. It was `snapshot_interval_ms` after the
   * document moved to seconds, which left the cloud converting the unit on
   * this descriptor and not on `datapointDescriptor` beside it — the same
   * drift `rateThrottleHz` was extracted to stop.
   */
  snapshot_interval_seconds: snapshotIntervalSeconds.meta({
    description: 'How often a still frame is captured for the cheap snapshot reads, in seconds, between `1` and `3600`. Independent of `fps`, which is about live video.',
  }),
})
export type CameraDescriptor = z.infer<typeof cameraDescriptor>

export const cameraListResponse = z.object({
  cameras: z.array(cameraDescriptor).meta({
    description: 'Every camera the published configuration exposes on this robot **and** the caller\'s role grants. A developer sees all of them; an end user sees what their role allows.',
  }),
})
export type CameraListResponse = z.infer<typeof cameraListResponse>

/**
 * What a viewer needs to join, and **what it costs them to hold**.
 *
 * `POST` takes a refcount hold and `DELETE` releases it; the first hold
 * starts the robot publishing and the last release stops it. A client
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
   * This viewer's hold, and the **only** thing `DELETE` should be given.
   *
   * A hold addressed by `{identity, robot, slug}` alone would make two tabs of
   * one logged-in user a single hold as far as the refcount can see. Closing
   * either tab would release it, and the surviving tab would keep its LiveKit
   * connection — the token is checked at join and never again — rendering a
   * video the robot had already stopped producing. A frozen picture is not an
   * ended session.
   *
   * `DELETE` without a session id keeps today's meaning — *release my holds
   * on this camera* — because an SDK that has lost its id, or a client that
   * is going away entirely, still needs a way to let go. It is the blunt
   * form, and it is the one that strands other tabs; new callers pass the id.
   */
  session_id: z.uuid().meta({
    description: 'This viewer\'s hold, and the only thing a release should be given. Two tabs of one logged-in user are two holds; releasing without an id lets go of both and leaves the other tab rendering a stream the robot has already stopped producing.',
  }),
  url: z.string().min(1).meta({
    description: 'The LiveKit server to connect to, as a WebSocket URL.',
  }),
  room: z.string().min(1).meta({
    description: 'The LiveKit room carrying this camera. Every viewer of one camera on one robot joins the same room, which is what makes the refcount hold meaningful.',
  }),
  token: z.string().min(1).meta({
    description: 'The LiveKit access token to join `room` with. It is checked when the participant connects and **not again afterwards** — which is not the same as irrevocable: the cloud can still disconnect a participant after the fact, and does when membership, a role or a key changes.',
  }),
  expires_at: z.iso.datetime().meta({
    description: 'The deadline for **joining**, as an ISO 8601 timestamp — not a session backstop. A viewer who has already joined keeps receiving video past this moment, so cleanup belongs in an explicit release, never in a timer built on this value.',
  }),
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
 * indistinguishable from a live one, and snapshots are deliberately cheap and
 * therefore deliberately old. `null` values mean nothing has been
 * captured yet — which is an answer, not an error.
 */
export const snapshotMetaResponse = z.object({
  slug: slug.meta({ description: 'The camera this snapshot belongs to.' }),
  timestamp_ms: z.number().int().nonnegative().nullable().meta({
    description: 'When the stored frame was captured, as a unix timestamp in milliseconds. `null` means nothing has been captured yet, which is an answer rather than an error.',
  }),
  age_ms: z.number().int().nonnegative().nullable().meta({
    description: 'How old the stored frame is right now, in milliseconds; `null` when there is none. Snapshots are deliberately cheap and therefore deliberately old, and a cached frame served without its age is indistinguishable from a live one.',
  }),
  width: z.number().int().positive().nullable().meta({
    description: 'Width of the stored frame in pixels, or `null` when nothing has been captured yet.',
  }),
  height: z.number().int().positive().nullable().meta({
    description: 'Height of the stored frame in pixels, or `null` when nothing has been captured yet.',
  }),
  mime: z.string().nullable().meta({
    description: 'The media type of the stored frame, such as `image/jpeg`, or `null` when nothing has been captured yet.',
  }),
})
export type SnapshotMetaResponse = z.infer<typeof snapshotMetaResponse>

// ---------------------------------------------------------------------------
// Retention, history and org quotas
// ---------------------------------------------------------------------------

/**
 * **Both history shapes answer the same boundary the same way: `[from, to)`.**
 *
 * Half-open, because it is the only rule under which **adjacent windows tile
 * without overlap**: `[0,10)` then `[10,20)` covers every instant once. With an
 * inclusive upper bound a sample at exactly `10` belongs to both windows, and
 * any consumer summing them counts it twice.
 *
 * Two shapes that answered it differently would give opposite results for a
 * point landing exactly on `to` — same range, same data — and the difference
 * renders as a gap in one of the two.
 *
 * This is a statement about behaviour, not a field: nothing in the shapes below
 * can enforce it. It is written here because this is the one place both shapes
 * are defined together.
 */

/**
 * A history query. `from`/`to` accept **either** a relative expression
 * (`now-30s`, `now-5m`, `now-1h`) **or** absolute unix milliseconds, because
 * a chart asks the first way and a report asks the second, and making a
 * client convert is making it guess our clock.
 *
 * `window` without `agg` is meaningless and `agg` without `window` is
 * ambiguous — both are refused rather than assigned a default, since a
 * silently chosen aggregation is a chart that lies quietly.
 */
export const historyQuery = z.object({
  from: z.string().min(1).max(32).meta({
    description: 'The start of the window: either a relative expression — `now-30s`, `now-5m`, `now-1h` — or absolute unix milliseconds. A chart asks the first way and a report asks the second, and making a client convert would be making it guess our clock.',
  }),
  to: z.string().min(1).max(32).optional().meta({
    description: 'The end of the window, in the same two spellings as `from`; absent means now. The window is half-open, `[from, to)`, so a sample landing exactly on `to` belongs to the next window and adjacent windows tile without double-counting.',
  }),
  window: z.string().min(2).max(16).optional().meta({
    description: 'The bucket width, such as `10s` or `1m`. Absent means raw samples. It is meaningless without `agg`, and the pair is refused apart rather than defaulted — a silently chosen aggregation is a chart that lies quietly.',
  }),
  agg: z.enum(['min', 'max', 'avg']).optional().meta({
    description: 'How each bucket reduces the samples inside it. Valid only together with `window`.',
  }),
  field: z.string().min(1).max(128).optional().meta({
    description: 'A dotted path to a numeric field inside an object value, such as `pose.x`. Without it the datapoint\'s value is used whole, which only works when it is already a number.',
  }),
  /**
   * **A union whose input branch IS the wire, not a coercion.**
   *
   * The schema describes a **query string**, where every value arrives as
   * text. `z.coerce.number()` would read it, but a coercion cannot be
   * *published*: zod renders a coercion's **result** in either `io` mode, so
   * input and output both emit `{"type":"integer"}` — an artifact describing a
   * shape a query string can never carry. Anyone validating a real request
   * against it rejects every one that sets `limit`.
   *
   * That is a different problem from `.default()` publishing as required,
   * which input-mode export genuinely does fix.
   *
   * A union states both truths honestly: the wire carries a numeric string, a
   * programmatic caller may pass a number, and the artifact can render the
   * input branch because there is one to render.
   *
   * **What the artifact does not say, named here rather than left silent.**
   * The `1..10000` bound lives in the `.pipe()`, which is the *output* half, so
   * no input-mode artifact can express it as a constraint: the published shape
   * is `^\d{1,5}$` or a bare integer, and five digits is a weak echo of the
   * real ceiling. That is honest about the wire — the bound is enforced after
   * parsing, not by the shape of the text — but it is a **reduction**, and an
   * artifact that stops naming a bound reads as if there were none.
   *
   * So both branches carry the number in a `.describe()`. It is **not** a
   * constraint and nothing validates against it; it means a generator, or a
   * person reading only the published schema, sees the actual ceiling instead
   * of nothing. The gap is narrowed and named rather than closed.
   */
  limit: z
    .union([
      z
        .string()
        .regex(/^\d{1,5}$/)
        // **The description carries the number the shape cannot** (see the
        // proposal). Five digits is the regex's bound, not the contract's; the
        // real ceiling lives in the `.pipe()` below and therefore cannot appear
        // in an input-mode artifact. This does not close that gap and does not
        // claim to — it means a generator, or a person reading only the
        // published schema, sees the actual number instead of none at all.
        .describe('Positive integer, 1-10000. The pattern only bounds digit count; the real ceiling is enforced after parsing.'),
      // The same sentence on the numeric branch, for the same reason and one
      // that is arguably stronger: without it the artifact publishes the full
      // safe-integer range, which reads as *nine quadrillion is fine*.
      z.number().int().describe('Positive integer, 1-10000. The ceiling is enforced after parsing, not by this type.'),
    ])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(10_000))
    .optional()
    .meta({
      description: 'The most samples or buckets to return, from `1` to `10000`. It arrives as text on the query string, so both a numeric string and a number are accepted; the ceiling is enforced after parsing rather than by the published shape.',
    }),
})
export type HistoryQuery = z.infer<typeof historyQuery>

/**
 * Raw samples. `timestamp_ms` is the **bridge's capture time** — the
 * same instant the live value carried, so a recorded point and a live one can
 * be placed on one axis without apology.
 *
 * `truncated` says the response was cut short. A short array that does not
 * admit it is indistinguishable from a quiet period, and the two lead a
 * developer to opposite conclusions.
 */
export const historySamplesResponse = z.object({
  slug: slug.meta({ description: 'The datapoint these samples belong to.' }),
  kind: z.literal('samples').meta({
    description: 'Says this is the raw-sample shape, which the query asked for by omitting `window`. A client reads this rather than inspecting which fields arrived.',
  }),
  samples: z.array(z.object({
    timestamp_ms: z.number().int().nonnegative().meta({
      description: 'When the sample was captured, as a unix timestamp in milliseconds. It is the **bridge\'s capture time** — the same instant the live value carried, so a recorded point and a live one sit on one axis without apology.',
    }),
    value: z.unknown().meta({
      description: 'The value as it was stored, shaped by the datapoint. A `field` in the query narrows a message down to one number; without one the whole stored value comes back.',
    }),
  })).meta({
    description: 'The samples in the queried window, oldest first. The window is half-open, `[from, to)`, so a sample landing exactly on `to` belongs to the next window.',
  }),
  truncated: z.boolean().meta({
    description: 'Whether the response was cut short. A short array that does not admit it is indistinguishable from a quiet period, and the two lead a developer to opposite conclusions.',
  }),
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
  truncated_by: z.enum(['limit', 'bytes']).nullable().meta({
    description: 'Why it was cut, and `null` when it was not — the two causes have **different remedies** and one boolean cannot tell them apart. `limit` means too many rows, so raising `limit` helps. `bytes` means the rows are large, so raising `limit` changes nothing: narrow the range, or name a numeric `field` so whole messages are not carried.',
  }),
})
export type HistorySamplesResponse = z.infer<typeof historySamplesResponse>

/**
 * Aggregated buckets — a **separate shape**, not the samples shape with nulls
 * in it, so a client knows by type what it received rather than by
 * inspection.
 *
 * `sample_count` exists because an empty bucket and a bucket whose average is
 * zero are different facts. When two facts share one representation, a chart
 * is the easiest place to draw a gap as a line.
 */
export const historyBucketsResponse = z.object({
  slug: slug.meta({ description: 'The datapoint these buckets summarise.' }),
  kind: z.literal('buckets').meta({
    description: 'Says this is the aggregated shape, which the query asked for by naming a `window`. A separate shape rather than the sample shape with nulls in it, so a client knows by type what it received rather than by inspection.',
  }),
  window_ms: z.number().int().positive().meta({
    description: 'The bucket width actually used, in milliseconds — the query\'s `window` resolved to a number, so a rendered chart can say what it is drawing without re-parsing the expression it sent.',
  }),
  agg: z.enum(['min', 'max', 'avg']).meta({
    description: 'How each bucket reduced the samples inside it, echoed back from the query.',
  }),
  buckets: z.array(
    z.object({
      bucket_start_ms: z.number().int().nonnegative().meta({
        description: 'The instant this bucket opens, as a unix timestamp in milliseconds. Buckets are half-open and `window_ms` wide, so this one covers up to but not including `bucket_start_ms + window_ms`.',
      }),
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
      value: z.number().nullable().meta({
        description: 'The aggregate over this bucket\'s **numeric** samples, or `null` when none of them were numeric — which is **not** the same as the bucket being empty. `sample_count` separates those: `null` with a count of `0` is a gap a chart should draw as a break, `null` with a count above `0` is data that simply has no height.',
      }),
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
      sample_count: z.number().int().nonnegative().meta({
        description: 'Every sample that landed in this bucket and inside the queried range, whether or not it contributed to `value` — only a count of *all* samples can prove a bucket empty rather than merely unplottable. Two consequences: `value * sample_count` is **not** a sum, and on a first or last bucket the count reflects the range rather than the bucket, so a low edge count is a boundary effect and not a quiet period.',
      }),
    }),
  ).meta({
    description: 'The buckets covering the queried window, oldest first. A range and window that would produce more than `limit` buckets is refused before the query runs, because this shape carries no `truncated` field and a refusal is then the only honest answer.',
  }),
})
export type HistoryBucketsResponse = z.infer<typeof historyBucketsResponse>

/**
 * **What `GET /api/robots/:id/datapoints/:slug/history` answers, which is one
 * of two shapes.**
 *
 * **The query decides, and only the query**: without `window` it is a
 * `historySamplesResponse`, with one it is a `historyBucketsResponse`.
 * `window` and `agg` must be given together or not at all — one without the
 * other is refused rather than defaulted, since a silently chosen aggregation
 * is a chart that lies quietly.
 *
 * Told apart by `kind`, which is `'samples'` or `'buckets'`, so a client
 * branches on a field rather than on which other fields happen to be present.
 * The two are deliberately not one shape with nullable halves: an aggregate
 * and a raw reading answer different questions, and `sample_count` exists on
 * only one of them.
 *
 * **This union exists so the route can name a response at all.** The entry
 * carried `response: null` while the handler demonstrably answers something,
 * which reads in the generated reference as *this route returns nothing*.
 */
export const historyResponse = z.union([historySamplesResponse, historyBucketsResponse])
export type HistoryResponse = z.infer<typeof historyResponse>

/**
 * Deletion, and the one channel that reports health.
 *
 * | Route | Body | Answer |
 * |---|---|---|
 * | `DELETE /api/robots/:id` | — | `204`. `?force=true` to proceed while a live session is open; without it, `409 robot_in_use` |
 * | `GET /api/robots/:id/deletion-preview` | — | `robotDeletionSummary` — the same shape the audit event carries |
 * | `DELETE /api/apps/:id` | — | `204`. No `force` parameter — an app has no open-session hazard to force past, so the preview is the guard |
 * | `GET /api/apps/:id/deletion-preview` | — | `appDeletionSummary` — the same shape the audit event carries |
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
 * The per-robot reading is the tempting one and it is wrong: a health list is
 * rendered for every robot at once, and a per-robot path makes that N requests
 * to draw one screen — while the event that keeps it fresh arrives org-wide
 * anyway. A snapshot and a channel that disagree about scope are not two halves
 * of one thing; they are two things every consumer has to reconcile, separately,
 * forever.
 *
 * So: same scope, one route, and `?robot_id=` for the narrow question.
 */

/**
 * What a `robot.deleted` audit event carries.
 *
 * A deletion record that says only *that* something was destroyed is a
 * receipt for an unknown amount. This names it: how many configured slugs,
 * how many stored samples, how many bytes that freed against the retention
 * quota, which cameras existed, how much attributed run history went with
 * it, and whether somebody was watching at the time. Those are the questions
 * asked afterwards, and afterwards is the one moment the data cannot be
 * consulted.
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
   * irreversible click destroys.
   *
   * A draft is destroyed too and is described by `had_unpublished_draft`
   * rather than by either of these: describing three things with two numbers
   * would make each of them mean something else.
   */
  slug_count: z.number().int().nonnegative(),
  sample_rows: z.number().int().nonnegative(),
  bytes_freed: z.number().int().nonnegative(),
  cameras: z.array(slug),
  /**
   * Assets destroyed with the robot, and **`asset_bytes_freed` is what the
   * robot's own store gives back** — every distinct mesh or texture blob it
   * holds, counted once, URDF excluded.
   *
   * Storage is content-addressed, but the store and its 1 GB ceiling are now
   * per robot: a blob another robot also references stays in the object
   * store but is still credited here, because each robot's counter carries
   * it regardless of what else points at the same bytes. Same reasoning that
   * keeps `cameras` out of `slug_count`: this summary is read aloud to a
   * human, and a number that is nearly right is worse here than an absent
   * one.
   *
   * `asset_count` is the plain count of the robot's asset rows, all of which
   * do go away.
   */
  asset_count: z.number().int().nonnegative(),
  asset_bytes_freed: z.number().int().nonnegative().meta({
    description: 'What the robot\'s store gives back: every distinct mesh or texture blob it holds, counted once, URDF excluded; a blob another robot also references stays in the object store but is still credited here, because each robot\'s counter carries it.',
  }),
  /**
   * How many rows of run history go with the robot — every recorded
   * invocation of one of its actions or services, up to
   * `JOB_RUN_RETENTION_DAYS`.
   *
   * Its own number, never folded into `slug_count`, for the same reason
   * `cameras` is not: `slug_count` counts *configuration* — what the robot
   * was set up to do — and this counts *what was actually done*, over as
   * much as 90 days. One robot with four slugs can carry forty thousand
   * runs, and a sentence that added them would describe two unrelated
   * magnitudes with one number on the one screen whose entire justification
   * is naming what an irreversible click destroys.
   *
   * It is also the only field here that names *people*: a run row carries
   * the `jobActor` who invoked it — a developer's or end user's email,
   * snapshotted at invoke time. So this deletion destroys attributed history
   * of who asked the machine to do what, which is a different kind of loss
   * from a count of sample rows and deserves to be said out loud rather than
   * inferred.
   *
   * **Bridge latency buckets are deliberately not counted here, and this is
   * the note saying so** rather than leaving the asymmetry to be
   * rediscovered as an omission. They are platform telemetry with a seven-day
   * life (`BRIDGE_LATENCY_RETENTION_DAYS`), produced by the cloud's own
   * pinging rather than by anything the developer did, counted against no
   * retention quota, and worth nothing to anybody after the robot is gone.
   * This summary is read aloud to a human deciding whether to click, and its
   * value comes from naming what the *developer* loses; a number for
   * telemetry they never asked for and cannot use would dilute exactly that.
   */
  job_run_count: z.number().int().nonnegative(),
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
 * The query of `DELETE /api/robots/:id`.
 *
 * **`force=true` or nothing, and every other value is refused.** The handler
 * parses the query with this schema and answers `400 validation_error` on
 * anything else, so `?force=1` and `?force=TRUE` are neither forced nor
 * quietly un-forced. That is the whole point of the strictness: silently
 * false was the worst answer available, because a caller who believes they
 * authorised a cascade and did not then gets a `409` naming the very flag
 * they passed, and cannot tell which of the two happened.
 *
 * Declared as the literal string because it is the only value that does
 * anything — a `z.boolean()` here would describe a wire shape a query string
 * cannot carry, and a `z.string()` would document nothing. The MCP door takes
 * a real boolean and cannot express the ambiguity at all, so the two are one
 * policy in two vocabularies rather than two policies.
 */
export const robotDeleteQuery = z
  .object({
    force: z.literal('true').optional().meta({
      description: 'Pass `true` to delete a robot that has a live session open; without it that is `409 robot_in_use`. **`true` and nothing else** — any other value is `400 validation_error`, reported against the field `force` with rule `invalid_value`, so a caller is never left believing they forced a deletion they did not. The deletion is a full cascade, which is why saying it is the whole decision.',
    }),
  })
  .meta({ description: 'The one optional parameter of `DELETE /api/robots/:id`, and it is the difference between a refusal and a cascade. It accepts the exact string `true`, or its own absence, and refuses everything else.' })
export type RobotDeleteQuery = z.infer<typeof robotDeleteQuery>

/**
 * The seven health states, declared **once**.
 *
 * `resourceHealthState` and `resourceHealthEvent` are the snapshot and the push
 * of the same thing. Writing the values out twice publishes two independent
 * artifacts with no `$ref` between them, kept in step only by whoever
 * remembers to edit both.
 *
 * One concept rendering as two artifacts that nothing keeps in step is its own
 * class of artifact-versus-source defect, distinct from `.default()` publishing
 * as `required` and from a coercion's unrepresentable input.
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
   * mistyped, or belonging to somebody else.
   *
   * Separate from `unreadable_credential` because that one asserts a
   * decryption that was attempted and failed, and here nothing was ever
   * encrypted: the developer is sent to a page where the credential is not
   * listed at all, to rotate something that is not there. And separate from
   * `unknown`, which means "the robot reported a failure we cannot classify"
   * — a different fact with a different fix.
   *
   * **Retiring with the credential store**, and not live behaviour to build
   * against. Its one producer tolerated an unresolved `credentials_ref` at
   * publish time; that field is gone, so nothing emits this today. It is kept
   * only until the credential store is removed, which takes these three
   * credential states with it — `unreadable_credential` and the `readable` fact
   * on `credentialSummary` go the same way.
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
 * sees it.
 *
 * It exists because nothing else carries the state of a camera, a source or a
 * credential to a developer who is not, at that exact moment, pressing a
 * button. A publish failure after the `201` reaches no one; a source whose
 * password is wrong fails at config-apply time with nobody watching and stays
 * silent until someone presses "Go live" days later; a viewer cannot learn
 * *why* a stream ended; an undecryptable credential reports as healthy.
 *
 * One shape rather than a field per symptom, because a failure written into a
 * state field the platform writes and reads in one place is a dead end.
 *
 * `reason` is for a human and is **never** built from an exception message: a
 * camera password reaches a log that way, and an exception message from a
 * failing stream travels to the cloud on this very path. Type names and fixed
 * strings only.
 */
export const resourceHealthState = z.object({
  robot_id: z.uuid(),
  kind: z.enum(['camera']),
  /** The camera slug, or the credential name. */
  ref: z.string().min(1).max(64),
  /**
   * **Which of two questions this entry answers.**
   *
   * `'source'`  — can the source be read at all? (`unreachable`, `auth_failed`,
   *               `unreadable_credential`, `missing_credential`, `ok`, …)
   * `'publish'` — given a readable source, did publishing to LiveKit work?
   *
   * Without the facet both answers land in one entry keyed
   * `${robot} ${kind} ${ref}` with one flat `state`, in which `publish_failed`
   * answers *"can we publish"* and every other value answers *"can the source
   * be read"* — same key, same field, two questions, each overwriting the
   * other.
   *
   * The facet is part of the entry's identity: a camera can perfectly well be
   * readable and unpublishable at the same moment, and that pair is exactly
   * what a developer needs to see rather than whichever fact arrived last.
   */
  facet: z.enum(['source', 'publish']),
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
 * Org-wide, not per robot — the route table above explains why. A channel
 * with no snapshot cannot answer "what is the state now?" for a
 * page that just loaded — it can only report the next change, which may be
 * hours away. Both halves or neither.
 */
export const resourceHealthListResponse = z.object({
  resources: z.array(resourceHealthState),
})
export type ResourceHealthListResponse = z.infer<typeof resourceHealthListResponse>

/**
 * The query of `GET /api/org/health`: optionally one robot instead of the org.
 *
 * The narrowing lives in a query rather than at a per-robot path because the
 * console shows health on the robot list too, and a per-robot path would make
 * that N requests to render one screen.
 */
export const orgHealthQuery = z
  .object({
    robot_id: z.uuid().optional().meta({
      description: 'Narrows the report to one robot. Omit it for every robot in the org. Malformed is `400 invalid_uuid` and a robot of another org is `404 not_found` — the same two answers an MCP caller gets, because the check lives in the shared service rather than on the route.',
    }),
  })
  .meta({ description: 'The optional robot filter of `GET /api/org/health`.' })
export type OrgHealthQuery = z.infer<typeof orgHealthQuery>

/**
 * Org protection quotas — generous, server-side adjustable, visible in
 * settings. Protection against runaway use, not a business model; a later one
 * docks onto the same dials.
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
 * letting an empty bucket and a zero average share a representation.
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

/** One bucket is one minute. Stated here so the cloud and any client agree without guessing. */
export const LATENCY_BUCKET_MS = 60_000

/**
 * Latency buckets are **platform telemetry, not a customer datapoint**, and
 * this short retention is why that distinction was worth making: the cloud
 * pings every bridge every 2 seconds, ~43 200 measurements per robot per day,
 * and a sparkline needs about 60 points per hour. Seven days is generous for
 * what reads it and costs the org's retention quota nothing, because it is not
 * counted against it.
 */
export const BRIDGE_LATENCY_RETENTION_DAYS = 7

/**
 * Every read of the durable run history and the latency buckets: the three
 * org-wide ones the fleet overview is built on, and the one robot-scoped door
 * a client app has into the same table.
 *
 * | Route | Query | Answer |
 * |---|---|---|
 * | `GET /api/org/jobs` | `jobRunQuery` | `jobRunListResponse` — newest first, cursor-paged over the durable `seq` |
 * | `GET /api/org/jobs/summary` | `jobRunSummaryQuery` | `jobRunSummary` — three numbers over the window the caller named |
 * | `GET /api/org/latency` | `orgLatencyQuery` | `orgLatencyResponse` — one series per robot, truncation named |
 * | `GET /api/robots/:id/jobs/history` | `jobRunQuery` | `jobRunListResponse` — the same read, robot-scoped, developers **and** clients |
 *
 * The paths are written down beside the shapes, as in
 * `robotDeletionSummary`'s neighbouring table: a shape whose route is not
 * named here is a fact that lives only in somebody's memory.
 *
 * Three things about them are worth stating rather than inferring:
 *
 * **The three `/api/org/…` reads are org-wide, and `?robot_id=` narrows
 * them** — the same choice `GET /api/org/health` already made, for the same
 * reason: the overview screen shows every robot at once, and a per-robot path
 * would make one screen N requests.
 *
 * **Those three are developer-only, and that is a property of their scope,
 * not of the data.** An org-wide read has no client meaning: an end user is
 * scoped to the robots their app assigns, never to an org.
 *
 * **The client-facing read of the same table is
 * `GET /api/robots/:id/jobs/history`** — robot-scoped, one route for
 * developers and clients like every other robot-scoped read (`.../jobs`,
 * `.../assets`, `.../datapoints`), never a parallel `/api/client/…` twin. An
 * end user reaches it only when their role's `capabilities.action_history`
 * says so — otherwise `403 capability_required`, naming the capability — and
 * sees only runs on slugs their role grants. On this route `?robot_id=` is
 * not a filter: the path already names the robot, and a query naming a
 * different one is refused rather than quietly answered about the path's.
 *
 * **It discloses the actor, and that is what a developer weighs before
 * granting the capability.** A `jobRun` names who invoked it — `jobActor`
 * carries an email — so an end user reading a robot's history learns which
 * other people have been driving that machine. Robot scope plus a role
 * capability is what makes that a decision a developer takes per role,
 * instead of something every session gets: an end-user-facing
 * `GET /api/org/jobs` would have handed over the whole org's actors with no
 * such decision anywhere, which is why there is none.
 *
 * **A page can be shorter than `limit` while `next_cursor` is non-null**, on
 * the robot-scoped route specifically: the slug filter is applied to the
 * page the store returned, so a role granting one slug in ten sees thin — and
 * sometimes empty — pages. That is what `jobRunListResponse.next_cursor`'s
 * own doc comment means by a promise rather than an observation; a client
 * keeps reading until it is null.
 *
 * **Neither window is optional, and neither has a default.** A summary over
 * an unnamed window is a number nobody can reproduce; an unbounded latency
 * window is a response size chosen by whoever forgot to pass one. Each
 * query's own doc comment says which of those two reasons applies to it.
 */

/** Seven days x 1440 buckets x N robots is otherwise an unbounded response. */
export const MAX_LATENCY_BUCKETS_PER_RESPONSE = 20_000

export const latencyBucket = z.object({
  /** Truncated to the minute. */
  bucket_at: z.iso.datetime(),
  /**
   * `null` exactly when `samples` is 0. A minute in which the robot was offline
   * throughout has **no** latency; writing `0` would put the number meaning
   * "perfectly fast" into the state meaning "not there at all".
   */
  min_ms: z.number().nonnegative().nullable(),
  avg_ms: z.number().nonnegative().nullable(),
  max_ms: z.number().nonnegative().nullable(),
  samples: z.number().int().nonnegative(),
  /**
   * Milliseconds of this bucket the cloud held the robot online.
   *
   * A duration and **not a ratio**: a ratio needs a denominator, and here that
   * would be expected pings per minute — `pingIntervalMs`, which is
   * configurable and is shrunk in tests. A stored value whose meaning depends
   * on a configuration variable is not comparable across the time it is stored
   * for. A client divides by `LATENCY_BUCKET_MS` if it wants a fraction.
   */
  online_ms: z.number().int().min(0).max(LATENCY_BUCKET_MS),
})
export type LatencyBucket = z.infer<typeof latencyBucket>

export const robotLatencySeries = z.object({
  robot_id: z.uuid(),
  buckets: z.array(latencyBucket),
})
export type RobotLatencySeries = z.infer<typeof robotLatencySeries>

/**
 * `GET /api/org/latency`'s query.
 *
 * **Both bounds are required**, for a reason narrower than
 * `jobRunSummaryQuery`'s: this table holds a bucket per robot per minute for
 * `BRIDGE_LATENCY_RETENTION_DAYS`, so "everything" is up to 10 080 rows per
 * robot, and a default window would be a response size chosen by whoever
 * forgot to pass one. `MAX_LATENCY_BUCKETS_PER_RESPONSE` still bounds the
 * answer; required bounds are what let a caller decide *which* buckets they
 * get instead of discovering the ceiling ate the ones they wanted.
 *
 * `wireTimestampMs` rather than a plain integer, for its own documented
 * reason: the union's input branch is what a query string actually carries,
 * and the year bound is what keeps `253402300800000` from reaching the
 * Postgres bind path as a `500` where a `400` belongs.
 */
export const orgLatencyQuery = z
  .object({
    from_ms: wireTimestampMs,
    /** Exclusive — half-open `[from, to)`, the convention every other query here already follows. */
    to_ms: wireTimestampMs,
    /**
     * One robot's own sparkline. `z.uuid()`, because the column is one —
     * the same fix in the same place `auditQuery.actor_id` documents at
     * length: a non-uuid reaching Postgres as a uuid parameter answers
     * `500 internal_error`, and a 500 explains nothing.
     */
    robot_id: z.uuid().optional(),
  })
  .strict()
  /**
   * Refused here rather than in the route, so an inverted window comes back
   * as part of the same `validation_error` every other bad parameter
   * produces. Strict, not `<=`: an empty half-open window is a query with no
   * answer, and a caller who asked for one has made a mistake worth being
   * told about rather than being handed an empty series that reads like a
   * quiet robot.
   *
   * **The published artifact cannot express this**, and that is worth saying
   * out loud rather than leaving a reader to assume the JSON Schema is the
   * whole contract: a cross-field comparison has no JSON Schema rendering, so
   * `org-latency-query.schema.json` describes two independent integers and
   * validates an inverted window happily. The cloud is the only enforcement
   * point for the ordering; a generated client that validates against the
   * artifact alone will get a `400` from the route it did not predict, which
   * is the correct outcome and not a drift bug.
   */
  .refine((query) => query.from_ms < query.to_ms, {
    message: 'from_ms must be strictly before to_ms',
    path: ['from_ms'],
  })
export type OrgLatencyQuery = z.infer<typeof orgLatencyQuery>

export const orgLatencyResponse = z.object({
  series: z.array(robotLatencySeries),
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /**
   * Which ceiling cut the response short, `null` when nothing did — borrowed
   * from `historySamplesResponse.truncated_by` rather than invented a second
   * time, for its reason: one boolean cannot carry two different remedies.
   */
  truncated_by: z.enum(['limit', 'bytes']).nullable(),
})
export type OrgLatencyResponse = z.infer<typeof orgLatencyResponse>

/**
 * How long a usage window may be, in days. **Refused above this, not capped** —
 * the rule `jobRunQuery.limit` already states: a caller who asked for more than
 * the platform will answer is owed a `400` naming the field, not a quietly
 * shorter answer they will mistake for the whole picture.
 *
 * 366 rather than 365, so "the last full year" is expressible in a leap year.
 */
export const USAGE_WINDOW_MAX_DAYS = 366

/**
 * The five things the meter records.
 *
 * Storage is two metrics and not one summed byte count: a sync grows storage
 * in jumps and time series grow steadily, and one number would let the first
 * crowd out the second on the invoice. The org that outgrew its bill would be
 * told to look at the wrong thing.
 */
export const usageMetric = z.enum(['api_calls', 'live_session_ms', 'retention_bytes', 'asset_bytes', 'robot_online_ms'])
export type UsageMetric = z.infer<typeof usageMetric>

/**
 * A UTC calendar day, `YYYY-MM-DD`.
 *
 * A string and not a millisecond instant, because the thing being described is
 * a day and not a moment: a `Date` here would carry a time and a zone the
 * column does not have, and every bug in this area starts with one being
 * silently converted.
 *
 * **The regex checks shape, not validity** — `2026-13-45` and `2026-02-30`
 * both match `\d{4}-\d{2}-\d{2}$` — so the `.refine()` below round-trips the
 * string through `Date`'s UTC parser and rejects anything that does not come
 * back unchanged: `2026-13-45` parses to `Invalid Date`, and `2026-02-30`
 * (which `Date` rolls over rather than rejects) comes back as `2026-03-02`,
 * a mismatch either way. Same defect class as `auditQuery.from_ms`'s
 * `253402300800000`: a value that is the right *shape* reaching the Postgres
 * bind path for a `date` column and answering `500` where `400` belongs.
 *
 * **What the published artifact does not say:** `wireTimestampMs`'s own
 * note applies unchanged — a `.refine()` has no JSON Schema rendering, so
 * `org-usage-query.schema.json` shows only the shape-checking `pattern` and
 * a generated client that validates against the artifact alone will believe
 * `2026-02-30` is acceptable. The runtime is the authority for this field.
 */
export const usageDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a UTC calendar day, YYYY-MM-DD')
  .refine(
    (day) => {
      const parsed = new Date(`${day}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
    },
    { message: 'must be a UTC calendar day, YYYY-MM-DD' },
  )

/**
 * **The window is inclusive at both ends**, unlike every millisecond window in
 * this file (`from_ms`/`to_ms`, which are half-open).
 *
 * That inconsistency is deliberate and is stated here rather than left to be
 * discovered: a calendar day is a unit, not an instant, and a person asking for
 * July will write `from_day=2026-07-01&to_day=2026-07-31`. A half-open day
 * window would silently drop the 31st.
 *
 * Both parameters are required and have no default — the rule `/api/org/latency`
 * and `/api/org/jobs/summary` already follow. "This month" is a question only
 * the caller's calendar can answer, and a default window would be a query size
 * chosen by whoever forgot to pass one.
 *
 * **The published artifact cannot express any of this**, and that is worth
 * saying out loud rather than leaving a reader to assume the JSON Schema is
 * the whole contract, for `orgLatencyQuery`'s own reason: a cross-field
 * comparison has no JSON Schema rendering, so `org-usage-query.schema.json`
 * describes two independent pattern-matched strings and validates an
 * inverted window happily — the cloud is the only enforcement point for the
 * ordering. The artifact is equally silent about the inclusivity called out
 * above: nothing in the shape distinguishes an inclusive day window from a
 * half-open one, that is a fact about behaviour, not a field (the same gap
 * `historyQuery`/`historyBucketsResponse` name for their own half-open
 * boundary). And it says nothing about `USAGE_WINDOW_MAX_DAYS` at all — the
 * constant is not wired into this schema as a check on the span between
 * `from_day` and `to_day`; the cloud route is where a caller who asked for
 * more than the ceiling is refused, so a generated client validating against
 * the artifact alone can build a five-year window and get a `400` from the
 * route it did not predict.
 */
export const orgUsageQuery = z
  .object({ from_day: usageDay, to_day: usageDay })
  .strict()
  .refine((query) => query.from_day <= query.to_day, {
    message: 'from_day must not be after to_day',
    path: ['from_day'],
  })
export type OrgUsageQuery = z.infer<typeof orgUsageQuery>

/**
 * One day's reading for one metric.
 *
 * **`app_id` is `null` when the consumer is the org itself**, and
 * what that `null` means for billing depends on the *metric*, not on
 * `app_id` alone. `api_calls` and `live_session_ms` are attributable to an
 * app: a `null` app_id on those two is the developer console's own traffic,
 * deliberately *not* billable. `retention_bytes`, `asset_bytes` and
 * `robot_online_ms` have no app dimension at all — every row for those three
 * carries `app_id: null` unconditionally, and every one is billable org-level
 * consumption. **A reader must check `metric` before treating `app_id ===
 * null` as "not billable"** — for three of the five metrics that reading is
 * always wrong.
 *
 * `app_name` is `null` whenever `app_id` is, and also when the app has since
 * been deleted — usage outlives the app it was attributed to, because an org
 * still owes for what it used. A UUID alone on an invoice line helps nobody,
 * and a copy of the name stored on every row would be a second truth that
 * drifts on the first rename.
 *
 * **What this number cannot promise**, and the bound is conditional rather
 * than flat. `api_calls` and `live_session_ms` are aggregated in memory and
 * written every 30 seconds.
 *
 * *While those writes are landing*, a `kill -9` loses up to 30 seconds of
 * counting — never more, and never against the caller, since an unflushed
 * count is simply not billed.
 *
 * *While they are failing* — an unreachable database, say — that bound does
 * not hold at all: everything counted since the last successful flush is
 * held in memory, deliberately uncapped, and a `kill -9` loses all of it.
 * The trade is intentional (dropping billing data to bound process memory is
 * the worse half of it), but "at most one interval" describes a platform whose
 * writes are landing, not a guarantee that survives an outage.
 *
 * A row the database rejects **permanently** — most concretely one whose org
 * has been deleted since the count, since a usage row's `org_id` is `ON
 * DELETE NO ACTION` — is written off instead: given up on, reported with a
 * count, and never billed. That is a deliberate loss, and it is the smaller
 * one. Before it, a single such row failed the whole batched write on every
 * retry, forever, and stopped `api_calls` and `live_session_ms` reaching the
 * database for **every** org on the platform.
 *
 * A graceful shutdown loses nothing **provided its final flush succeeds**.
 * If that write fails, the process reports how many rows it is carrying and
 * exits carrying them — there is no second attempt, because there is no
 * longer a process to make one.
 *
 * The other three metrics never travel this path. They are sampled from
 * other tables on their own timer and can lag; what a missed sample costs,
 * per metric, is in the docs' `/api/org/usage` notes.
 */
export const usageRow = z.object({
  app_id: z.uuid().nullable(),
  app_name: z.string().nullable(),
  metric: usageMetric,
  day: usageDay,
  value: z.number().int().nonnegative(),
})
export type UsageRow = z.infer<typeof usageRow>

/** The window is echoed back for `orgLatencyResponse`'s reason: a rendered total has to be able to say which window it describes. */
export const orgUsageResponse = z.object({
  rows: z.array(usageRow),
  from_day: usageDay,
  to_day: usageDay,
})
export type OrgUsageResponse = z.infer<typeof orgUsageResponse>

/** `PATCH /api/robots/:id` — rename the robot. Display-only: nothing references robot names. */
export const patchRobotRequest = z.object({ name: z.string().min(1).max(63) }).strict()
export type PatchRobotRequest = z.infer<typeof patchRobotRequest>

/**
 * `POST /api/robots/:id/config/rename-slug` — atomic server-side rename:
 * rewrites the **draft** config, every app-role grant carrying
 * `{robot_id, from}`, and the recorded history rows, in one transaction.
 * Job runs and audit events keep the old slug as historical fact. The
 * published config is immutable, so the caller must publish afterwards
 * (`requires_publish`); samples arriving between rename and the applied
 * publish still land under the old slug — named residual, not migrated.
 * Second residual in that same window: grants and the draft already name
 * `to`, but the still-published config exposes only `from` until the
 * publish lands — an end user's app has no working name for the datapoint
 * at all for however long that gap lasts, since `to` isn't published yet
 * and `from` no longer has a grant behind it. The console must publish
 * immediately after a rename to keep this window short; nothing server-side
 * closes it.
 * This schema only enforces slug *shape*; whether `to` is reserved or
 * already in use on this robot is checked once, behind the cloud's
 * `validation.ts` door — one door, not a second copy of that rule here.
 */
export const renameSlugRequest = z.object({ from: slug, to: slug }).strict()
export type RenameSlugRequest = z.infer<typeof renameSlugRequest>

export const renameSlugResponse = z.object({
  rewritten_grants: z.number().int().nonnegative(),
  history_moved: z.boolean(),
  requires_publish: z.literal(true)
})
export type RenameSlugResponse = z.infer<typeof renameSlugResponse>

/**
 * `GET /api/robots/:id/config/slug-usage/:slug` — what a rename would touch;
 * feeds the console's confirm dialog.
 *
 * `alert_count` is part of the atomic rename transaction alongside grants and
 * history: alerts are keyed by `(robot_id, slug)` too, and a rename that
 * silently moved the alert row while the usage preview stayed silent about it
 * would show a developer a smaller blast radius than the rename actually has.
 */
export const slugUsageResponse = z.object({
  grant_count: z.number().int().nonnegative(),
  app_identifiers: z.array(z.string()),
  has_recorded_history: z.boolean(),
  alert_count: z.number().int().nonnegative(),
})
export type SlugUsageResponse = z.infer<typeof slugUsageResponse>
