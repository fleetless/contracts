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
    type: parameterType.meta({
      description: 'The ROS 2 primitive a value of this parameter must be, spelled the way ROS 2 spells it — `float64`, not `double`. It **decides which other constraints are allowed at all**: `min_value` and `max_value` need a numeric type, `regex` needs a string one, and a constraint on the wrong type is refused rather than quietly ignored.',
    }),
    default: z.union([z.number(), z.string(), z.boolean()]).meta({
      description: 'The value used when a caller omits this parameter: **without a `default` the parameter is required**, because the message cannot be built without it. It must itself satisfy `min_value`, `max_value`, `enum` and `regex` — a default the constraints reject is refused here rather than becoming the one value that reaches the robot unchecked.',
    }).optional(),
    min_value: z.number().meta({
      description: 'The lowest value a caller may send; numeric types only. It is **enforced in the cloud, before anything reaches the robot** — this is where a speed limit actually holds, rather than in the app that is supposed to respect it.',
      examples: [-0.5],
    }).optional(),
    max_value: z.number().meta({
      description: 'The highest value a caller may send; numeric types only, and it may not sit below `min_value`. A reversed pair is refused at parse time, because nothing downstream catches it and every call would then fail against a bound no value can satisfy.',
      examples: [0.5],
    }).optional(),
    enum: z.array(z.union([z.string(), z.number()])).min(1).meta({
      description: 'The complete set of values a caller may send. Integer and string types only — **never a float**, because equality on floating point is unreliable and an enumerated float list is a trap that only shows up in operation. Every entry must match `type`, and a `default` must be one of them.',
    }).optional(),
    regex: z.string().min(1).meta({
      description: 'A pattern the value must match; string types only. It is compiled as a JavaScript regular expression and is **not anchored**, so `[a-z]+` accepts any value that merely contains a lowercase run — a pattern meant to cover the whole value writes its own `^` and `$`.',
      examples: ['^[a-z_]+$'],
    }).optional(),
    description: parameterDescription.meta({
      description: 'What this parameter means, in the developer\'s own words, and documentation only — the robot does nothing with it. It travels into the MCP tool\'s input schema beside the bounds, so `type` and the range say what the value *is* and this is the only place that says what it *does*.',
    }),
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
  .meta({
    description: 'The holes in this entry\'s `message` that a caller fills, keyed by **parameter name** rather than by field path — so the name survives the field moving inside the message, and a caller sends something that means what it says. Every declared parameter must appear somewhere in the message and every `${name}` in the message must be declared; either half alone is an error.',
  })

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
    fire_at: z.union([z.number().finite(), z.string(), z.boolean()]).meta({
      description: 'The value at which the alert starts firing. Alone it is an **equality**: it fires while the value equals `fire_at` and is ok again as soon as it differs, which is what makes a boolean or a string condition meaningful. Adding `resolve_at` turns it into a threshold instead.',
      examples: [15, true],
    }),
    resolve_at: z.number().finite().meta({
      description: 'The value at which a firing alert becomes ok again — allowed only when `fire_at` is a number, and it **must differ from it**. That gap is the hysteresis, and it makes the condition a threshold whose direction follows from which of the two values is higher. Without a gap a value sitting on the line flips on every sample.',
      examples: [18],
    }).optional(),
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
 * is a named constant, so a consumer applying a default reads it from here.
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
  condition: alertCondition.meta({
    description: 'When this alert fires and when it is ok again. It carries **no discriminator**: upper threshold, lower threshold or equality all follow from the two values in it. Editing it resets the alert to `ok` on the next publish, while a publish that leaves it untouched keeps the running state.',
  }),
  severity: alertSeverity.meta({
    description: 'How bad it is when this alert fires; absent means `warning`. It changes no behaviour — nothing is escalated, retried or delivered differently — it travels with the org event and colours the alert wherever it is shown.',
  }).optional(),
  name: z.string().min(1).max(120).meta({
    description: 'A human-readable label shown wherever this alert appears, in place of its bare key. It is not the alert\'s identity — the key is — so the label can be reworded freely, while changing the key deletes one alert and creates another.',
    examples: ['Battery low'],
  }).optional(),
  enabled: z.boolean().meta({
    description: 'Whether this alert is evaluated at all. Absent means on, the opposite of `retention.enabled`: an alert that is written down watches unless it is explicitly switched off, which is how one is silenced without losing the key that identifies it.',
  }).optional(),
})
export type DatapointAlert = z.infer<typeof datapointAlert>

