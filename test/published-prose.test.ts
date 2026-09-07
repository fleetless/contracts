// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Nothing internal reaches the bytes this package publishes.
 *
 * `dist/` and `artifacts/` are the whole of what an outside integrator
 * receives. `tsc` preserves JSDoc into both `dist/*.js` and `dist/*.d.ts`, and
 * `scripts/export-schemas.ts` copies every `.meta({ description })` into the
 * JSON Schemas and the OpenAPI document — so a comment written for the people
 * who built this is a comment an editor shows to somebody who installed it.
 *
 * A description says what a field means to a caller. It never says how the
 * behaviour was found, on which machine, under which internal ticket, or in
 * which language the team happened to be thinking that day.
 *
 * That rule has two halves and the second one is easier to miss. The first is
 * about **markers** — a `DEF-` id, a robot's hostname, a German paragraph — and
 * they are cheap to detect because they cannot be anything else. The second is
 * about **stance**: an internal decision label, a path into a sibling
 * repository, "this project", a reference to a document the reader does not
 * have, a sentence about how somebody discovered the behaviour. Each of those
 * is ordinary text that happens to address the wrong reader, and each one tells
 * a person who installed this package that it was not written for them.
 *
 * **What makes this fail**: put one German sentence, one `FL-0xx`, one `DEF-`
 * id, one internal wave label, one `rx1` path or one internal hostname back
 * into any comment in `src/` and rebuild. Verified by doing exactly that — the
 * run named the file, the line and the marker.
 *
 * **What makes it fail the harder way**: scanning nothing. `dist/` and
 * `artifacts/` are generated, so an unbuilt tree would make every assertion
 * below free. The floors are asserted against the real listing, and a control
 * string that must be present is asserted too — a scan that reads no bytes
 * fails on the control rather than passing on the absence.
 *
 * **`src/` is scanned as well, and that is not redundancy — it is the answer to
 * a stale `dist/`.** `pnpm test` does not build, so a marker put back in a
 * comment ten seconds ago is not yet in `dist/` and a built-output-only guard
 * would be green about the tree it is looking at. `src/` is the tree `dist/` is
 * generated from and it is always current, so the two halves cover each other:
 * `src/` catches a marker before the build, `dist/`+`artifacts/` catch one that
 * arrives THROUGH the build (a banner, a generator, a description assembled at
 * export time) and would never appear in a source file at all.
 */

const ROOT = new URL('..', import.meta.url).pathname

/** The two generated trees: this is what npm serves. */
const BUILT = ['dist', 'artifacts']

/**
 * The tree they are generated from. Not `scripts/` or `test/` — those never
 * reach a consumer, and this file's own word list would be the first hit.
 */
const SOURCE = ['src']

const SCANNED = [...BUILT, ...SOURCE]

/**
 * German function words with no English homograph. Deliberately function words
 * rather than a topic vocabulary: prose switches language wholesale, so the
 * cheap words are the reliable detector and a noun list would miss a paragraph
 * that happens to avoid its nouns.
 */
const GERMAN = [
  'und', 'oder', 'nicht', 'aber', 'sondern', 'weil', 'dass', 'damit', 'wenn',
  'denn', 'doch', 'schon', 'noch', 'auch', 'nur', 'sehr', 'hier', 'dort',
  'jetzt', 'dann', 'immer', 'nie', 'alle', 'alles', 'viele', 'jede', 'jeder',
  'jedes', 'eine', 'einen', 'einem', 'einer', 'eines', 'kein', 'keine',
  'keinen', 'ist', 'sind', 'wurde', 'wurden', 'wird', 'werden', 'worden',
  'kann', 'können', 'muss', 'müssen', 'soll', 'sollen', 'darf', 'dürfen',
  'haben', 'hatte', 'hatten', 'für', 'über', 'unter', 'zwischen',
  'gegen', 'ohne', 'durch', 'nach', 'vor', 'bei', 'beim', 'zum', 'zur', 'vom',
  'aus', 'mit', 'von', 'auf', 'sich', 'ihre', 'ihrer', 'seine', 'seiner',
  'diese', 'dieser', 'dieses', 'welche', 'welcher', 'wer', 'wie',
  'warum', 'deshalb', 'daher', 'gemessen', 'gilt', 'steht', 'liegt',
]

