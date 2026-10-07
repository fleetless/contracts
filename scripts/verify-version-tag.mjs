#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The one place the tag <-> version rule lives, adapted from `sdk`'s copy.
 *
 * Given a git tag (CI_COMMIT_TAG or argv[2]) it fails unless
 *
 *   1. package.json's version equals the tag without its leading `v`;
 *   2. CHANGELOG.md carries a dated `## [<version>]` heading for it.
 *
 * It then prints `DIST_TAG=<staging|next>` on one line so a shell can `eval` it.
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
 * **A final release goes out under `staging`, never `latest`.** `latest` is
 * what `npm i @fleetless/contracts` installs, the command the README gives
 * outsiders, and it now names what runs in production: it moves when the
 * staging generation that carries the release is promoted, in
 * fleetless/fleetless's promote.yml. The "never backwards" rule this script
 * used to hold moved to the promotion with it: a release never touches
 * `latest`, so there is nothing left here to ask the registry.
 *
 * Exit codes are distinct on purpose: 2 means "nothing to check" (no tag was
 * handed over at all, which is a caller bug), 1 means "the tag is wrong".
 */
import { readFileSync } from 'node:fs'

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
// Decided by the tag's shape alone, and that is safe now: neither answer is
// `latest`, so a backported `v1.0.1` from a maintenance branch moves nothing an
// outsider installs.
const distTag = m[3] ? 'next' : 'staging'

console.log(`DIST_TAG=${distTag}`)
