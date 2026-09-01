import { z } from 'zod'
import { applyError, slug, rosName, rosTypeName, fieldPath } from './common.js'
/**
 * `alertSeverity` is identical for the stored row and this document-nested
 * definition — `z.enum(['warning', 'error'])`, nothing more to say twice —
 * so it is imported rather than redefined. Not re-exported from here: the
 * barrel already carries it from `alerts.ts`, and wave 4 moves the
 * definition itself into this file once `alerts.ts` retires.
 */
import { alertSeverity } from './alerts.js'

/**
 * The exposure model (spec §4): what a developer configures per robot, how a
 * configuration moves from draft to published, and how the cloud reports what
 * it refuses.
 *
 * ## What this schema decides, and what it leaves to the cloud
 *
 * FL-002 names thirteen validation codes and this file implements some of
 * them. The line was drawn four times while the format was written and never
 * written down, so here it is.
 *
 * **Decided here** — everything a single entry, plus its own declared types,
 * answers on its own: `unknown_key` (every object is `z.strictObject`),
 * `explicit_null`, `invalid_rate` (`rateThrottleHz`),
 * `requires_single_field`, `invalid_condition`,
 * `constraint_not_allowed_for_type`, `value_type_mismatch` and
 * `failsafe_has_parameters`. The name grammar comes with the key, and
 * `duplicate_slug` and `duplicate_parameter` come with the mapping — a
 * repeated key is a YAML syntax error before any schema sees it.
 *
 * **Left to the cloud**, for one of two reasons:
 *
 * - *It needs introspection.* `unknown_topic`, `unknown_field_path`,
 *   `type_mismatch` and `requires_numeric_field` are all questions about the
 *   robot's own message definitions. This schema has no robot.
 * - *It spans sections, or documents.* `reserved_slug` and cross-section
 *   `duplicate_slug` need the whole document; `undeclared_parameter`,
 *   `unused_parameter`, `unknown_message` and `nested_message_reference` need
 *   the index of declared names that `messages:` and each entry's
 *   `parameters:` build together.
 *
 * `nested_message_reference` is the one worth naming explicitly, because it
 * looks decidable here and is: a `messages:` entry whose whole body is
 * `'${name}'` is a nested reference, full stop. It is the cloud's anyway, so
 * that all four name-resolution codes are answered in one place against one
 * index. Splitting them would put one rule here and its three siblings there
 * — the shape this file has twice had to undo.
 *
 * **Every refusal that answers one of the spec's codes carries
 * `params: { code }`** with that code, which zod passes through `safeParse`
 * untouched. The cloud maps an issue to a code and its repair by reading that
 * field, never by matching the message prose — a join nobody notices
 * breaking.
 *
 * Read the sentence narrowly, because a wider reading is false and was
 * written here once. Plenty of refusals in this file carry no `params.code`,
 * and correctly: the section caps (`parameterMap`'s fifty, `messageMap`'s two
 * hundred), the camera device-path rules, and every refusal zod raises on its
 * own — `unrecognized_keys` behind `unknown_key`, `too_big` behind
 * `invalid_rate`. Those are not spec codes wearing a different hat; the cloud
 * reaches them through zod's own issue codes. The one *spec* code with no
 * `params` is a reversed pair of bounds — `min_value`/`max_value` on a
 * parameter, `y_min`/`y_max` on a chart: `invalid_range` was deleted with
 * `expected_range`, and no code replaced it.
 *
 * `robotConfigDoc` carries all six sections — messages, datapoints, actions,
 * services, publishers and cameras — plus, since FL-002, the alerts, the
 * chart bounds and the camera credentials that used to live outside it.
 * Everything configurable about a robot is in this document, and there is one
 * door to it. FL-002 rewrote the slug grammar (underscores, not dashes) and
 * keyed every section by name; draft/publish and versioning are unchanged.
 */

