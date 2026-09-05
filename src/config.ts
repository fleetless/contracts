import { z } from 'zod'
import {
  applyError,
  slug,
  rosName,
  rosTypeName,
  fieldPath,
  SLUG_RULE,
  ROS_NAME_RULE,
  ROS_TYPE_NAME_RULE,
  FIELD_PATH_RULE,
} from './common.js'
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
 * answers on its own: `unknown_key` (every object is this file's own
 * `strictObject`, which is `z.strictObject` plus a missing key that names
 * itself),
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
 * What every `pattern` in this document means, said in words.
 *
 * A developer whose topic name was wrong used to be shown the regular
 * expression that refused it. These are the sentences that replace it — one
 * per grammar rather than one per field, because the message explains why the
 * *pattern* said no, and the same pattern says no for the same reason wherever
 * it appears.
 *
 * **Four of the seven are not here.** `SLUG_RULE`, `ROS_NAME_RULE`,
 * `ROS_TYPE_NAME_RULE` and `FIELD_PATH_RULE` belong to patterns `common.ts`
 * declares, and each one lives beside its pattern so that the two cannot move
 * apart; that file's header says why. The three below exist only inside a
 * configuration document, so they are here, beside theirs, on the same rule.
 *
 * **Where they are read, and when.** Each is used twice: as the message **zod
 * itself produces**, and as `patternErrorMessage` in the exported JSON Schema,
 * which is a published artifact other tools validate against and which a person
 * reads. One constant with two readers, never two strings that happen to agree
 * — `config-zod-messages.test.ts` asserts the two readings are the same string
 * at all 24 pattern positions the document has, because under D3 nothing
 * consumes `patternErrorMessage` at runtime and an unwatched second spelling of
 * a live rule drifts word for word, forever and invisibly.
 *
 * In the console `patternErrorMessage` is also the live pattern diagnostic
 * **until wave 3 lands**: `useMonacoYaml.ts` still passes `validate: true`, so
 * between task 7's artifacts and D3 these sentences are what monaco-yaml shows.
 * D3 then turns that validation off, and from there the message a developer
 * sees comes from this schema's own parser and from the cloud — the same
 * sentence, which is the point of there being one.
 *
 * The tense matters because the two states look identical from inside this
 * file. Whoever reads it after wave 3 should find a claim that was true when
 * written and stayed true, not one that quietly became false.
 *
 * Each one states the rule in words and gives one example, and none of them
 * quotes its own regex — `config-messages.test.ts` asserts that over every
 * pattern in the exported document, not over the three below.
 */
const RTSP_URL_RULE = 'The URL has to begin with `rtsp://` or `rtsps://` — `rtsp://cam-1.plant.local/stream1`. No other scheme is accepted: the bridge opens this with a library that would equally honour `file:`.'

const MJPEG_URL_RULE = 'The URL has to begin with `http://` or `https://` — `http://cam-1.plant.local/video.mjpg`. No other scheme is accepted: the bridge opens this with a library that would equally serve `file:`.'

const DEVICE_PATH_RULE = 'A capture device is a path under `/dev/`, and the character straight after it is a letter or a digit — `/dev/video0`, or a stable `/dev/v4l/by-id/...` symlink. Nothing outside `/dev/` is accepted: the string reaches OpenCV, which would as happily open an ordinary file.'

/**
 * The key of every section, every parameter map and the alert map: a slug,
 * carrying the grammar's sentence.
 *
 * **`slug` itself stays plain in `common.ts`, and the reason is blast radius.**
 * Not metadata loss: `.meta()` on a clone *merges* with the parent's entry per
 * key and resolves it lazily, measured against zod 4.4.3 and written up at
 * `messageBody`'s own `.meta()` below — a later `description` on a use of
 * `slug` would keep the sentence, not drop it.
 *
 * What that reach would cost was measured instead, by adding the one `.meta()`
 * line to `slug` in a copy of `src/` and re-exporting every artifact under each
 * schema's own `io`: **42 of the 159 published schema artifacts** would carry
 * it, `bridge-hello`, `datapoint-frame`, `snapshot-header` and
 * `bridge-camera-state` among them — protocol frames the bridge **vendors**
 * under `bridge/test/contracts/schema/`, so rewording one sentence would become
 * a re-vendor plus a `SOURCE.md` edit in another repo. As landed the same
 * search finds **7**, all config-derived.
 *
 * Whether `vscode-json-languageservice` honours `patternErrorMessage` on a
 * `propertyNames` schema at all is **not measured** — §1.3 measured a value
 * position, not a key one. It ships for the same reason as the rest: the
 * artifact is read by tools and by people.
 */
const mapKey = slug.meta({ patternErrorMessage: SLUG_RULE })

/**
 * One field, carrying the sentence it says when it is absent.
 *
 * **Three shapes of "this key is not here", and the first version of this
 * helper caught one of them.** A walk over every required key of a fully
 * populated document — `config-zod-messages.test.ts`, which is the guard that
 * found it — says the format has 52 required-key positions and that 14 were
 * still answering in zod's words:
 *
 * - `invalid_type`, the ordinary case: a string, a number, an object.
 * - `invalid_value` from a `z.literal` or a `z.enum`. A missing `fleetless:`
 *   said `Invalid input: expected 1`; a parameter without a `type` recited all
 *   fifteen ROS primitives.
 * - `invalid_union`. `alertCondition.fire_at` said `Invalid input` and nothing
 *   else, and a camera source without `kind` said `Invalid discriminator value`
 *   — where the input is not `undefined` at all but the object that lacks the
 *   key, which is why that branch is tested separately.
 *
 * So the rule is the fact rather than the code: **a required field whose input
 * is absent is a missing key, whatever zod calls the refusal.** For a value
 * present as an explicit `undefined` the sentence reads as "missing", which is
 * what the format means by it: omission is this format's only spelling of "not
 * set".
 *
 * **`z.unknown()` needs a wrapper before it can be given a sentence at all.**
 * It accepts `undefined`, so zod marks the key required and raises its own
 * `expected nonoptional, received undefined` — an issue it attributes to
 * neither the field nor the object, so no error map of ours is consulted
 * (measured). `z.nonoptional` puts a schema there that can carry one. The JSON
 * Schema and the inferred type are byte-identical either way (measured, zod
 * 4.4.3), and a field that is genuinely optional is `.optional()` and is
 * skipped here — but it is **not** behaviourally free, and that is the one
 * place this task changed what the format accepts: a required key *present*
 * holding `undefined` is now refused where zod's internal check accepted it.
 *
 * That was ruled in deliberately rather than noticed later, because no route
 * into this format can carry such a key — JSON drops it, YAML's `message:`
 * yields `null`, and jsonb cannot represent it — and because the alternative
 * leaves `expected nonoptional, received undefined` on `message`, a field
 * developers write by hand. The three measurements, and the condition that
 * would make them false, are written where they are asserted:
 * `config-zod-messages.test.ts`, *"and no route into the format can carry
 * one"*. Read that before changing this line.
 *
 * `clone` is the only way to add an `error` to a schema that is already built,
 * and **it drops the schema's registry entry** — its `description`, its
 * `examples`, every annotation this wave added, all of which live in
 * `z.globalRegistry` keyed by the schema instance rather than in its
 * definition. So the entry is read back and put on the clone. Measured on zod
 * 4.4.3: `z.globalRegistry.get` resolves the whole `.meta()` parent chain into
 * one object, so what is copied is what the export would have produced, and a
 * later `.meta()` on the result merges with it as it did before. A wrapper that
 * silently emptied every hover in the format would be the worst available way
 * to improve one message.
 *
 * Two residuals, neither reachable in this file today and both worth knowing
 * before it grows: `{ ...def }` is a shallow spread and `def.shape` is a
 * **getter**, so the spread resolves every nested shape at module-eval time —
 * a `z.lazy` or a forward reference added later would be resolved here before
 * its cycle closed, and the JSON Schema export could still look identical. And
 * the copied registry entry is the resolved merge with no parent link, so a
 * `.meta()` called on an original field *after* `strictObject` consumed it
 * would not reach the copy inside the document. Neither is reachable here, and
 * not by inspection: this module evaluates top to bottom, so a forward
 * reference in any shape would be a `ReferenceError` at import rather than a
 * subtle export — the module loading at all is the measurement. The one
 * `z.lazy` in `contracts` is `introspection.ts`'s `typeField`, which no shape
 * in this file holds. And every `.meta()` here is applied before the shape is
 * handed over, which is what the file reads like and what the export
 * comparison would show if it were not.
 *
 * The inherited `error` is kept and deferred to, so this composes with a
 * field that already carries one rather than replacing it.
 */
const saysItIsMissing = <T extends z.core.$ZodType>(field: T): T => {
  const meta = z.globalRegistry.get(field)
  const def = { ...(field as unknown as { _zod: { def: Record<string, unknown> } })._zod.def }
  const inherited = def.error
  const carrier = def.type === 'optional' || !(field as unknown as z.ZodType).safeParse(undefined).success
    ? field
    : (z.nonoptional(field as unknown as z.ZodType) as unknown as T)
  const carrierDef = carrier === field
    ? def
    : { ...(carrier as unknown as { _zod: { def: Record<string, unknown> } })._zod.def }
  carrierDef.error = (issue: z.core.$ZodRawIssue): string | undefined => {
    const key = issue.path?.[issue.path.length - 1]
    if (typeof key === 'string' && absent(issue, key)) return `Missing required key \`${key}\`.`
    return typeof inherited === 'function' ? inherited(issue) : (inherited as string | undefined)
  }
  const cloned = (carrier as unknown as { clone: (d: unknown) => T }).clone(carrierDef)
  if (meta !== undefined) z.globalRegistry.add(cloned, meta)
  return cloned
}

