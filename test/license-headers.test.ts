// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every source file in this repository carries the SPDX header as its first
 * line. The package is published to npm under Apache-2.0, and a file without
 * the header is a file whose licence a downstream reader has to infer.
 *
 * What makes this test fail: delete the header from any one file under any
 * source directory. Verified by doing exactly that — the run named the file.
 * What ALSO makes it fail, and is the harder half: the sweep finding fewer
 * files than the repository has. A guard over a set that silently walks an
 * empty directory is the failure mode this project has hit most often, so the
 * count is asserted twice — against a floor, and against the real listing.
 *
 * **The directories are derived from the repository, not listed.** A named list
 * (`src`, `scripts`, `test`) is a requirement about a set guarded by three
 * examples: a `bin/`, a `tools/`, or a `.ts` at the repository root is invisible
 * to it and carries whatever header somebody copied. So the walk starts at the
 * repository and excludes a literal set of directories that are not source —
 * which makes a NEW top-level directory a failure until somebody classifies it,
 * the same shape the `unclassified` assertion already has one level down.
 *
 * The published half of this rule is not here: `dist/` is what a consumer
 * receives, `tsc` drops the header from declaration emit, and
 * `scripts/stamp-dist.mjs` puts it back. `scripts/verify-pack.mjs` asserts it
 * over the tarball's own bytes, which is the only place that can.
 */

const HEADER = '// SPDX-License-Identifier: Apache-2.0'
const ROOT = new URL('..', import.meta.url).pathname

/**
 * Not source, and excluded by name so that anything else is swept. Generated
 * output (`dist`, `artifacts`), dependencies, VCS metadata, and the agent
 * scratch directory that is not part of the package.
 */
const NOT_SOURCE = new Set(['node_modules', 'dist', 'artifacts', '.git', '.superpowers', 'coverage', '.nuxt'])

const DIRS = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NOT_SOURCE.has(e.name))
  .map((e) => e.name)
  .sort()

/** Files at the repository root itself — a `.ts` there is source like any other. */
const ROOT_FILES = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)

/** Extensions that carry `//` comments and therefore must carry the header. */
const SOURCE = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']

/**
 * Files in those directories that are NOT source and are exempt by name. Kept
 * as a literal list rather than as a pattern: a new non-source file has to be
 * added here deliberately, which is the moment somebody asks whether it should
 * have been source instead.
 */
const EXEMPT = new Set([
  'tsconfig.json',
  // Root files that are not source and are not this rule's business.
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore',
  '.gitlab-ci.yml', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md',
  'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

const all = [...DIRS.flatMap(walk), ...ROOT_FILES]
const sources = all.filter((f) => SOURCE.some((ext) => f.endsWith(ext)))

describe('SPDX headers', () => {
  it('sweeps every file in src/, scripts/ and test/ — no file is silently skipped', () => {
    // The set assertion, not an example: every entry the walk found is either
    // source (and therefore header-checked below) or exempt by name. A `.py`,
    // a `.tsx` or a `.yaml` dropped into `src/` fails here rather than passing
    // unnoticed because the extension list did not know about it.
    const unclassified = all.filter(
      (f) => !sources.includes(f) && !EXEMPT.has(f.split('/').pop()!),
    )
    expect(unclassified).toEqual([])
  })

  it('finds the repository\'s source files, not an empty directory', () => {
    // Anti-vacuity. `src/` alone has 20 files and `test/` has 38; a sweep that
    // returns 3, or 0, has stopped measuring what this test is named for and
    // every assertion below it becomes free.
    expect(sources.length).toBeGreaterThan(40)
    for (const dir of DIRS) {
      expect(
        sources.filter((f) => f.startsWith(`${dir}/`)).length,
        `no source files found under ${dir}/`,
      ).toBeGreaterThan(0)
    }
  })

  it('derives the directory set from the repository rather than a literal list', () => {
    // The three that must always be there, asserted so the derivation cannot
    // quietly return fewer — an exclude set that grew a typo would otherwise
    // shrink the swept set and every assertion with it.
    expect(DIRS).toEqual(expect.arrayContaining(['src', 'scripts', 'test']))
    // And a new top-level source directory is swept without anybody editing
    // this file: it is in DIRS by construction unless it is in NOT_SOURCE.
    for (const name of DIRS) expect(NOT_SOURCE.has(name)).toBe(false)
  })

  it('every source file opens with the SPDX header', () => {
    // Collected, not asserted one by one inside the loop: the failure message
    // then names every offender at once instead of only the first, which is
    // what somebody adding six files needs to read.
    //
    // A `#!` line — and ONLY a `#!` line — may precede the header, because a
    // shebang has to be byte zero or the kernel does not see it. Deliberately
    // narrow: any other first line is a violation, so this is not a general
    // "somewhere near the top" rule that a stray comment could satisfy.
    const missing = sources.filter((f) => {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n')
      const at = lines[0].startsWith('#!') ? 1 : 0
      return lines[at] !== HEADER
    })
    expect(missing).toEqual([])
  })

  it('only a shebang may precede the header — not an arbitrary first line', () => {
    // The exemption above is a hole if it is not bounded. This asserts the
    // bound directly: of the files whose header is on line 2, every one has a
    // shebang on line 1. Without it, the rule would read as "line 1 or line 2"
    // and a file could carry a comment above its licence.
    const offset = sources
      .map((f) => [f, readFileSync(join(ROOT, f), 'utf8').split('\n')] as const)
      .filter(([, lines]) => lines[0] !== HEADER)
    for (const [f, lines] of offset) {
      expect(lines[0].startsWith('#!'), `${f}: line 1 is neither the header nor a shebang`).toBe(true)
    }
  })
})
