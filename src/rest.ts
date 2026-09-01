import { z } from 'zod'
import { bridgeState, MAX_PATIENCE_MS, MIN_PATIENCE_MS } from './protocol.js'
import { slug, rosTypeName, wireTimestampMs } from './common.js'
import { configState, rateThrottleHz, robotConfigDoc, snapshotIntervalSeconds, validationIssue } from './config.js'
import { rosGraph, typeDefinition } from './introspection.js'
import { job } from './jobs.js'

/**
 * REST shapes of the robot resource (spec §11.1). W1 scope: create, list,
 * get, and the built-in `bridge_state` datapoint read.
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

/**
 * How many things a robot exposes, per kind (spec `2026-08-21-exposure-and-revoke-design` D1).
 *
 * **Five numbers, never a sum.** `robotDeletionSummary.slug_count` already made
 * this call and wrote down why: fold cameras in and the sentence "this deletes
 * N slugs and M cameras" counts them twice. A list row has the same problem.
 *
 * **Counted from the published configuration, and excluding the built-ins.**
 * `GET /api/robots/:id/exposures` answers *which* slugs and prepends the
 * three built-in datapoints — `bridge_state`, `robot_details` and
 * `bridge_pressure` — as `builtin: true`; this answers *how many* and counts
 * only what somebody configured. So a robot with an empty published config
 * reports `datapoints: 0` here and three entries there. That is intentional,
 * and it is written on both sides so the disagreement is never mistaken for a
 * bug.
 *
 * The number is "three" and not "two" as of `bridge_pressure`; the cloud
 * builds that prefix from `PLANE_BUILTIN_DATAPOINTS` rather than a literal,
 * so a further built-in moves this count again. Read the count off that set,
 * not off this sentence, before filing the bug this comment exists to
 * prevent.
 */
export const exposureCounts = z.object({
  datapoints: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  services: z.number().int().nonnegative(),
  publishers: z.number().int().nonnegative(),
  cameras: z.number().int().nonnegative(),
})
export type ExposureCounts = z.infer<typeof exposureCounts>

/** A robot as listed, with its current built-in `bridge_state`. */
export const robotListItem = z.object({
  ...robot.shape,
  bridge_state: bridgeState,
  /** Required, not optional: "we did not look" and "it exposes nothing" must not render the same. */
  exposes: exposureCounts,
})
export type RobotListItem = z.infer<typeof robotListItem>

export const robotListResponse = z.object({
  robots: z.array(robotListItem),
})
export type RobotListResponse = z.infer<typeof robotListResponse>

/**
 * The REST read of one datapoint. For bridge-captured data `timestamp_ms`
 * is the capture time at the bridge (spec §6.3); for the cloud-observed
 * built-in `bridge_state` it is the time the cloud observed the state.
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
 * per-robot API (§11.2).
 *
 * **The OpenAPI rendering does not exist.** This comment used to name a
 * release it would "arrive in", and was wrong twice over: once when that
 * release shipped without it, and a second way ever since, because a promise
 * with an expired date reads as a plan rather than as a gap. It states the
 * fact instead of a schedule.
 */
export const datapointDescriptor = z.object({
  slug,
  builtin: z.boolean(),
  unit: z.string().nullable(),
  /**
   * `null` for a built-in and for a datapoint published with no throttle —
   * the same "no ceiling configured" fact `datapointConfig.rate_throttle_hz`
   * itself carries as `0` or absence, just re-spelled nullable rather than
   * optional because this shape is a read response, not a document a caller
   * writes. Reuses `rateThrottleHz` so the 20 Hz ceiling is written once.
   */
  rate_throttle_hz: rateThrottleHz.nullable(),
})
export type DatapointDescriptor = z.infer<typeof datapointDescriptor>

export const datapointListResponse = z.object({
  datapoints: z.array(datapointDescriptor),
})
export type DatapointListResponse = z.infer<typeof datapointListResponse>

/**
 * The built-in `robot_details` datapoint (spec §4.3): static properties the
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
 * | `POST /api/robots/:id/jobs/:slug/cancel` | `cancelRequest` | `jobResponse` |
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
  patience_ms: z.number().int().min(MIN_PATIENCE_MS).max(MAX_PATIENCE_MS).optional(),
})
export type InvokeRequest = z.infer<typeof invokeRequest>

/**
 * The answer to an invoke. The job id is informative (§11.3): state is
 * observed by slug afterwards, over polling or a subscription.
 */