/**
 * `was` and `hat` are deliberately absent: both are ordinary English words, and
 * a detector that fires on "the reference was not resolved" is a detector
 * somebody deletes. The list is the words that cannot be English.
 */

/**
 * URL-ish runs, removed before the German scan.
 *
 * A path segment is not prose, and several German function words are also
 * ordinary path segments: `/api/v1/von/…`, `/nach/…`, `/bei/…`, `/wie/…`. A
 * detector that fires on those is a detector somebody deletes the first time it
 * is wrong about a route, so the URLs come out of the text first and the
 * remaining prose is scanned intact. `NO_URL_FIXTURES` below asserts both
 * directions: a URL alone stays green, and a URL sitting **beside** German
 * prose still goes red, so this is not a hole to hide text in.
 */
const URLISH = /\b[a-z][a-z0-9+.-]*:\/\/\S+|(?:^|[\s(`"'])\/[A-Za-z0-9_.:${}*-]+(?:\/[A-Za-z0-9_.:${}*-]+)+/g
const stripUrls = (t: string) => t.replace(URLISH, ' ')

/**
 * **The word boundary is `[^\p{L}]`, not `\b`, and that is not a style
 * choice.** `\b` in JavaScript is an ASCII-word boundary: `ü` is not a word
 * character to it, so `\b` before one requires the PRECEDING character to be a
 * word character — which inverts the test for every German word that opens with
 * an umlaut. Measured on this list:
 *
 * | text | `\b…\b` | `[^\p{L}]…[^\p{L}]` |
 * |---|---|---|
 * | `Das gilt über hier.` | **misses it** | catches it |
 * | `darüber steht` | **false positive** | correctly silent |
 *
 * So `\b` is wrong in both directions at once on exactly the words a German
 * paragraph is most likely to contain. The URL trap it was suggested for is
 * closed by `stripUrls` above instead, which removes the path before the scan
 * rather than weakening what a word is.
 */

/**
 * Each is [name, pattern]. `name` is what the failure prints, so it has to say
 * why the hit is a problem rather than only that there was one.
 *
 * The five stance patterns at the end are narrower than their plain-English
 * readings on purpose. `caught by the body schema`, `the row is found by token
 * hash` and `a link measured below 0.5 B/s` are all correct descriptions of
 * behaviour, and a guard that reddened on them would be deleted rather than
 * obeyed — so `how it was found` matches a capitalised `Measured`, `measured
 * against/on/through`, `used to say`, `the first version of this`, and
 * `found/caught by` only when a **review** or a name follows.
 */
const MARKERS: [string, RegExp][] = [
  ['German prose', new RegExp(`(^|[^\\p{L}])(${GERMAN.join('|')})([^\\p{L}]|$)`, 'iu')],
  ['an internal feature id (FL-0xx)', /FL-0\d/],
  ['an internal defect id (DEF-nnn)', /DEF-\d/],
  ['an internal wave label (W1..W9x)', /(^|[^\p{L}\d])W\d[a-e]?([^\p{L}\d]|$)/u],
  ['an absolute path from a developer machine', /\/home\//],
  ['the reference robot by name', /rx1/i],
  ['an internal host or workspace name', /wg-fleetless|src\.old-|gitlab\.dehne-robotik\.de|dehne\.cloud/i],
  ['a person by first name', /Andr[eé]\b/],
  ['an internal review codename', /Momus|Kassandra|Threepio|Argus-W|Nimbus-W|Rosie-W|Eve-W\d|Data-W\d/],

  // The stance half. Each of these is ordinary text addressed to the wrong
  // reader, which is what makes it harder to see than a `DEF-` id.
  ['an internal decision label', /(?<![A-Za-z0-9])(?:spec |design )?[DRKM]\d{1,2}(?:[–\-/,] ?[DRKM]?\d{1,2})*(?![A-Za-z0-9])(?=[)\s.,;:]|$)/],
  ['a path into another repository', /\b(?:cloud|console|bridge|sdk|infra)\/(?:src|app|test|scripts|fleetless_bridge)\/[A-Za-z0-9_./-]+/],
  ['a reference to this project rather than to the reader\'s', /\bthis (?:project|repository|repo|train|wave|codebase|delta|playbook)(?:'s)?\b/i],
  ['a reference to a document the reader does not have', /\b(?:the )?(?:spec|playbook|register row|deferral register|discipline gate|gate step)\b/i],
  ['how the behaviour was found rather than what it is', /(?:^|[.!?]\s+|\*\*)Measured\b|\bmeasured (?:against|on|through|either|before|in a|at the)\b|\bthe first version of this\b|\bused to (?:say|read|claim)\b|\b(?:found|caught) by (?:a )?(?:review|[A-Z])/],
]

/** A string that MUST be in the scanned bytes; its absence means we read nothing. */
const CONTROL = 'Fleetless'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

for (const dir of SCANNED) {
  if (!existsSync(join(ROOT, dir))) {
    throw new Error(
      `${dir}/ does not exist, so this test would assert nothing. Run \`pnpm build\` and \`pnpm artifacts\` first.`,
    )
  }
}

