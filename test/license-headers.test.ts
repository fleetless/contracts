// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every source file here opens with the SPDX header. Published to npm
 * under Apache-2.0 — without it, a downstream reader has to infer the licence.
 *
 * What makes this test fail: delete the header from any one file under any
 * source directory. Verified by doing exactly that — the run named the file.
 * What ALSO makes it fail, and is the harder half: the sweep finding fewer
 * files than the repository has. A guard over a set that silently walks an
 * empty directory is the failure mode this package has hit most often, so the
 * count is asserted twice — against a floor, and against the real listing.
 *
 * **The file set comes from `git ls-files`, not from a list of directories.** A
 * named list (`src`, `scripts`, `test`) is a requirement about a set guarded by
 * three examples: a `bin/`, a `tools/`, or a `.ts` at the repository root is
 * invisible to it and carries whatever header somebody copied.
 *
 * Walking the filesystem instead is the obvious repair, and wrong the other
 * way — it sweeps whatever is lying in the working directory. Written that
 * way first, this test failed CI on `dist-tag.env`, a file the pipeline
 * writes into the checkout before the suite runs: a guard about the tracked
 * tree, answering about a job's scratch. Git's own answer to "what is a file
 * of this package" is the index, so that is what is asked.
 *
 * The published half of this rule is not here: `dist/` is what a consumer
 * receives, `tsc` drops the header from declaration emit, and
 * `scripts/stamp-dist.mjs` puts it back. `scripts/verify-pack.mjs` asserts it
 * over the tarball's own bytes, which is the only place that can.
 */

const HEADER = '// SPDX-License-Identifier: Apache-2.0'
const ROOT = new URL('..', import.meta.url).pathname

/**
 * Tracked but generated: `artifacts/` is committed JSON produced by
 * `scripts/export-schemas.ts`, and `dist/` is emitted (and stamped by
 * `scripts/stamp-dist.mjs`, asserted in `scripts/verify-pack.mjs`). Neither is
 * a source file somebody writes a header into.
 */
const GENERATED = ['artifacts/', 'dist/']

/** Extensions that carry `//` comments and therefore must carry the header. */
const SOURCE = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']

/**
 * Extensions and names that are NOT source. Kept as literal lists rather than
 * as a catch-all: a file type nobody has classified lands in `unclassified`
 * below and fails, which is the moment somebody asks whether it should have
 * been source instead.
 */
const NOT_SOURCE_EXT = ['.md', '.json', '.yaml', '.yml', '.txt']
const NOT_SOURCE_NAME = new Set(['LICENSE', 'NOTICE', '.gitignore'])

/**
 * Git's own answer to "what is a file of this package": the index. It excludes `node_modules/`, every build output and anything a CI job
 * drops into the checkout, without this test having to enumerate those.
 *
 * `-z` and a NUL split: git escapes a path with a space or a quote in its
 * default output, and a naive newline split would mangle it — silently
 * dropping exactly the file whose name was unusual.
 */
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const all = tracked.filter((f) => !GENERATED.some((d) => f.startsWith(d)))
const sources = all.filter((f) => SOURCE.some((ext) => f.endsWith(ext)))

describe('SPDX headers', () => {
  it('sweeps every file in src/, scripts/ and test/ — no file is silently skipped', () => {
    // The set assertion, not an example: every entry the walk found is either
    // source (and therefore header-checked below) or exempt by name. A `.py`,
    // a `.tsx` or a `.yaml` dropped into `src/` fails here rather than passing
    // unnoticed because the extension list did not know about it.
    const unclassified = all.filter(
      (f) =>
        !sources.includes(f) &&
        !NOT_SOURCE_EXT.some((ext) => f.endsWith(ext)) &&
        !NOT_SOURCE_NAME.has(f.split('/').pop()!),
    )
    expect(unclassified).toEqual([])
  })

  it('finds the repository\'s source files, not an empty listing', () => {
    // Anti-vacuity. `src/` alone has 20 files and `test/` has 38; a listing
    // that returns 3, or 0 — a `git ls-files` that failed, a `cwd` pointing
    // somewhere else — has stopped measuring what this test is named for and
    // every assertion below it becomes free.
    expect(tracked.length).toBeGreaterThan(60)
    expect(sources.length).toBeGreaterThan(40)
    for (const dir of ['src', 'scripts', 'test']) {
      expect(
        sources.filter((f) => f.startsWith(`${dir}/`)).length,
        `no source files found under ${dir}/`,
      ).toBeGreaterThan(0)
    }
  })

  it('sweeps the whole repository, not three named directories', () => {
    // The point of taking the set from git: a source file OUTSIDE src/,
    // scripts/ and test/ is swept without anybody editing this file. Asserted
    // by construction — every tracked, non-generated source path is in
    // `sources`, whatever directory it sits in.
    const outside = sources.filter((f) => !/^(src|scripts|test)\//.test(f))
    for (const f of outside) expect(sources).toContain(f)
    // And the generated trees, which ARE tracked, are the only exclusions.
    expect(tracked.some((f) => f.startsWith('artifacts/'))).toBe(true)
    expect(all.some((f) => f.startsWith('artifacts/'))).toBe(false)
  })

  it('every source file opens with the SPDX header', () => {
    // Collected, not asserted one by one inside the loop: the failure message
    // then names every offender at once instead of only the first, which is
    // what somebody adding six files needs to read.
    //
    // A `#!` line — and ONLY a `#!` line — may precede the header: a shebang
    // has to be byte zero or the kernel won't see it. Deliberately narrow: any
    // other first line is a violation, not a general "somewhere near the top"
    // rule a stray comment could satisfy.
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
