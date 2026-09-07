// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'

import { ASSET_UPLOAD_HEADERS } from '../src/rest.js'
import { ASSET_UPLOAD_MAX_BYTES, assetListResponse, assetSyncBusyDetails, assetSyncStatus, assetFailure, assetFailureKind, urdfCompleteness } from '../src/assets.js'

const runningSync = {
  sync_id: '33333333-3333-4333-8333-333333333333',
  robot_id: '11111111-1111-4111-8111-111111111111',
  state: 'running' as const,
  done: 3,
  total: 10,
  failed: [],
  reason: null,
  started_at: '2026-08-19T10:00:00.000Z',
  updated_at: '2026-08-19T10:00:03.000Z',
}

describe('the upload ceiling both sides read', () => {
  it('is one number in the contract, not two in two repositories', () => {
    // A limit the sender guesses and the receiver enforces is not a limit; it
    // is two numbers that agree until one of them changes.
    expect(ASSET_UPLOAD_MAX_BYTES).toBe(64 * 1024 * 1024)
    expect(Number.isInteger(ASSET_UPLOAD_MAX_BYTES)).toBe(true)
  })

  it('is a per-file ceiling a real robot description can exceed', () => {
    // A single mesh can be several times this number, and another mesh in the
    // same description can sit comfortably under it. The ceiling is per file,
    // so one oversized mesh does not stop the rest of a sync.
    expect(193_886_766).toBeGreaterThan(ASSET_UPLOAD_MAX_BYTES)
    expect(39_525_034).toBeLessThan(ASSET_UPLOAD_MAX_BYTES)
  })

  it('announces the size in its own header, so the refusal can precede the body', () => {
    // A server-side body limit is applied by the content-type parser, before
    // the handler runs, so a structured refusal would have no producer.
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
    const body = { assets: [], urdf: { present: false, mesh_count: 0, missing: [] }, urdf_available: null }
    expect(assetListResponse.safeParse({ ...body, active_sync: assetSyncStatus.parse(runningSync) }).success).toBe(true)
    expect(assetListResponse.safeParse({ ...body, active_sync: null }).success).toBe(true)
    // Required, with no default: a server that says nothing would be
    // indistinguishable from one saying no sync is running.
    expect(assetListResponse.safeParse(body).success).toBe(false)
  })
})

describe('the ceiling reaches the side that cannot read npm', () => {
  it('is in the artifact, not only in the TypeScript export', async () => {
    // The robot-side bridge cannot import this package. It reads
    // `artifacts/constants.json` and nothing else, so a constant exported only
    // to TypeScript consumers is a limit one side cannot read — which is two
    // numbers again.
    const { readFileSync } = await import('node:fs')
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/constants.json', import.meta.url), 'utf8'))
    expect(artifact.ASSET_UPLOAD_MAX_BYTES).toBe(ASSET_UPLOAD_MAX_BYTES)
  })
})

describe('a refusal that says how big, and how big it was allowed to be', () => {
  const at = (kind: string, details?: unknown) => assetFailure.safeParse({ reference: 'package://p/base.dae', kind, details })

  it('is its own kind, because `refused` already carries the collective sentinel', () => {
    // Filing both under `refused` would put two facts on one key, each
    // overwriting the other.
    expect(assetFailureKind.options).toContain('too_large')
    expect(assetFailureKind.options).toContain('refused')
  })

  it('cannot be published without the two numbers a developer would act on', () => {
    expect(at('too_large').success).toBe(false)
    expect(at('too_large', null).success).toBe(false)
    expect(at('too_large', { limit_bytes: ASSET_UPLOAD_MAX_BYTES, size_bytes: 193_886_766 }).success).toBe(true)
  })

  it('refuses size details on a kind they do not describe', () => {
    expect(at('unresolvable', { limit_bytes: 1, size_bytes: 2 }).success).toBe(false)
    expect(at('unresolvable').success).toBe(true)
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