/**
 * Whether an issue is one field's way of saying the key is not there.
 *
 * The second arm is the discriminated union: zod hands its error map the whole
 * object and points the path at the discriminator, so `input` is not
 * `undefined` and the first arm cannot see it. `Object.hasOwn` rather than
 * `in`, on this project's own rule — a document's keys are chosen by a
 * developer, and `constructor` satisfies the slug grammar.
 */
const absent = (issue: z.core.$ZodRawIssue, key: string): boolean =>
  issue.input === undefined
  || (issue.code === 'invalid_union'
    && typeof issue.input === 'object'
    && issue.input !== null
    && !Object.hasOwn(issue.input, key))

/** Each field of a shape, carrying the sentence it says when it is missing. */
const namesItsAbsence = <T extends z.ZodRawShape>(shape: T): T =>
  Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, saysItIsMissing(field)])) as T

/**
 * Every object in this document is strict, and every required key of it says
 * its own name when it is absent.
 *
 * **This is not `z.strictObject`** — it is this file's, wrapping it. The
 * difference is the second half: `Invalid input: expected object, received
 * undefined` was the whole of what a developer was told when a camera had no
 * `source:` (design §1.5), naming neither the key nor the fact that it was
 * required. monaco-yaml said `Missing property "source".` for the same
 * document, and was right to.
 *
 * It has to be done a field at a time. zod attributes a missing key to the
 * **field's own** schema — an `invalid_type` whose input is `undefined` — and
 * an `error` on the containing object is never consulted for it; measured on
 * zod 4.4.3, an error map on the object saw no such issue at all. So the
 * sentence is attached to every field of every shape, here, in one place,
 * rather than at the eighteen objects and hundred-odd fields it would
 * otherwise have to be remembered at.
 *
 * **How "every" is enforced, because the first version of this comment said
 * "every" and was wrong.** Six of the eighteen objects were written
 * `z\n  .strictObject({`, so `z.strictObject` never appeared on one line and a
 * `grep` for it returned only prose. Twelve conversions read as eighteen, and
 * eleven required keys — `datapoints.<slug>.topic` and `.type` among them,
 * which is the commonest entry in the whole format — went on reciting the
 * sentence §1.5 calls unusable. The claim was in the source, which is what the
 * next person reads.
 *
 * What makes it true now is not this paragraph. It is
 * `config-zod-messages.test.ts`'s *"a required key that is absent names
 * itself"*: a walk of the exported schema's `required` arrays against a
 * fully-populated document, `oneOf` branches resolved by their discriminator,
 * deleting one key at a time and asserting the message names it. It reaches 52
 * positions across 19 objects, and the count comes out of the walk rather than
 * off a list — a required key added to the format later is swept the day it
 * exists, and an object that skips this helper is red before it is merged.
 */
const strictObject = <T extends z.ZodRawShape>(shape: T) => z.strictObject(namesItsAbsence(shape))

/**
 * A map keyed by slugs, whose refused key says **which** key and **why**.
 *
 * `Invalid key in record` was the worst sentence in the format and it lands on
 * the commonest beginner mistake — a section keyed `Battery` rather than
 * `battery`. It named neither the key nor the grammar, and the grammar was
 * sitting one level down, on the key schema's own issue, where nothing that
 * renders a `safeParse` result ever looks: the cloud's 422 and the console both
 * read the top-level `issues[].message` and nothing below it.
 *
 * So the sentence is composed from exactly that: the key, then the messages of
 * the issues the key schema itself raised. A key too short says so; a key that
 * breaks the grammar states the grammar, `SLUG_RULE` verbatim. Composing rather
 * than restating is what keeps this from becoming a second wording of the rule
 * the moment the rule is reworded.
 *
 * The path already carries the key (`datapoints.Battery`) and always did — the
 * fix is the sentence, not the path — but a message that reads correctly on its
 * own is what a diagnostic list, a 422 body and a hover all need.
 */
const slugKeyed = <T extends z.core.$ZodType>(entry: T) =>
  z.record(mapKey, entry, {
    error: (issue) => {
      if (issue.code !== 'invalid_key') return undefined
      const why = issue.issues.map((inner) => inner.message).filter(Boolean).join(' ')
      return why.length === 0 ? undefined : `\`${String(issue.input)}\` is not a valid name. ${why}`
    },
  })

/**
 * `enumDescriptions` built from a table keyed by the **value**, never written
 * out as a positional array.
 *
 * The consuming key is positional — `enumDescriptions[i]` documents `enum[i]` —
 * and that is the whole hazard. Fifteen sentences hand-aligned against
 * `parameterType`'s declaration order would misalign in silence the day
 * somebody regroups that list, which is a grouping rather than an order the
 * format needs. It would misalign only in the published artifact, where
 * nothing else looks.
 *
 * So the alignment is made unrepresentable rather than tested: the table is
 * keyed by value, `Record<V, string>` makes a missing value a **typecheck**
 * failure the day one is added, and the order comes from the enum's own
 * `.options`. `config-messages.test.ts` still checks arity, non-emptiness and
 * that the sentences differ from one another — what it cannot check, and says
 * so, is whether a sentence is the *right* one for its value.
 */
const describeValues = <V extends string>(values: readonly V[], table: Record<V, string>): string[] =>
  values.map((value) => table[value])

/**
 * One of the format's own parameter holes, `${name}`, written so that it
 * survives a `defaultSnippets` insert. **The backslash is load-bearing and is
 * not a typo to tidy away.**
 *
 * The two syntaxes collide. `defaultSnippets` bodies are inserted as LSP
 * snippets, where `${1:front}` is a tab stop and `${speed}` is a *variable* —
 * and an unknown variable is not left alone. Measured against
 * monaco-editor 0.52.2's own `SnippetParser`, which is what the console runs:
 *
 * | body holds | the editor inserts |
 * |---|---|
 * | `x: ${speed}` | `x: ` — the hole is **deleted**, silently |
 * | `x: \${speed}` | `x: ${speed}` |
 *
 * yaml-language-server emits body strings verbatim (`stringifyObject`'s
 * replacer only strips a leading `^` and quotes `true`/`false`), so nothing
 * between here and the snippet engine escapes it for us. A body that writes a
 * parameter unescaped therefore offers a developer a publisher whose message
 * has lost the very value a caller was meant to fill, which parses and is
 * wrong — the worst available outcome for a hint the developer trusts.
 */
const param = (name: string) => `\\\${${name}}`

/** A snippet as authored: what the picker shows, and the block it inserts. */
type Snippet = { label: string, description: string, body: Record<string, unknown> }

/**
 * The same skeleton, offered one level out — at the section rather than at the
 * entry.
 *
 * A section body is its entry body under one slug key: `datapoints:` offers
 * `{ battery: … }`, and `battery: ▮` offers the `…`. Both positions are real
 * and both were silent, but they are **one skeleton**, so each is authored once
 * as a `Snippet` constant and wrapped here for the section — never copied.
 * Two copies of one skeleton is the drift this wave caught three times in three
 * reviews: a body inventing a value its sibling had already answered, under a
 * label that still agreed. `config-snippets.test.ts` deep-compares the two
 * positions rather than trusting this.
 *
 * **The slug key belongs to the wrapper, not to the skeleton**, because it
 * differs per snippet — `battery_voltage` for a plain datapoint, `battery` for
 * the numeric one. It therefore takes tab stop `${1}`, and an entry body's own
 * stops are numbered from `${2}` throughout. At the entry position that leaves
 * no `${1}` at all, which costs nothing — measured against
 * monaco-editor 0.52.2's own `SnippetParser`, the version the console runs: it
 * sorts placeholders by index and requires neither that they start at 1 nor
 * that they be contiguous, so a body of `a: ${2:x}` visits `2` first, and one
 * of `a: ${2:x}` / `b: ${5:y}` visits `2` then `5`.
 */
const underSlug = (slugKey: string, snippet: Snippet): Snippet =>
  ({ ...snippet, body: { [slugKey]: snippet.body } })

