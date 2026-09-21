// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  asset,
  assetListResponse,
  assetSyncStatus,
  assetStoreRefusedDetails,
  urdfCompleteness,
  rolePermissions,
  bridgeAssetsAvailable,
  bridgeAssetProgress,
  ERROR_CODES,
} from '../src/index.js'

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const SHA = 'a'.repeat(64)
const NOW = '2026-08-12T20:00:00.000Z'

/**
 * The asset store. These tests are about **absence** — what a shape refuses
 * to leave unsaid. Three defects shipped just before this, all one thing: an
 * omittable value guessed at downstream. The assertions target omissions,
 * not happy shapes.
 */
describe('the assets capability cannot be left unsaid', () => {
  const base = {
    role_id: UUID,
    grants: [{ robot_id: UUID, slugs: ['arm'] }],
  }

  it('refuses a role that does not state whether it grants assets', () => {
    // Required, not `.default(false)`. A pre-assets role needs deliberate
    // migration to deny-by-default — the cloud's decision to make once, not
    // the shape's to make silently on every omitted field.
    expect(
      rolePermissions.safeParse({
        ...base,
        capabilities: { action_history: false, presence: false },
      }).success,
    ).toBe(false)
  })

  it('accepts a role that states it', () => {
    expect(
      rolePermissions.safeParse({
        ...base,
        capabilities: { action_history: false, presence: false, assets: true },
      }).success,
    ).toBe(true)
  })
})

describe('an asset says what it is and where it came from', () => {
  const good = {
    id: UUID,
    robot_id: UUID,
    kind: 'mesh' as const,
    name: 'package://robot_description/meshes/base.dae',
    media_type: 'model/vnd.collada+xml',
    size_bytes: 1024,
    sha256: SHA,
    created_at: NOW,
  }

  it('accepts a mesh whose name is the unresolved package:// URI', () => {
    // Verbatim — it's the only thing a developer can match against their own
    // workspace when a sync comes back incomplete.
    expect(asset.safeParse(good).success).toBe(true)
  })

  it('refuses a content hash that is not one', () => {
    for (const bad of ['', 'not-a-hash', SHA.slice(0, 63), SHA.toUpperCase(), `${SHA}a`]) {
      expect(asset.safeParse({ ...good, sha256: bad }).success).toBe(false)
    }
  })

  it('refuses an asset with no size rather than treating absence as zero', () => {
    const { size_bytes: _omitted, ...withoutSize } = good
    expect(asset.safeParse(withoutSize).success).toBe(false)
  })
})

describe('completeness distinguishes three different unhappy answers', () => {
  it('separates "no bridge to ask" from "no URDF"', () => {
    // `null` means nobody is online to answer; `false` means the robot
    // answered and has none. Collapsing them misdirects a developer — one
    // case waits for a robot, the other fixes a launch file.
    const body = {
      assets: [],
      urdf: { present: false, mesh_count: 0, missing: [] },
      // In the FIXTURE, not the assertion: the last line claims `body`
      // without `urdf_available` is refused. Without every other required
      // field here it would fail for several reasons and pass for the wrong
      // one.
      active_sync: null,
      store: { bytes: 1_000_000_000, used_bytes: 0 },
      joint_state_slug: null,
    }
    expect(assetListResponse.safeParse({ ...body, urdf_available: null }).success).toBe(true)
    expect(assetListResponse.safeParse({ ...body, urdf_available: false }).success).toBe(true)
    expect(assetListResponse.safeParse(body).success).toBe(false)
  })

  it('requires the missing list, so "how many" can never travel without "which"', () => {
    expect(urdfCompleteness.safeParse({ present: true, mesh_count: 2 }).success).toBe(false)
    expect(
      urdfCompleteness.safeParse({ present: true, mesh_count: 2, missing: [] }).success,
    ).toBe(true)
  })
})

