// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import type { ValidationIssue } from './config.js'

/**
 * What is wrong with a configuration document, in one account.
 *
 * Everything here used to live in `cloud/src/validation.ts`. It is in
 * contracts because the console has to say **exactly** what the server says
 * about a document — same codes, same sentences, same paths — and the only
 * way that is true is if it is the same code. A console that reimplemented
 * this and then disagreed with the server about what is wrong would be worse
 * than a console that said nothing (spec D3).
 *
 * **The second door D3 forbids existed for one wave, and closed in wave 2
 * task 8** (cloud `a307e18`, 2026-09-03). The cloud cannot import a specifier
 * it has not pinned, so its own copy of `schemaIssues`, `refusal`, `slugOf`,
 * `formatPath` and `valueAt` stood from wave 1, when this module landed here,
 * until that re-pin deleted them and imported these. The window is recorded
 * rather than dropped because it cost a live bug while it was open: the
 * cloud's own `formatPath` wrote a blank path segment as the empty string,
 * which `validationIssue.path`'s `min(1)` refuses, so a draft containing
 * `"": 3` rode a 200 whose whole body the console's `safeParse` then dropped.
 * Anything else that lands in contracts ahead of its consumer's pin opens the
 * same window.
 */

/**
 * One zod issue.
 *
 * Zod's own issue union, not a structural restatement of it. The cloud's
 * copy described the shape by hand because the cloud has no `zod` dependency
 * of its own — it reaches every schema through this package. Here zod *is* a
 * dependency, and a hand-written shape that drifts from the real one would
 * be a second account of the same thing, on the module whose whole point is
 * that there is one.
 */
export type SchemaIssue = z.core.$ZodIssue

/** What a path with no segments at all is called, since `path` may not be empty. */
export const DOCUMENT_ROOT_PATH = '(document)'

/**
 * The five sections whose keys are slugs — one namespace across all of them,
 * which is what lets a role grant say `{robot, slug}` without naming a kind.
 * `messages:` is deliberately not among them: its names are their own
 * namespace.
 *
 * `cloud/src/config-sections.ts` re-exports this constant and drives the
 * cloud's iteration over sections from it; the console reads it directly
 * (`useConfigRepairs.ts`). It was spelled out separately in all three until
 * wave 2 task 8 (cloud `a307e18`, 2026-09-03) — this is the only spelling
 * since.
 */
export const EXPOSURE_SECTIONS = ['datapoints', 'actions', 'services', 'publishers', 'cameras'] as const
export type ExposureSection = (typeof EXPOSURE_SECTIONS)[number]

/**
 * The refusals `robotConfigDoc` already made, reported as validation issues
 * with their FL-002 codes.
 *
 * **This maps; it does not re-decide.** Seven of the thirteen codes are
 * answered by the schema before a document ever becomes a `RobotConfigDoc`,
 * and `config.ts` attaches `params: { code }` at each site for exactly this —
 * its header lists which codes it decides and which it defers. Reading
 * `params.code` is also the only stable join: the prose of a message is not a
 * contract and matching on it is a join nobody notices breaking.
 *
 * Two refusals carry no `params.code` and are recognised by zod's own issue
 * code instead, which the same header says consumers should do:
 *
 * - `unrecognized_keys` is `unknown_key`. One issue per key, so the path
 *   names the offending key rather than its parent.
 * - `invalid_type` **where the value at that path is `null`** is
 *   `explicit_null`. The condition is checked against the parsed value and
 *   not against the message, which says "received null" — see above. Zod 4
 *   does not carry the input on the issue, so the value is navigated to. The
 *   sentence differs at the document root, where there is no key to remove:
 *   see `EMPTY_DOCUMENT_MESSAGE`.
 *
 * Everything else keeps zod's own code. Those are refusals with no FL-002
 * code — a reversed `min_value`/`max_value` pair, a section over its cap, a
 * key that is not a slug — and inventing a fourteenth code for them would put
 * a code on the wire that no table documents.
 */
