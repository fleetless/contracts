// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ASSET_UPLOAD_HEADERS, orgQuotas } from '../src/rest.js'
import { ERROR_CODES } from '../src/errors.js'
import {
  ROBOT_ASSET_STORE_BYTES,
  assetFailure,
  assetFailureKind,
  assetKind,
  assetListResponse,
  assetStoreRefusedDetails,
  assetSyncBusyDetails,
  assetSyncStatus,
  urdfCompleteness,
} from '../src/assets.js'

const runningSync = {
  sync_id: '33333333-3333-4333-8333-333333333333',
  robot_id: '11111111-1111-4111-8111-111111111111',
  state: 'running' as const,
  done: 3,
  total: 10,
  failed: [],
  reason: null,
  stored: 3,
  announced: 10,
  started_at: '2026-08-19T10:00:00.000Z',
  updated_at: '2026-08-19T10:00:03.000Z',
}

const listBase = {
  assets: [],
  active_sync: null,
  urdf: { present: false, mesh_count: 0, missing: [] },
  urdf_available: null,
}

describe('assets after the per-robot store', () => {
  it('knows three kinds and three failure kinds', () => {
    // `other` never reached the wire and `too_large` has no producer left:
    // nothing is refused for its own size any more, only for the store.
    expect(assetKind.options).toEqual(['urdf', 'mesh', 'texture'])
    expect(assetFailureKind.options).toEqual(['unresolvable', 'upload_failed', 'refused'])
  })

  it('the store is one gigabyte per robot and a refusal names all three numbers', () => {
    // Two numbers say how full it is; the third says what did not fit. A
    // caller missing any of them cannot tell whether to shrink or to delete.
    expect(ROBOT_ASSET_STORE_BYTES).toBe(1_000_000_000)
    expect(assetStoreRefusedDetails.safeParse({ store_bytes: 1_000_000_000, used_bytes: 999_000_000, size_bytes: 2_000_000 }).success).toBe(true)
    expect(assetStoreRefusedDetails.safeParse({ store_bytes: 1_000_000_000, used_bytes: 0 }).success).toBe(false)
  })

  it('asset_too_large is no error code and max_asset_storage_bytes no quota', () => {
    // A code with no producer is a refusal a consumer still has to branch on.
    expect(ERROR_CODES).not.toContain('asset_too_large')
    expect(Object.keys(orgQuotas.shape)).not.toContain('max_asset_storage_bytes')
  })

  it('the list response carries the store and the joint-state slug', () => {
    expect(assetListResponse.safeParse({ ...listBase, store: { bytes: 1_000_000_000, used_bytes: 0 }, joint_state_slug: null }).success).toBe(true)
    expect(assetListResponse.safeParse({ ...listBase, store: { bytes: 1_000_000_000, used_bytes: 0 }, joint_state_slug: 'joints' }).success).toBe(true)
    // Required, both of them: a server that says nothing about the store is
    // indistinguishable from one reporting an empty store.
    expect(assetListResponse.safeParse(listBase).success).toBe(false)
  })

  it('constants.json follows, because the bridge reads only that', () => {
    const c = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(c.ASSET_UPLOAD_MAX_BYTES).toBeUndefined()
    expect(c.ROBOT_ASSET_STORE_BYTES).toBe(ROBOT_ASSET_STORE_BYTES)
    expect(c.ASSET_KINDS).toEqual(['urdf', 'mesh', 'texture'])
  })
})

