#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The one place the tag <-> version rule lives, adapted from `sdk`'s copy.
 *
 * Given a git tag (CI_COMMIT_TAG or argv[2]) it fails unless
 *
 *   1. package.json's version equals the tag without its leading `v`;
 *   2. CHANGELOG.md carries a dated `## [<version>]` heading for it;
 *   3. the dist-tag it is about to hand the publish job does not move npm's
 *      `latest` backwards.
 *
 * It then prints `DIST_TAG=<latest|next>` on one line so a shell can `eval` it.
 *
 * Why it runs FIRST in `verify` on a tag pipeline: this is the cheapest check
 * guarding a release, and the mistake it catches — tagging v1.1.0 with 1.0.0
 * still in package.json — publishes a version whose contents claim to be a
 * different one. npm will not let that be taken back.
 *
 * **(2) is here because CONTRIBUTING promises it.** "Update `CHANGELOG.md` and
 * set the new version in `package.json`. The two must agree with the tag or CI
 * refuses the release" was true of one of the two. `CHANGELOG.md` ships inside
 * the tarball, so a forgotten entry publishes a package whose newest documented
 * version is not the one installed, in `node_modules` and on the npm page, and
 * npm cannot be made to take it back. An unkept promise about a gate is worse
 * than no promise: it is the reason nobody checks by hand.
 *
 * **(3) is here because the dist-tag was derived from the tag's SHAPE alone.**
 * `latest` for anything without a pre-release suffix, passed straight to
 * `npm publish --tag`, which sets it unconditionally. Once 2.0.0 exists, a
 * backported `v1.0.1` from a maintenance branch would move `latest` to a
 * package a major behind — and `npm i @fleetless/contracts`, the command the
 * README gives outsiders, would install it.
 *
 * Exit codes are distinct on purpose: 2 means "nothing to check" (no tag was
 * handed over at all, which is a caller bug), 1 means "the tag is wrong".
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const tag = process.argv[2] ?? process.env.CI_COMMIT_TAG
if (!tag) { console.error('verify-version-tag: no tag (argv[2] or CI_COMMIT_TAG)'); process.exit(2) }
const m = /^v(\d+\.\d+\.\d+)(-([0-9A-Za-z.]+))?$/.exec(tag)
if (!m) { console.error(`verify-version-tag: "${tag}" is not vX.Y.Z or vX.Y.Z-<pre>`); process.exit(1) }
const version = m[1] + (m[2] ?? '')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.version !== version) { console.error(`verify-version-tag: tag ${tag} names ${version} but package.json says ${pkg.version}`); process.exit(1) }

// ------------------------------------------------------------- the changelog
//
// A dated heading, not merely the version string somewhere in the file: the
// version already appears in prose in this changelog, so a substring search
// would pass on a paragraph that mentions it. Keep a Changelog's own shape is
// `## [1.0.1] — 2026-09-07` (or `-`), and the date is asserted because an
// undated heading is the shape of an `## [Unreleased]` section renamed in
// haste.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^## \\[${escaped}\\]\\s*[—-]\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm')
const dated = heading.exec(changelog)
if (!dated) {
  console.error(`verify-version-tag: CHANGELOG.md has no dated heading for ${version}.`)
  console.error(`  expected a line reading exactly:  ## [${version}] — YYYY-MM-DD`)
  console.error('  CHANGELOG.md ships inside the tarball; publishing without the entry documents the wrong version to every consumer, and npm will not take a version back.')
  const headings = changelog.split('\n').filter((l) => l.startsWith('## ')).slice(0, 3)
  if (headings.length) console.error(`  the newest headings are: ${headings.join(' | ')}`)
  process.exit(1)
}
console.error(`verify-version-tag: CHANGELOG.md documents ${version}, dated ${dated[1]}`)

// --------------------------------------------------------------- the dist-tag
const distTag = m[3] ? 'next' : 'latest'

if (distTag === 'latest') {
  // Ask the registry what `latest` is now. A publish with `--tag latest` sets
  // it unconditionally, so this is the only moment the move can be refused.
  //
  // `npm view` failing is NOT treated as "go ahead": a network error and an
  // unpublished package look the same from here, and only one of them is safe
  // to proceed on. The two are told apart by the error npm gives — E404 means
  // the package does not exist yet, which is the genuine first-publish case.
  let current = null
  try {
    current = execFileSync('npm', ['view', `${pkg.name}@latest`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    const text = `${err.stderr ?? ''}${err.stdout ?? ''}`
    if (/E404|is not in this registry|404 Not Found/.test(text)) {
      console.error(`verify-version-tag: ${pkg.name} has no published version yet; ${version} will be the first \`latest\`.`)
    } else {
      console.error(`verify-version-tag: could not read the current \`latest\` from the registry, and this check cannot tell a network failure from an unpublished package.`)
      console.error(`  ${text.trim().split('\n').slice(0, 4).join('\n  ')}`)
      process.exit(1)
    }
  }
  if (current && cmpSemver(version, current) < 0) {
    console.error(`verify-version-tag: publishing ${version} with --tag latest would move \`latest\` BACKWARDS from ${current}.`)
    console.error('  `npm i @fleetless/contracts` is the command the README gives outsiders; it would start installing the older package.')
    console.error(`  Release a maintenance version under its own dist-tag instead, or tag a version above ${current}.`)
    process.exit(1)
  }
  if (current) console.error(`verify-version-tag: \`latest\` is ${current}; ${version} moves it forward.`)
}

console.log(`DIST_TAG=${distTag}`)

/** -1, 0 or 1. Release-only comparison; a pre-release never reaches here. */
function cmpSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  // Equal releases: a pre-release sorts below its release, but this branch is
  // `latest` only, so equality means the same version — which npm refuses to
  // republish anyway. Not a backwards move.
  return 0
}