const files = SCANNED.flatMap(walk)
const contents = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
const totalBytes = [...contents.values()].reduce((n, s) => n + s.length, 0)

describe('the published bytes carry nothing internal', () => {
  it('scans the real generated trees, not an empty or half-built one', () => {
    // Anti-vacuity, per directory rather than in total: `artifacts/` alone is
    // ~240 files, so a total-only floor would stay green with `dist/` empty —
    // and `dist/` is the half that carries the doc comments this test is for.
    const dist = files.filter((f) => f.startsWith('dist/'))
    const artifacts = files.filter((f) => f.startsWith('artifacts/'))
    const src = files.filter((f) => f.startsWith('src/'))
    expect(dist.length, 'dist/ is too small to be this package — run `pnpm build`').toBeGreaterThanOrEqual(40)
    expect(artifacts.length, 'artifacts/ is too small — run `pnpm artifacts`').toBeGreaterThanOrEqual(200)
    expect(src.length, 'src/ is too small to be this package').toBeGreaterThanOrEqual(15)

    // The two halves must stay paired: one module per source file, both emits.
    // A `dist/` that has fallen behind `src/` is a `dist/` this guard would be
    // reading the wrong answer out of, and the pack check would not catch it
    // because `npm pack` rebuilds.
    expect(dist.length, 'dist/ holds fewer files than src/ has modules').toBeGreaterThanOrEqual(src.length * 2)

    // Both halves of dist, because declaration emit and JS emit carry comments
    // independently: a `.d.ts`-only or `.js`-only tree is not this package.
    expect(dist.filter((f) => f.endsWith('.js')).length).toBeGreaterThanOrEqual(20)
    expect(dist.filter((f) => f.endsWith('.d.ts')).length).toBeGreaterThanOrEqual(20)
  })

  it('actually read the bytes it claims to have scanned', () => {
    // The control. A walk that returns paths whose contents are empty strings
    // would satisfy every "does not match" assertion below; this is the one
    // assertion that goes the other way.
    expect(totalBytes).toBeGreaterThan(1_000_000)
    const withControl = [...contents.entries()].filter(([, text]) => text.includes(CONTROL))
    expect(withControl.length, `not one scanned file contains ${CONTROL}`).toBeGreaterThan(0)
  })

  it.each(MARKERS)('no published file contains %s', (name, pattern) => {
    // Collected across every file and reported together: somebody who
    // reintroduced a paragraph needs to see all of it, not its first line.
    const hits: string[] = []
    for (const [file, text] of contents) {
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = name === 'German prose' ? stripUrls(lines[i]) : lines[i]
        const m = line.match(pattern)
        if (m) hits.push(`${file}:${i + 1}: …${lines[i].slice(Math.max(0, m.index! - 40), m.index! + 80).trim()}…`)
      }
    }
    expect(hits, `${hits.length} hit(s) for ${name}`).toEqual([])
  })
})

