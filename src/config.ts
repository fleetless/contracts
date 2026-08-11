import { z } from 'zod'
import { slug, rosName, rosTypeName, fieldPath } from './common.js'

/**
 * The exposure model (spec §4): what a developer configures per robot, how a
 * configuration moves from draft to published, and how the cloud reports what
 * it refuses.
 *
 * The envelope is deliberately kind-agnostic. W2 implements the datapoint
 * kind; W4 adds actions, services and publishers to `robotConfigDoc`, W5 the
 * cameras — without changing draft/publish, versioning or slug rules.
 */

/**
 * Parameter checks for actions, services and publishers (spec §4.4).
 *
 * Defined in W2 so the shape is settled and stored configurations stay
 * valid; **enforced in W4**, where parameters exist. There is deliberately
 * no evaluator in W2 — a rule engine without a caller is dead weight.
 */
export const valueRule = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  enum: z.array(z.union([z.string(), z.number()])).min(1).optional(),
  pattern: z.string().optional(),
  required: z.boolean().optional(),
})
export type ValueRule = z.infer<typeof valueRule>

/**
 * One parameter of an action, service or publisher, with the check the cloud
 * applies before anything reaches a robot (spec §4.4). `valueRule` was
 * defined in W2 and deliberately left unenforced until its subjects existed;
 * W4 is when they exist.
 */
export const parameterSpec = z.object({
  /** Field path into the ROS request/goal/message — same grammar as a datapoint's. */
  name: fieldPath,
  /** The ROS type, for the console to render an input the developer recognises. */
  type: z.string().min(1).max(255),
  rule: valueRule,
})
export type ParameterSpec = z.infer<typeof parameterSpec>

/** Built-in slugs (spec §4.3) — never available to a configured service. */
export const RESERVED_SLUGS = ['bridge-state', 'robot-details'] as const

/**
 * How often a datapoint is sent (spec §4.2). The **bridge** enforces this, so
 * every realtime subscriber sees the same rate by construction (§11.1).
 */
export const datapointRate = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('max_hz'), hz: z.number().positive().max(100) }),
  z.object({ mode: z.literal('on_change') }),
])
export type DatapointRate = z.infer<typeof datapointRate>

/** Plausibility bounds shown to clients; metadata, not a filter. */
export const datapointRange = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
})
export type DatapointRange = z.infer<typeof datapointRange>

/**
 * One exposed datapoint: one field of a topic, or the whole topic
 * (`field: null`) — never several topics (spec §4.2).
 *
 * `scale`/`offset` are applied at the bridge (`value * scale + offset`) so
 * that REST and realtime carry identical numbers; `unit` and `range` travel
 * as metadata.
 */
export const datapointConfig = z.object({
  slug,
  topic: rosName,
  type: rosTypeName,
  field: fieldPath.nullable(),
  rate: datapointRate,
  unit: z.string().max(32).nullable(),
  scale: z.number().nullable(),
  offset: z.number().nullable(),
  range: datapointRange.nullable(),
  /**
   * Recording (spec §8) is a W6 feature. The field exists so the shape does
   * not change under stored configurations later; until W6 the only accepted
   * value is `null` and the editor does not offer it.
   */
  retention: z.null().optional(),
  /**
   * What happens to this datapoint's values while the bridge is disconnected
   * (spec §6.3). Buffered values are backfilled after reconnect — **after**
   * live telemetry and job results, at a limited rate, so closing a gap can
   * never delay what is happening now. An unbuffered datapoint simply has a
   * gap, which is an honest answer and often the right one.
   */
  buffer: z
    .object({
      enabled: z.boolean(),
      max_values: z.number().int().positive().max(100_000),
    })
    .default({ enabled: false, max_values: 0 }),
})
export type DatapointConfig = z.infer<typeof datapointConfig>

/**
 * An action the robot can be asked to perform (spec §4.2, §11.3). At most one
 * job runs per action slug; a second call is refused `busy`, and every
 * observer of the slug watches the same job.
 */
export const actionConfig = z.object({
  slug,
  ros_name: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
})
export type ActionConfig = z.infer<typeof actionConfig>

/** A ROS service call with validated parameters (spec §4.2). */
export const serviceConfig = z.object({
  slug,
  ros_name: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
})
export type ServiceConfig = z.infer<typeof serviceConfig>

/**
 * A topic clients may publish to (spec §4.2, §6.4).
 *
 * The two timeouts are the whole safety story of this kind, and they are
 * different things:
 *
 * - `timeout_ms` + `failsafe`: if client publishes stop arriving — including
 *   because the client crashed or lost its connection — **the bridge itself**
 *   publishes `failsafe` on the topic. This is the platform's safety
 *   primitive (§7.2); a cmd_vel publisher with a zero-twist failsafe is the
 *   canonical case.
 * - `quiet_timeout_ms`: how long a publisher must be silent before a
 *   *different* user may publish. Whoever publishes holds the publisher
 *   implicitly exclusive, with no session machinery.
 */
export const publisherConfig = z.object({
  slug,
  topic: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
  timeout_ms: z.number().int().positive().max(60_000),
  /** The message the bridge publishes on timeout. Shape is the ROS type's. */
  failsafe: z.unknown(),
  quiet_timeout_ms: z.number().int().nonnegative().max(600_000),
})
export type PublisherConfig = z.infer<typeof publisherConfig>

/**
 * A whole robot configuration. One document per draft and per published
 * version. The kinds are sibling arrays, and **slugs are one namespace across
 * all of them** (§4.1) — which is what lets a role grant say
 * `{robot, slug}` without ever naming a kind.
 */
export const robotConfigDoc = z.object({
  datapoints: z.array(datapointConfig).max(200),
  /**
   * The three kinds W4 adds default to empty so that **every configuration
   * published before W4 still parses**. Stored documents are jsonb; a
   * required field here would have invalidated live robots' published
   * versions on the first read after deploy.
   */
  actions: z.array(actionConfig).max(200).default([]),
  services: z.array(serviceConfig).max(200).default([]),
  publishers: z.array(publisherConfig).max(200).default([]),
})
export type RobotConfigDoc = z.infer<typeof robotConfigDoc>


/**
 * One thing the cloud has to say about a configuration (spec §11.5: field +
 * violated rule).
 *
 * `error` blocks the publish. `warning` does not — an unknown topic is a
 * warning on purpose, because configuring a robot that has never been
 * connected must stay possible (spec §4.1).
 */
export const validationIssue = z.object({
  path: z.string().min(1),
  slug: z.string().nullable(),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']),
})
export type ValidationIssue = z.infer<typeof validationIssue>

/**
 * Where a robot's configuration stands — the material for the console's
 * "draft newer than published", "published v2 · applied v1 · bridge offline"
 * (spec §15.2, robot tab 1).
 */
export const configState = z.object({
  published_version: z.number().int().positive().nullable(),
  published_at: z.iso.datetime().nullable(),
  draft_updated_at: z.iso.datetime().nullable(),
  applied_version: z.number().int().nonnegative().nullable(),
  applied_ok: z.boolean().nullable(),
  applied_errors: z
    .array(z.object({ slug: z.string(), message: z.string() }))
    .nullable(),
})
export type ConfigState = z.infer<typeof configState>