/**
 * What an exposed service *is*, in the developer's own words (§17).
 *
 * This is what `robot_describe` carries verbatim, so it is read by a model
 * that has never seen this robot and cannot ask a follow-up question.
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
 * One hole a caller fills, authored once for the two positions it is offered
 * from: `parameters:` (under `underSlug`) and the value of one entry below it.
 *
 * `type` is a placeholder default rather than a choice, unlike the camera
 * source's `type`, and for two reasons that are **not** "the editor offers the
 * fifteen here anyway". It does not: after the insert this position holds
 * `float64` as a selected tab stop, and Monaco does not open the suggest widget
 * over one — nor as the developer types over the selection, since an unquoted
 * YAML scalar tokenizes as `string` and the editor's default
 * `quickSuggestions.strings` is false. The fifteen are an explicit Ctrl+Space
 * away.
 *
 * The reasons that do hold: fifteen options is a list that would have to be
 * maintained beside the enum, and the enum is the format's own answer — a
 * snippet must not fork it, and any shorter list is a subset presented as the
 * set. And a wrong pick here **is** reported: `type_mismatch` checks the
 * declared type against the type at the template position, which is the half of
 * the rule that settles it. That is the difference from the camera `type`,
 * where a wrong pick is accepted by every layer and the bridge then delivers no
 * frames with nothing objecting.
 *
 * The bounds are the point of the block — the field descriptions call them
 * where a speed limit actually holds — so they are in the skeleton, at
 * `min_value`/`max_value`'s own `examples`. They are coupled to `type`: tabbing
 * `float64` to `string` makes them `constraint_not_allowed_for_type`, one line
 * below the pick, in a message that names the value just chosen. That is
 * deliberate, where omitting the bounds would leave the format's one
 * enforcement point out of the hint that introduces it. **When the developer
 * meets it is not today**: this is a `superRefine`, so it is not in the JSON
 * Schema export and monaco-yaml cannot see it — until the console validates
 * against `robotConfigDoc` itself, the refusal arrives on save rather than
 * under the cursor.
 *
 * No `default`, so the parameter is required: `default` is the one field here
 * with no `examples`, and "has no default" is the format's spelling of
 * required, which is the honest thing for a skeleton to start from. That every
 * declared parameter must also appear in the `message` is a question about the
 * whole entry and is the cloud's, not this schema's.
 */
