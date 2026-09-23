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
 * The newest **dated** heading — never `## [Unreleased]`. The release
 * leaves that heading open between releases, and an ordinary feature pull
 * request fills it with whatever it changed, which is almost never a
 * protocol bump; reading it here would fail the first such pull request
 * after every release for "not restating a bump nobody made". The release
 * PR is what turns `[Unreleased]` into a dated heading and sets the version
 * — its own `verify` run checks THIS function against the tree it is about
 * to merge, so the dated section is exactly what the check needs to be
 * looking at by the time a bump ships.
 */
function topDatedSection(changelog: string): string {
  const headings = [...changelog.matchAll(/^## \[.*$/gm)]
  const i = headings.findIndex((h) => h[0] !== '## [Unreleased]')
  if (i === -1) return ''
  const start = headings[i].index ?? changelog.length
  const end = headings[i + 1]?.index ?? changelog.length
  return changelog.slice(start, end)
}

/** The membership check both tests below share, so the real assertion and its own proof cannot drift apart. */
function namesTheBump(section: string, bridgeFrom: string, sunset: string): boolean {
  return section.includes(bridgeFrom) && section.includes(sunset)
}

describe('the CHANGELOG names a protocol bump and the sunset it starts', () => {
  it('the newest dated section mentions the newest bridge_from and the previous version\'s sunset date', () => {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    const section = topDatedSection(changelog)

    const latest = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
    const previous = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 2]
    // Nothing to enforce on a window with a single entry — no bump has
    // happened yet for this test to hold anyone to.
    if (!previous) return

    const sunset = sunsetOf(previous)
    expect(sunset).not.toBeNull()

    expect(namesTheBump(section, latest.bridge_from, sunset as string)).toBe(true)
  })

  it('would catch a dated section that renamed [Unreleased] without carrying the bump', () => {
    const latest = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
    const previous = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 2]
    if (!previous) return
    const sunset = sunsetOf(previous)
    expect(sunset).not.toBeNull()

    // A release PR that forgot to say why: the heading is dated, the topic is
    // real, and neither fact the bridge maintainer needs is in it.
    const changelog = [
      '## [Unreleased]',
      '',
      '## [9.9.9] — 2099-01-01',
      '',
      'Something unrelated changed.',
      '',
    ].join('\n')
    const section = topDatedSection(changelog)
    expect(section).toContain('9.9.9')
    expect(namesTheBump(section, latest.bridge_from, sunset as string)).toBe(false)
  })
})