/**
 * The body of a cancel (W6b). **Every field optional, and the body itself may
 * be absent** — `POST .../cancel` was bodyless before this wave and every
 * existing caller still sends nothing.
 *
 * That is not politeness, it is the W5 defect: a bodyless `POST` carrying
 * `content-type: application/json` was rejected outright, which made
 * `cameras.live()` unreachable through the SDK and took `cancel`, publish,
 * restore, key rotation and member removal with it — unnoticed since W4. A
 * schema that demands a body would reintroduce it on the one verb that stops
 * a machine.
 *
 * **`.strict()`, and that is the whole point of the shape.** A plain object
 * strips unknown keys, so a caller who *means* to name a job and misspells the
 * field — `jobId` for `job_id` — has their id silently removed and gets the
 * **slug-wide** cancel instead: the most destructive reading of a request they
 * did not make. Measured in W6b's review: `{"jobId": "<some other job>"}`
 * answered `200` and stopped the job that was actually running, which nobody
 * had named. The `?force=true` precedent this route's design borrowed from
 * fails *safe* on a typo — a misspelled `force` simply does not force.
 * Stripping here fails unsafe, so unknown keys are refused instead.
 *
 * `job_id` absent and `job_id: null` mean the **same** thing here, and that is
 * deliberate: over REST an absent body is how every caller written before this
 * wave says "cancel whatever is running". On the socket, `clientCancel.job_id`
 * is required-and-nullable instead, because a frame is assembled fresh by a
 * client that has already been updated — there, `null` is a decision and an
 * omission is a bug.
 */
export const cancelRequest = z.object({
  job_id: z.uuid().nullable().optional(),
}).strict()
export type CancelRequest = z.infer<typeof cancelRequest>

/**
 * The query of a live release (W6b): `DELETE .../live?session_id=<uuid>`.
 *
 * A query parameter rather than a body, following `?force=true` on robot
 * deletion — the precedent this repo already set for "a DELETE that needs one
 * more fact". A body on a DELETE is carried inconsistently by proxies and by
 * `fetch` itself, and this call runs from a browser tab that is often closing.
 *
 * **`.strict()`, for the reason `cancelRequest` is** — `?sessionid=` instead of
 * `?session_id=` was measured releasing **both** of an identity's holds and
 * stranding the other tab, which is precisely the defect this field was added
 * to remove. A refused typo costs a round trip; a stripped one stops a robot
 * somebody else is watching.
 *
 * Absent means today's meaning: release **all** of this identity's holds on
 * this camera. A client that has lost its id, or is going away entirely, still
 * needs a way to let go — it is the blunt form, and it is the one that strands
 * the identity's other tabs.
 */
export const releaseLiveQuery = z.object({
  session_id: z.uuid().optional(),
}).strict()
export type ReleaseLiveQuery = z.infer<typeof releaseLiveQuery>

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
 * Every job the platform currently believes this robot has — `GET
 * /api/robots/:id/jobs` (W6b).
 *
 * `jobResponse` answers "what is on this slug", which requires knowing the
 * slug first. That was enough while a job could only exist on a slug the
 * published configuration named. W6b breaks that assumption twice: a
 * reconnecting bridge can name a job the cloud has **no row for** and the
 * cloud adopts it, and a configuration change can leave a job on a slug the
 * document no longer contains. Both are jobs nobody can ask about, because
 * asking requires already knowing what to ask for.
 *
 * So this route exists to answer the question the per-slug route cannot: not
 * "is something running here", but "what is this robot doing". A restarted
 * cloud that has just reconciled a robot's `hello.active_jobs` has exactly
 * this list and, until now, no way to say it out loud.
 *
 * The array is ordered newest first and is **never null**: a robot doing
 * nothing answers `{ jobs: [] }`. "Nothing is running" and "we did not look"
 * are different facts, and a nullable list would merge them — the same
 * distinction `robotDeletionSummary` was made all-required for.
 *
 * **At most one entry per slug: the current job there, exactly what
 * `jobResponse` would answer for that slug.** This is not a history endpoint
 * and must not become one. The first implementation returned every job the
 * registry still held — six rows and four complete Fibonacci results after a
 * few minutes of gate traffic, and unbounded in both count and payload for a
 * robot that has been working all day. The list would have grown until a
 * console page carried a robot's entire past, and the one thing it exists to
 * answer — *what is this robot doing* — would have been the first line of a
 * scroll.
 *
 * A settled job stays visible as its slug's current entry until something
 * else runs there, which is what makes a job that just failed still findable.
 * Read `state` to tell a live one from a finished one, exactly as with
 * `jobResponse`.
 */
