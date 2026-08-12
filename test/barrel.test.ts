/**
 * The package's only export path is `dist/index.js` — `package.json` maps
 * `"."` to it and nothing else, so a deep import is refused by Node with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. `src/index.ts` is an explicit named list,
 * which means every new symbol has to be written twice and nothing checks
 * the second one.
 *
 * It went wrong immediately: the W6a delta added five symbols across three
 * modules, the artifacts and the typecheck were both clean, and the barrel
 * was never touched — so the wave's first consumer could not import any of
 * them. Found by a teammate on their first task, not by the lead who wrote
 * it, and not by any check in this repo.
 *
 * This test is that missing check. It compares what the source modules
 * export against what the barrel re-exports, so the failure arrives here
 * rather than in another repo's install.
 *
 * It found a sixth on its first run — `SNAPSHOT_MAX_BYTES`, missing since
 * W5 and never noticed, because nothing had imported it from the package.
 *
 * **What it cannot check: `export type`.** Types are erased at runtime, so a
 * missing type re-export is invisible here and shows up as a consumer's
 * `tsc` error instead. Adding a value means adding its type by hand, and
 * this test does not cover that half — said plainly rather than left for
 * someone to assume the check is complete.
 */
import { describe, it, expect } from 'vitest'
import * as barrel from '../src/index.js'
import * as common from '../src/common.js'
import * as protocol from '../src/protocol.js'
import * as rest from '../src/rest.js'
import * as realtime from '../src/realtime.js'
import * as config from '../src/config.js'
import * as errors from '../src/errors.js'
import * as identity from '../src/identity.js'
import * as apps from '../src/apps.js'
import * as audit from '../src/audit.js'
import * as jobs from '../src/jobs.js'
import * as introspection from '../src/introspection.js'
import * as clientAuth from '../src/client-auth.js'

const MODULES: Record<string, object> = {
  common, protocol, rest, realtime, config, errors,
  identity, apps, audit, jobs, introspection, 'client-auth': clientAuth,
}

describe('the barrel', () => {
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