const PARAMETER_SNIPPET: Snippet = {
  label: 'a parameter, with its bounds',
  description: 'One hole a caller fills: what type it is, what values it may take, and what it means. Without a `default` it is required, and the bounds are enforced in the cloud before anything reaches the robot.',
  body: {
    type: '${2:float64}',
    min_value: -0.5,
    max_value: 0.5,
    description: '${3:What a caller is choosing when they set this.}',
  },
}

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
export const parameterSpec = strictObject({
  type: parameterType.meta({
    description: 'The ROS 2 primitive a value of this parameter must be, spelled the way ROS 2 spells it — `float64`, not `double`. It **decides which other constraints are allowed at all**: `min_value` and `max_value` need a numeric type, `regex` needs a string one, and a constraint on the wrong type is refused rather than quietly ignored.',
    /**
     * One sentence per value. The field's own paragraph is already the
     * hover; these answer the different question the editor asks when the
     * cursor is on **one** offer — what is this type, and what does choosing
     * it allow. Written for the value, so `int32` states its range and
     * `string` says it is the type a `regex` may constrain.
     */
    enumDescriptions: describeValues(parameterType.options, {
      bool: 'A `true`/`false` flag. The one type that takes no constraint at all: no bounds, no `regex`, no `enum`.',
      byte: 'One raw octet, `0` to `255`, carrying no character meaning. It counts as an integer here, so bounds and an `enum` apply to it.',
      char: 'A single-octet character code, `0` to `255`. ROS 2 keeps it apart from `byte` although the width is the same, and it travels as a number rather than as a one-character string.',
      int8: 'A whole number from `-128` to `127`.',
      uint8: 'A whole number from `0` to `255`.',
      int16: 'A whole number from `-32768` to `32767`.',
      uint16: 'A whole number from `0` to `65535`.',
      int32: 'A whole number from `-2147483648` to `2147483647` — the usual choice for a count or an index.',
      uint32: 'A whole number from `0` to `4294967295`.',
      int64: 'A whole number from `-9223372036854775808` to `9223372036854775807`.',
      uint64: 'A whole number from `0` to `18446744073709551615`.',
      float32: 'A single-precision number, roughly seven significant digits.',
      float64: 'A double-precision number, roughly fifteen significant digits. This is what other languages call `double`; ROS 2 spells it `float64` and so does this field.',
      string: 'Text, carried as UTF-8. One of the two types a `regex` may constrain.',
      wstring: 'Text as wide characters, and rare — nearly every ROS 2 interface uses `string`. It takes a `regex` on the same terms.',
    }),
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
    description: 'What this parameter means, in the developer\'s own words, and documentation only — the robot does nothing with it. It travels into the input schema `robot_describe` publishes for this call, beside the bounds, so `type` and the range say what the value *is* and this is the only place that says what it *does*.',
    /** The sentence `PARAMETER_SNIPPET` already places here, verbatim. */
    examples: ['What a caller is choosing when they set this.'],
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
  /**
   * The value position of one entry — `speed: ▮` under `parameters:`. It is
   * reached by a developer adding a **second** parameter by hand, which the
   * section snippet never covers: that one fires on the empty `parameters:` and
   * not again.
   */
  .meta({ defaultSnippets: [PARAMETER_SNIPPET] })
export type ParameterSpec = z.infer<typeof parameterSpec>

/** Parameters of one entry, keyed by name. At most 50. */
export const parameterMap = slugKeyed(parameterSpec)
  .refine((m) => Object.keys(m).length <= 50, { message: 'at most 50 parameters per entry' })
  .meta({
    description: 'The holes in this entry\'s `message` that a caller fills, keyed by **parameter name** rather than by field path — so the name survives the field moving inside the message, and a caller sends something that means what it says. Every declared parameter must appear somewhere in the message and every `${name}` in the message must be declared; either half alone is an error.',
    /**
     * **One snippet reaching three positions.** `parameters:` under an action,
     * under a service and under a publisher are all this node, so the snippet
     * is authored once here rather than three times on the three sections.
     * Three copies that must agree is three chances to disagree, and the
     * export inlines this object into all three positions — which
     * `config-snippets.test.ts` asserts rather than assumes, because the way
     * this comes apart is somebody later giving one section a `parameters:`
     * snippet of its own.
     *
     * The body is `PARAMETER_SNIPPET` under its slug key — the same skeleton
     * the entry position below offers, and the reasons behind every value in
     * it are written there.
     */
    defaultSnippets: [underSlug('${1:speed}', PARAMETER_SNIPPET)],
  })

/**
 * Slugs no configured entry may take (spec §4.3), across **all five exposure
 * sections at once** — slugs are one namespace, so a name reserved here is
 * reserved everywhere.
 *
 * The first three are built-ins: the cloud or the bridge already publishes
 * something under them, so a configured entry would be a second producer for
 * one name. `history` is reserved for a different reason and is not a built-in
 * — nothing publishes it. `GET /api/robots/:id/jobs/history` is a **literal
 * sibling** of `GET /api/robots/:id/jobs/:slug`, so an action or service named
 * `history` would have a job route no caller could ever reach. Reserving the
 * name is the honest half of that: the alternative is a slug the format
 * accepts and one route silently cannot address.
 *
 * **This constant is the only list.** The cloud's `validation.ts` builds its
 * set from it and emits `reserved_slug`; `config-store.ts` reads it for the
 * rename target; the console reads it for slug suggestion and repairs. Nothing
 * copies the members. Note that it is NOT the enumeration of built-in
 * datapoints — the cloud keeps that separately, and it must, now that a
 * reserved name exists that no plane serves.
 *
 * **What it does not do: `robotConfigDoc` does not enforce it.** Reservation is
 * a semantic check that belongs with the ones that need the robot's context,
 * and it answers as a `ValidationIssue` carrying the section, the slug and a
 * severity — which a zod issue could not, and which is what the console's
 * repair actions read. The section descriptions below say "refused here"
 * meaning refused for the document, not refused by this parse.
 */
export const RESERVED_SLUGS = ['bridge_state', 'robot_details', 'bridge_pressure', 'history'] as const

/**
 * When an alert fires and when it is ok again. There is no discriminator:
 * `resolve_at` absent means equality, present means a threshold whose
 * direction follows from the comparison. The gap is the hysteresis, and it
 * is therefore mandatory for thresholds — a value sitting exactly on a
 * threshold with no gap flips on every sample.
 */
export const alertCondition = strictObject({
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
 * One whole alert, authored once for the two positions it is offered from:
 * `alerts:` (under `underSlug`) and the value of one entry below it.
 *
 * **The body carries a condition.** `condition` is `datapointAlert`'s only
 * required field, so a skeleton that stopped at the key would insert a document
 * the format refuses — the one outcome worse than offering nothing, because the
 * developer trusts the hint. It is also one decision for a reader: an alert
 * without a condition is not a partial alert, it is nothing. The separate
 * snippets on `condition` itself still earn their place — they are what a
 * developer gets when they come back to an existing alert and rewrite the
 * threshold, where this one is never offered.
 *
 * `severity` is left out: it is optional, absent means `warning`, and it
 * changes no behaviour at all. Writing it would add a line that decides
 * nothing. `enabled` likewise — absent means on, which is what an alert
 * somebody just wrote is for.
 */
const ALERT_SNIPPET: Snippet = {
  label: 'an alert, with its condition',
  description: 'One whole alert: the label shown in place of its key, and the threshold with the gap that keeps it from flipping on every sample.',
  body: {
    condition: { fire_at: 15, resolve_at: 18 },
    name: '${2:Battery low}',
  },
}

/**
 * An alert's definition. Runtime state — whether it is firing, since when,
 * with what value — is NOT here: it lives in the database and survives a
 * restart, and it has no business in a versioned document.
 *
 * `severity` and `enabled` are absent-means-`ALERT_SEVERITY_DEFAULT` and
 * absent-means-`ALERT_ENABLED_DEFAULT`; see those constants for why the
 * default is not applied here.
 */
export const datapointAlert = strictObject({
  condition: alertCondition.meta({
    description: 'When this alert fires and when it is ok again. It carries **no discriminator**: upper threshold, lower threshold or equality all follow from the two values in it. Editing it resets the alert to `ok` on the next publish, while a publish that leaves it untouched keeps the running state.',
    /**
     * **Two snippets, and the reason is the missing discriminator.** A
     * threshold and an equality are the same shape here — one field apart —
     * so a single skeleton would not merely be incomplete, it would hide one
     * of the two things this field exists to express behind a `resolve_at`
     * the developer has to know to delete. Offering both makes the choice the
     * schema deliberately does not name into a choice the editor does.
     *
     * Both values come from `fire_at`'s own `examples`, which carry exactly
     * this pair: `15` for the threshold and `true` for the equality.
     *
     * **The second snippet costs the `condition:` *key* completion its body,
     * and that price is paid knowingly.** monaco-yaml's
     * `getInsertTextForProperty` (`yaml.worker.js:8520`) takes
     * `defaultSnippets[0].body` only when a node carries **exactly one**
     * snippet, so accepting `condition` from the key list writes the bare key
     * here where every other node this wave touched writes its whole block.
     * The two stay anyway: the value position — a developer who has written
     * `condition:` and pressed ⏎ — is where the question "what goes here?" is
     * actually asked, and that is the position this wave exists to answer.
     * Merging them into one would buy back the key completion by deleting the
     * choice the schema deliberately does not name, which is the worse trade;
     * anyone tempted to make it should change the key-completion behaviour
     * knowingly rather than as a side effect of tidying two snippets into one.
     */
    defaultSnippets: [
      {
        label: 'a threshold, with its hysteresis',
        description: 'Fires below 15 and is ok again above 18. The gap is what keeps a value sitting on the line from flipping on every sample; the direction follows from which of the two is higher, and nothing else declares it.',
        body: { fire_at: 15, resolve_at: 18 },
      },
      {
        label: 'an equality',
        description: 'Fires while the value equals `fire_at` and is ok as soon as it differs — the only form a boolean or a string condition can take. No `resolve_at`: adding one would turn this into a threshold, and is refused unless `fire_at` is a number.',
        body: { fire_at: true },
      },
    ],
  }),
  severity: alertSeverity.meta({
    description: 'How bad it is when this alert fires; absent means `warning`. It changes no behaviour — nothing is escalated, retried or delivered differently — it travels with the org event and colours the alert wherever it is shown.',
    enumDescriptions: describeValues(alertSeverity.options, {
      warning: 'Worth seeing. This is what an alert that names no severity gets.',
      error: 'Worth acting on. The only difference from `warning` is how the alert is shown: the same event is written, at the same moment, to the same places.',
    }),
  }).optional(),
  name: z.string().min(1).max(120).meta({
    description: 'A human-readable label shown wherever this alert appears, in place of its bare key. It is not the alert\'s identity — the key is — so the label can be reworded freely, while changing the key deletes one alert and creates another.',
    examples: ['Battery low'],
  }).optional(),
  enabled: z.boolean().meta({
    description: 'Whether this alert is evaluated at all. Absent means on, the opposite of `retention.enabled`: an alert that is written down watches unless it is explicitly switched off, which is how one is silenced without losing the key that identifies it.',
  }).optional(),
}).meta({
  /**
   * The value position of one entry — `battery_low: ▮` under `alerts:`, which
   * is where a developer adding a **second** alert by hand stands. The section
   * snippet fires on the empty `alerts:` and never again.
   */
  defaultSnippets: [ALERT_SNIPPET],
})
export type DatapointAlert = z.infer<typeof datapointAlert>

/** Requires a numeric field — all four fields share that one precondition. */
export const datapointNumeric = strictObject({
  scale: z.number().meta({
    description: 'A factor the robot multiplies the raw value by before sending it (`value * scale + offset`). The arithmetic happens once, at the source, so REST, realtime and history can never disagree about a number.',
    examples: [100],
  }).optional(),
  offset: z.number().meta({
    description: 'A constant the robot adds after `scale` (`value * scale + offset`), for a value whose zero sits in the wrong place. Like `scale` it is applied before sending, so history stores the converted value and a later correction cannot reach what is already stored.',
    examples: [-273.15],
  }).optional(),
  unit: z.string().max(32).meta({
    description: 'The unit of the value **after** `scale` and `offset`, not the robot\'s own. It is shown beside the value and carried by `robot_describe` as its own field, so a model does not have to guess whether 15 means percent, volts or minutes.',
    examples: ['%'],
  }).optional(),
  decimals: z.number().int().min(0).max(6).meta({
    description: 'How many fraction digits the console shows the value with — value tile, chart axis and tooltip, and the datapoint detail page — and the number `robot_describe` reports as its own field, so a model formats the value the way the console does. Presentation only: the stored value keeps the precision it arrived with, and absent means the console\'s own default rather than zero.',
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
export const datapointRetention = strictObject({
  enabled: z.boolean().meta({
    description: 'Whether values are written to the time series and become queryable. Off by default: without it the value is live only, and nobody who was not watching will ever see it.',
  }).optional(),
  interval_seconds: z.number().int().min(1).max(3600).meta({
    description: 'How often a value is written to history, in seconds; absent means `300`. **Not** how often it is sent — that is `rate_throttle_hz`. Stored points are billed, so this is the direct lever on what a robot costs, and a bumper that is true for 200 ms does not appear unless a write falls inside it.',
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
/**
 * Named rather than inlined at `style:`, so that `describeValues` can read its
 * `.options` and its per-value sentences can be keyed by value.
 */
const chartStyle = z.enum(['line', 'step'])

export const datapointChart = strictObject({
  y_min: z.number().finite().meta({
    description: 'A fixed floor for the chart\'s y axis; omitted, the axis scales to the data. `0` is a real floor and is read as `0`, never as unset.',
    examples: [0],
  }).optional(),
  y_max: z.number().finite().meta({
    description: 'A fixed ceiling for the chart\'s y axis; omitted, the axis scales to the data. It may not sit below `y_min`: a reversed pair is refused here because nothing downstream catches it, and the chart would render empty.',
    examples: [100],
  }).optional(),
  style: chartStyle.meta({
    description: 'How the drawing joins two samples, which is not a matter of taste. `line` claims the value moved evenly between them, roughly true of a temperature or a charge; `step` holds and then jumps, the only honest drawing for a mode, a switch or a counter, where a straight line would show values that never existed.',
    enumDescriptions: describeValues(chartStyle.options, {
      line: 'Straight lines between samples, so the drawing claims the value moved evenly from one to the next. Right for a quantity that really is continuous — a temperature, a charge level — where a reading taken between two samples would have landed somewhere on that line.',
      step: 'Each value is held until the next one arrives, then jumps to it. Right for anything that does not slide between its values — a mode, a state, a switch, a counter — where a sloped line would draw readings the robot never reported.',
    }),
  }).optional(),
  default_window_minutes: z.number().int().min(1).max(43_200).meta({
    description: 'How far back the chart reaches when it is first opened, in minutes; absent means `60`. Only the starting zoom: a viewer may look further, and nothing about what is stored follows from it.',
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
 * One value the robot publishes, authored once for the two positions it is
 * offered from: `datapoints:` (under `underSlug`) and the value of one entry
 * below it. The four required-to-be-useful fields and nothing else; everything
 * optional arrives by ordinary key completion, which works and never stopped.
 */
const DATAPOINT_SNIPPET: Snippet = {
  label: 'a datapoint',
  description: 'One value the robot publishes: one field of one topic.',
  body: {
    topic: '${2:/battery}',
    type: '${3:sensor_msgs/msg/BatteryState}',
    field: '${4:voltage}',
    description: '${5:What this value is, for whoever meets it in the console.}',
  },
}

/**
 * The same, with the three sub-blocks a plain datapoint leaves out — what the
 * number means, what is kept of it, and how it is drawn.
 *
 * `chart.style` is the literal `line` and not the choice the `chart:` node
 * itself offers: this body is a battery percentage, where `line` is not a
 * guess.
 */
const NUMERIC_DATAPOINT_SNIPPET: Snippet = {
  label: 'a numeric datapoint, with history and a chart',
  description: 'A number with its unit, what is kept of it and how it is drawn — the blocks a plain datapoint leaves out.',
  body: {
    topic: '${2:/battery}',
    type: '${3:sensor_msgs/msg/BatteryState}',
    field: '${4:percentage}',
    description: '${5:What this value is, for whoever meets it in the console.}',
    /**
     * The quotes inside `unit` are part of the inserted text and are not
     * decoration. A body string is written into the document verbatim, and `%`
     * is a YAML directive indicator: measured with `yaml` 2.9.0, `unit: %` is a
     * **syntax error** ("Plain value cannot start with directive indicator
     * character %") while `unit: "%"` parses to `%`. Nothing between here and
     * the buffer quotes a scalar for us.
     */
    numeric: { scale: 100, unit: '"%"', decimals: 1 },
    retention: { enabled: true, interval_seconds: 300 },
    chart: { y_min: 0, y_max: 100, style: 'line' },
  },
}

/**
 * One exposed datapoint: one field of a topic, or the whole topic
 * (`field` omitted). Never several topics.
 *
 * `rate_throttle_hz` is an upper bound, not a clock — the bridge drops what
 * arrives too fast and never repeats a value to manufacture a rate. The
 * ceiling is 20: an app's surface has no use for more, and a control loop
 * belongs on a tool that reads at the robot.
 */
export const datapointConfig = strictObject({
  topic: rosName.meta({
    description: 'The ROS topic this datapoint reads, as an absolute graph name. One datapoint reads **one** topic: a value assembled from two topics is not expressible here.',
    patternErrorMessage: ROS_NAME_RULE,
    examples: ['/battery'],
  }),
  type: rosTypeName.meta({
    description: 'The message type carried by `topic`, spelled the way ROS 2 spells it, with the `msg` segment in the middle — `sensor_msgs/msg/BatteryState`, never `sensor_msgs/BatteryState`. It is declared here rather than discovered, so a configuration can be written for a robot that has never been connected; the cloud checks it against the robot\'s own message definitions only once one is there.',
    patternErrorMessage: ROS_TYPE_NAME_RULE,
    examples: ['sensor_msgs/msg/BatteryState'],
  }),
  field: fieldPath.meta({
    description: 'A dotted path into the message naming the single value this datapoint carries, each segment indexing at most one array level — `ranges[0]`, never `ranges[0][1]`, because ROS 2 has no nested arrays. Without it the datapoint is the whole message, and `numeric`, `chart` and `alerts` are then refused.',
    patternErrorMessage: FIELD_PATH_RULE,
    examples: ['voltage', 'pose.position.x', 'ranges[0]'],
  }).optional(),
  rate_throttle_hz: rateThrottleHz.meta({
    description: 'A ceiling on how often this datapoint is sent, in hertz. Omitted or `0` means no throttling. It is **a ceiling, not a clock**: a slow topic stays slow, a value is never repeated to manufacture a rate, and within a window the newest value wins. The bridge enforces it, so the robot\'s bandwidth is genuinely saved.',
    examples: [2, 0.5],
  }).optional(),
  description: serviceDescription.meta({
    description: 'Prose about what this value is, for whoever meets it in the console later. It changes nothing the robot does, so a publish that touches only it pushes no configuration at all — but it is carried verbatim into `robot_describe`, where a model that has never seen this robot reads it. The datapoint is offered whenever the role grants it; without one it is offered with `description: null` and the model has less to go on, as for actions, services, publishers and cameras. Omission is the only way to say nothing; an empty string is refused, here and on all five.',
    /**
     * The sentence both datapoint snippets already place here, verbatim. Its
     * four siblings — an action's, a service's, a publisher's, a camera's —
     * each carry the sentence from their own snippet body, so this position
     * was the one description in the format offering nothing; a second wording
     * invented here would have been the drift instead.
     */
    examples: ['What this value is, for whoever meets it in the console.'],
  }),
  numeric: datapointNumeric.meta({
    description: 'Arithmetic and formatting for a numeric value. `scale` and `offset` are applied **on the robot**, before sending, which is why REST, realtime and history all carry identical numbers. `unit` and `decimals` change nothing the robot does, so a publish that touches only those pushes no configuration.',
    /**
     * The quotes inside `unit` are inserted text, not decoration, for the
     * reason spelled out on the `datapoints` snippet below: a body string is
     * written to the buffer verbatim and a bare `%` is a YAML directive
     * indicator, so `unit: %` is a syntax error where `unit: "%"` parses.
     *
     * **`offset` is not in the body, and that is a choice rather than an
     * oversight.** All four fields carry `examples`, but they were authored
     * per field and from two different conversions: `scale: 100` with
     * `unit: '%'` is a 0..1 fraction shown as a percentage, while
     * `offset: -273.15` is kelvin as celsius. A body holding both would
     * insert arithmetic that means nothing and that a developer has to
     * unpick before it means anything. The rule this file follows is that a
     * skeleton carries what a developer opening the block almost certainly
     * wants, at the node's own example values; the remaining keys arrive by
     * ordinary key completion, which works here and never stopped working —
     * the position that was silent is the *value* after `numeric:`.
     */
    defaultSnippets: [{
      label: 'a unit, and the arithmetic that produces it',
      description: 'A 0..1 fraction sent as a percentage to one decimal. `scale` is applied on the robot before sending, so history stores the converted value and a later correction cannot reach what is already stored.',
      body: { scale: 100, unit: '"%"', decimals: 1 },
    }],
  }).optional(),
  retention: datapointRetention.meta({
    description: 'What outlives the moment: whether this value is written to the time series, how often, and how many points the robot buffers while the bridge is away. Absent means no history at all — the value is live only.',
    /**
     * `enabled: true` is the only value that makes opening this block mean
     * anything — absent already means off, so a skeleton inserting `false`
     * would be a block that does nothing. It is a boolean and carries no
     * `examples`; the direction comes from the schema comment above, which
     * says why absent-means-off is the deliberate one.
     *
     * `interval_seconds: 300` restates the format's own default, on purpose:
     * stored points are what a customer is billed for, so this is the direct
     * lever on what a robot costs, and a developer who never sees the field
     * never tunes it.
     *
     * **This body carries `max_buffer_values` and the composite `datapoints`
     * snippet's `retention:` does not, deliberately.** The two answer
     * different questions and the difference is the answer to each: the
     * composite says *what a datapoint looks like*, where retention is one
     * of three sub-blocks and the robot-side buffer is a tuning detail that
     * would bury the shape it is there to show; this node is reached only by
     * a developer who has written `retention:` and asked what goes in it, and
     * for that question the buffer is a third of the answer. Neither is the
     * corrected version of the other.
     */
    defaultSnippets: [{
      label: 'history, on, with its interval and buffer',
      description: 'Writes this value to the time series every 300 seconds and holds 5000 points on the robot while the bridge is away. Stored points are billed, so both numbers are worth choosing rather than inheriting.',
      body: { enabled: true, interval_seconds: 300, max_buffer_values: 5000 },
    }],
  }).optional(),
  chart: datapointChart.meta({
    description: 'How the console draws this value over time: axis bounds, whether the line interpolates or steps, and the window a chart opens on. **Display only** — it changes no stored value, no alert and nothing the robot does, so a publish that touches only it pushes no configuration.',
    /**
     * `style` is a **choice**, not a literal, for the reason the camera
     * source's `type` is one: the format offers a closed pair, the right
     * answer depends on what the datapoint is, and the snippet cannot know.
     * Its own description says the two are not a matter of taste — `line`
     * claims the value moved evenly between two samples, `step` holds and
     * jumps, and `step` is the only honest drawing for a mode, a switch or a
     * counter. A snippet that picked `line` would draw values that never
     * existed, and nothing would object: both are valid, no diagnostic
     * fires, and the chart looks plausible.
     *
     * `Choice.toString()` is the first option, so a developer who tabs past
     * this gets `line`, which is right for the continuous values most charts
     * carry; one who opens the picker sees that `step` exists at all.
     *
     * The composite snippet on `datapoints` writes `style: 'line'` as a
     * literal and stays that way — its body is a battery percentage, where
     * `line` is not a guess.
     *
     * **`default_window_minutes` is left out, on the same rule that leaves
     * `offset` out of `numeric` above**, and it is said here so that the two
     * omissions read alike: it has its own `examples` (`1440`) and this
     * node's description names it, but it is the one field of the four that
     * decides nothing about the drawing — absent means 60, a viewer may look
     * further whatever it says, and nothing about what is stored follows from
     * it. Key completion offers it inside the block the moment anyone wants
     * it; the position that was silent is the *value* after `chart:`.
     */
    defaultSnippets: [{
      label: 'axis bounds, and how two samples are joined',
      description: 'A fixed 0..100 axis rather than one that scales to the data, and a choice between interpolating and stepping between samples — which is not a matter of taste.',
      body: { y_min: 0, y_max: 100, style: '${1|line,step|}' },
    }],
  }).optional(),
  alerts: slugKeyed(datapointAlert).meta({
    description: 'Alerts watching this value, keyed by slug; each moves between `ok` and `firing` and writes an org event on every transition. No mail is sent. **The key is the identity**, so renaming an alert is a delete plus a create: its runtime state is lost, and an alert that is still true fires again.',
    /**
     * The body is `ALERT_SNIPPET` under its slug key — the same skeleton the
     * entry position offers, and the reasons behind every value in it are
     * written there. **The key is in the wrapper**, and it is the alert's
     * identity: renaming it is a delete plus a create.
     */
    defaultSnippets: [underSlug('${1:battery_low}', ALERT_SNIPPET)],
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
  /**
   * The value position of one entry — `battery: ▮` under `datapoints:`, where a
   * developer adding a **second** datapoint by hand stands. Both skeletons the
   * section offers, in the same order, so the choice between a plain value and
   * a fully-equipped one is the same choice at both positions.
   */
  .meta({ defaultSnippets: [DATAPOINT_SNIPPET, NUMERIC_DATAPOINT_SNIPPET] })
export type DatapointConfig = z.infer<typeof datapointConfig>

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
 * One shared message body, authored once for the two positions it is offered
 * from: `messages:` (under `underSlug`) and the value of one entry below it.
 *
 * `param()` and not a bare `${speed}` — the backslash is why the hole survives
 * the insert; see `param` for the measurement.
 */
const SHARED_MESSAGE_SNIPPET: Snippet = {
  label: 'a shared message',
  description: 'One reusable body, with one parameter hole in it.',
  body: {
    linear: { x: param('speed') },
    angular: { z: 0 },
  },
}

/**
 * The value position of one shared message — `drive: ▮` under `messages:`.
 *
 * **This is a clone of `messageTemplate` and not `messageTemplate` itself,
 * deliberately.** `messageBody` *is* `messageTemplate`, the same instance, so a
 * `defaultSnippets` written onto it would also reach `message:` under an
 * action, a service and a publisher — where the body below is a zero twist
 * offered as the skeleton for a nav2 goal, which is worse than the silence it
 * replaced. Those three positions take arbitrary content shaped by the entry's
 * own ROS type, and nothing here knows it. `.meta()` clones rather than
 * mutating, so `messageTemplate` is untouched, and the template's own
 * `description` reaches this node **without being restated** — a second copy of
 * that paragraph would be a second thing to keep true.
 *
 * **How the description gets here is zod behaviour, not something written
 * below.** Measured against zod 4.4.3: `.meta()` on an already-registered
 * schema merges rather than replaces, and the clone resolves the parent's entry
 * *lazily* — a clone taken before the parent was registered at all still sees
 * the parent's description afterwards. So no spread is needed and there is no
 * evaluation-order hazard. This was first written as
 * `.meta({ ...messageTemplate.meta(), … })`; dropping the spread was measured
 * to change nothing in the export, and two mechanisms for one description is
 * the shape this file removes rather than adds.
 *
 * It is undocumented behaviour all the same, so `config-snippets.test.ts`
 * asserts this node still carries a description and that it is the same string
 * as the `message:` position — if a zod release stops merging, that is a red
 * test rather than a hover that silently went blank.
 */
const sharedMessageBody = messageTemplate.meta({ defaultSnippets: [SHARED_MESSAGE_SNIPPET] })

/**
 * Reusable message bodies, keyed by name. A shared message may hold
 * placeholders; whoever inserts it declares the parameters. It may NOT
 * insert another — that excludes cycles and lets every check look at exactly
 * one body instead of walking a reference tree.
 */
export const messageMap = slugKeyed(sharedMessageBody)
  .refine((m) => Object.keys(m).length <= 200, { message: 'at most 200 shared messages' })
  .meta({
    description: 'Reusable message bodies, keyed by name. A body is inserted by writing `${name}` directly after `message:`, may hold placeholders of its own, and **may not insert another** — which rules out cycles and lets every check look at exactly one body.',
  })

/**
 * One action, authored once for the two positions it is offered from:
 * `actions:` (under `underSlug`) and the value of one entry below it. The three
 * required fields at the node's own `examples`; `message` and `parameters`
 * depend on the action type and are left to key completion.
 */
const ACTION_SNIPPET: Snippet = {
  label: 'an action',
  description: 'One thing the robot does on request, reported as a job with progress.',
  body: {
    ros_name: '${2:/navigate_to_pose}',
    type: '${3:nav2_msgs/action/NavigateToPose}',
    description: '${4:Drives to a target pose on the map.}',
  },
}

/**
 * An action the robot can be asked to perform (spec §4.2, §11.3). At most one
 * job runs per action slug; a second call is refused `busy`, and every
 * observer of the slug watches the same job.
 */
export const actionConfig = strictObject({
  ros_name: rosName.meta({
    description: 'The action server on the robot, as an absolute graph name — this is what the bridge sends the goal to. Clients never see it: they address this entry by its slug, so a server can be renamed on the robot without a single app changing.',
    patternErrorMessage: ROS_NAME_RULE,
    examples: ['/navigate_to_pose'],
  }),
  type: rosTypeName.meta({
    description: 'The action type `ros_name` implements, with the `action` segment in the middle — `nav2_msgs/action/NavigateToPose`, never `nav2_msgs/NavigateToPose`. Declared rather than introspected, so an action can be configured for a robot that has never connected; the cloud checks it against the robot\'s own definitions only once one is there.',
    patternErrorMessage: ROS_TYPE_NAME_RULE,
    examples: ['nav2_msgs/action/NavigateToPose'],
  }),
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription.meta({
    description: 'What this action does, in the developer\'s own words — documentation for the console and for MCP clients, which is all it is: the robot does nothing with it. It is carried verbatim into `robot_describe` and read by a model that has never seen this robot. The action is offered whenever the role grants it; without one it is offered with `description: null`, and the model has nothing but the slug.',
    examples: ['Drives to a target pose on the map.'],
  }),
}).meta({
  /** The value position of one entry — `navigate: ▮` under `actions:`. */
  defaultSnippets: [ACTION_SNIPPET],
})
export type ActionConfig = z.infer<typeof actionConfig>

/**
 * One service, authored once for the two positions it is offered from:
 * `services:` (under `underSlug`) and the value of one entry below it. The
 * example is `Trigger`, whose request has no fields — so `message` and
 * `parameters` are genuinely absent rather than merely left out.
 */
const SERVICE_SNIPPET: Snippet = {
  label: 'a service',
  description: 'One request, one reply, no progress in between.',
  body: {
    ros_name: '${2:/reset_odometry}',
    type: '${3:std_srvs/srv/Trigger}',
    description: '${4:Resets odometry to the origin.}',
  },
}

/** A ROS service call with validated parameters (spec §4.2). */
export const serviceConfig = strictObject({
  ros_name: rosName.meta({
    description: 'The ROS service the robot answers on, as an absolute graph name. The call is one request and one reply with no progress in between, so whatever this service does has to finish inside that reply; anything long-running belongs in `actions`.',
    patternErrorMessage: ROS_NAME_RULE,
    examples: ['/reset_odometry'],
  }),
  type: rosTypeName.meta({
    description: 'The service type `ros_name` implements, with the `srv` segment in the middle — `std_srvs/srv/Trigger`. A type whose request has no fields, like `Trigger`, needs neither `message` nor `parameters`: there is nothing to fill.',
    patternErrorMessage: ROS_TYPE_NAME_RULE,
    examples: ['std_srvs/srv/Trigger'],
  }),
  message: messageBody.optional(),
  parameters: parameterMap.optional(),
  description: serviceDescription.meta({
    description: 'What this service does, in the developer\'s own words. The robot does nothing with it — the readers are the console and MCP clients, and without one the service is still offered, with `description: null`, exactly as for an action. It sits on the configuration rather than on the app, so one wording is true for every app that reaches this robot.',
    examples: ['Resets odometry to the origin.'],
  }),
}).meta({
  /** The value position of one entry — `reset_odometry: ▮` under `services:`. */
  defaultSnippets: [SERVICE_SNIPPET],
})
export type ServiceConfig = z.infer<typeof serviceConfig>

/**
 * One publisher, authored once for the two positions it is offered from:
 * `publishers:` (under `underSlug`) and the value of one entry below it.
 *
 * This is the one skeleton in the file that carries every part of the format at
 * once — a fixed message with two holes, the parameters that declare them, and
 * the failsafe — because a publisher with any of them missing is a publisher
 * the format refuses. `failsafe` is required and its message may hold no
 * placeholder: it is sent with no caller left to fill one.
 */
const PUBLISHER_SNIPPET: Snippet = {
  label: 'a publisher, with its parameters and its failsafe',
  description: 'A topic clients may send to: what is fixed, what a caller fills, and what the bridge sends by itself once the caller falls silent.',
  body: {
    topic: '${2:/cmd_vel}',
    type: '${3:geometry_msgs/msg/Twist}',
    message: {
      linear: { x: param('speed') },
      angular: { z: param('turn') },
    },
    parameters: {
      speed: { type: 'float64', min_value: -0.5, max_value: 0.5, default: 0 },
      turn: { type: 'float64', min_value: -0.5, max_value: 0.5, default: 0 },
    },
    failsafe: {
      timeout_ms: 500,
      message: {
        linear: { x: 0 },
        angular: { z: 0 },
      },
    },
    quiet_timeout_ms: 2000,
    description: '${4:Velocity command. If sending stops, the robot stops.}',
  },
}

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
export const publisherConfig = strictObject({
  topic: rosName.meta({
    description: 'The ROS topic the message is published onto, as an absolute graph name. **No client ever names a topic**: a caller addresses this entry by its slug, so the topics an app can write to are exactly the ones written in this file.',
    patternErrorMessage: ROS_NAME_RULE,
    examples: ['/cmd_vel'],
  }),
  type: rosTypeName.meta({
    description: 'The message type of `topic`, spelled the way ROS 2 spells it, with the `msg` segment. It fixes the shape that `message` and `failsafe.message` must both fill, which is why one publisher carries one type and a second type needs a second publisher.',
    patternErrorMessage: ROS_TYPE_NAME_RULE,
    examples: ['geometry_msgs/msg/Twist'],
  }),
  message: messageBody,
  parameters: parameterMap.optional(),
  failsafe: strictObject({
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
      /**
       * Both fields are required, so the body carries both: a `failsafe:` with
       * only one of them is a publisher the format refuses, and this is the
       * field where a document that does not publish is the least useful thing
       * to hand somebody.
       *
       * The zero twist is the message this field's own description names, and
       * the same body the composite `publishers` snippet inserts. Neither
       * knows the publisher's ROS type — nothing at this position does — so
       * the snippet offers the format's canonical safe message rather than
       * guessing a shape. Every value in it is a literal: a placeholder here
       * is refused outright (`failsafe_has_parameters`), because the message
       * is sent with no caller left to fill one.
       */
      defaultSnippets: [{
        label: 'a deadline, and the message it sends',
        description: 'Half a second of silence and then a zero twist. The deadline runs on the robot, so it still fires when the link to the cloud is what failed — which is the case it exists for.',
        body: {
          timeout_ms: 500,
          message: {
            linear: { x: 0 },
            angular: { z: 0 },
          },
        },
      }],
    }),
  quiet_timeout_ms: z.number().int().nonnegative().max(600_000).meta({
    description: 'How long this publisher must stay silent before a **different** user may send to it. Whoever sends holds it implicitly exclusive, with no session and no lock, so this one number is the whole handover policy: too short and two operators fight over one robot, too long and a crashed client blocks it for everyone.',
    examples: [2000],
  }),
  description: serviceDescription.meta({
    description: 'What sending to this publisher does, in the developer\'s own words. It is documentation for the console and for MCP clients — the robot does nothing with it — and as for actions and services, the publisher is offered whether or not one is written, with `description: null` when it is not. A caller sends here repeatedly and continuously rather than once, which is why this kind alone carries `failsafe` and `quiet_timeout_ms`.',
    examples: ['Velocity command. If sending stops, the robot stops.'],
  }),
}).meta({
  /** The value position of one entry — `drive: ▮` under `publishers:`. */
  defaultSnippets: [PUBLISHER_SNIPPET],
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
export const cameraCredentials = strictObject({
  username: z.string().min(1).max(128).optional().meta({
    description: 'The account name the camera expects. For MJPEG the bridge sends a real HTTP `Authorization: Basic` header and leaves the URL untouched. RTSP offers no such channel through ffmpeg, so there the name goes inside the connect URL instead — built fresh for that one call and never written back into the stored document.',
    examples: ['ops'],
  }),
  password: z.string().min(1).max(128).optional().meta({
    description: 'The password for `username`. **There is no secret store behind this**: the value written here is the value stored, so treat it as readable by everyone who may read this robot\'s configuration, now and in its history.',
  }),
})
  .meta({
    description: 'Username and password for the stream, standing **in clear text in the document**. A published version is immutable, so a password here cannot be removed from history or rotated without republishing — which is why the publish audit event carries only the version number and never the document body. Userinfo in the `url` works too; an explicit block here wins over it.',
    defaultSnippets: [{
      label: 'username and password',
      description: 'Both fields, in clear text — which is what this block is. The password default is deliberately not a password: `CHANGE-ME` is stored like any other value, but it is **visible** rather than plausible, so a reviewer reading the diff sees it and the camera rejects it at connect time — where a default that looked like a password would simply be published and kept.',
      /**
       * `CHANGE-ME`, and not a plausible-looking password, because of what the
       * comment above this schema records: a published version is immutable,
       * so a password written here cannot be removed from history or rotated
       * without republishing. This snippet is the one thing in the file that
       * could manufacture such a version by itself — a developer who tabs past
       * the placeholder publishes whatever the default was.
       *
       * What `CHANGE-ME` buys is **visibility, not a refusal**. It is stored
       * exactly like any other value; nothing at publish time objects. What it
       * does is fail at the camera, at connect time, and read wrong to anyone
       * looking at the diff — where a plausible default is published and kept.
       *
       * The two alternatives were both worse. A plausible default (`secret`)
       * reads in a diff like a value somebody chose, so nobody looks twice. A
       * bare `$2` inserts the empty string, which `min(1)` refuses — that is
       * loud, but it makes this the only snippet in the format that knowingly
       * inserts an invalid document, and the guard that says none of them do
       * would need an exception carved for it. A guard with an exception is not
       * a guard. So the default stays valid and stays obviously wrong: no
       * camera accepts it, and no reviewer reads past it.
       *
       * Both fields are `.optional()` — a bare `{}` parses — so nothing forces
       * a default here at all. It is offered because a developer who opened
       * this block wants both fields, and the snippet exists to save them the
       * typing, not to decide anything.
       */
      body: {
        username: '${1:ops}',
        password: '${2:CHANGE-ME}',
      },
    }],
  })
export type CameraCredentials = z.infer<typeof cameraCredentials>

/**
 * Where a camera's frames come from (spec §10 names four sources).
 *
 * A discriminated union rather than optional fields, so an impossible camera
 * is **unrepresentable** rather than merely invalid — there is no way to
 * write an RTSP camera with a ROS topic, or a V4L2 device with a URL, and
 * therefore no validation rule to forget.
 *
 * **Each branch carries its own `defaultSnippets`, rather than one list on the
 * union.** Both placements were measured and both work; this one keeps a
 * label beside the branch it names, so the two cannot drift, and it makes a
 * fifth source impossible to add without one — `config-snippets.test.ts`
 * walks the exported branches and fails on any that carries none.
 */
/**
 * Named for the same reason as `chartStyle`: `describeValues` needs `.options`.
 */
const rtspTransport = z.enum(['tcp', 'udp'])

export const cameraSource = z.discriminatedUnion('kind', [
  strictObject({
    kind: z.literal('ros').meta({
      description: 'Selects the ROS image-topic source: this camera then carries `topic` and `type`, and no field of another kind.',
    }),
    topic: rosName.meta({
      description: 'The ROS image topic the bridge subscribes to, as an absolute graph name. Clients never name it — they address the camera by its slug — so the topic can be renamed on the robot without an app changing.',
      patternErrorMessage: ROS_NAME_RULE,
      examples: ['/camera/image_raw'],
    }),
    type: rosTypeName.meta({
      description: 'The message type of `topic`: `sensor_msgs/msg/Image` for raw frames, `sensor_msgs/msg/CompressedImage` for a camera that already encodes. Declared here rather than introspected, so a camera can be configured for a robot that has never connected.',
      patternErrorMessage: ROS_TYPE_NAME_RULE,
      examples: ['sensor_msgs/msg/Image'],
    }),
  }).meta({
    description: 'Frames come from an image topic the robot already publishes. It is the only source the bridge **subscribes** to rather than opens, so it needs no URL, no device and nobody to authenticate to.',
    defaultSnippets: [{
      label: 'ros — an image topic the robot already publishes',
      description: 'Subscribes to a topic that is already there; nothing is opened and there is nobody to authenticate to.',
      /**
       * `type` is a **choice**, not a literal, and that is a correction: it was
       * written out on the rule that a field the format fixes is written out,
       * and `type` is not such a field. Its own description names two values
       * and says which applies when — `Image` for raw frames,
       * `CompressedImage` for a camera that encodes itself. A snippet that
       * picks one picks wrong for half the cameras, and picks it invisibly:
       * `rosTypeName` accepts either, publish accepts either, no diagnostic
       * fires anywhere, and the bridge then subscribes with the wrong type and
       * delivers no frames. A snippet supplying a wrong answer where it could
       * have supplied a question is this project's *check that cannot fire*,
       * arriving through a hint the developer trusts.
       *
       * `kind: 'ros'` stays a literal, because the branch really does fix it.
       *
       * Measured through the actual pipeline rather than assumed, because
       * choice syntax is the one construct here that three layers must each
       * pass through unharmed: yaml-language-server's `stringifyObject` emits
       * the body verbatim, and monaco-editor 0.52.2's `SnippetParser` parses
       * `${2|a,b|}` into a placeholder carrying both options whose
       * `toString()` — the text on the buffer before anyone chooses — is the
       * first one. So a developer who tabs past this gets a document
       * byte-identical to the literal it replaced, and one who opens the
       * picker gets `CompressedImage`; both parse.
       */
      body: {
        kind: 'ros',
        topic: '${1:/camera/image_raw}',
        type: '${2|sensor_msgs/msg/Image,sensor_msgs/msg/CompressedImage|}',
      },
    }],
  }),
  strictObject({
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
      .regex(/^rtsps?:\/\//i, RTSP_URL_RULE)
      .meta({
        description: 'Where the stream lives, reached from the robot rather than from the cloud. **`rtsp://` or `rtsps://` only** — the bridge opens this with a library that would equally honour `file:`, so an unconstrained URL would turn a configuration document into arbitrary file access on the robot. The bridge re-checks the scheme itself, so a validator that changed could not make a robot serve files.',
        patternErrorMessage: RTSP_URL_RULE,
        examples: ['rtsp://cam-1.plant.local/stream1'],
      }),
    /** TCP by default: UDP loses frames on a congested link, silently. */
    transport: rtspTransport.optional().meta({
      description: 'How the RTSP payload is carried. Omitted means `tcp`: `udp` loses frames on a congested link and loses them silently, so the result looks like a failing camera rather than like a choice made here.',
      enumDescriptions: describeValues(rtspTransport.options, {
        tcp: 'The frames are interleaved into the RTSP connection itself, which is what a congested or lossy link needs — nothing is dropped on the way. This is what an omitted `transport` means.',
        udp: 'The frames travel in their own UDP stream: lower latency on a quiet network, and silent frame loss on any other.',
      }),
    }),
    credentials: cameraCredentials.optional(),
  }).meta({
    description: 'Frames come from an RTSP stream the robot itself can reach — a network camera on its own LAN. The bridge opens the connection; the cloud never does, and never needs a route to the camera.',
    defaultSnippets: [{
      label: 'rtsp — a network camera the robot itself can reach',
      description: 'A stream the bridge opens over RTSP. The scheme is written out because the format constrains it; the host and the path are what vary.',
      body: {
        kind: 'rtsp',
        url: 'rtsp://${1:cam-1.plant.local}/${2:stream1}',
      },
    }],
  }),
  strictObject({
    kind: z.literal('mjpeg').meta({
      description: 'Selects the MJPEG-over-HTTP source: this camera then carries `url`, and optionally `credentials`.',
    }),
    /** `http:`/`https:` only — see the `rtsp` variant above for why. */
    url: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^https?:\/\//i, MJPEG_URL_RULE)
      .meta({
        description: 'Where the stream lives. **`http://` or `https://` only** — as for the `rtsp` URL, the bridge opens it with a library that would also serve `file:`. Plain `http://` is permitted because these cameras usually sit on the robot\'s own network, but Basic credentials on such a URL then travel in the clear.',
        patternErrorMessage: MJPEG_URL_RULE,
        /**
         * The host and the path this branch's own snippet body inserts, and the
         * URL its rule sentence names — one answer to "what goes here?", not a
         * third. The sibling `rtsp` url had an `examples` from the first day and
         * this position was the format's only silent URL (§1.1).
         */
        examples: ['http://cam-1.plant.local/video.mjpg'],
      }),
    credentials: cameraCredentials.optional(),
  }).meta({
    description: 'Frames come from an MJPEG stream over HTTP — one JPEG after another, the simplest network source there is. Unlike `rtsp` there is no `transport` to choose: it is HTTP, and any `credentials` therefore travel as HTTP Basic.',
    defaultSnippets: [{
      label: 'mjpeg — one JPEG after another over HTTP',
      description: 'The simplest network source there is. `https://` is accepted too, and is what any credentials on this URL need.',
      body: {
        kind: 'mjpeg',
        url: 'http://${1:cam-1.plant.local}/${2:video.mjpg}',
      },
    }],
  }),
  strictObject({
    kind: z.literal('v4l2').meta({
      description: 'Selects the local capture-device source: this camera then carries `device` and nothing else.',
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
      .regex(/^\/dev\/[A-Za-z0-9][A-Za-z0-9._/-]*$/, DEVICE_PATH_RULE)
      .refine((v) => !v.split('/').includes('..'), 'must not contain a `..` path segment')
      .refine((v) => !v.endsWith('/'), 'must name a device, not a directory')
      .meta({
        description: 'The capture device, resolved on the robot and never by the cloud; a `/dev/v4l/by-id/...` symlink survives a reboot that renumbers `/dev/video0`. **Constrained to `/dev/`** — the string reaches OpenCV, which will just as happily open an ordinary video file or an `http://` URL and publish its pixels to the cloud. The bridge re-derives the same constraint rather than trusting the wire.',
        patternErrorMessage: DEVICE_PATH_RULE,
        examples: ['/dev/video0'],
      }),
  }).meta({
    description: 'Frames come from a capture device attached to the robot itself, such as a USB camera on `/dev/video0`. Nothing leaves the robot to fetch them, and there is nothing to authenticate to, so this source takes no `credentials`.',
    defaultSnippets: [{
      label: 'v4l2 — a capture device attached to the robot',
      description: 'A USB camera on the robot itself. A `/dev/v4l/by-id/...` symlink survives a reboot that renumbers `/dev/video0`.',
      /**
       * The default is not decoration. `device` is required and the path is
       * constrained to `/dev/`, so a bare `$1` would insert the empty string
       * and offer a camera the format refuses.
       */
      body: {
        kind: 'v4l2',
        device: '${1:/dev/video0}',
      },
    }],
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
 * One camera, authored once for the two positions it is offered from:
 * `cameras:` (under `underSlug`) and the value of one entry below it.
 *
 * Every field of `cameraConfig` except `description` is required, so the body
 * carries all of them; the four `source` kinds each offer their own skeleton at
 * `source:` itself, and `v4l2` is the one here because a device path is the
 * only source a robot can be assumed to have without a network.
 */
const CAMERA_SNIPPET: Snippet = {
  label: 'a camera',
  description: 'A complete camera entry with every required field.',
  body: {
    source: { kind: 'v4l2', device: '${2:/dev/video0}' },
    width: 1280,
    height: 720,
    fps: 15,
    bitrate_kbps: 2000,
    snapshot_interval_seconds: 5,
    description: '${3:Forward-facing camera on the mast.}',
  },
}

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
export const cameraConfig = strictObject({
  source: cameraSource.meta({
    description: 'Where this camera\'s frames come from. `kind` picks one of four sources and fixes which other fields the source may carry, so an impossible camera is unrepresentable rather than merely invalid — there is no way to write an RTSP camera with a ROS topic.',
  }),
  width: z.number().int().positive().max(7680).meta({
    description: 'The width the bridge scales frames to before sending, in pixels — what the bridge produces, not what the sensor captures; a snapshot can arrive narrower, since the bridge reduces both dimensions together to fit its JPEG byte ceiling. It stands in the configuration and never in a viewer\'s request, so no client can make the robot encode a larger frame than the developer allowed.',
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
    description: 'What this camera shows, in the developer\'s own words — documentation for whoever reads the configuration, for the console and for MCP clients; the robot does nothing with it. A camera without one is still offered, with `description: null`, as for actions, services and publishers. What `camera_snapshot` serves is the latest snapshot with its age; a live session is never a tool.',
    examples: ['Forward-facing camera on the mast.'],
  }),
}).meta({
  /** The value position of one entry — `front: ▮` under `cameras:`. */
  defaultSnippets: [CAMERA_SNIPPET],
})
export type CameraConfig = z.infer<typeof cameraConfig>

/**
 * The format version of a `fleetless.yaml`. Deliberately not called
 * `version`: the console counts published states with "v12 → v13", and two
 * numbers called version would be the likeliest confusion in the format.
 */
export const FLEETLESS_FORMAT_VERSION = 1

const capped = <T extends z.ZodTypeAny>(entry: T, max: number, what: string) =>
  slugKeyed(entry).refine((m) => Object.keys(m).length <= max, { message: `at most ${max} ${what}` })

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
export const robotConfigDoc = strictObject({
  fleetless: z.literal(FLEETLESS_FORMAT_VERSION).meta({
    description: 'The format version, and the first line of the file. It decides how everything below is read, so a file that omits it — or names a version this cloud does not know — is **refused rather than half understood**.',
  }),
  messages: messageMap.meta({
    description: 'Reusable message bodies, keyed by name, inserted elsewhere by writing `${name}` directly after `message:`. A shared body may hold placeholders and whoever inserts it declares the parameters, so two publishers can send the same message under different bounds. **A shared message may not insert another**, so a `${name}` inside a body is always a parameter and never a second message.',
    defaultSnippets: [underSlug('${1:drive}', SHARED_MESSAGE_SNIPPET)],
  }).optional(),
  datapoints: capped(datapointConfig, 200, 'datapoints').meta({
    description: 'Values the robot publishes, each one field of one topic or a whole topic, and **never several topics**. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind; `bridge_state`, `robot_details` and `bridge_pressure` are built-in, and `history` is reserved because `GET …/jobs/history` would shadow an action of that name; all four are refused here.',
    defaultSnippets: [
      underSlug('${1:battery_voltage}', DATAPOINT_SNIPPET),
      underSlug('${1:battery}', NUMERIC_DATAPOINT_SNIPPET),
    ],
  }).optional(),
  actions: capped(actionConfig, 200, 'actions').meta({
    description: 'Things the robot does on request that take time, each reported as a job with progress. **At most one job runs per action slug**: a second call is refused `busy`, and every observer of that slug watches the same job. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind; `bridge_state`, `robot_details` and `bridge_pressure` are built-in, and `history` is reserved because `GET …/jobs/history` would shadow an action of that name; all four are refused here.',
    defaultSnippets: [underSlug('${1:navigate}', ACTION_SNIPPET)],
  }).optional(),
  services: capped(serviceConfig, 200, 'services').meta({
    description: 'ROS service calls the robot answers — one request, one reply. Unlike an action a service reports **no progress** and the call returns with its result already on the job, so there is nothing left to observe; a second concurrent call is still refused `busy`, exactly as for an action. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind; `bridge_state`, `robot_details` and `bridge_pressure` are built-in, and `history` is reserved because `GET …/jobs/history` would shadow an action of that name; all four are refused here.',
    defaultSnippets: [underSlug('${1:reset_odometry}', SERVICE_SNIPPET)],
  }).optional(),
  publishers: capped(publisherConfig, 200, 'publishers').meta({
    description: 'Topics clients may send to, and where the format\'s whole safety story lives. The `message` template fixes every value a caller cannot change, and **`failsafe` is required**: once a client falls silent the bridge sends the failsafe message itself, so an operator whose window closed does not leave a robot driving. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind; `bridge_state`, `robot_details` and `bridge_pressure` are built-in, and `history` is reserved because `GET …/jobs/history` would shadow an action of that name; all four are refused here.',
    defaultSnippets: [underSlug('${1:drive}', PUBLISHER_SNIPPET)],
  }).optional(),
  cameras: capped(cameraConfig, 50, 'cameras').meta({
    description: 'Video the robot streams, and the still frames the cloud serves from it. `width`, `height`, `fps` and `bitrate_kbps` are what **the bridge produces before sending**, not what the camera captures — they live in the configuration rather than in a viewer\'s request precisely so that no viewer can make a robot send more. Keys are slugs, one namespace across all five exposure sections, which is what lets a role grant say `{robot, slug}` without naming a kind; `bridge_state`, `robot_details` and `bridge_pressure` are built-in, and `history` is reserved because `GET …/jobs/history` would shadow an action of that name; all four are refused here.',
    defaultSnippets: [underSlug('${1:front}', CAMERA_SNIPPET)],
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