/* ------------------------------------------------------------------ W6c --
 * Identity, rewritten by the 2026-08-29 org-central redesign (D1/D2/D6).
 * Written down here for the same reason the W4 command routes were: **a body
 * schema does not imply a path**, and three consumers were about to derive
 * nine paths independently from one implementation.
 *
 * **One pool, one prefix.** The `/api/org/` vs `/api/end-users/` split that
 * this table used to insist on ("the two identity spaces must never
 * authenticate each other") described two identity spaces that no longer
 * exist. Users, groups and assignments are org-scoped and live under
 * `/api/org/`; what is still separated is not *who a person is* but *what they
 * are claiming*: the console surface (`/api/auth/`, Org Admins only) and the
 * app surface (`/api/client/`, an assignment for a named app).
 *
 * | route | body | answers |
 * |---|---|---|
 * | `GET    /api/org/groups`                    | —                          | `groupListResponse` |
 * | `GET    /api/org/groups/:id`                | —                          | `orgGroup` |
 * | `POST   /api/org/groups`                    | `createGroupRequest`       | `orgGroup` |
 * | `PATCH  /api/org/groups/:id`                | `patchGroupRequest`        | `orgGroup` — the Org Admins group is renamable here |
 * | `DELETE /api/org/groups/:id`                | —                          | 204 — `group_not_deletable` for the Org Admins group, `group_in_use` while it holds members or apps |
 * | `GET    /api/org/groups/:id/usage`          | —                         | `groupUsageResponse` — the members + apps attached to this group (delete preview) |
 * | `GET    /api/org/groups/:id/oidc-provider`  | —                          | `groupOidcProvider` — `404` when the group has none configured |
 * | `PUT    /api/org/groups/:id/oidc-provider`  | `putGroupOidcProviderRequest` | `groupOidcProvider` — the Org Admins group is refused `target_state_conflict` / `org_admins_group`; the first write must carry `client_secret` |
 * | `DELETE /api/org/groups/:id/oidc-provider`  | —                          | 204 — `404` when the group has none configured |
 * | `GET    /api/org/users`                     | —                          | `orgUserListResponse` |
 * | `GET    /api/org/users/:id`                 | —                          | `orgUser` |
 * | `PATCH  /api/org/users/:id`                 | `patchUserRequest`         | `orgUser` — **no email, no group, no tier** |
 * | `DELETE /api/org/users/:id`                 | —                          | 204 — **and every session of that user ends** |
 * | `GET    /api/org/users/:id/usage?group_id=` | —                          | `groupUsageResponse` — the move preview |
 * | `POST   /api/org/users/:id/move-group`      | `moveUserGroupRequest`     | `orgUser` — cascade, behind the acknowledgement |
 * | `PUT    /api/org/users/:id/tier`            | `tierChangeRequest`        | `orgUser` — **Owner**, last-owner guarded |
 * | `GET    /api/org/users/:id/assignments`     | —                          | `appAssignmentListResponse` |
 * | `PUT    /api/org/users/:id/assignments/:appId` | `putAssignmentRequest`  | `appAssignment` |
 * | `DELETE /api/org/users/:id/assignments/:appId` | —                       | 204 |
 * | `GET    /api/apps/:id/group-usage?group_id=` | —                         | `groupUsageResponse` — the re-link preview |
 * | `PUT    /api/apps/:id/group`                | `putAppGroupRequest`       | `app` — cascade, behind the acknowledgement |
 * | `POST   /api/org/users/invitations`         | `createUserInviteRequest`  | `userInvite` |
 * | `GET    /api/org/users/invitations`         | —                          | `userInviteListResponse` — pending only, **no tokens** |
 * | `DELETE /api/org/users/invitations/:id`     | —                          | 204 |
 * | `POST   /api/org/users/invitations/accept`  | `acceptUserInviteRequest`  | 204 — unauthenticated, **and the login is created; sign in next** |
 * | `POST   /api/auth/password/change`          | `passwordChangeRequest`    | `sessionTokens` — authenticated, **console** |
 * | `POST   /api/auth/password/reset`           | `passwordResetRequest`     | 202 — unauthenticated, **always the same answer** |
 * | `POST   /api/auth/password/reset/confirm`   | `passwordResetConfirm`     | 204 — unauthenticated |
 * | `POST   /api/client/password/change`        | `passwordChangeRequest`     | `sessionTokens` — authenticated, **app session** |
 * | `POST   /api/client/password/reset`         | `clientPasswordResetRequest`| 202 — unauthenticated, **carries the app** |
 * | `POST   /api/client/password/reset/confirm` | `passwordResetConfirm`      | 204 — unauthenticated |
 *
 * **Deleted with no successor** (D6), listed so that a consumer looking for
 * them finds the reason rather than a 404: `POST /api/client/register` and
 * `/register/confirm`, `GET|PUT /api/apps/:id/self-registration`, the per-app
 * end-user CRUD and invitation routes, and `GET|DELETE|PATCH
 * /api/org/members[/:id]`. Client apps move to the new flow; there are no
 * compatibility aliases, because an alias here is how the deleted model would
 * survive in production while the contract said otherwise.
 *
 * **A group's OIDC provider is config, the login it enables is not.** The three
 * `oidc-provider` rows above are the developer-facing CRUD (Org Admins only) for
 * *which* IdP a group federates to (`groupOidcProvider` / D3). The *login* that
 * uses it — the federated authorize/callback legs and the org-admin
 * impersonation interstitial — is not a `/api/` REST shape but a browser flow
 * of server-owned redirect targets, and it lives with the other OAuth paths in
 * `OAUTH_PATHS` (`idpStart`, `idpCallback`, `impersonate`), for the same reason
 * `authorize` and `token` do: a client never constructs those paths, it is sent
 * to them. The cloud is the authorization server; toward the group's IdP it is a
 * relying party (see `oauth.ts`).
 *
 * **A group move and an app re-link are their own routes, not fields on a
 * PATCH.** Both cascade-delete assignments, both are preceded by a
 * `groupUsageResponse` read, and both refuse without
 * `acknowledge_assignment_loss: true` (see `moveUserGroupRequest` for why the
 * acknowledgement is unconditional and a literal). The preview is a separate
 * GET rather than a dry-run flag on the write, so that fetching it can never
 * perform anything.
 *
 * **`POST /api/auth/password/reset` answers `202` for every well-formed
 * address**, known or not. It is the one route where §3.3's silence about
 * existence is not a preference but the entire point: any status, body or
 * timing difference between the two cases is an account-enumeration oracle.
 * Note *timing* — a route that only sends mail for a real address must not
 * become measurably faster for an unknown one. Email is **globally unique**
 * (Andre, 2026-08-29), so a bare address names at most one account and the
 * route mails the one match, if any; the per-org detour the 2026-08-29
 * redesign briefly took (multi-candidate verify on login, mail-every-match on
 * reset) is retired, with no shape change. See `passwordResetRequest`.
 *
 * **Both surfaces get the password routes, mirrored.** Cluster D named the end
 * user explicitly — *"an end user cannot change their own password, and there
 * is no reset path"* — and a console user needs the same thing; the first
 * version of this table gave the routes only one prefix, which would have
 * shipped the wave's named item for the wrong principal. The shapes are shared
 * because the operation is identical; the **prefix** is what says which
 * session is being spent, exactly as it does for `login`.
 *
 * **A password change answers with fresh `sessionTokens`, not `204`.** The
 * promise is that the session which made the change survives while every other
 * one dies — and `passwordChangeRequest` carries nothing that identifies the
 * caller's refresh family, so a route given only that shape cannot spare one.
 * Re-issuing is the honest way to keep the promise: revoke everything, hand the
 * caller a new pair. Anything else means the caller keeps working until their
 * access token expires and is then silently logged out, which is
 * indistinguishable from the change having failed (Nimbus-W6c).
 *
 * **Every link this wave mails must carry what the page needs to act on it.**
 * Three things were mailed to pages that could not handle them — a reset link
 * to the *request* page, an accept link to a `404`, a register confirmation to
 * a redirect (Kassandra-W6c). Fixing the paths alone would have left the defect
 * underneath: **both surfaces mailed the identical reset URL**, and the
 * console's confirm page posts to the console route, so an app user's token
 * sent there answers `token_spent` forever. A URL that does not say which
 * surface minted it cannot be routed correctly by anything.
 *
 * So the link shapes are fixed here rather than in whichever repo builds them.
 * **They moved to the auth portal** (auth-portal spec `2026-08-30`, D-A1): the
 * console serves no credential page at all any more, and `{portal}` is the
 * cloud's `AUTH_PUBLIC_URL` — `auth.fleetless.dev` where the deployment has
 * that vhost, the cloud's own base where it does not, since the cloud renders
 * these pages itself either way.
 *
 * | purpose | URL |
 * |---|---|
 * | password reset             | `{portal}/reset-password/{token}` |
 * | user invitation            | `{portal}/accept-invite/{token}` — one link for every user now, admin or not |
 *
 * The **app** password reset row is deleted rather than re-pointed: that flow
 * has no producer and no route. Nothing in the cloud ever built or mailed
 * `{console}/app/{identifier}/reset-password/{token}`, and the endpoint its
 * page posted to was never registered — train C deleted the page and said so.
 * If an app's end users are ever to reset a password, that is a feature to
 * design, not a row to restore.
 *
 * The strings themselves live in `cloud/src/portal-paths.ts`, read by the
 * route that serves each page AND by the builder that mails it — one constant,
 * because the defect this table records happened again after it was written:
 * `buildAcceptUrl` mailed `{console}/accept-invite/{token}` while the console
 * served `/invite/{token}`, and this table said a third thing. Nothing caught
 * it because nothing shared a string.
 *
 * ## W7 — the asset store (§4.6)
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
 * **The read routes are dual-mode, and the first version of this table said
 * `developer` for all three — contradicting the sentence that followed it.**
 * `assets` is an *app-role* capability (§3.3), and developers are not in any
 * app's role system at all (§3.1/§3.4: two identity spaces, and a credential
 * from one never authenticates the other). Enforced literally, an end user
 * could never fetch a URDF — which is §4.6's entire "Clients: `GET .../urdf`"
 * story, and the audience the asset store exists for.
 *
 * So: a developer reaches the robot because it belongs to their org; an end
 * user reaches it when their role grants `assets`. Caught by Threepio-W7
 * reading §3.3 against this table before anything was built on it — the second
 * time in two waves that this one check has caught a delta placing a feature
 * in the wrong identity space.
 *
 * **The rewritten mesh URIs in a served URDF are absolute, not
 * root-relative.** A relative URL resolves against *the consumer's* origin,
 * and the consumers here are apps on other domains — so `/api/robots/…` would
 * 404 against the customer's own site. This is the same mistake as W5's
 * `LIVEKIT_URL=localhost`, which was handed to a viewer's browser and cost an
 * afternoon: **a URL we hand to somebody else's browser must never be relative
 * to ours.** Raised by Data-W7 asking which it was rather than assuming.
 *
 * **There is no per-asset `DELETE`, and its absence is the design.** The first
 * version of this table had one, for symmetry — which is not a reason. Assets
 * are immutable and content-addressed, and the operation a developer actually
 * performs is *the URDF changed, sync again*: a **re-sync reconciles**, so
 * assets the new URDF no longer references stop belonging to that robot. One
 * mechanism instead of two. Robot deletion is already covered by W6a's
 * cascade.
 *
 * Left in, it would have been a route with no console, no SDK method and no
 * gate step — register row 8's third instance, in the wave whose own contracts
 * file warns about the first two by name. Caught by Eve-W7 asking why it was
 * in her mission's route table but in neither her mission nor the gate.
 *
 * Reading is a role capability; **changing the store is Owner-tier**, matching
 * W6c's reading of §3.1 — a sync spends the org's asset quota and a deletion
 * breaks every app rendering that robot, so neither is a Member's to do.
 *
 * **`GET .../assets/missing` shipped undocumented for a whole wave and is the
 * sole producer of `asset_missing` (W7a, Momus-W7 M5).** It never succeeds,
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
 * where a rate limit and a size ceiling matter most, and where W6c's own rule
 * applies: the refusal must precede the work, not follow it.
 *
 * The end-user links carry `app_identifier` because the page cannot act
 * without it: `clientPasswordResetRequest` requires it, and an end user is
 * identified by **app and address**, never address alone. The token alone is
 * not enough, and a page that guesses the app is a page that guesses wrong.
 *
 * **This is a stopgap and should be named as one.** An app's users landing on
 * *our console* to reset a password is wrong — the page belongs to the app,
 * and an app has no configured base URL to send them to. Registered for W7;
 * until then the console hosts both, and the URL carries the app so that
 * moving it later is a redirect rather than a redesign.
 *
 * **`DELETE /api/org/members/:id` is not a row deletion.** Gate step 3 takes a
 * token minted before the removal and uses it; if it still works, the feature
 * is not built. `revokeSessionsForSubject` is already wired.
 */