/**
 * What an exposed service *is*, in the developer's own words (§17).
 *
 * This is what an MCP tool description carries verbatim, so it is read by a
 * model that has never seen this robot and cannot ask a follow-up question.
 * `unit` and `range` already say what a number *is*; this says what it
 * *means*.
 *
 * **It lives on the configuration rather than on the app, and that was a
 * decision with a cost.** §17's own wording put the semantic descriptions in
 * the MCP app; André moved them here on 2026-08-18 so that a description is
 * written once per service and true for every app that reaches the robot,
 * beside the other metadata. What is given up is real and should not be
 * rediscovered as a bug: **two apps can no longer describe one service
 * differently for two audiences.** §17 was reworded in the same wave rather
 * than left contradicting this field.
 *
 * **`.optional()` and not `.nullable().default(null)`, deliberately.** The
 * established shape in this file is a default — and every use of it has
 * added an instance to a known contradiction: `.default()` publishes the
 * field as **required** in the generated JSON Schema, because after parsing
 * it is always present. That is recorded four times over in
 * `scripts/export-schemas.ts`, whose fix (`io: 'input'`, applied per schema)
 * is a judgement call across roughly sixty schemas plus a re-vendor and a
 * re-pin in four repos. W7c's playbook said task 0 would do it; reading the
 * measured blast radius — 90 artifacts, 436 deletions for the blanket
 * version — said otherwise, at the start of a wave with five people blocked
 * on this pin. So the field simply does not create a fifth instance:
 * optional is optional in both modes, and *absent* is the single spelling of
 * "not described". `.min(1)` keeps the empty string from becoming a second.
 */
export const serviceDescription = z.string().min(1).max(2000).optional()

/**
 * One parameter's prose, for the same reader as `serviceDescription` and
 * under the same rules. Shorter, because it describes one field of one call
 * rather than the call itself.
 */
export const parameterDescription = z.string().min(1).max(500).optional()

/** The ROS 2 primitive field types, spelled as ROS 2 spells them. */
export const parameterType = z.enum([
  'bool', 'byte', 'char',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64',
  'float32', 'float64',
  'string', 'wstring',
])
export type ParameterType = z.infer<typeof parameterType>

