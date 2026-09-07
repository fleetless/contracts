// SPDX-License-Identifier: Apache-2.0
/**
 * What `npm publish` would actually ship, asserted in BOTH directions.
 *
 * A `files` array is an allow-list, and the two ways it goes wrong look
 * nothing alike from inside the repository:
 *
 *   - something REQUIRED is missing. `artifacts/` not shipping is the
 *     expensive one — the docs site and the bridge read those by path, so the
 *     package installs, imports, typechecks and is useless.
 *   - something FORBIDDEN is present. `src/` or `test/` in the tarball ships
 *     the repository rather than the package; a `.map` ships paths from the
 *     build machine.
 *
 * Only one of those can be caught by "does my import work", so both are
 * asserted here as sets. The presence half is a list of paths that must exist;
 * the absence half is a predicate over EVERY entry, not a list of paths that
 * must not — a list cannot fail on the file nobody thought of.
 *
 * What makes this fail: remove "artifacts" from `files`, or add "src". Both
 * were run. It also fails if `prepare` stops emitting, because the tarball is
 * built by `npm pack` from this tree rather than from whatever `dist/` holds.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Every path that a consumer resolves and would break without. */
const MUST_CONTAIN = [
  'package.json',
  'dist/index.js',
  'dist/index.d.ts',
  'artifacts/routes.json',
  'artifacts/openapi.json',
  'artifacts/constants.json',
  'LICENSE',
  'NOTICE',
  'README.md',
  'CHANGELOG.md',
]

/**
 * Predicates over every entry, so a file nobody anticipated still fails.
 * Each is [name, test]; `name` is what the failure prints.
 */
const MUST_NOT_MATCH = [
  ['source files under src/', (f) => f === 'src' || f.startsWith('src/')],
  ['test files under test/', (f) => f === 'test' || f.startsWith('test/')],
  ['build scripts under scripts/', (f) => f === 'scripts' || f.startsWith('scripts/')],
  ['source maps', (f) => f.endsWith('.map')],
  ['tsconfigs', (f) => f.endsWith('tsconfig.json')],
  ['lockfiles', (f) => f.endsWith('pnpm-lock.yaml') || f.endsWith('package-lock.json')],
  ['CI definitions', (f) => f.endsWith('.gitlab-ci.yml')],
]

const tmp = mkdtempSync(join(tmpdir(), 'contracts-pack-'))
let failures = 0
const fail = (msg) => { failures += 1; console.error(`  FAIL  ${msg}`) }
const pass = (msg) => console.log(`  ok    ${msg}`)

try {
  console.log('packing…')
  // `--json` rather than parsing npm's human output, and `npm pack` (not pnpm)
  // because it is npm that publishes. It runs `prepare`, so the tarball is
  // built from this tree.
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const meta = JSON.parse(out)
  if (!Array.isArray(meta) || meta.length !== 1) {
    throw new Error(`npm pack --json returned ${Array.isArray(meta) ? meta.length : 'a non-array'}, expected exactly one tarball`)
  }
  const [info] = meta
  const tarball = join(tmp, info.filename)
  if (!existsSync(tarball)) throw new Error(`npm pack named ${info.filename} but it is not in ${tmp}`)

  // The entry list from the tarball itself, not from npm's report: npm's
  // `files` array and the archive are produced by the same code, so reading
  // the report would be asking the suspect for its own alibi.
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  const entries = listing
    .split('\n')
    .filter(Boolean)
    // npm prefixes every path with `package/`.
    .map((l) => l.replace(/^package\//, ''))
    .map((l) => l.replace(/\/$/, ''))
    .filter(Boolean)

  console.log(`tarball ${info.filename} — ${entries.length} entries, ${(info.size / 1024).toFixed(0)} kB packed\n`)

  // Anti-vacuity: an empty or near-empty listing would pass every "does not
  // contain" assertion below and is the one way this script could be green
  // about nothing.
  if (entries.length < 50) fail(`only ${entries.length} entries in the tarball — the listing is too small to be this package`)
  else pass(`${entries.length} entries listed`)

  console.log('\npresent:')
  for (const want of MUST_CONTAIN) {
    if (entries.includes(want)) pass(want)
    else fail(`${want} is NOT in the tarball`)
  }

  // The artifacts directory is the reason this check exists; assert the shape
  // of the set, not only the two files named above.
  const schemas = entries.filter((f) => f.startsWith('artifacts/schema/') && f.endsWith('.json'))
  const outgoing = entries.filter((f) => f.startsWith('artifacts/schema-outgoing/') && f.endsWith('.json'))
  if (schemas.length > 100) pass(`artifacts/schema/ — ${schemas.length} JSON Schemas`)
  else fail(`artifacts/schema/ has ${schemas.length} JSON Schemas, expected >100`)
  if (outgoing.length > 5) pass(`artifacts/schema-outgoing/ — ${outgoing.length} JSON Schemas`)
  else fail(`artifacts/schema-outgoing/ has ${outgoing.length} JSON Schemas, expected >5`)

  console.log('\nabsent:')
  for (const [name, matches] of MUST_NOT_MATCH) {
    const hits = entries.filter(matches)
    if (hits.length === 0) pass(`no ${name}`)
    else fail(`${hits.length} × ${name}: ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ' …' : ''}`)
  }

  console.log('\nmetadata:')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const [key, want] of [['license', 'Apache-2.0'], ['name', '@fleetless/contracts']]) {
    if (pkg[key] === want) pass(`package.json ${key} = ${want}`)
    else fail(`package.json ${key} is ${JSON.stringify(pkg[key])}, expected ${want}`)
  }
  if (pkg.publishConfig?.access === 'public') pass('publishConfig.access = public')
  else fail('publishConfig.access is not "public" — a scoped package defaults to restricted')
  if (pkg.exports?.['./artifacts/*'] === './artifacts/*') pass('exports has ./artifacts/* — the deep path resolves')
  else fail('exports has no "./artifacts/*" entry; `@fleetless/contracts/artifacts/routes.json` would not resolve')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed — this tarball must not be published.`)
  process.exit(1)
}
console.log('\nthe tarball is what it should be.')
