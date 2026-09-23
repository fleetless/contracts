// SPDX-License-Identifier: Apache-2.0
/**
 * The upkeep test `protocol.ts:44-46` names: a protocol bump is worthless to
 * a bridge maintainer who reads the CHANGELOG and finds neither the new
 * bridge floor nor the date the old version stops being served.
 * `scripts/verify-version-tag.mjs` only checks that a dated heading exists
 * for the tagged version — nothing reads its *contents*. This does.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROTOCOL_VERSIONS, sunsetOf } from '../src/index.js'

/**
 * The section a reader lands on for "what changed lately": `[Unreleased]`
 * while one is open, or the topmost dated heading once a release folded it
 * away — Keep a Changelog always keeps the newest section first.
 *
 * The release leaves `## [Unreleased]` behind empty, waiting for the next
 * pull request that changes something — that placeholder is not a section
 * with anything to report, so it is skipped in favour of the newest heading
 * that actually has a body.
 */
function topSection(changelog: string): string {
  const headings = [...changelog.matchAll(/^## \[.*$/gm)]
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index ?? changelog.length
    const end = headings[i + 1]?.index ?? changelog.length
    const section = changelog.slice(start, end)
    if (section.slice(section.indexOf('\n') + 1).trim()) return section
  }
  const start = headings[0]?.index ?? changelog.length
  const end = headings[1]?.index ?? changelog.length
  return changelog.slice(start, end)
}

describe('the CHANGELOG names a protocol bump and the sunset it starts', () => {
  it('the current section mentions the newest bridge_from and the previous version\'s sunset date', () => {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    const section = topSection(changelog)

    const latest = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
    const previous = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 2]
    // Nothing to enforce on a window with a single entry — no bump has
    // happened yet for this test to hold anyone to.
    if (!previous) return

    const sunset = sunsetOf(previous)
    expect(sunset).not.toBeNull()

    expect(section).toContain(latest.bridge_from)
    expect(section).toContain(sunset as string)
  })
})