const INTEGER_TYPES = new Set(['byte', 'char', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'])
const FLOAT_TYPES = new Set(['float32', 'float64'])
const STRING_TYPES = new Set(['string', 'wstring'])

/**
 * One parameter a caller may fill in a message template.
 *
 * `type` is required and **not derived from the template position**, even
 * though introspection usually knows it. The reason is the robot that has
 * never connected: there is nothing to derive there, and that is exactly
 * where the editor has to help most.
 *
 * Which constraints exist depends on the type, and a constraint on the wrong
 * type is refused rather than silently inert. Floats deliberately have no
 * `enum`: equality on floating point is unreliable, so an enumerated float
 * list is a trap that only shows up in operation.
 *
 * **A `default` and every `enum` entry must match `type`**, and that is
 * decided here rather than in the cloud. Its sibling
 * `constraint_not_allowed_for_type` was always here, and leaving one of a
 * pair in zod and the other in the cloud is two policies for one decision.
 * It needs nothing this schema does not have: a value and a declared type.
 * `type_mismatch` — the declared type against the type at the template
 * position — is the one that needs introspection, and it is the cloud's.
 *
 * There is no `required` field. A placeholder cannot be left unfilled, so
 * "required" is exactly "has no `default`" — a second spelling of one fact
 * is the defect this file has spent two waves removing.
 */
export const parameterSpec = z
  .strictObject({
    type: parameterType,
    default: z.union([z.number(), z.string(), z.boolean()]).optional(),
    min_value: z.number().optional(),
    max_value: z.number().optional(),
    enum: z.array(z.union([z.string(), z.number()])).min(1).optional(),
    regex: z.string().min(1).optional(),
    description: parameterDescription,
  })
  .superRefine((p, ctx) => {
    const numeric = INTEGER_TYPES.has(p.type) || FLOAT_TYPES.has(p.type)
    const refuse = (path: (string | number)[], why: string, code?: string) =>
      ctx.addIssue({ code: 'custom', path, message: why, ...(code ? { params: { code } } : {}) })

    /**
     * What a value of this parameter's declared type may look like on the
     * wire. Integers are checked with `Number.isInteger`, which cannot tell
     * `1.0` from `1` — nothing can, in JSON or in YAML, since both parse to
     * the same double. `1.5` on an `int32` is the case worth catching and it
     * is caught.
     */
    const matchesType = (v: unknown): boolean => {
      if (p.type === 'bool') return typeof v === 'boolean'
      if (STRING_TYPES.has(p.type)) return typeof v === 'string'
      if (INTEGER_TYPES.has(p.type)) return typeof v === 'number' && Number.isInteger(v)
      return typeof v === 'number' && Number.isFinite(v)
    }

    if (!numeric && (p.min_value !== undefined || p.max_value !== undefined))
      refuse(['min_value'], `min_value/max_value need a numeric type, not '${p.type}'`, 'constraint_not_allowed_for_type')
    if (!STRING_TYPES.has(p.type) && p.regex !== undefined)
      refuse(['regex'], `regex needs a string type, not '${p.type}'`, 'constraint_not_allowed_for_type')
    if (p.enum !== undefined && !(INTEGER_TYPES.has(p.type) || STRING_TYPES.has(p.type))) {
      refuse(['enum'], `enum needs an integer or string type, not '${p.type}'`, 'constraint_not_allowed_for_type')
    } else if (p.enum !== undefined) {
      /**
       * Only reached when `enum` is allowed at all. A float `enum` is one
       * mistake, not two: reporting both codes for it would leave neither
       * pinned to a document that produces exactly it.
       */
      p.enum.forEach((v, i) => {
        if (!matchesType(v)) refuse(['enum', i], `enum entry does not match type '${p.type}'`, 'value_type_mismatch')
      })
    }
    if (p.default !== undefined && !matchesType(p.default))
      refuse(['default'], `default does not match type '${p.type}'`, 'value_type_mismatch')
    /**
     * One of the two refusals in this file with no `params.code`, the other
     * being `datapointChart`'s: `invalid_range` was deleted with
     * `expected_range`, and reversed bounds are not one of the thirteen.
     * Inventing a fourteenth here would put a code in the contracts that the
     * cloud's table does not know.
     */
    if (p.min_value !== undefined && p.max_value !== undefined && p.min_value > p.max_value)
      refuse(['min_value'], 'min_value is greater than max_value')

    /**
     * A default must satisfy the same constraints a caller's value must.
     *
     * Without this, a default is the one way past bounds that are otherwise
     * the enforcement point — the spec calls `min_value`/`max_value` "the
     * speed limit that actually holds", enforced in the cloud before anything
     * reaches the robot. But a caller who simply omits the parameter gets the
     * default, and the bridge fills it at the template walk without
     * re-checking bounds, deliberately: a second enforcement point there
     * would be the weaker of two policies. So `{min_value: -1, max_value: 1,
     * default: 99}` published 99 to a robot with no layer objecting.
     *
     * No `params.code`, for the same reason as the reversed bounds above.
     */
    if (p.default !== undefined && matchesType(p.default)) {
      const d = p.default
      if (typeof d === 'number') {
        if (p.min_value !== undefined && d < p.min_value)
          refuse(['default'], `default ${d} is below min_value ${p.min_value}`)
        if (p.max_value !== undefined && d > p.max_value)
          refuse(['default'], `default ${d} is above max_value ${p.max_value}`)
      }
      if (p.enum !== undefined && !p.enum.some((v) => v === d))
        refuse(['default'], 'default is not one of the enum entries')
      if (p.regex !== undefined && typeof d === 'string') {
        let re: RegExp | undefined
        try {
          re = new RegExp(p.regex)
        } catch {
          // An unparseable regex is its own problem and not this check's to
          // report; skip rather than refuse the default for it.
        }
        if (re && !re.test(d)) refuse(['default'], 'default does not match regex')
      }
    }
  })
export type ParameterSpec = z.infer<typeof parameterSpec>

/** Parameters of one entry, keyed by name. At most 50. */
export const parameterMap = z
  .record(slug, parameterSpec)
  .refine((m) => Object.keys(m).length <= 50, { message: 'at most 50 parameters per entry' })

/** Built-in slugs (spec §4.3) — never available to a configured service. */
export const RESERVED_SLUGS = ['bridge_state', 'robot_details', 'bridge_pressure'] as const

/**
 * When an alert fires and when it is ok again. There is no discriminator:
 * `resolve_at` absent means equality, present means a threshold whose
 * direction follows from the comparison. The gap is the hysteresis, and it
 * is therefore mandatory for thresholds — a value sitting exactly on a
 * threshold with no gap flips on every sample.
 */
export const alertCondition = z
  .strictObject({
    fire_at: z.union([z.number().finite(), z.string(), z.boolean()]),
    resolve_at: z.number().finite().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.resolve_at === undefined) return
    if (typeof c.fire_at !== 'number')
      ctx.addIssue({
        code: 'custom',
        path: ['resolve_at'],
        message: 'resolve_at is only allowed when fire_at is a number',
        params: { code: 'invalid_condition' },
      })
    else if (c.resolve_at === c.fire_at)
      ctx.addIssue({
        code: 'custom',
        path: ['resolve_at'],
        message: 'resolve_at must differ from fire_at',
        params: { code: 'invalid_condition' },
      })
  })
export type AlertCondition = z.infer<typeof alertCondition>

/**
 * The four defaults the format names, as constants.
 *
 * **The fields stay `.optional()`, not `.default()`** — that argument is on
 * `serviceDescription` above and has not changed: `.default()` publishes a
 * field as *required* in the generated JSON Schema, and absence is the
 * single spelling of "not set" in this format. What was missing is the
 * number itself. Left only in prose, the cloud and the console each invent
 * their own, and the two agree until one of them is edited. The house answer
 * is a named constant — `ALERT_COOLDOWN_MINUTES_DEFAULT` in `alerts.ts` is
 * the same shape — so a consumer applying a default reads it from here.
 */
export const ALERT_SEVERITY_DEFAULT = 'warning' satisfies z.infer<typeof alertSeverity>
export const ALERT_ENABLED_DEFAULT = true
/** How often a value is written to history — not how often it is sent. */
export const RETENTION_INTERVAL_SECONDS_DEFAULT = 300
/** The window a chart opens on, in minutes. Display only. */
export const CHART_WINDOW_MINUTES_DEFAULT = 60

/**
 * An alert's definition. Runtime state — whether it is firing, since when,
 * with what value — is NOT here: it lives in the database and survives a
 * restart, and it has no business in a versioned document.
 *
 * `severity` and `enabled` are absent-means-`ALERT_SEVERITY_DEFAULT` and
 * absent-means-`ALERT_ENABLED_DEFAULT`; see those constants for why the
 * default is not applied here.
 */
export const datapointAlert = z.strictObject({
  condition: alertCondition,
  severity: alertSeverity.optional(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
})
export type DatapointAlert = z.infer<typeof datapointAlert>

/** Requires a numeric field — all four fields share that one precondition. */
export const datapointNumeric = z.strictObject({
  scale: z.number().optional(),
  offset: z.number().optional(),
  unit: z.string().max(32).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
})
export type DatapointNumeric = z.infer<typeof datapointNumeric>

/**
 * `interval_seconds` absent means `RETENTION_INTERVAL_SECONDS_DEFAULT`.
 *
 * **`enabled` absent means off**, and that direction is the deliberate one.
 * Stored points are what a customer is billed for, so a default that silently
 * turned history on would start charging for a value nobody asked to keep. The
 * cheap mistake is a developer noticing a datapoint has no history and
 * switching it on; the expensive one is nobody noticing that everything has
 * history. Absent-means-off is also what the cloud already does — this comment
 * exists because it was doing it without anything saying so.
 *
 * Not spelled `.default(false)` for the same reason as every other default in
 * this file: the document a developer wrote is the document that is stored,
 * and a parse that inserts fields makes the round trip a lie.
 */
export const datapointRetention = z.strictObject({
  enabled: z.boolean().optional(),
  interval_seconds: z.number().int().min(1).max(3600).optional(),
  max_buffer_values: z.number().int().min(1).max(100_000).optional(),
})
export type DatapointRetention = z.infer<typeof datapointRetention>

/**
 * Chart display, and display only. `default_window_minutes` absent means
 * `CHART_WINDOW_MINUTES_DEFAULT`.
 *
 * The bounds are ordered here for the same reason `parameterSpec`'s are:
 * `{y_min: 10, y_max: 1}` is a mistake nothing else catches. It used to be
 * `invalid_range`'s job and that code was deleted with `expected_range`, so
 * without this the document would carry a reversed axis all the way to a
 * chart that renders empty.
 */
export const datapointChart = z
  .strictObject({
    y_min: z.number().finite().optional(),
    y_max: z.number().finite().optional(),
    style: z.enum(['line', 'step']).optional(),
    default_window_minutes: z.number().int().min(1).max(43_200).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.y_min !== undefined && c.y_max !== undefined && c.y_min > c.y_max)
      ctx.addIssue({ code: 'custom', path: ['y_min'], message: 'y_min is greater than y_max' })
  })
export type DatapointChart = z.infer<typeof datapointChart>

/**
 * The ceiling lives here once. `rest.ts`'s `datapointDescriptor` reuses it,
 * so the two cannot drift apart the way a number spelled out twice always
 * eventually does. `0` is deliberately admitted — zero and "omitted"
 * (`datapointConfig`) or `null` (`datapointDescriptor`) are the same fact,
 * "no throttling", not a refused value: `.positive()` here would exclude
 * the very thing this field's own absence already means.
 */
export const rateThrottleHz = z.number().nonnegative().max(20)

/**
 * One exposed datapoint: one field of a topic, or the whole topic
 * (`field` omitted). Never several topics.
 *
 * `rate_throttle_hz` is an upper bound, not a clock — the bridge drops what
 * arrives too fast and never repeats a value to manufacture a rate. The
 * ceiling is 20: an app's surface has no use for more, and a control loop
 * belongs on a tool that reads at the robot.
 */
export const datapointConfig = z
  .strictObject({
    topic: rosName,
    type: rosTypeName,
    field: fieldPath.optional(),
    rate_throttle_hz: rateThrottleHz.optional(),
    description: serviceDescription,
    numeric: datapointNumeric.optional(),
    retention: datapointRetention.optional(),
    chart: datapointChart.optional(),
    alerts: z.record(slug, datapointAlert).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.field !== undefined) return
    for (const group of ['numeric', 'chart', 'alerts'] as const) {
      if (d[group] !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: [group],
          message: `${group} needs a single field; without 'field' the value is the whole message`,
          params: { code: 'requires_single_field' },
        })
    }
  })
