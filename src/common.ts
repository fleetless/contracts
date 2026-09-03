import { z } from 'zod'

/**
 * Names shared by every layer: the Fleetless slug and the ROS names it is
 * deliberately decoupled from (spec §4.1).
 *
 * They live here rather than in `protocol.ts` so the exposure model
 * (`config.ts`) and the bridge protocol can both use them without importing
 * each other.
 *
 * ## Each grammar's sentence lives beside its pattern
 *
 * A developer whose topic name was wrong used to be shown the regular
 * expression that refused it. The four `*_RULE` constants below are the
 * sentences that replace it — one per grammar rather than one per field,
 * because the message explains why the *pattern* said no, and the same pattern
 * says no for the same reason wherever it appears.
 *
 * Each is used **twice**: as the message zod itself produces, here, and as
 * `patternErrorMessage` in `config.ts`'s exported JSON Schema, which is a
 * published artifact that other tools validate against and that a person
 * reads. Under FL-005 D3 nothing will consume `patternErrorMessage` at runtime
 * **once wave 3 lands** — `useMonacoYaml.ts` still passes `validate: true`
 * today, so until then this sentence IS the live diagnostic in the editor and
 * zod's is the live one on the server. Either way it is a second spelling of a
 * live rule, and an unwatched one would drift word for word,
 * forever and invisibly — the shape that had `buildAcceptUrl` mailing one URL
 * three ways. They are therefore one constant with two readers rather than two
 * strings that happen to agree, and `config-zod-messages.test.ts` asserts the
 * two readings are the same string at all 24 pattern positions the document
 * has.
 *
 * **They are exported because the pattern and its sentence must not be able to
 * move apart**, and the pattern is here while the schema annotation is in
 * `config.ts`. The three grammars that exist only inside a configuration
 * document — the two URL schemes and the capture-device path — are constants in
 * `config.ts` beside their own patterns, on the same rule.
 *
 * **The blast radius of putting the sentence here was measured, and it is
 * zero artifacts.** A `.meta()` on `slug` would reach 42 of the 159 published
 * schema artifacts, the bridge's vendored protocol frames among them — which is
 * why `mapKey` in `config.ts` carries the annotation and `slug` does not. A
 * message on a `.regex()` check is a different thing: zod renders no error
 * message into JSON Schema at all, so every artifact is byte-identical either
 * way (measured across all 278 barrel schemas under both `io` modes,
 * 2026-09-03). What it does reach is the sentence a *parser* produces, in every
 * layer that parses one of these names — which is the improvement, not a cost.
 */

export const SLUG_RULE = 'A name is lower-case: it starts with a letter, continues with letters and digits, and joins further words with a single underscore — `battery_voltage`. Capitals, dashes, dots, spaces, a leading digit and a doubled or trailing underscore are all refused.'

/**
 * A name: a slug for an exposed service or datapoint, a parameter name, a
 * message name. Lowercase, underscore-separated, letter-initial, 2..63
 * characters, no leading/trailing/doubled underscores.
 *
 * Names are stable and decoupled from ROS names (spec §4.1) — renaming a
 * topic on the robot must never break a client app. The reverse also holds
 * and costs more: changing a name breaks every client, role grant and MCP
 * tool name that uses it.
 */
export const slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, SLUG_RULE)

export const ROS_NAME_RULE = 'A ROS graph name is absolute: it begins with a slash, and each segment after a slash starts with a letter or an underscore and continues with letters, digits and underscores — `/camera/image_raw`. A relative name, a trailing slash, a dash or a dot is refused.'

/**
 * A fully qualified ROS graph name: absolute, slash-separated, each segment
 * letter- or underscore-initial. Relative names are refused — the bridge
 * would have to resolve them against a namespace the cloud cannot see.
 */
export const rosName = z
  .string()
  .max(255)
  .regex(/^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/, ROS_NAME_RULE)

export const ROS_TYPE_NAME_RULE = 'A ROS 2 type name has three segments: the package, then `msg`, `srv` or `action`, then the type — `sensor_msgs/msg/BatteryState`, `std_srvs/srv/Trigger`, `nav2_msgs/action/NavigateToPose`. The middle segment is the one usually left out. The package is lower-case with underscores; the type itself is letters and digits, conventionally CamelCase.'

/**
 * A ROS interface type as ROS 2 spells it: `pkg/msg/Type`, `pkg/srv/Type`,
 * `pkg/action/Type`. W2 resolves field trees for `msg` only (§4.5); the
 * other two are listed by the introspection browser and get their trees in
 * W4, where action and service parameters exist.
 */
export const rosTypeName = z
  .string()
  .max(255)
  .regex(/^[a-z][a-z0-9_]*\/(?:msg|srv|action)\/[A-Za-z][A-Za-z0-9]*$/, ROS_TYPE_NAME_RULE)

export const FIELD_PATH_RULE = 'A field path is dotted and lower-case, and each segment may index at most one array level — `voltage`, `pose.position.x`, `ranges[0]`. ROS 2 has no nested arrays, so a second index on one segment could name nothing that exists.'