/** Requires a numeric field — all four fields share that one precondition. */
export const datapointNumeric = z.strictObject({
  scale: z.number().meta({
    description: 'A factor the robot multiplies the raw value by before sending it (`value * scale + offset`). The arithmetic happens once, at the source, so REST, realtime and history can never disagree about a number.',
    examples: [100],
  }).optional(),
  offset: z.number().meta({
    description: 'A constant the robot adds after `scale` (`value * scale + offset`), for a value whose zero sits in the wrong place. Like `scale` it is applied before sending, so history stores the converted value and a later correction cannot reach what is already stored.',
    examples: [-273.15],
  }).optional(),
  unit: z.string().max(32).meta({
    description: 'The unit of the value **after** `scale` and `offset`, not the robot\'s own. It is shown beside the value and appended to the MCP tool description, so a model does not have to guess whether 15 means percent, volts or minutes.',
    examples: ['%'],
  }).optional(),
  decimals: z.number().int().min(0).max(6).meta({
    description: 'How many decimal places every display of the value uses — tile, chart, detail page and MCP output alike. Presentation only: the stored value keeps the precision it arrived with.',
    examples: [1],
  }).optional(),
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
  enabled: z.boolean().meta({
    description: 'Whether values are written to the time series and become queryable. Off by default: without it the value is live only, and nobody who was not watching will ever see it.',
  }).optional(),
  interval_seconds: z.number().int().min(1).max(3600).meta({
    description: 'How often a value is written to history, in seconds. **Not** how often it is sent — that is `rate_throttle_hz`. Stored points are billed, so this is the direct lever on what a robot costs, and a bumper that is true for 200 ms does not appear unless a write falls inside it.',
    examples: [300, 60],
  }).optional(),
  max_buffer_values: z.number().int().min(1).max(100_000).meta({
    description: 'How many values the robot holds while the bridge is disconnected, to be pushed once it reconnects. The catch-up runs behind live telemetry and job results at a limited rate, so closing a gap never delays the present; without it the series simply has a gap, which is an honest answer.',
    examples: [5000],
  }).optional(),
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
    y_min: z.number().finite().meta({
      description: 'A fixed floor for the chart\'s y axis; omitted, the axis scales to the data. `0` is a real floor and is read as `0`, never as unset.',
      examples: [0],
    }).optional(),
    y_max: z.number().finite().meta({
      description: 'A fixed ceiling for the chart\'s y axis; omitted, the axis scales to the data. It may not sit below `y_min`: a reversed pair is refused here because nothing downstream catches it, and the chart would render empty.',
      examples: [100],
    }).optional(),
    style: z.enum(['line', 'step']).meta({
      description: 'How the drawing joins two samples, which is not a matter of taste. `line` claims the value moved evenly between them, roughly true of a temperature or a charge; `step` holds and then jumps, the only honest drawing for a mode, a switch or a counter, where a straight line would show values that never existed.',
    }).optional(),
    default_window_minutes: z.number().int().min(1).max(43_200).meta({
      description: 'How far back the chart reaches when it is first opened, in minutes. Only the starting zoom: a viewer may look further, and nothing about what is stored follows from it.',
      examples: [1440],
    }).optional(),
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
    topic: rosName.meta({
      description: 'The ROS topic this datapoint reads, as an absolute graph name. One datapoint reads **one** topic: a value assembled from two topics is not expressible here.',
      examples: ['/battery'],
    }),
    type: rosTypeName.meta({
      description: 'The message type carried by `topic`, spelled the way ROS 2 spells it. It is declared here rather than discovered, so a configuration can be written for a robot that has never been connected; the cloud checks it against the robot\'s own message definitions only once one is there.',
      examples: ['sensor_msgs/msg/BatteryState'],
    }),
    field: fieldPath.meta({
      description: 'A dotted path into the message naming the single value this datapoint carries. Without it the datapoint is the whole message, and `numeric`, `chart` and `alerts` are then refused.',
      examples: ['voltage', 'pose.position.x'],
    }).optional(),
    rate_throttle_hz: rateThrottleHz.meta({
      description: 'A ceiling on how often this datapoint is sent, in hertz. Omitted or `0` means no throttling. It is **a ceiling, not a clock**: a slow topic stays slow, a value is never repeated to manufacture a rate, and within a window the newest value wins. The bridge enforces it, so the robot\'s bandwidth is genuinely saved.',
      examples: [2, 0.5],
    }).optional(),
    description: serviceDescription.meta({
      description: 'Prose about what this value is, for whoever meets it in the console later. It changes nothing the robot does, so a publish that touches only it pushes no configuration at all. Omission is the only way to say nothing; an empty string is refused.',
    }),
    numeric: datapointNumeric.meta({
      description: 'Arithmetic and formatting for a numeric value. `scale` and `offset` are applied **on the robot**, before sending, which is why REST, realtime and history all carry identical numbers. `unit` and `decimals` change nothing the robot does, so a publish that touches only those pushes no configuration.',
    }).optional(),
    retention: datapointRetention.meta({
      description: 'What outlives the moment: whether this value is written to the time series, how often, and how many points the robot buffers while the bridge is away. Absent means no history at all — the value is live only.',
    }).optional(),
    chart: datapointChart.meta({
      description: 'How the console draws this value over time: axis bounds, whether the line interpolates or steps, and the window a chart opens on. **Display only** — it changes no stored value, no alert and nothing the robot does, so a publish that touches only it pushes no configuration.',
    }).optional(),
    alerts: z.record(slug, datapointAlert).meta({
      description: 'Alerts watching this value, keyed by slug; each moves between `ok` and `firing` and writes an org event on every transition. No mail is sent. **The key is the identity**, so renaming an alert is a delete plus a create: its runtime state is lost, and an alert that is still true fires again.',
    }).optional(),
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
/**
 * Whether a template holds an explicit `null` anywhere inside it.
 *
 * At **any depth**, and the depth is the whole point. Every other field in
 * this file is `.optional()` rather than `.nullable()`, so zod refuses `null`
 * at each of them for free. A message body is the one exception — it is
 * `z.unknown()`, because a template can be any shape a ROS message can — so
 * nothing below the top of it is checked by the type at all.
 *
 * That gap was measured and missed once already: a top-level `message: null`
 * was refused while `message: { linear: { x: null } }` parsed clean, and a
 * check written to catch exactly this was deleted on the strength of six test
 * cases, none of which reached inside a body.
 *
 * Walked with an explicit stack and a seen-set, not recursion: a YAML anchor
 * can make a template both very deep and genuinely cyclic, and a developer can
 * legitimately write one.
 */
function holdsExplicitNull(node: unknown): boolean {
  const stack: unknown[] = [node]
  const seen = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === null) return true
    if (typeof current !== 'object') continue
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(Array.isArray(current) ? current : Object.values(current)))
  }
  return false
}