export type DatapointConfig = z.infer<typeof datapointConfig>

/**
 * A message template: the goal, request or published message, written out in
 * full. Literals are fixed; `${name}` is a hole a caller fills.
 *
 * The shape cannot be narrower than `unknown` here — it is the shape of an
 * arbitrary ROS message, which only the robot's own type definition knows.
 * What CAN be checked here is the placeholder grammar; everything else is
 * checked in the cloud against the introspected type.
 *
 * **`null` is refused, at every depth of this position.** Omission is the
 * only spelling of "not set" in this format, and a bare `z.unknown()` made
 * every message position the one place that also accepted the second
 * spelling: `publishers.p.message: null`, `failsafe.message: null`,
 * `actions.a.message: null` and `messages: {stop: null}` all parsed. Every
 * other field gets this from its own type refusing `null`; this one has no
 * type to get it from, so it says it here.
 *
 * The refusal is a refinement and therefore **invisible in the JSON Schema
 * artifact**, which publishes this position as `{}`. The artifact says what
 * the shape is, not what the parser refuses; a consumer that validates
 * against the artifact instead of against this schema does not get it.
 */
export const messageTemplate = z.unknown().refine((v) => v !== null, {
  message: 'null is not a message; omit the field instead',
  params: { code: 'explicit_null' },
})

