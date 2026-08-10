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
})
export type DatapointConfig = z.infer<typeof datapointConfig>

/**
 * A whole robot configuration. One document per draft and per published
 * version; the other service kinds become sibling arrays here.
 */
export const robotConfigDoc = z.object({
  datapoints: z.array(datapointConfig).max(200),
})
export type RobotConfigDoc = z.infer<typeof robotConfigDoc>

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