export function schemaIssues(value: unknown, issues: readonly SchemaIssue[]): ValidationIssue[] {
  return issues.flatMap((issue): ValidationIssue[] => {
    if (issue.code === 'unrecognized_keys') {
      return (issue.keys ?? []).map((key) =>
        refusal([...issue.path, key], 'unknown_key', `'${key}' is not a key this format defines.`),
      )
    }

    // `'params' in issue` rather than `issue.code === 'custom'`: the cloud's
    // version read `params` off any issue that carried one, and narrowing by
    // code here would be a quieter rule than the one being moved. Zod only
    // declares `params` on the custom issue, so the `in` check is also what
    // types it.
    const declared = 'params' in issue ? issue.params?.['code'] : undefined
    if (typeof declared === 'string') return [refusal(issue.path, declared, issue.message)]

    if (issue.code === 'invalid_type' && valueAt(value, issue.path) === null) {
      return [refusal(issue.path, 'explicit_null', issue.path.length === 0 ? EMPTY_DOCUMENT_MESSAGE : NULL_KEY_MESSAGE)]
    }

    return [refusal(issue.path, issue.code, issue.message)]
  })
}

const NULL_KEY_MESSAGE = 'This key is null. Omission is the only spelling of "not set" in this format — remove the key instead.'

/**
 * The same refusal at the document root, where **there is no key**.
 *
 * The whole document is the null: the file is empty, holds nothing but
 * comments, or says `null` / `~` outright. All four reach `robotConfigDoc` as
 * a genuine `invalid_type` on `null` at the empty path, so the code is right —
 * but the sentence for a null *key* told the developer to remove a key that
 * does not exist, and "select all, delete" is the commonest way anybody gets
 * here. Since FL-005 D2 stores the draft rather than refusing it, that
 * sentence is what the FINDINGS panel shows persistently for an emptied
 * editor, where it used to ride a one-shot 422 nobody read.
 *
 * It names the smallest legal document rather than only saying what is wrong,
 * because at this path there is no line to jump to and no repair to offer —
 * `repairsFor`'s `explicit_null` branch looks the path up in the text and
 * finds nothing, correctly. The sentence is the entire remedy the developer
 * gets.
 */
const EMPTY_DOCUMENT_MESSAGE = 'There is no document in this file — it is empty, holds only comments, or is an explicit null. A fleetless configuration is a mapping, and the smallest one is the single line "fleetless: 1".'

function refusal(path: readonly PropertyKey[], code: string, message: string): ValidationIssue {
  return { path: formatPath(path), slug: slugOf(path), code, message, severity: 'error' }
}

const EXPOSURE_SECTION_NAMES = new Set<string>(EXPOSURE_SECTIONS)

/**
 * The entry a path belongs to, for the console's "jump to it" link. `null`
 * for anything outside the five exposure sections — `messages:` most of all,
 * whose names are their own namespace.
 */
function slugOf(path: readonly PropertyKey[]): string | null {
  const [section, slug] = path
  if (typeof section !== 'string' || !EXPOSURE_SECTION_NAMES.has(section)) return null
  return typeof slug === 'string' ? slug : null
}

/**
 * `['datapoints','a','enum',0]` -> `datapoints.a.enum[0]`, the spelling every
 * other path here uses.
 *
 * **A segment that would render as nothing is written quoted instead.** The
 * last segment of an `unrecognized_keys` or `invalid_key` path is a key the
 * *developer* wrote, and YAML lets that key be empty (`"": 3`), nothing but
 * whitespace, or — see `isBlank` — nothing but characters that occupy no
 * width. Rendered bare, such a key produced a path a reader cannot act
 * on — and at the root it produced the empty string, which
 * `validationIssue.path` (`z.string().min(1)`) refuses. That was the cloud
 * publishing a finding that fails the cloud's own contract for findings, and
 * after D2 stored the draft it cost the whole `configDraftResponse`, not one
 * issue: the console's `safeParse` dropped the response and handed the editor
 * nothing, for two characters typed.
 *
 * The quoted spelling is the segment's JSON string literal, and that is the
 * whole of the reason for choosing it: JSON's string syntax is a subset of
 * YAML's double-quoted scalar syntax, so `""`, `" "` and `"\t"` are each a
 * valid YAML spelling of exactly the key being complained about. The path is
 * therefore text the developer can search their own file for — which is the
 * bar this has to clear. It is also the same move `DOCUMENT_ROOT_PATH` makes
 * for the no-segments case, one level down: give the invisible thing a name.
 *
 * **Only blank segments are quoted.** A segment containing `.` or `[` is
 * still written bare, so it still cannot be read back — see
 * `splitFormatPath`, which documents why escaping those was rejected. That
 * decision is unchanged here on purpose: those paths are wrong for one
 * console lookup, these were wrong on the wire.
 */
