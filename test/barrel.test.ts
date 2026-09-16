// SPDX-License-Identifier: Apache-2.0
/**
 * The package's only export path is `dist/index.js` — `package.json` maps
 * `"."` to it alone, so Node refuses a deep import with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. `src/index.ts` is an explicit named list,
 * which means every new symbol has to be written twice and nothing checks
 * the second one.
 *
 * It went wrong immediately: one delta added five symbols across three
 * modules, the artifacts and the typecheck were both clean, and the barrel
 * was never touched — so the first consumer could not import any of them.
 * Found by a person, not by any check here.
 *
 * This test is that missing check. It compares what the source modules
 * export against what the barrel re-exports, so the failure arrives here
 * rather than in another repo's install.
 *
 * It found a sixth on its first run — `SNAPSHOT_MAX_BYTES`, missing for
 * months and never noticed, because nothing had imported it from the
 * package.
 *
 * **What it cannot check: `export type`.** Types are erased at runtime, so a
 * missing type re-export is invisible here and shows up as a consumer's
 * `tsc` error instead. Adding a value means adding its type by hand;
 * this test does not cover that half — said plainly so nobody assumes
 * the check is complete.
 */
import { describe, it, expect } from 'vitest'
import * as barrel from '../src/index.js'
/**
 * **The module list enumerates itself, and that is the second lesson this
 * file has had to learn.**
 *
 * It was a hand-written `MODULES` record — and `assets.ts`, the entire
 * asset store, was never added to it. So the check written to catch a missing
 * barrel export was **blind to a whole module** from the moment that module
 * arrived, and stayed blind until somebody hit `AssetFailure` missing from
 * the barrel and asked why nothing had caught it.
 *
 * The original defect was *"every new symbol has to be written twice and
 * nothing checks the second one"*. The fix introduced a third place to
 * remember — this list — and the same failure moved into it. A check that
 * must be told about a new module is a check that will one day not be told.
 *
 * `import.meta.glob` reads the directory, so a new `src/*.ts` is covered the
 * moment it exists. Nothing to remember, and the previous version's own
 * caveat about `export type` still stands below.
 */
const MODULES: Record<string, object> = Object.fromEntries(
  Object.entries(import.meta.glob('../src/*.ts', { eager: true }))
    .filter(([path]) => !path.endsWith('/index.ts'))
    .map(([path, mod]) => [path.replace('../src/', '').replace('.ts', ''), mod as object]),
)

describe('the barrel', () => {
  it('actually found the source modules', () => {
    // **A `MODULES` that silently came back empty would make the check below
    // pass vacuously** — the fifth failure mode in the list this package keeps,
    // and the obvious way for a glob to go wrong. `assets` is named because
    // its absence is what this rewrite exists to stop.
    expect(Object.keys(MODULES).length).toBeGreaterThan(10)
    expect(Object.keys(MODULES)).toContain('assets')
  })

  it('re-exports every value the source modules export', () => {
    const exported = new Set(Object.keys(barrel))
    const missing: string[] = []
    for (const [name, mod] of Object.entries(MODULES)) {
      for (const key of Object.keys(mod)) {
        if (!exported.has(key)) missing.push(`${name}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