/**
 * What a `rate_limited` refusal tells the caller (W6c).
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
 * `started_at`, with `seq` as the tiebreaker** (W7, register rows 2j and 2l).
 *
 * The field is named because the previous version of this comment claimed an
 * order without saying what produced it, and the answer turned out to matter
 * twice over:
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
  jobs: z.array(job),
})
export type RobotJobsResponse = z.infer<typeof robotJobsResponse>

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
 * The metadata an asset upload carries beside its raw body (W7).
 *
 * Here rather than as a convention documented on both sides, and the reason is
 * a scar. W5 shipped `x-fleetless-*` headers the CORS policy did not expose,
 * so `age_ms` was `null` in **every** browser while the SDK documented `null`
 * as "nothing captured yet" — a fresh frame reporting as no snapshot at all,
 * invisible to three test suites because none of them was a browser. And W6b
 * found the general form: three repos agreeing with each other about a payload
 * none of them exchanged, each right in its own tests.
 *
 * **A string shared by two repos and defined in both is a string that drifts.**
 * A zod schema cannot validate a header, which is an argument for writing the
 * names down once, not an argument for writing them down twice.
 *
 * `name` is the `package://` URI verbatim for a mesh — the same string
 * `asset.name` stores, and the same one `urdfCompleteness.missing` reports, so
 * a failed upload and a missing mesh can be matched by eye.
 */