export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return DOCUMENT_ROOT_PATH
  return path.reduce<string>((acc, segment, index) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`
    const written = isBlank(segment) ? quoteBlank(segment) : String(segment)
    // Indexed rather than `acc === ''`: "first segment" used to be detected as
    // "nothing written yet", which is how an empty first segment came to be
    // dropped entirely — `formatPath(['', 'a'])` was `'a'`, a path naming a
    // key the document does not have. Quoting means no segment writes nothing
    // any more, but a guard that holds only because of what another line
    // happens to produce is the shape this file exists to avoid.
    return index === 0 ? written : `${acc}.${written}`
  }, '')
}

/**
 * The quoted spelling of a blank segment: its JSON string literal, with every
 * zero-width character written as a `\uXXXX` escape.
 *
 * `JSON.stringify` escapes the C0 controls and nothing else, so a zero-width
 * space came back as itself and `"\u200b"` rendered as two quote marks with
 * nothing between them — visible as *a* blank key, but indistinguishable from
 * `""`, and so not findable. The bar this function's caller set itself is that
 * the developer can search their own file for the path, and `\uXXXX` is a JSON
 * escape *and* a YAML double-quoted escape, so the quoted form stays a valid
 * YAML spelling of exactly the key complained about while naming which
 * invisible character it is. Astral format characters are left as
 * `JSON.stringify` wrote them: `\uXXXX` cannot spell them and their surrogate
 * pair already round-trips.
 */
function quoteBlank(segment: string): string {
  return JSON.stringify(segment).replace(/\p{Cf}/gu, (char) => {
    const code = char.codePointAt(0)!
    return code > 0xffff ? char : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/**
 * A name with nothing in it to read: empty, whitespace all the way through, or
 * made of characters that occupy no width.
 *
 * `trim()` alone is not the test, and that gap was real rather than
 * theoretical: `trim()` removes Unicode `White_Space`, and a zero-width space
 * (`U+200B`) is not white space — it is a format character (`Cf`), as are
 * `U+200C`–`U+200F`, the word joiner `U+2060` and a stray BOM `U+FEFF`. A key
 * spelled with one of those rendered bare and therefore rendered as nothing,
 * which is the exact defect quoting exists to close, one character class over.
 * Format characters are stripped before the trim so both classes, and any
 * mixture of them, reach the same answer.
 *
 * This is the **only** spelling of "blank" in this file. `unquoteBlank` asks
 * the same question on the way back and must get the same answer, or a path
 * `formatPath` quoted stops round-tripping.
 */
function isBlank(segment: PropertyKey): segment is string {
  return typeof segment === 'string' && segment.replace(/\p{Cf}/gu, '').trim() === ''
}

/**
 * `formatPath` read back — `datapoints.a.enum[0]` -> `['datapoints','a','enum',0]`.
 *
 * It exists because two console call sites split an issue path on `.` alone
 * while the cloud writes sequence indices in brackets, so `ranges[0]` reached
 * a document lookup as one segment that matches no key.
 *
 * **It is not the inverse of `formatPath`, and must not be read as one.**
 * `formatPath` writes `.` and `[n]` as structure and escapes nothing, so a
 * name that contains either is indistinguishable afterwards from the
 * structure it looks like. This is reachable, not theoretical: an
 * `unrecognized_keys` path ends in a key the **developer** chose, and YAML
 * lets that key be `a.b` or `ranges[0]`.
 *
 * Escaping on the way out was the alternative and was rejected: `path` is a
 * wire field (`validationIssue.path`), it is rendered to developers as-is,
 * and every recorded expectation in this repo and the cloud's spells it
 * unescaped. Changing what the server says about every document to make one
 * console lookup total is the larger of the two costs.
 *
 * So the property this has, and the one its test asserts, is the narrow one:
 * **a path round-trips when no string segment contains `.` or `[`, and the
 * path is not the single segment `(document)`.** Outside that, the split is a
 * best guess. What it costs is bounded — the console uses the result to find
 * a line to put a marker on, so a wrong split finds no line and the marker is
 * not placed. It never makes the console assert something false about the
 * document.
 *
 * A **blank** segment is inside that property rather than outside it, and
 * that is new. `formatPath` used to drop an empty first segment entirely
 * (`formatPath(['', 'a'])` was `'a'`, a path naming a different key) and to
 * write a nested one as a trailing `.`; at the root it produced the empty
 * string, which `validationIssue.path`'s `min(1)` refuses outright. It now
 * quotes blank segments, and `unquoteBlank` reads them back, so `['']`,
 * `[' ']` and `['datapoints', 'battery_soc', '']` all round-trip. The single
 * new non-round-trip that buys is a key literally spelled with quote marks
 * around whitespace.
 */
export function splitFormatPath(path: string): Array<string | number> {
  if (path === DOCUMENT_ROOT_PATH) return []

  const segments: Array<string | number> = []
  for (const chunk of path.split('.')) {
    // A blank segment left `formatPath` quoted, so read it back. Narrowed to
    // *blank* content on purpose: it is the only content `formatPath` quotes,
    // so this cannot misread `"x"`, and the one key it does misread — a key
    // literally spelled with quote marks around whitespace — is the same
    // bounded cost as the `.` and `[` cases below.
    const unquoted = unquoteBlank(chunk)
    if (unquoted !== null) {
      segments.push(unquoted)
      continue
    }
    const match = /^([^[\]]*)((?:\[\d+\])+)$/.exec(chunk)
    if (match === null) {
      segments.push(chunk)
      continue
    }
    // A chunk is `name[0][1]` or a bare `[0]`; the name is absent only when
    // the whole path starts with an index, which `formatPath` does write.
    const [, name, indices] = match
    if (name !== '') segments.push(name)
    for (const index of indices!.slice(1, -1).split('][')) segments.push(Number(index))
  }
  return segments
}

/** The blank string a chunk quotes, or `null` if it does not quote one. */
function unquoteBlank(chunk: string): string | null {
  if (chunk.length < 2 || !chunk.startsWith('"') || !chunk.endsWith('"')) return null
  let value: unknown
  try {
    value = JSON.parse(chunk)
  } catch {
    return null
  }
  return typeof value === 'string' && isBlank(value) ? value : null
}

/**
 * The value a zod issue's path points at in the document that was parsed.
 *
 * `Object.hasOwn`, not a bare index, for the reason `sectionGet` gives: the
 * value came out of a YAML parse and carries `Object.prototype`, so a path
 * segment like `constructor` would otherwise read a function off the
 * prototype and answer a question about a key the document never had.
 */
function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cursor: unknown = root
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    if (Array.isArray(cursor)) {
      if (typeof segment !== 'number') return undefined
      cursor = cursor[segment]
      continue
    }
    const key = String(segment)
    if (!Object.hasOwn(cursor, key)) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

/**
 * A stable hash of a schema object, for asking *is the thing running the one
 * I think it is?*
 *
 * Wave 5's browser sweep enumerates positions against a schema it holds and
 * has to know that the editor is running the same one; the manifest that
 * makes a schema-side change announce itself uses the same number as its
 * baseline. Both are the same question, so there is one implementation of it:
 * a second one on the sweep side would drift, and the gate would then go red
 * for the drift rather than for the schema.
 *
 * Canonical JSON first — object keys sorted at every depth, so a re-ordered
 * `meta()` block is not a change — then FNV-1a over the result, 64 bits as
 * 16 hex characters. Sorting is done through the `JSON.stringify` replacer,
 * which also means a cyclic input throws the engine's own "converting
 * circular structure" TypeError rather than hanging.
 *
 * **Named residual: this is a change detector, not a digest.** FNV-1a is not
 * a cryptographic hash and a collision can be constructed on purpose. It is
 * asked *did this object change since the baseline was recorded*, by the
 * people who wrote both; nothing here defends against someone choosing the
 * input. `crypto.subtle` would be the answer to the other question and is
 * async, which a `data-` attribute rendered during setup cannot be.
 */
export function configSchemaHash(schema: unknown): string {
  return fnv1a64(canonicalJson(schema))
}

function canonicalJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, inner: unknown) =>
      inner !== null && typeof inner === 'object' && !Array.isArray(inner)
        ? Object.fromEntries(
            Object.keys(inner as Record<string, unknown>)
              .sort()
              .map((key) => [key, (inner as Record<string, unknown>)[key]]),
          )
        : inner,
    ) ??
    // `JSON.stringify` answers `undefined`, not a string, for `undefined` and
    // for a function. Hashing the word keeps this function total; a caller
    // that passed one by accident gets a hash that matches no baseline, which
    // is the outcome it wants anyway.
    'undefined'
  )
}

function fnv1a64(text: string): string {
  const PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}