/**
 * A path into a message: dot-separated field names, each carrying **at most
 * one** array index, e.g. `percentage`, `pose.position.x`, `ranges[0]`,
 * `poses[0].pose.position.x`. `null` in a datapoint config means *the whole
 * message* (spec §4.2: one field or one whole topic — never several topics).
 *
 * One index per segment is not a preference but the shape of the target: ROS 2
 * IDL has `float64[]`, `float64[3]` and `float64[<=10]`, and no nested or
 * multi-dimensional arrays at all. A second index on one segment — `a[0][1]` —
 * could therefore denote nothing on any message that exists. The bridge has
 * always refused it (`sampling.py`'s `FieldPathError`, *"ROS has no nested
 * arrays"*); this grammar said otherwise until FL-004, so a hand-written or
 * AI-generated document could pass the cloud and then fail at the robot as a
 * `config_applied` error — the latest and worst place to learn it.
 */
export const fieldPath = z
  .string()
  .max(255)
  .regex(/^[a-z_][a-z0-9_]*(?:\[\d+\])?(?:\.[a-z_][a-z0-9_]*(?:\[\d+\])?)*$/, FIELD_PATH_RULE)

/**
 * A unix-millisecond instant as a **query string** actually carries it, bounded
 * to years 1..9999.
 *
 * The union's input branch **is the wire** — a `z.coerce` cannot be published,
 * because zod renders the coercion's result in either `io` direction, so the
 * artifact would describe a shape a query string can never carry (DEF-059).
 *
 * The year bound is borrowed rather than invented: `nonnegative()` alone let
 * `253402300800000` through, where the Postgres bind path has no representation
 * and the route answered 500 — measured either side of the edge,
 * `253402300799000` -> 200 and `253402300800000` -> 500 (Argus-W9). This moved
 * here from `audit.ts` when `jobRunQuery` needed the same guard; a second copy
 * would have been a second policy for one decision.
 */
/**
 * A `seq` cursor as a **query string** actually carries it.
 *
 * The regex admits 19 digits, which is wider than a JavaScript number can
 * represent — `Number('9999999999999999999')` is `1e19`. That is safe, and
 * for a reason worth writing down rather than re-deriving: **zod 4's `.int()`
 * bounds the safe-integer range**, so such a value is refused here with a
 * `too_big` issue and the route answers 400. It never reaches Postgres as an
 * out-of-range `bigint`, and no extra `.max()` is needed — one that merely
 * restated `.int()` would be a second policy for one decision.
 *
 * Lives here because `auditQuery` and `jobRunQuery` had this **twice**, which
 * is how the newer copy ends up the weaker one.
 *
 * **What the published artifact does not say:** zod renders a
 * `.transform().pipe()` from its *input* branch, so the JSON Schema shows the
 * union and none of the constraints below it — a generated client reading it
 * would believe `-5` is acceptable. The runtime is the authority for this
 * field; the artifact describes only what the wire may carry.
 */
export const wireSeqCursor = z
  .union([z.string().regex(/^\d{1,19}$/), z.number().int()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive())

export const wireTimestampMs = z
  .union([z.string().regex(/^\d{1,15}$/), z.number().int()])
  .transform((v) => Number(v))
  .pipe(
    z
      .number()
      .int()
      .nonnegative()
      .refine((ms) => {
        const year = new Date(ms).getUTCFullYear()
        return Number.isFinite(year) && year >= 1 && year <= 9999
      }, 'must fall within years 1..9999'),
  )

/**
 * Which kind of exposure failed to apply. Known at every one of the bridge's five apply call sites.
 *
 * Lives here, not in `protocol.ts`, for the same reason `slug` and friends
 * do: `config.ts`'s `configState.applied_errors` is the REST shape the
 * console reads this same error through (spec `2026-08-21-exposure-and-revoke-design`
 * D4), and `protocol.ts` already imports from `config.ts`
 * (`credentialRef`, `robotConfigDoc`) — so `config.ts` importing back from
 * `protocol.ts` would be a cycle. One definition, reachable from both
 * without either importing the other.
 */
export const applyErrorKind = z.enum(['datapoint', 'action', 'service', 'publisher', 'camera'])
export type ApplyErrorKind = z.infer<typeof applyErrorKind>

/**
 * One thing that did not apply — carried on the wire by
 * `protocol.ts`'s `bridgeConfigApplied.errors` and read back by the console
 * through `config.ts`'s `configState.applied_errors`. **One definition**:
 * `configState` used to declare its own narrower `{ slug, message }` copy,
 * which silently stripped `kind`, `code` and `details` on every read —
 * exactly the shape of bug this file's own module comment warns about,
 * found only once the plan's console task tried to render the fields that
 * were never there.
 *
 * `slug` is the exposure's slug, or `*` when a whole kind failed before any
 * individual slug was reached (`client.py`'s `_apply_or_report` catch) — which
 * means something different from every other error: not "this slug is wrong"
 * but "this kind was not applied at all and its slugs are in an unknown state".
 *
 * **`code` is a bounded string and not a `z.enum`, deliberately**, following
 * `cloudHelloError.code`. An enum would make every future bridge
 * classification a protocol change on both sides; a string lets the bridge
 * learn to classify without the cloud being taught first, and the cloud renders
 * what it knows and passes the rest through. The codes the bridge produces
 * today are `field_path_invalid`, `whole_kind_failed` and `unknown`.
 *
 * `details` carries whatever a classifier has to add. **Nothing redacts it** —
 * the same rule `auditEvent.details` states.
 */
export const applyError = z.object({
  slug: z.string(),
  kind: applyErrorKind,
  code: z.string().min(1).max(40),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ApplyError = z.infer<typeof applyError>