/**
 * Fixtures, because a guard that is only ever run against a clean tree is a
 * guard nobody knows the shape of. Each pair is [text, expected], and both
 * directions are asserted: text that MUST be caught, and text that must NOT be,
 * because a false positive here is how a detector gets deleted rather than
 * obeyed.
 */
const MUST_MATCH: [string, string][] = [
  ['German prose', 'Die Cloud wusste es die ganze Zeit und warf die Markierung weg.'],
  // The umlaut-initial word an ASCII `\b` boundary silently misses.
  ['German prose', 'Eine Grenze, über die niemand spricht.'],
  ['an internal decision label', 'Fleetless renders no page for an app user (D2).'],
  ['a path into another repository', 'Produced by `cloud/src/routes/config.ts`.'],
  ["a reference to this project rather than to the reader's", 'the failure this project keeps paying for'],
  ['a reference to a document the reader does not have', 'the spec calls this the speed limit'],
  ['how the behaviour was found rather than what it is', 'Measured against zod 4.4.3: `.meta()` merges.'],
  ['how the behaviour was found rather than what it is', 'This comment used to say the opposite.'],
]

const MUST_NOT_MATCH: [string, string][] = [
  // A URL whose segments are also German function words. This is the trap the
  // pre-word-boundary version of the detector fell into.
  ['German prose', 'See `https://example.test/api/v1/von/bei/nach/wie` for the shape.'],
  ['German prose', 'The path `/nach/bei` is reserved.'],
  // German letters INSIDE an English word, which an ASCII `\b` would claim.
  ['German prose', 'The überflieger identifier is not a keyword here.'],
  // Ordinary English that the stance patterns must not claim.
  ['how the behaviour was found rather than what it is', 'A malformed uuid in a body is caught by the body schema first.'],
  ['how the behaviour was found rather than what it is', 'The row is found by token hash and the previous hash is gone.'],
  ['how the behaviour was found rather than what it is', 'A link measured below 0.5 B/s floors to 0 here.'],
  ['how the behaviour was found rather than what it is', '"not measured" and "measured as zero" are different facts.'],
  ['an internal decision label', 'The bound is 1..10000 and the ceiling is 64 MiB.'],
  ['an internal decision label', 'A `.dae` referencing `textures/skin.png` uploads under that name.'],
  ['a path into another repository', 'The route is `/api/robots/:id/config/draft`.'],
  ["a reference to this project rather than to the reader's", 'this server has no sessions'],
  ['a reference to a document the reader does not have', 'RFC 6749 §5.2 permits additional members.'],
]

describe('the detectors themselves', () => {
  const by = new Map(MARKERS)
  const test = (name: string, text: string) => {
    const p = by.get(name)
    if (!p) throw new Error(`no marker named ${name}`)
    return p.test(name === 'German prose' ? stripUrls(text) : text)
  }

  it('names every marker the fixtures refer to', () => {
    // Anti-vacuity for the fixtures: a renamed marker would otherwise make
    // every case below silently test nothing.
    for (const [name] of [...MUST_MATCH, ...MUST_NOT_MATCH]) expect(by.has(name)).toBe(true)
    // And every stance marker has at least one fixture of each kind, so a
    // pattern added later without one is a failure rather than an omission.
    for (const [name] of MARKERS.slice(-5)) {
      expect(MUST_MATCH.some(([n]) => n === name), `${name} has no MUST_MATCH fixture`).toBe(true)
      expect(MUST_NOT_MATCH.some(([n]) => n === name), `${name} has no MUST_NOT_MATCH fixture`).toBe(true)
    }
  })

  it.each(MUST_MATCH)('%s catches: %s', (name, text) => {
    expect(test(name, text)).toBe(true)
  })

  it.each(MUST_NOT_MATCH)('%s leaves alone: %s', (name, text) => {
    expect(test(name, text)).toBe(false)
  })
})