describe('a sync cannot report success while having dropped something', () => {
  it('requires `failed` on every progress frame', () => {
    const frame = { type: 'asset_progress', sync_id: UUID, done: 3, total: 5, state: 'running' }
    expect(bridgeAssetProgress.safeParse(frame).success).toBe(false)
    expect(bridgeAssetProgress.safeParse({ ...frame, failed: [] }).success).toBe(true)
  })

  it('keeps "never started" out of `failed` by giving a refusal its own state', () => {
    // The alternative was reporting every requested URI in `failed` when a
    // sync is refused as concurrent — collapsing "could not resolve" and
    // "never attempted" into one field. Same key, two questions: the defect
    // this package has split five times already.
    const refused = { type: 'asset_progress', sync_id: UUID, done: 0, total: 4, failed: [], state: 'refused_busy' }
    expect(bridgeAssetProgress.safeParse(refused).success).toBe(true)
    expect(bridgeAssetProgress.safeParse({ ...refused, state: 'finished' }).success).toBe(true)
    expect(bridgeAssetProgress.safeParse({ ...refused, state: 'done' }).success).toBe(false)
  })

  it('requires `failed` on the stored status too', () => {
    const status = {
      sync_id: UUID,
      robot_id: UUID,
      state: 'succeeded',
      done: 5,
      total: 5,
      reason: null,
      started_at: NOW,
      updated_at: NOW,
    }
    expect(assetSyncStatus.safeParse(status).success).toBe(false)
    expect(assetSyncStatus.safeParse({ ...status, failed: [] }).success).toBe(true)
  })
})

describe('the availability frame reports what it cannot resolve', () => {
  it('requires the mesh list even when there is no URDF', () => {
    expect(bridgeAssetsAvailable.safeParse({ type: 'assets_available', urdf: false }).success).toBe(false)
    expect(
      bridgeAssetsAvailable.safeParse({ type: 'assets_available', urdf: false, meshes: [] }).success,
    ).toBe(true)
  })
})

describe('a store refusal carries all three numbers', () => {
  it('refuses a pair where the caller needs a triple', () => {
    // Same discipline as `job_queue_full`: the store alone doesn't say how
    // full it is, and what did not fit is unreadable without both.
    expect(assetStoreRefusedDetails.safeParse({ store_bytes: 100, used_bytes: 90 }).success).toBe(false)
    expect(assetStoreRefusedDetails.safeParse({ used_bytes: 90, size_bytes: 20 }).success).toBe(false)
    expect(assetStoreRefusedDetails.safeParse({ store_bytes: 100, used_bytes: 90, size_bytes: 20 }).success).toBe(true)
  })
})

describe('the asset store declares its codes', () => {
  it('carries asset_missing and refuses an overfull store as quota_exceeded', () => {
    expect(ERROR_CODES).toContain('asset_missing')
    expect(ERROR_CODES).toContain('quota_exceeded')
    // Nothing is refused for its own size any more; there is no ceiling to hit.
    expect(ERROR_CODES).not.toContain('asset_too_large')
  })
})

describe('a sync reason is not a mesh URI', () => {
  it('keeps non-URI explanations out of `failed`', () => {
    // Three kinds of string were reaching `failed`: unresolvable package://
    // URIs, the literal `robot_description` from a failed URDF upload, and
    // English sentences from the cloud. The console labels that array "these
    // meshes could not be resolved" — so a robot that dropped mid-sync got a
    // mesh named "the robot disconnected mid-sync". `reason` is where
    // anything that is not a URI goes.
    const base = {
      sync_id: UUID, robot_id: UUID, state: 'failed', done: 0, total: 3,
      failed: [], started_at: NOW, updated_at: NOW,
    }
    expect(assetSyncStatus.safeParse(base).success).toBe(false)
    expect(assetSyncStatus.safeParse({ ...base, reason: null }).success).toBe(true)
    expect(assetSyncStatus.safeParse({ ...base, reason: 'another sync was already running' }).success).toBe(true)
    // Empty string is not a reason — an explanation nobody wrote is `null`.
    expect(assetSyncStatus.safeParse({ ...base, reason: '' }).success).toBe(false)
  })
})