/** `${name}` and nothing else. A bare word is always a literal. */
export const PLACEHOLDER_RE = /^\$\{([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\}$/

export const messageRef = z.string().regex(PLACEHOLDER_RE)

/**
 * What may stand at a `message:` position: a shared message by name
 * (`${name}`), or an inline template. Position decides which — directly after
 * `message:` a `${name}` resolves to a shared message, inside a body it
 * resolves to a parameter.
 *
 * **This is `messageTemplate`, not a union with `messageRef`, and that is a
 * correction rather than a simplification.** It was written as
 * `z.union([messageRef, messageTemplate])`, whose second member accepts
 * everything the first does: the union could never refuse, never narrowed
 * anything (`string | unknown` is `unknown`), and published as
 * `anyOf: [{pattern: …}, {}]` — an artifact that claims a distinction no
 * validator makes. The distinction is real but it is not a shape distinction:
 * a `${name}` here means a reference and elsewhere means a parameter, and
 * only the cloud can say whether that name is a defined message
 * (`unknown_message`) or a nested one (`nested_message_reference`).
 *
 * `messageRef` stays exported as the predicate that decides it. It is what a
 * consumer applies to a body to ask "is this a reference?"; it is not what
 * validates one.
 */
export const messageBody = messageTemplate

/**
 * Every placeholder name in a template, at any depth.
 *
 * **An explicit stack, not recursion, and the reason is `safeParse`'s
 * contract.** This runs inside `publisherConfig`'s failsafe refinement, so a
 * `RangeError: Maximum call stack size exceeded` did not stay here: it
 * propagated out of `safeParse`, which is specified to return a result and
 * not to throw. Measured on the recursive version — fine at 8 000 levels of
 * nesting, throwing at 20 000 — and a flow-style YAML one-liner reaches that
 * in about 120 KB of input. A draft PUT would have answered 500 where it
 * meant 400.
 *
 * `seen` is not an optimisation. YAML anchors can express a cycle
 * (`&a { b: *a }`), and the parser resolves an alias to the same object, so
 * without it the loop that fixed the overflow would hang instead — the
 * failure mode a stack trades for, made worse by being silent.
 *
 * The array branch is explicit, not necessary: `Object.values()` on an array
 * yields the same elements. It is here so the walk reads as covering both
 * shapes; a reader does not have to know that property of `Object.values`.
 */
export function placeholderNames(node: unknown, found = new Set<string>()): Set<string> {
  const stack: unknown[] = [node]
  const seen = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current === 'string') {
      const m = PLACEHOLDER_RE.exec(current)
      if (m) found.add(m[1]!)
      continue
    }
    if (!current || typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
    } else {
      for (const value of Object.values(current)) stack.push(value)
    }
  }
  return found
}

