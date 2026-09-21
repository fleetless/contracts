// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { ROUTES, clientRobotListItem, clientRobotListResponse, mcpRobotDatasheet } from '../src/index.js'

const ITEM = {
  id: '4f2c1a90-7b3e-4d51-9c86-0a1b2c3d4e5f',
  name: 'gate-bot',
  created_at: '2026-09-17T08:00:00.000Z',
  bridge_state: { online: false, latency_ms: null, low_bandwidth: false },
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

describe('the discovery routes', () => {
  const byKey = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r]))

  it('lists GET /api/client/robots for all three caller kinds, answering the client robot list', () => {
    const r = byKey.get('GET /api/client/robots')
    expect(r).toBeDefined()
    expect(r!.auth).toBe('developer_or_client')
    expect(r!.audience).toBe('client')
    expect(r!.response).toBe(clientRobotListResponse)
    expect(r!.errors).toEqual(['unauthorized', 'token_expired', 'token_revoked', 'forbidden'])
  })

  it('lists GET /api/robots/:id/datasheet answering the very schema robot_describe answers', () => {
    const r = byKey.get('GET /api/robots/:id/datasheet')
    expect(r).toBeDefined()
    expect(r!.auth).toBe('developer_or_client')
    expect(r!.response).toBe(mcpRobotDatasheet)
    expect(r!.errors).toContain('not_found')
    expect(r!.errors).toContain('invalid_uuid')
  })
})
