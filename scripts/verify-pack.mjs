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
 * asserted here as sets. The presence half is DERIVED from `src/`, not a
 * hand-written list; the absence half is a predicate over EVERY entry, not a
 * list of paths that must not — a list cannot fail on the file nobody thought
 * of.
 *
 * **Naming two of the forty dist files is the same as naming none.**
 * `dist/index.js` is a re-export barrel, so a tarball holding it and nothing
 * else passes a presence list and throws `ERR_MODULE_NOT_FOUND` on the first
 * import. The module set therefore comes from `readdirSync('src')`: every
 * `src/<name>.ts` must have both `dist/<name>.js` and `dist/<name>.d.ts` in the
 * tarball, so a module added tomorrow is checked the day it exists and a module
 * dropped by a partial `tsc` emit is a failure rather than a smaller list.
 *
 * **And a listing is not a package.** The last section installs the tarball
 * into a scratch project and imports it for real — the package root and a deep
 * `artifacts/*.json` path — because `exports`, `type`, `main` and `types` are
 * fields no file listing can evaluate.
 *
 * What makes this fail: remove "artifacts" from `files`, or add "src", or
 * delete one file from `dist/` after the pack. All three were run. It also
 * fails if `prepare` stops emitting, because the tarball is built by `npm pack`
 * from this tree rather than from whatever `dist/` holds.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * The module set, read off `src/` rather than typed here. A `.ts` in `src/` is
 * a module `dist/index.js` may re-export, and a consumer resolving that
 * re-export needs both halves of the emit.
 */
const MODULES = readdirSync(join(root, 'src'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .sort()

/** Every path that a consumer resolves and would break without. */
const MUST_CONTAIN = [
  'package.json',
  ...MODULES.flatMap((m) => [`dist/${m}.js`, `dist/${m}.d.ts`]),
  'artifacts/routes.json',
  'artifacts/openapi.json',
  'artifacts/constants.json',
  'LICENSE',
  'NOTICE',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
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

// Anti-vacuity on the DERIVED half. If `src/` were unreadable or empty,
// MUST_CONTAIN would shrink to the handful of literals above and the set
// assertion would silently stop being one — the exact failure this rewrite
// exists to remove, reintroduced one level up.
if (MODULES.length < 15) {
  console.error(`FATAL: only ${MODULES.length} modules found in src/; the derived presence set is too small to be this package.`)
  process.exit(1)
}
if (!MODULES.includes('index')) {
  console.error('FATAL: src/index.ts was not found; the module list is not this package\'s.')
  process.exit(1)
}
console.log(`${MODULES.length} modules in src/ — ${MODULES.length * 2} dist files required\n`)

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

  // ---------------------------------------------------------------- licence
  //
  // Over the tarball's OWN bytes, not over `dist/` in this tree. `tsc` drops the
  // header from every declaration file and from any `.js` whose first statement
  // it elides, and `scripts/stamp-dist.mjs` puts it back — but only if `prepare`
  // ran, which is exactly the thing a check reading the local `dist/` cannot
  // tell you.
  console.log('\nlicence headers in the tarball:')
  const extracted = join(tmp, 'extracted')
  execFileSync('mkdir', ['-p', extracted])
  execFileSync('tar', ['-xzf', tarball, '-C', extracted])
  const HEADER = '// SPDX-License-Identifier: Apache-2.0'
  const distEntries = entries.filter((f) => f.startsWith('dist/'))
  const unheadered = distEntries.filter((f) => !readFileSync(join(extracted, 'package', f), 'utf8').startsWith(`${HEADER}\n`))
  if (distEntries.length < MODULES.length * 2) fail(`only ${distEntries.length} dist entries — fewer than the ${MODULES.length * 2} the module set requires`)
  else if (unheadered.length === 0) pass(`all ${distEntries.length} dist files carry the SPDX header`)
  else fail(`${unheadered.length} published file(s) carry no SPDX header: ${unheadered.slice(0, 6).join(', ')}${unheadered.length > 6 ? ' …' : ''}`)

  // ------------------------------------------------------------ real import
  //
  // A listing cannot evaluate `exports`, `type`, `main` or `types`, and a
  // barrel that re-exports a module the tarball does not hold looks identical
  // to a correct one until somebody imports it. So: install it as a consumer
  // does, in a project that shares nothing with this one, and import it.
  console.log('\ninstalling and importing the tarball:')
  const consumer = join(tmp, 'consumer')
  execFileSync('mkdir', ['-p', consumer])
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'contracts-pack-consumer', private: true, version: '0.0.0', type: 'module' }, null, 2))
  try {
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error', tarball], { cwd: consumer, stdio: ['ignore', 'pipe', 'inherit'] })
    pass('npm install of the tarball resolved')
  } catch (err) {
    fail(`npm install of the tarball failed: ${err.message}`)
  }

  // In a child process, because a failed dynamic import in THIS process would
  // be caught by the same try that is measuring it and the `finally` would
  // still print a summary. A child's exit code cannot be confused for
  // anything else.
  const probe = join(consumer, 'probe.mjs')
  writeFileSync(probe, [
    "import { robotListResponse, ERROR_CODES } from '@fleetless/contracts'",
    "import routes from '@fleetless/contracts/artifacts/routes.json' with { type: 'json' }",
    "if (typeof robotListResponse?.safeParse !== 'function') throw new Error('robotListResponse is not a zod schema')",
    "if (!Array.isArray(ERROR_CODES) || ERROR_CODES.length < 20) throw new Error('ERROR_CODES did not come through the barrel')",
    "if (!Array.isArray(routes?.routes) || routes.routes.length < 100) throw new Error('artifacts/routes.json did not resolve to the manifest')",
    // The barrel is a re-export, so importing it does NOT prove every module
    // file exists — Node resolves an `export … from` lazily per binding only
    // for circular graphs, and eagerly here, but a module with no exported
    // binding used above would still not be reached. Import each one by its
    // own specifier through the package root's graph instead: the package has
    // no deep TypeScript exports, so the barrel is the only door, and the
    // check that it opens onto everything is that the barrel's own namespace
    // is not smaller than the module count.
    "const ns = await import('@fleetless/contracts')",
    "if (Object.keys(ns).length < 200) throw new Error(`the barrel exports only ${Object.keys(ns).length} names; a module is missing from dist/`)",
    "console.log(`imported: ${Object.keys(ns).length} exported names, ${routes.routes.length} routes`)",
  ].join('\n'))
  try {
    const out = execFileSync('node', [probe], { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
    pass(`import '@fleetless/contracts' and its artifacts — ${out.trim()}`)
  } catch (err) {
    fail(`the installed package could not be imported: ${err.message}`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed — this tarball must not be published.`)
  process.exit(1)
}
console.log('\nthe tarball is what it should be.')