export const messageTemplate = z.unknown().refine((v) => !holdsExplicitNull(v), {
  message: 'null is not a value; omit the key instead',
  params: { code: 'explicit_null' },
}).meta({
  description: 'The message as it will be sent, written out in full: literals are fixed, `${name}` is a hole a caller fills, and a field written `0.0` is one no client can change. Directly after `message:` a `${name}` standing alone names a shared message instead; anywhere inside a body it is a parameter. `null` is refused **at every depth** — omitting a key is the only spelling of "not set".',
})

/** `${name}` and nothing else. A bare word is always a literal. */
export const PLACEHOLDER_RE = /^\$\{([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\}$/

export const messageRef = z.string().regex(PLACEHOLDER_RE).meta({
  description: 'A reference to a shared message: `${name}` and nothing else, which is what separates a reference from a literal — a bare word stays a literal even when it happens to match a declared name. Whether that name is declared, and whether it points at a body holding a second reference, are questions about the whole document and are answered in the cloud.',
})

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
  .meta({
    description: 'Reusable message bodies, keyed by name. A body is inserted by writing `${name}` directly after `message:`, may hold placeholders of its own, and **may not insert another** — which rules out cycles and lets every check look at exactly one body.',
  })

/**
 * An action the robot can be asked to perform (spec §4.2, §11.3). At most one
 * job runs per action slug; a second call is refused `busy`, and every
 * observer of the slug watches the same job.
 */
export const actionConfig = z.strictObject({
  ros_name: rosName.meta({
    description: 'The action server on the robot, as an absolute graph name — this is what the bridge sends the goal to. Clients never see it: they address this entry by its slug, so a server can be renamed on the robot without a single app changing.',
    examples: ['/navigate_to_pose'],
  }),
  type: rosTypeName.meta({
    description: 'The action type `ros_name` implements, with the `action` segment in the middle — `nav2_msgs/action/NavigateToPose`, never `nav2_msgs/NavigateToPose`. Declared rather than introspected, so an action can be configured for a robot that has never connected; the cloud checks it against the robot\'s own definitions only once one is there.',
    examples: ['nav2_msgs/action/NavigateToPose'],
  }),
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription.meta({
    description: 'What this action does, in the developer\'s own words — documentation for the console and for MCP clients, which is all it is: the robot does nothing with it. It is carried verbatim into the MCP tool description and read by a model that has never seen this robot, so **an action without one is exposed as no tool at all**.',
    examples: ['Drives to a target pose on the map.'],
  }),
})
export type ActionConfig = z.infer<typeof actionConfig>

/** A ROS service call with validated parameters (spec §4.2). */
export const serviceConfig = z.strictObject({
  ros_name: rosName.meta({
    description: 'The ROS service the robot answers on, as an absolute graph name. The call is one request and one reply with no progress in between, so whatever this service does has to finish inside that reply; anything long-running belongs in `actions`.',
    examples: ['/reset_odometry'],
  }),
  type: rosTypeName.meta({
    description: 'The service type `ros_name` implements, with the `srv` segment in the middle — `std_srvs/srv/Trigger`. A type whose request has no fields, like `Trigger`, needs neither `message` nor `parameters`: there is nothing to fill.',
    examples: ['std_srvs/srv/Trigger'],
  }),
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription.meta({
    description: 'What this service does, in the developer\'s own words. The robot does nothing with it — the readers are the console and MCP clients, and **without it the service is exposed as no MCP tool**, exactly as for an action. It sits on the configuration rather than on the app, so one wording is true for every app that reaches this robot.',
    examples: ['Resets odometry to the origin.'],
  }),
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
  topic: rosName.meta({
    description: 'The ROS topic the message is published onto, as an absolute graph name. **No client ever names a topic**: a caller addresses this entry by its slug, so the topics an app can write to are exactly the ones written in this file.',
    examples: ['/cmd_vel'],
  }),
  type: rosTypeName.meta({
    description: 'The message type of `topic`, spelled the way ROS 2 spells it, with the `msg` segment. It fixes the shape that `message` and `failsafe.message` must both fill, which is why one publisher carries one type and a second type needs a second publisher.',
    examples: ['geometry_msgs/msg/Twist'],
  }),
  message: messageBody,
  parameters: parameterMap.optional(),
  failsafe: z
    .strictObject({
      timeout_ms: z.number().int().positive().max(60_000).meta({
        description: 'How long the bridge waits for the client\'s next send before sending the failsafe message itself, in milliseconds. The deadline runs **on the robot**, so it still fires when the link to the cloud is what failed — which is the case it exists for.',
        examples: [500, 1000],
      }),
      message: messageBody.meta({
        description: 'What the bridge sends once `timeout_ms` runs out — for a drive command, a zero twist. It must be safe in **every** state, because it is sent precisely when nobody is watching any more, and it may hold no placeholder: there is no caller left to fill one.',
      }),
    })
    /**
     * The string case is the exemption, not an oversight — see the paragraph
     * above — so it is tested first, where it reads as one.
     */
    .refine((f) => typeof f.message === 'string' || placeholderNames(f.message).size === 0, {
      message: 'the failsafe message must contain no placeholder: it is sent with no caller to fill one',
      path: ['message'],
      params: { code: 'failsafe_has_parameters' },
    })
    .meta({
      description: 'What the bridge sends **by itself** once a client stops sending, and how long it waits first. This is the format\'s safety story in one field: a client that crashes, loses its connection or whose operator closes the window does not leave a robot driving. The message may hold no placeholder, inline or through a shared message — there is nobody left to fill one.',
    }),
  quiet_timeout_ms: z.number().int().nonnegative().max(600_000).meta({
    description: 'How long this publisher must stay silent before a **different** user may send to it. Whoever sends holds it implicitly exclusive, with no session and no lock, so this one number is the whole handover policy: too short and two operators fight over one robot, too long and a crashed client blocks it for everyone.',
    examples: [2000],
  }),
  description: serviceDescription.meta({
    description: 'What sending to this publisher does, in the developer\'s own words. It is documentation for the console and for MCP clients — the robot does nothing with it — and as for actions and services, no description means no MCP tool. A caller sends here repeatedly and continuously rather than once, which is why this kind alone carries `failsafe` and `quiet_timeout_ms`.',
    examples: ['Velocity command. If sending stops, the robot stops.'],
  }),
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
export const cameraCredentials = z
  .strictObject({
    username: z.string().min(1).max(128).optional().meta({
      description: 'The account name the camera expects. The bridge sends it when it opens the stream — as RTSP `Authorization: Basic`, or as HTTP Basic for an MJPEG URL.',
      examples: ['ops'],
    }),
    password: z.string().min(1).max(128).optional().meta({
      description: 'The password for `username`. **There is no secret store behind this**: the value written here is the value stored, so treat it as readable by everyone who may read this robot\'s configuration, now and in its history.',
    }),
  })
  .meta({
    description: 'Username and password for the stream, standing **in clear text in the document**. A published version is immutable, so a password here cannot be removed from history or rotated without republishing — which is why the publish audit event carries only the version number and never the document body. Userinfo in the `url` works too; an explicit block here wins over it.',
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
  z.strictObject({
    kind: z.literal('ros').meta({
      description: 'Selects the ROS image-topic source: this camera then carries `topic` and `type`, and no field of another kind.',
    }),
    topic: rosName.meta({
      description: 'The ROS image topic the bridge subscribes to, as an absolute graph name. Clients never name it — they address the camera by its slug — so the topic can be renamed on the robot without an app changing.',
      examples: ['/camera/image_raw'],
    }),
    type: rosTypeName.meta({
      description: 'The message type of `topic`: `sensor_msgs/msg/Image` for raw frames, `sensor_msgs/msg/CompressedImage` for a camera that already encodes. Declared here rather than introspected, so a camera can be configured for a robot that has never connected.',
      examples: ['sensor_msgs/msg/Image'],
    }),
  }).meta({
    description: 'Frames come from an image topic the robot already publishes. It is the only source the bridge **subscribes** to rather than opens, so it needs no URL, no device and nobody to authenticate to.',
  }),
  z.strictObject({
    kind: z.literal('rtsp').meta({
      description: 'Selects the RTSP source: this camera then carries `url`, and optionally `transport` and `credentials`.',
    }),
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
    url: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^rtsps?:\/\//i, 'must be an rtsp:// or rtsps:// URL')
      .meta({
        description: 'Where the stream lives, reached from the robot rather than from the cloud. **`rtsp://` or `rtsps://` only** — the bridge opens this with a library that would equally honour `file:`, so an unconstrained URL would turn a configuration document into arbitrary file access on the robot. The bridge re-checks the scheme itself, so a validator that changed could not make a robot serve files.',
        examples: ['rtsp://cam-1.plant.local/stream1'],
      }),
    /** TCP by default: UDP loses frames on a congested link, silently. */
    transport: z.enum(['tcp', 'udp']).optional().meta({
      description: 'How the RTSP payload is carried. Omitted means `tcp`: `udp` loses frames on a congested link and loses them silently, so the result looks like a failing camera rather than like a choice made here.',
    }),
    credentials: cameraCredentials.optional(),
  }).meta({
    description: 'Frames come from an RTSP stream the robot itself can reach — a network camera on its own LAN. The bridge opens the connection; the cloud never does, and never needs a route to the camera.',
  }),
  z.strictObject({
    kind: z.literal('mjpeg').meta({
      description: 'Selects the MJPEG-over-HTTP source: this camera then carries `url`, and optionally `credentials`.',
    }),
    /** `http:`/`https:` only — see the `rtsp` variant above for why. */
    url: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^https?:\/\//i, 'must be an http:// or https:// URL')
      .meta({
        description: 'Where the stream lives. **`http://` or `https://` only** — as for the `rtsp` URL, the bridge opens it with a library that would also serve `file:`. Plain `http://` is permitted because these cameras usually sit on the robot\'s own network, but Basic credentials on such a URL then travel in the clear.',
      }),
    credentials: cameraCredentials.optional(),
  }).meta({
    description: 'Frames come from an MJPEG stream over HTTP — one JPEG after another, the simplest network source there is. Unlike `rtsp` there is no `transport` to choose: it is HTTP, and any `credentials` therefore travel as HTTP Basic.',
  }),
  z.strictObject({
    kind: z.literal('v4l2').meta({
      description: 'Selects the local capture-device source: this camera then carries `device` and nothing else — there is no network here and nobody to authenticate to.',
    }),
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
      .refine((v) => !v.endsWith('/'), 'must name a device, not a directory')
      .meta({
        description: 'The capture device, resolved on the robot and never by the cloud; a `/dev/v4l/by-id/...` symlink survives a reboot that renumbers `/dev/video0`. **Constrained to `/dev/`** — the string reaches OpenCV, which will just as happily open an ordinary video file or an `http://` URL and publish its pixels to the cloud. The bridge re-derives the same constraint rather than trusting the wire.',
        examples: ['/dev/video0'],
      }),
  }).meta({
    description: 'Frames come from a capture device attached to the robot itself, such as a USB camera on `/dev/video0`. Nothing leaves the robot to fetch them, and there is nothing to authenticate to, so this source takes no `credentials`.',
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
  source: cameraSource.meta({
    description: 'Where this camera\'s frames come from. `kind` picks one of four sources and fixes which other fields the source may carry, so an impossible camera is unrepresentable rather than merely invalid — there is no way to write an RTSP camera with a ROS topic.',
  }),
  width: z.number().int().positive().max(7680).meta({
    description: 'The width the bridge scales every frame to before sending, in pixels — what the bridge produces, not what the sensor captures. It stands in the configuration and never in a viewer\'s request, so no client can make the robot encode a larger frame than the developer allowed.',
    examples: [1280],
  }),
  height: z.number().int().positive().max(4320).meta({
    description: 'The height the bridge scales every frame to, in pixels; with `width` it is the size the live stream carries. A snapshot can arrive **smaller** than this — its JPEG has a byte ceiling, and the bridge gives up quality first and then resolution to fit, reporting the size it actually encoded.',
    examples: [720],
  }),
  fps: z.number().int().positive().max(60).meta({
    description: 'How many frames a second the bridge forwards, at most. It is a ceiling, not a clock: a camera that delivers ten frames a second stays at ten. Both modes read the same throttled pipeline, so this also bounds how fresh a snapshot can be.',
    examples: [15],
  }),
  bitrate_kbps: z.number().int().positive().max(50_000).meta({
    description: 'The ceiling for the **live** encoding, in kilobits per second — this is what bounds a watched camera against the robot\'s uplink. Snapshots are not covered by it: they are JPEGs under their own byte ceiling. Raising `width`, `height` or `fps` against a fixed bitrate buys blur, not detail.',
    examples: [2000],
  }),
  snapshot_interval_seconds: snapshotIntervalSeconds.meta({
    description: 'How often a still frame is captured, in seconds. **It runs whether or not anyone is watching**, unlike the live stream, which the cloud refcounts — first viewer starts it, last one ends it. The cloud caches the one frame and serves every reader from it, so a hundred pollers cost the robot exactly one image per interval.',
    examples: [5],
  }),
  description: serviceDescription.meta({
    description: 'What this camera shows, in the developer\'s own words — documentation for whoever reads the configuration, for the console and for MCP clients; the robot does nothing with it. **A camera without one is exposed as no MCP tool**, as for actions, services and publishers. The tool it does produce serves the latest snapshot with its age; a live session is never a tool.',
    examples: ['Forward-facing camera on the mast.'],
  }),
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
  fleetless: z.literal(FLEETLESS_FORMAT_VERSION).meta({
    description: 'The format version, and the first line of the file. It decides how everything below is read, so a file that omits it — or names a version this cloud does not know — is **refused rather than half understood**.',
  }),
  messages: messageMap.meta({
    description: 'Reusable message bodies, keyed by name, inserted elsewhere by writing `${name}` directly after `message:`. A shared body may hold placeholders and whoever inserts it declares the parameters, so two publishers can send the same message under different bounds. **A shared message may not insert another**, so a `${name}` inside a body is always a parameter and never a second message.',
  }).optional(),
  datapoints: capped(datapointConfig, 200, 'datapoints').meta({
    description: 'A value the robot publishes: one field of one topic, or a whole topic, and **never several topics**. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind.',
  }).optional(),
  actions: capped(actionConfig, 200, 'actions').meta({
    description: 'Things the robot does on request that take time, each reported as a job with progress. **At most one job runs per action slug**: a second call is refused `busy`, and every observer of that slug watches the same job. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind.',
  }).optional(),
  services: capped(serviceConfig, 200, 'services').meta({
    description: 'ROS service calls the robot answers — one request, one reply. Unlike an action a service is short and reports **no progress**, so there is no job to observe while it runs. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind.',
  }).optional(),
  publishers: capped(publisherConfig, 200, 'publishers').meta({
    description: 'Topics clients may send to, and where the format\'s whole safety story lives. The `message` template fixes every value a caller cannot change, and **`failsafe` is required**: once a client falls silent the bridge sends the failsafe message itself, so an operator whose window closed does not leave a robot driving. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind.',
  }).optional(),
  cameras: capped(cameraConfig, 50, 'cameras').meta({
    description: 'Video the robot streams, and the still frames the cloud serves from it. `width`, `height`, `fps` and `bitrate_kbps` are what **the bridge produces before sending**, not what the camera captures — they live in the configuration rather than in a viewer\'s request precisely so that no viewer can make a robot send more. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind.',
  }).optional(),
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