/**
 * Reusable message bodies, keyed by name. A shared message may hold
 * placeholders; whoever inserts it declares the parameters. It may NOT
 * insert another — that excludes cycles and lets every check look at exactly
 * one body instead of walking a reference tree.
 */
export const messageMap = z
  .record(slug, messageTemplate)
  .refine((m) => Object.keys(m).length <= 200, { message: 'at most 200 shared messages' })

/**
 * An action the robot can be asked to perform (spec §4.2, §11.3). At most one
 * job runs per action slug; a second call is refused `busy`, and every
 * observer of the slug watches the same job.
 */
export const actionConfig = z.strictObject({
  ros_name: rosName,
  type: rosTypeName,
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription,
})
export type ActionConfig = z.infer<typeof actionConfig>

/** A ROS service call with validated parameters (spec §4.2). */
export const serviceConfig = z.strictObject({
  ros_name: rosName,
  type: rosTypeName,
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription,
})
export type ServiceConfig = z.infer<typeof serviceConfig>

/**
 * A topic clients may publish to.
 *
 * `failsafe` groups the deadline with the message it triggers, because the
 * deadline exists for nothing else. The message must hold no placeholder:
 * the bridge sends it with no caller present, so there would be nobody to
 * fill one.
 *
 * **What that check can and cannot see.** It refuses a placeholder written
 * into an inline failsafe body. It does not refuse
 * `failsafe: { message: '${anything}' }` — a string at a `message:` position
 * is a *reference to a shared message*, and whether that message holds a
 * placeholder is a question about another section of the document, which a
 * schema over one publisher cannot answer. So `failsafe_has_parameters` is
 * half here and half in the cloud, on purpose and by position rather than by
 * accident: the inline half is decidable here, the referenced half is one of
 * the name-resolution codes the file header assigns to the cloud.
 *
 * `quiet_timeout_ms` is unrelated — how long a publisher must be silent
 * before a *different* user may send.
 */
