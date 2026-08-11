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
 */

/** Invoke an action or call a service; parameters by field path (§4.4). */
export const invokeRequest = z.object({
  params: z.record(z.string(), z.unknown()),
})
export type InvokeRequest = z.infer<typeof invokeRequest>

/**
 * The answer to an invoke. The job id is informative (§11.3): state is
 * observed by slug afterwards, over polling or a subscription.
 */
export const invokeResponse = z.object({ job })
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

/** The job currently running on a slug, or null when nothing is. */
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
  kind: z.enum(['datapoint', 'action', 'service', 'publisher']),
  builtin: z.boolean(),
})
export type Exposure = z.infer<typeof exposure>

export const exposureListResponse = z.object({
  exposures: z.array(exposure),
})
export type ExposureListResponse = z.infer<typeof exposureListResponse>
