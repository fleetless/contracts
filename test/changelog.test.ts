// SPDX-License-Identifier: Apache-2.0
/**
 * The one upkeep test `protocol.ts:44-46` used to claim already existed: a
 * protocol bump is worthless to a bridge maintainer who reads the CHANGELOG
 * and finds neither the new bridge floor nor the date the old version stops
 * being served. `scripts/verify-version-tag.mjs` only checks that a dated
 * heading exists for the tagged version — nothing reads its *contents*.
 * This does.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROTOCOL_VERSIONS, sunsetOf } from '../src/index.js'

/**
 * The section a reader lands on for "what changed lately": `[Unreleased]`
 * while one is open, or the topmost dated heading once a release folded it
 * away — Keep a Changelog always keeps the newest section first.
 */
function topSection(changelog: string): string {
  const headings = [...changelog.matchAll(/^## \[.*$/gm)]
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