export const publisherConfig = z.strictObject({
  topic: rosName,
  type: rosTypeName,
  message: messageBody,
  parameters: parameterMap.optional(),
  failsafe: z
    .strictObject({
      timeout_ms: z.number().int().positive().max(60_000),
      message: messageBody,
    })
    /**
     * The string case is the exemption, not an oversight — see the paragraph
     * above — so it is tested first, where it reads as one.
     */
    .refine((f) => typeof f.message === 'string' || placeholderNames(f.message).size === 0, {
      message: 'the failsafe message must contain no placeholder: it is sent with no caller to fill one',
      path: ['message'],
      params: { code: 'failsafe_has_parameters' },
    }),
  quiet_timeout_ms: z.number().int().nonnegative().max(600_000),
  description: serviceDescription,
})
export type PublisherConfig = z.infer<typeof publisherConfig>

/**
 * Camera credentials, in the document. There is no separate store any more.
 *
 * This was decided against a recorded objection, and the objection stands: a
 * password here is in every published version, and those are immutable. It
 * cannot be removed from history and cannot be rotated without republishing.
 * The bound on that decision is elsewhere and load-bearing — the publish
 * audit event and the org event stream must not carry the document body.
 */
export const cameraCredentials = z.strictObject({
  username: z.string().min(1).max(128).optional(),
  password: z.string().min(1).max(128).optional(),
})
export type CameraCredentials = z.infer<typeof cameraCredentials>

/**
 * Where a camera's frames come from (spec §10 names four sources).
 *
 * A discriminated union rather than optional fields, so an impossible camera
 * is **unrepresentable** rather than merely invalid — there is no way to
 * write an RTSP camera with a ROS topic, or a V4L2 device with a URL, and
 * therefore no validation rule to forget.
 */
