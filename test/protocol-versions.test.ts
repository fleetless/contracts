// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  PROTOCOL_SUNSET_DAYS,
  LATEST_BRIDGE_VERSION,
  protocolStatus,
  minimumProtocolVersion,
  sunsetOf,
} from '../src/index.js'
import { statusFromTable } from '../src/protocol.js'

const SEMVER = /^\d+\.\d+\.\d+$/

describe('the protocol versions table', () => {
  it('has exactly one current entry and it is PROTOCOL_VERSION', () => {
    const current = PROTOCOL_VERSIONS.filter((entry) => entry.deprecated_at === null)
    expect(current).toHaveLength(1)
    expect(current[0]!.version).toBe(PROTOCOL_VERSION)
  })

  it('is strictly increasing and every superseded entry carries a date', () => {
    for (let i = 1; i < PROTOCOL_VERSIONS.length; i++) {
      expect(PROTOCOL_VERSIONS[i]!.version).toBeGreaterThan(PROTOCOL_VERSIONS[i - 1]!.version)
      expect(PROTOCOL_VERSIONS[i - 1]!.deprecated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('names a semver bridge_from per entry and a latest bridge at or above them all', () => {
    expect(LATEST_BRIDGE_VERSION).toMatch(SEMVER)
    for (const entry of PROTOCOL_VERSIONS) {
      expect(entry.bridge_from).toMatch(SEMVER)
      expect(compare(LATEST_BRIDGE_VERSION, entry.bridge_from)).toBeGreaterThanOrEqual(0)
    }
  })

  it('sunsets 90 days after deprecation', () => {
    expect(PROTOCOL_SUNSET_DAYS).toBe(90)
    expect(sunsetOf({ version: 1, bridge_from: '1.0.0', deprecated_at: '2026-01-01' })).toBe('2026-04-01')
    expect(sunsetOf({ version: 1, bridge_from: '1.0.0', deprecated_at: null })).toBeNull()
  })
})

describe('protocolStatus', () => {
  const today = new Date('2026-09-21T12:00:00Z')

  it('calls the current version current with no sunset', () => {
    expect(protocolStatus(PROTOCOL_VERSION, today)).toEqual({ status: 'current', sunset_at: null })
  })

  it('calls an unknown or newer version unsupported', () => {
    expect(protocolStatus(PROTOCOL_VERSION + 1, today).status).toBe('unsupported')
    expect(protocolStatus(0, today).status).toBe('unsupported')
  })

  it('minimumProtocolVersion is the lowest version still inside its window', () => {
    expect(minimumProtocolVersion(today)).toBe(PROTOCOL_VERSIONS[0]!.version)
  })
})

function compare(a: string, b: string): number {
  const [a1, a2, a3] = a.split('.').map(Number) as [number, number, number]
  const [b1, b2, b3] = b.split('.').map(Number) as [number, number, number]
  return a1 - b1 || a2 - b2 || a3 - b3
}

describe('statusFromTable at the boundaries', () => {
  const table = [
    { version: 1, bridge_from: '1.0.0', deprecated_at: '2026-06-01' },
    { version: 2, bridge_from: '3.0.0', deprecated_at: null },
  ]
  it('is deprecated the day before sunset and unsupported on the sunset day', () => {
    expect(statusFromTable(table, 1, new Date('2026-08-29T23:59:59Z'))).toEqual({ status: 'deprecated', sunset_at: '2026-08-30' })
    expect(statusFromTable(table, 1, new Date('2026-08-30T00:00:00Z'))).toEqual({ status: 'unsupported', sunset_at: '2026-08-30' })
  })
})