describe('a failure entry after the ceiling went', () => {
  const at = (kind: string, details?: unknown) => assetFailure.safeParse({ reference: 'package://p/base.dae', kind, details })
  const full = { store_bytes: ROBOT_ASSET_STORE_BYTES, used_bytes: 999_000_000, size_bytes: 2_000_000 }

  it('takes the three kinds and nothing else', () => {
    expect(at('unresolvable').success).toBe(true)
    expect(at('upload_failed').success).toBe(true)
    expect(at('refused').success).toBe(true)
    expect(at('too_large').success).toBe(false)
  })

  it('lets `refused` carry the store numbers, and lets it carry none', () => {
    // Both halves of the kind are real: a file the store had no room for,
    // and the one collective entry a producer emits at its own ceiling. The
    // second has no store numbers to give, so details cannot be required.
    expect(at('refused', full).success).toBe(true)
    expect(at('refused').success).toBe(true)
  })

  it('refuses store numbers on a kind they do not describe', () => {
    expect(at('unresolvable', full).success).toBe(false)
    expect(at('upload_failed', full).success).toBe(false)
  })
})

describe('the upload still announces its size', () => {
  it('names the size header, so the store check precedes the body', () => {
    // The check moved from a per-file ceiling to the robot's store; it still
    // has to happen before a byte is buffered, so the header stays.
    expect(ASSET_UPLOAD_HEADERS.size).toBe('x-fleetless-asset-size')
    expect(new Set(Object.values(ASSET_UPLOAD_HEADERS)).size).toBe(Object.values(ASSET_UPLOAD_HEADERS).length)
  })
})

describe('a running sync is addressable', () => {
  it('the busy refusal names the sync, not only the state', () => {
    // The same rule one layer on: a cancel names its job, a release names its
    // session, and a busy refusal names its sync.
    const d = { sync_id: runningSync.sync_id, started_at_ms: 1787130000000 }
    expect(assetSyncBusyDetails.safeParse(d).success).toBe(true)
    const { sync_id: _dropped, ...withoutId } = d
    expect(assetSyncBusyDetails.safeParse(withoutId).success).toBe(false)
  })

  it('the asset list carries the running sync — the case a reload creates', () => {
    // A page that loads fresh presses no button; it asks this list. The busy
    // details alone are therefore not enough.
    const body = { ...listBase, store: { bytes: ROBOT_ASSET_STORE_BYTES, used_bytes: 0 }, joint_state_slug: null }
    expect(assetListResponse.safeParse({ ...body, active_sync: assetSyncStatus.parse(runningSync) }).success).toBe(true)
    expect(assetListResponse.safeParse({ ...body, active_sync: null }).success).toBe(true)
    // Required, with no default: a server that says nothing would be
    // indistinguishable from one saying no sync is running.
    const { active_sync: _gone, ...withoutSync } = body
    expect(assetListResponse.safeParse(withoutSync).success).toBe(false)
  })
})

describe('missing names what is missing AND of what', () => {
  const uc = (missing: unknown) => urdfCompleteness.safeParse({ present: true, mesh_count: 3, missing })

  it('refuses the bare string list a client would have to guess from', () => {
    expect(uc(['package://p/wheel.stl']).success).toBe(false)
  })

  it('carries the element the producer already knows', () => {
    const ok = uc([
      { uri: 'package://p/wheel.stl', element: 'mesh' },
      { uri: 'package://p/wheel.png', element: 'texture' },
    ])
    expect(ok.success).toBe(true)
    // `mesh_count` beside it counts meshes; this subset is what may contradict it.
    expect(ok.success && ok.data.missing.filter((m) => m.element === 'mesh')).toHaveLength(1)
  })

  it('refuses an element nobody defined', () => {
    expect(uc([{ uri: 'x', element: 'collision' }]).success).toBe(false)
  })
})

describe('the kind describes itself to whoever reads the schema', () => {
  it('names the three it has and no fourth, in the bytes an integrator gets', () => {
    // A description outliving the value it describes is worse than none: it
    // is published, hovered in an editor, and read as the contract. This one
    // said "or `other`" for a whole commit after the value went.
    const published = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'schema', 'asset.schema.json'), 'utf8'))
    const kind = published.properties.kind
    expect(kind.enum).toEqual([...assetKind.options])
    for (const k of assetKind.options) expect(kind.description, `the description omits ${k}`).toContain(`\`${k}\``)
    expect(kind.description).not.toContain('`other`')
  })
})