export const cameraSource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ros'), topic: rosName, type: rosTypeName }),
  z.strictObject({
    kind: z.literal('rtsp'),
    /**
     * Scheme-constrained deliberately. The playbook drafted `z.string().url()`
     * here and the shipped contract was `z.string().min(1).max(2048)` — nobody
     * recorded the change, and the W6 review found the consequence: the bridge
     * opens these with libraries that honour `file:` and `ftp:`, so an
     * unconstrained URL turns a configuration document into an arbitrary
     * local-file read on the robot, with the two distinct failure codes
     * doubling as a file-existence oracle. Spec §7.6 is ROS-pure exposure with
     * no shell or http features; that rule came back by omission rather than
     * by intent. The bridge re-checks this too — a robot must not become a
     * file server because a validator changed.
     */
    url: z.string().min(1).max(2048).regex(/^rtsps?:\/\//i, 'must be an rtsp:// or rtsps:// URL'),
    /** TCP by default: UDP loses frames on a congested link, silently. */
    transport: z.enum(['tcp', 'udp']).optional(),
    credentials: cameraCredentials.optional(),
  }),
  z.strictObject({
    kind: z.literal('mjpeg'),
    /** `http:`/`https:` only — see the `rtsp` variant above for why. */
    url: z.string().min(1).max(2048).regex(/^https?:\/\//i, 'must be an http:// or https:// URL'),
    credentials: cameraCredentials.optional(),
  }),
  z.strictObject({
    kind: z.literal('v4l2'),
    /**
     * e.g. `/dev/video0`, or a stable `/dev/v4l/by-id/...` symlink. Resolved
     * on the robot, never by the cloud.
     *
     * Constrained to `/dev/` for the same reason the `rtsp` and `mjpeg` URLs
     * are constrained to their schemes, and it was missed the first time
     * (Momus, W6 verification). The device string reaches
     * `cv2.VideoCapture(device)` on the robot, and OpenCV does not restrict
     * itself to devices: measured on cv2 4.5.4, an ordinary local video file
     * opens and its pixels are published to the cloud, and so does
     * `http://127.0.0.1:8899/secret.jpg`. Unconstrained, this field is an
     * arbitrary local-file read *and* an outbound fetch from inside the robot
     * — the §7.6 violation closed for the other two source kinds, reachable
     * through the fourth, because "it is just a device path" read like a
     * reason not to check.
     *
     * Narrower than the URL hole in one respect worth recording: a non-media
     * file and a missing file both fail to open, so this branch never worked
     * as a file-existence oracle.
     *
     * The bridge re-derives this constraint rather than trusting the wire
     * (`validate_device_path`), exactly as it re-derives the URL scheme.
     */
    device: z
      .string()
      .min(1)
      .max(128)
      .regex(/^\/dev\/[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'must be a device path under /dev/')
      .refine((v) => !v.split('/').includes('..'), 'must not contain a `..` path segment')
      .refine((v) => !v.endsWith('/'), 'must name a device, not a directory'),
  }),
])
export type CameraSource = z.infer<typeof cameraSource>

/**
 * How often a snapshot is captured, in seconds. Bounded below at one second
 * because a snapshot is the *cheap* mode — a developer who wants motion wants
 * live, and an interval faster than this is a live stream wearing a disguise.
 *
 * The bound lives here once, and `rest.ts`'s `cameraDescriptor` reuses it —
 * the same treatment `rateThrottleHz` got, and for the same reason: the
 * descriptor used to say `snapshot_interval_ms` while the document said
 * seconds, so the cloud converted on one descriptor and not its sibling, with
 * nothing in either file saying so.
 */
export const snapshotIntervalSeconds = z.number().int().min(1).max(3600)

/**
 * A camera the robot exposes (spec §10).
 *
 * `width`/`height`/`fps`/`bitrate_kbps` are not cosmetic: §10 makes them the
 * developer's control over **the robot's own bandwidth**, which is why they
 * live in the configuration rather than in a viewer's request. A viewer never
 * gets to make a robot send more.
 *
 * The two modes are deliberately independent (§10):
 *
 * - **Snapshot** runs always, at `snapshot_interval_seconds`, whether or not
 *   anyone is watching live. The cloud caches the one frame and serves every
 *   client from it, so a hundred pollers cost the robot exactly one image per
 *   interval.
 * - **Live** runs on demand and is refcounted in the cloud: the first viewer
 *   starts it, the last one ends it.
 */
export const cameraConfig = z.strictObject({
  source: cameraSource,
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(4320),
  fps: z.number().int().positive().max(60),
  bitrate_kbps: z.number().int().positive().max(50_000),
  snapshot_interval_seconds: snapshotIntervalSeconds,
  description: serviceDescription,
})
export type CameraConfig = z.infer<typeof cameraConfig>

/**
 * The format version of a `fleetless.yaml`. Deliberately not called
 * `version`: the console counts published states with "v12 → v13", and two
 * numbers called version would be the likeliest confusion in the format.
 */
export const FLEETLESS_FORMAT_VERSION = 1

const capped = <T extends z.ZodTypeAny>(entry: T, max: number, what: string) =>
  z.record(slug, entry).refine((m) => Object.keys(m).length <= max, { message: `at most ${max} ${what}` })

/**
 * A whole robot configuration — everything configurable about one robot.
 *
 * Every section is a mapping keyed by name, not a list of objects carrying
 * their own name. A duplicate name is then a YAML syntax error rather than a
 * rule somebody has to write, and the name reads as the entry's heading.
 *
 * Slugs remain ONE namespace across all five exposure sections (§4.1), which
 * is what lets a role grant say `{robot, slug}` without naming a kind. That
 * check spans sections and therefore lives in the cloud, not here.
 */
export const robotConfigDoc = z.strictObject({
  fleetless: z.literal(FLEETLESS_FORMAT_VERSION),
  messages: messageMap.optional(),
  datapoints: capped(datapointConfig, 200, 'datapoints').optional(),
  actions: capped(actionConfig, 200, 'actions').optional(),
  services: capped(serviceConfig, 200, 'services').optional(),
  publishers: capped(publisherConfig, 200, 'publishers').optional(),
  cameras: capped(cameraConfig, 50, 'cameras').optional(),
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
  /**
   * The bridge's own `bridgeConfigApplied.errors` (`protocol.ts`), read back
   * verbatim. **Reuses `applyError` rather than restating `{ slug, message
   * }`** — a narrower local copy here used to silently strip `kind`, `code`
   * and `details` on every read: `configState.safeParse` dropped every field
   * a caller did not ask for, and `robotDetailResponse` embeds `configState`
   * (`useCloudApi.ts`'s `getRobot`), so the console lost the fields one
   * layer before anyone could see them.
   */
  applied_errors: z.array(applyError).nullable(),
})
export type ConfigState = z.infer<typeof configState>