/**
 * **`name` travels percent-encoded, and that is a fix rather than a
 * convention** (W7a review, André's decision to fix rather than defer).
 *
 * HTTP header values are latin-1 (`http.client` in Python, and the same is
 * true on the other side). So a texture called `textures/日本語.png` raised a
 * `UnicodeEncodeError` **inside `urllib`** — a `ValueError`, caught by neither
 * `HTTPError` nor `URLError` — which propagated to the sync's broad handler
 * and marked **everything still remaining** as failed. One non-ASCII filename
 * cost a developer every mesh after it in that sync, with no cause on the
 * wire. R6 made it ordinary rather than exotic: `.dae` internal names come
 * from 3D-authoring tools, where non-ASCII is Tuesday.
 *
 * The encoding is not invented here. **`GET .../assets/missing?name=` already
 * carries this exact string percent-encoded**, because a query parameter is
 * percent-encoded by definition — same value, same wire, question already
 * answered.
 *
 * **It is a SECOND header, and that is the whole design rather than a
 * detail.** The first version overloaded `name` itself: the producer would
 * encode, the store would `decodeURIComponent`. That decodes identically for
 * every name without a `%`, so an **older bridge and a newer cloud agree by
 * luck** — right up until a name contains `%2f`, which the store would then
 * silently turn into a `/`. A wire change whose breakage is invisible in the
 * common case and silent in the uncommon one is the worst of both (Argus-W7a,
 * reading the contract rather than the code).
 *
 * So `name` keeps meaning exactly what it always meant, and `nameEncoded`
 * carries the percent-encoded UTF-8 form. **The store prefers `nameEncoded`
 * when present and uses `name` otherwise**, so:
 *
 * - an older bridge sends only `name` and behaves exactly as before;
 * - a newer bridge sends both, and a name it cannot express in latin-1 travels
 *   intact for the first time;
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
   * **Die angekündigte Größe, und sie ist der Grund, warum `asset_too_large`
   * überhaupt entstehen kann (W9b, DEF-116).**
   *
   * Fastifys `bodyLimit` greift im Content-Type-Parser, also **vor** dem
   * Handler — eine zu große Datei bekam damit ein blankes `413 bad_request`
   * ohne `limit_bytes` und ohne `size_bytes`, und der strukturierte Fehlercode,
   * den `assetTooLargeDetails` beschreibt, hatte schlicht keinen erreichbaren
   * Erzeuger (Momus-W7, M1, an den echten Routenoptionen reproduziert).
   *
   * Mit einer angekündigten Größe im Kopf kann die Ablehnung dort entstehen,
   * wo sie etwas sagen kann: bevor ein Byte gepuffert ist, mit beiden Zahlen.
   * Und die Bridge erfährt ihre Grenze, ohne 194 MB zu lesen, um sie zu
   * entdecken — was am 2026-08-18 auf rx1 genau so ausging (DEF-148).
   *
   * Der Kopf ist eine **Ankündigung, kein Beweis**: Ein Absender kann lügen.
   * Der Deckel gilt weiterhin auch am Körper — dies ersetzt die Durchsetzung
   * nicht, es macht die Absage nur beantwortbar.
   */
  size: 'x-fleetless-asset-size',
} as const

