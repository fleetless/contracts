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
 * Each is [name, pattern]. `name` is what the failure prints, so it has to say
 * why the hit is a problem rather than only that there was one.
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
        const m = lines[i].match(pattern)
        if (m) hits.push(`${file}:${i + 1}: …${lines[i].slice(Math.max(0, m.index! - 40), m.index! + 80).trim()}…`)
      }
    }
    expect(hits, `${hits.length} hit(s) for ${name}`).toEqual([])
  })
})
