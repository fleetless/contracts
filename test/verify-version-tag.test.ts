// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `scripts/verify-version-tag.mjs` decides the dist-tag a release is
 * published under, and `publish` hands its answer straight to
 * `npm publish --tag`. A final release goes out under `staging`, never
 * `latest`: `latest` moves only when the release is promoted to production
 * (fleetless/fleetless promote.yml). Nothing but this file would notice the
 * script answering `latest` again — the workflow would publish it, and npm
 * does not take a dist-tag move back on its own.
 *
 * The script reads `package.json` and `CHANGELOG.md` beside its own
 * directory, so each case runs a copy of it in a temporary package. `npm` on
 * `PATH` is a stub that records every call and fails: a release must not ask
 * the registry about `latest` at all, and a stub that answered would hide a
 * call instead of showing it.
 */

const SCRIPT = new URL('../scripts/verify-version-tag.mjs', import.meta.url).pathname

interface Run {
  status: number
  stdout: string
  stderr: string
  npmCalls: string[]
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(tag: string | null, pkgVersion: string, changelog: string): Run {
  const dir = mkdtempSync(join(tmpdir(), 'verify-version-tag-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'bin'))
  copyFileSync(SCRIPT, join(dir, 'scripts', 'verify-version-tag.mjs'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@fleetless/contracts', version: pkgVersion, type: 'module' }))
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog)
  const npmLog = join(dir, 'npm-calls.log')
  writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/sh\necho "$*" >> "${npmLog}"\nexit 1\n`)
  chmodSync(join(dir, 'bin', 'npm'), 0o755)

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH ?? ''}` }
  delete env.CI_COMMIT_TAG
  const child = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-version-tag.mjs'), ...(tag === null ? [] : [tag])], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const npmCalls = existsSync(npmLog) ? readFileSync(npmLog, 'utf8').split('\n').filter(Boolean) : []
  return { status: child.status ?? -1, stdout: child.stdout, stderr: child.stderr, npmCalls }
}

const changelogFor = (version: string) => `# Changelog\n\n## [Unreleased]\n\n## [${version}] — 2026-10-07\n\n### Changed\n\n- Something.\n`

describe('verify-version-tag picks the dist-tag of a release', () => {
  it('a final release goes out under `staging`, and the registry is not asked about `latest`', () => {
    const r = run('v6.4.0', '6.4.0', changelogFor('6.4.0'))

    expect(r.stderr).toContain('CHANGELOG.md documents 6.4.0')
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('DIST_TAG=staging\n')
    expect(r.npmCalls).toEqual([])
  })

  it('a final release below the newest one still goes out under `staging`: a release never touches `latest`', () => {
    const r = run('v1.0.1', '1.0.1', changelogFor('1.0.1'))

    expect(r.status).toBe(0)
    expect(r.stdout).toBe('DIST_TAG=staging\n')
    expect(r.npmCalls).toEqual([])
  })

  it('a pre-release tag goes out under `next`', () => {
    const r = run('v6.4.0-next.1', '6.4.0-next.1', changelogFor('6.4.0-next.1'))

    expect(r.status).toBe(0)
    expect(r.stdout).toBe('DIST_TAG=next\n')
    expect(r.npmCalls).toEqual([])
  })

  it('no output ever names `latest` as the dist-tag', () => {
    for (const [tag, version] of [['v6.4.0', '6.4.0'], ['v6.4.0-next.1', '6.4.0-next.1']]) {
      expect(run(tag, version, changelogFor(version)).stdout).not.toContain('latest')
    }
  })
})

describe('verify-version-tag refuses a tag that does not match the tree', () => {
  it('a tag naming another version than package.json exits 1 and prints no dist-tag', () => {
    const r = run('v6.4.0', '6.3.0', changelogFor('6.4.0'))

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('tag v6.4.0 names 6.4.0 but package.json says 6.3.0')
    expect(r.stdout).toBe('')
  })

  it('a version without a dated changelog heading exits 1 and prints no dist-tag', () => {
    const r = run('v6.4.0', '6.4.0', changelogFor('6.3.0'))

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('CHANGELOG.md has no dated heading for 6.4.0')
    expect(r.stdout).toBe('')
  })

  it('an undated heading is not a release heading', () => {
    const r = run('v6.4.0', '6.4.0', '# Changelog\n\n## [6.4.0]\n\n- Something.\n')

    expect(r.status).toBe(1)
    expect(r.stdout).toBe('')
  })

  it('a tag that is not vX.Y.Z exits 1', () => {
    const r = run('6.4.0', '6.4.0', changelogFor('6.4.0'))

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is not vX.Y.Z')
    expect(r.stdout).toBe('')
  })

  it('no tag at all exits 2: a caller bug, not a wrong tag', () => {
    const r = run(null, '6.4.0', changelogFor('6.4.0'))

    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
})