export const cameraDescriptor = z.object({
  slug,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  /**
   * Seconds, as the document spells it, reusing `snapshotIntervalSeconds` so
   * the 1–3600 bound is written once. It was `snapshot_interval_ms` after the
   * document moved to seconds, which left the cloud converting the unit on
   * this descriptor and not on `datapointDescriptor` beside it — the same
   * drift `rateThrottleHz` was extracted to stop.
   */
  snapshot_interval_seconds: snapshotIntervalSeconds,
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
 * **Both history shapes answer the same boundary the same way: `[from, to)`
 * (W9d, DEF-062 — decision pre-made at the W6 boundary so no wave
 * re-litigates it).**
 *
 * They did not. `samples` was inclusive of `to`, `buckets` exclusive — same
 * range, same data, opposite answers for a point landing exactly on `to`, and
 * the buckets answer rendered as a gap tooltipped *"empty — no samples"*.
 * `sdk/README.md` documented the inclusive notation for the half-open path,
 * so it was wrong for one of the two whichever way you read it.
 *
 * Half-open wins because it is the only rule under which **adjacent windows
 * tile without overlap**: `[0,10)` then `[10,20)` covers every instant once.
 * With an inclusive upper bound a sample at exactly `10` belongs to both
 * windows, and any consumer summing them counts it twice.
 *
 * This is a statement about behaviour, not a field — nothing in the shapes
 * below can enforce it. It is written here because this is the one place both
 * shapes are defined together, and the cloud's `history-store` and the SDK's
 * README are the two places that have to agree with it.
 */

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
   * **A union whose input branch IS the wire, not a coercion (W9d, DEF-059).**
   *
   * This was `z.coerce.number()`, for a good reason that stayed true: the
   * schema describes a **query string**, where every value arrives as text,
   * and a bare `z.number()` would make each route coerce by hand. What was
   * measured afterwards is that a coercion cannot be *published*: zod renders
   * a coercion's **result** in either `io` mode, so `io: 'input'` and
   * `io: 'output'` both emit `{"type":"integer"}` — an artifact describing a
   * shape a query string can never carry. Anyone validating a real request
   * against it rejects every one that sets `limit`.
   *
   * That is a **different** defect from the `.default()` class, which
   * `io: 'input'` genuinely does fix; `export-schemas.ts` once claimed one
   * remedy for both and has been corrected.
   *
   * A union states both truths honestly: the wire carries a numeric string,
   * a programmatic caller may pass a number, and the artifact can render the
   * input branch because there is one to render.
   *
   * **What the artifact no longer says, named here rather than left silent.**
   * The `1..10000` bound lives in the `.pipe()`, which is the *output* half, so
   * no input-mode artifact can express it as a constraint: the published shape
   * is `^\d{1,5}$` or a bare integer, and five digits is a weak echo of the
   * real ceiling. That is honest about the wire — the bound is enforced after
   * parsing, not by the shape of the text — but it is a **reduction**, and an
   * artifact that stops naming a bound reads as if there were none.
   *
   * So both branches carry the number in a `.describe()` (Nimbus-W9d's
   * proposal). It is **not** a constraint and nothing validates against it; it
   * means a generator, or a person reading only the published schema, sees the
   * actual ceiling instead of nothing. The gap is narrowed and named rather
   * than closed.
   */
  limit: z
    .union([
      z
        .string()
        .regex(/^\d{1,5}$/)
        // **The description carries the number the shape cannot** (Nimbus-W9d's
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
    .optional(),
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
  /**
   * Assets destroyed with the robot (W7), and **`asset_bytes_freed` is what
   * this org actually gets back** — not the sum of the assets' sizes.
   *
   * Storage is content-addressed, so a mesh two robots share survives the
   * deletion of one of them and frees nothing. Reporting the total would tell
   * a developer they are about to recover 400 MB and hand back 4, on the one
   * screen whose entire justification is naming what an irreversible click
   * destroys. Same reasoning that keeps `cameras` out of `slug_count`: this
   * summary is read aloud to a human, and a number that is nearly right is
   * worse here than an absent one.
   *
   * `asset_count` is the plain count of the robot's asset rows, all of which
   * do go away.
   */
  asset_count: z.number().int().nonnegative(),
  asset_bytes_freed: z.number().int().nonnegative(),
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
   * **Retiring with the credential store**, and not live behaviour to build
   * against. Its one producer was `cloud-config-frame.ts` tolerating an
   * unresolved `credentials_ref` at publish time; FL-002 deleted that field,
   * so nothing emits this today. It is kept only until the wave that removes
   * the store also removes these three credential states — `unreadable_credential`
   * and the `readable` fact on `credentialSummary` go the same way.
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
  /**
   * **Which of two questions this entry answers (W9a, DEF-072).**
   *
   * `'source'`  — can the source be read at all? (`unreachable`, `auth_failed`,
   *               `unreadable_credential`, `missing_credential`, `ok`, …)
   * `'publish'` — given a readable source, did publishing to LiveKit work?
   *
   * Before this, both went into one entry keyed `${robot} ${kind} ${ref}` with
   * one flat `state`, in which `publish_failed` answered *"can we publish"*
   * and every other value answered *"can the source be read"* — **same key,
   * same field, two questions**, so each overwrote the other. The conflation
   * was once an occasional race; W6a's reconnect restatement made it
   * guaranteed, on every reconnect, for any camera with an active viewer.
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
  /**
   * Asset storage (§4.6, W7) — **its own dial, not part of
   * `max_retention_bytes`.** A sync grows storage in jumps and time series
   * grow steadily; one dial would let the first crowd out the second, and the
   * org that hit its limit would be told to look at the wrong thing.
   *
   * **Counted per distinct blob *this org references* — not per asset row, and
   * not per object the platform stores on its behalf (W7a, D1).** The two
   * readings are indistinguishable from the number alone and a customer is
   * entitled to know which one they are being charged for.
   *
   * Within an org, sharing is free: two robots referencing the same mesh cost
   * one copy, which is what dedup means to a customer, and anything else
   * charges an org twice for a fleet of identical robots — the normal case.
   *
   * **Across orgs, sharing is not free, and W7 shipped the opposite.** Storage
   * stays globally content-addressed (one object per sha256; that efficiency
   * is real), but accounting is per-org: an org is charged for each distinct
   * blob it references and credited when its own last reference goes, whether
   * or not the blob survives for somebody else. Global refcounting made the
   * first org to sync a blob pay for it forever while every later org stored
   * it free — so the quota was evadable by anyone whose mesh someone else had
   * already uploaded, and an org's own number depended on who got there first,
   * which nobody can predict. Measured before the change: 342 bytes held by an
   * org owning no assets, with no operation able to free them.
   */
  max_asset_storage_bytes: z.number().int().nonnegative(),
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
  max_asset_storage_bytes: z.number().int().nonnegative(),
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
 * **Retiring with the credential store**, which FL-002 removes: a camera's
 * password now lives in the configuration document, on `config.ts`'s
 * `cameraCredentials`. This shape and its routes go when the store does, in
 * the wave that moves the contracts pin.
 *
 * **There is no password field here, and this route returns none.** A secret
 * you can read back is not a secret; `set` and `username` are enough to
 * manage a credential and not enough to be a leak.
 *
 * That used to be a statement about the whole REST API, and is now a
 * statement about this shape alone. Three shapes carry a camera password
 * since credentials moved into the document: `putConfigDraftRequest.doc`
 * carries one in, and `configDraftResponse.doc` and
 * `configVersionResponse.doc` hand it back to anyone who may read a robot's
 * configuration — for every published version, immutably. That was decided
 * against a recorded objection (see `cameraCredentials`), and the one bound
 * on it is that the publish audit event and the org event stream must not
 * carry the document body.
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

/**
 * Write-only, and retiring with the credential store — see
 * `credentialSummary`.
 *
 * It was the only shape carrying a password anywhere in the REST API until
 * credentials moved into `robotConfigDoc`. Now there are four, and this is
 * the only one of them that cannot be read back: `putConfigDraftRequest.doc`,
 * `configDraftResponse.doc` and `configVersionResponse.doc` all carry
 * `cameraCredentials.password`.
 */
export const credentialWriteRequest = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
})
export type CredentialWriteRequest = z.infer<typeof credentialWriteRequest>

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
 * **Written down here because the last time a delta shipped shapes without
 * their paths, a teammate had to ask three separate people** — see
 * `robotDeletionSummary`'s neighbouring table, which exists for exactly that
 * reason. The shapes landed one wave before the routes did, so this table is
 * the only place the two halves meet.
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
    /** Exclusive — half-open `[from, to)`, the convention every other query here already follows (DEF-062). */
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
 * The five things the meter records (spec D1).
 *
 * Storage is two metrics and not one summed byte count, for
 * `org_quotas.max_asset_storage_bytes`'s own reason applied to billing: a sync
 * grows storage in jumps and time series grow steadily, and one number would
 * let the first crowd out the second on the invoice the same way it would on
 * the quota.
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
 * this file (`from_ms`/`to_ms`, half-open per DEF-062).
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
 * **`app_id` is `null` when the consumer is the org itself** (spec D2), and
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
 * the worse half of it), but "at most one interval" describes a platform
 * whose writes are landing, not a guarantee that survives an outage. This
 * sentence used to say "never more", and it was false.
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
 * `alert_count` (spec `2026-08-28-alerts-and-datapoint-modal-design`, D5)
 * joined the atomic rename transaction alongside grants and history: alerts
 * are keyed by `(robot_id, slug)` too, and a rename that silently moved the
 * alert row while the usage preview stayed silent about it would show a
 * developer a smaller blast radius than the rename actually has.
 */
export const slugUsageResponse = z.object({
  grant_count: z.number().int().nonnegative(),
  app_identifiers: z.array(z.string()),
  has_recorded_history: z.boolean(),
  alert_count: z.number().int().nonnegative(),
})
export type SlugUsageResponse = z.infer<typeof slugUsageResponse>
