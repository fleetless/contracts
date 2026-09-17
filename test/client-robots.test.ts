// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { clientRobotListItem, clientRobotListResponse } from '../src/index.js'

const ITEM = {
  id: '4f2c1a90-7b3e-4d51-9c86-0a1b2c3d4e5f',
  name: 'rx1',
  created_at: '2026-09-17T08:00:00.000Z',
  bridge_state: { online: false, latency_ms: null },
  published_version: 3,
}

describe('clientRobotListItem', () => {
  it('accepts a listed robot with its bridge state and a published version', () => {
    expect(clientRobotListItem.parse(ITEM)).toEqual(ITEM)
  })

  it('accepts published_version null — a robot with nothing published is still listed', () => {
    expect(clientRobotListItem.parse({ ...ITEM, published_version: null }).published_version).toBeNull()
  })

  it('refuses a missing published_version — "not looked at" and "nothing published" must not read the same', () => {
    const { published_version: _omitted, ...withoutVersion } = ITEM
    expect(clientRobotListItem.safeParse(withoutVersion).success).toBe(false)
  })

  it('refuses a missing bridge_state', () => {
    const { bridge_state: _omitted, ...withoutState } = ITEM
    expect(clientRobotListItem.safeParse(withoutState).success).toBe(false)
  })
})

describe('clientRobotListResponse', () => {
  it('wraps the list under `robots`, and an empty list is a valid answer', () => {
    expect(clientRobotListResponse.parse({ robots: [] })).toEqual({ robots: [] })
    expect(clientRobotListResponse.parse({ robots: [ITEM] }).robots).toHaveLength(1)
  })
})
