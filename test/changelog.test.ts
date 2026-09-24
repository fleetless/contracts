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
 * Every section: `## [Unreleased]` and each dated heading, newest first.
 *
 * The check below asks whether **any one** of them names the current window,
 * and not whether the newest dated one does. Reading the newest section alone
 * made every release restate a window it had not touched — and a release that
 * changes nothing about the protocol has nothing true to say about it, so the
 * restatement is prose a reader has to go and verify. A bump is named where it
 * is made instead: the pull request that moves the window writes an
 * `[Unreleased]` entry, which fails here until it does, and the release turns
 * that entry into the dated section the window stays named in afterwards.
 */
function sections(changelog: string): string[] {
  const headings = [...changelog.matchAll(/^## \[.*$/gm)]
  return headings.map((h, i) => changelog.slice(h.index ?? 0, headings[i + 1]?.index ?? changelog.length))
}

/** The membership check every test below shares, so the real assertion and its own proof cannot drift apart. */
function namesTheBump(section: string, bridgeFrom: string, sunset: string): boolean {
  return section.includes(bridgeFrom) && section.includes(sunset)
}

/** Both facts in one section, never one here and one four releases down. */
function somewhereNamesTheBump(changelog: string, bridgeFrom: string, sunset: string): boolean {
  return sections(changelog).some((s) => namesTheBump(s, bridgeFrom, sunset))
}

/** The current window, or null while no bump has happened for this test to hold anyone to. */
function currentWindow(): { bridgeFrom: string; sunset: string } | null {
  const latest = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1]
  const previous = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 2]
  if (!previous) return null
  const sunset = sunsetOf(previous)
  expect(sunset).not.toBeNull()
  return { bridgeFrom: latest.bridge_from, sunset: sunset as string }
}

describe('the CHANGELOG names a protocol bump and the sunset it starts', () => {
  it('some section names the newest bridge_from and the previous version\'s sunset date', () => {
    const window = currentWindow()
    if (!window) return
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

    expect(somewhereNamesTheBump(changelog, window.bridgeFrom, window.sunset)).toBe(true)
  })

  it('would catch a window named in no section at all', () => {
    const window = currentWindow()
    if (!window) return

    // A bump nobody wrote up: the headings are real, the topics are real, and
    // neither fact the bridge maintainer needs is anywhere in the file.
    const changelog = [
      '## [Unreleased]',
      '',
      'Something unrelated changed.',
      '',
      '## [9.9.9] — 2099-01-01',
      '',
      'Something else unrelated changed.',
      '',
    ].join('\n')
    expect(somewhereNamesTheBump(changelog, window.bridgeFrom, window.sunset)).toBe(false)
  })

  it('takes the window named under [Unreleased], which is where the bump is made', () => {
    const window = currentWindow()
    if (!window) return

    // The shape of the pull request that moves the window: the entry is in
    // [Unreleased], and no dated section below it mentions the new window yet.
    const changelog = [
      '## [Unreleased]',
      '',
      `Protocol bumped: bridges from ${window.bridgeFrom}, and the version before it sunsets ${window.sunset}.`,
      '',
      '## [9.9.9] — 2099-01-01',
      '',
      'Something unrelated changed.',
      '',
    ].join('\n')
    expect(somewhereNamesTheBump(changelog, window.bridgeFrom, window.sunset)).toBe(true)
  })
})
