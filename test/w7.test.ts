import { describe, it, expect } from 'vitest'
import {
  asset,
  assetListResponse,
  assetSyncStatus,
  assetTooLargeDetails,
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
 * W7 — the asset store. These tests are mostly about **absence**: what a shape
 * refuses to leave unsaid. The wave before this one shipped three defects that
 * were all one thing — a value that could be omitted and was then guessed at
 * downstream — so the assertions here are aimed at the omissions rather than
 * at the happy shapes.
 */
describe('the assets capability cannot be left unsaid', () => {
  const base = {
    role_id: UUID,
    grants: [{ robot_id: UUID, slugs: ['arm'] }],
  }

  it('refuses a role that does not state whether it grants assets', () => {
    // Required, not `.default(false)`. A role stored before W7 must be
    // migrated deliberately — deny-by-default is the right migration, but it
    // is the cloud's decision to make once, not a shape that quietly answers
    // it every time somebody forgets the field.
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
    name: 'package://rx1_description/meshes/base.dae',
    media_type: 'model/vnd.collada+xml',
    size_bytes: 1024,
    sha256: SHA,
    created_at: NOW,
  }

  it('accepts a mesh whose name is the unresolved package:// URI', () => {
    // Verbatim, because that string is the only thing a developer can match
    // against their own workspace when a sync comes back incomplete.
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
    // `urdf_available: null` means nobody is online to answer; `false` means
    // the robot answered and has none. Collapsing them sends a developer to
    // the wrong place — one waits for a robot, the other fixes a launch file.
    const body = {
      assets: [],
      urdf: { present: false, mesh_count: 0, missing: [] },
      // W9b: in die FIXTURE, nicht in die Zusicherung. Die letzte Zeile dieses
      // Tests behauptet, `body` ohne `urdf_available` werde abgelehnt — ohne
      // `active_sync` hier würde sie aus ZWEI Gründen scheitern und damit aus
      // dem falschen bestehen. Genau diese Form ist in W7c einmal durchgerutscht.
      active_sync: null,
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
    // The alternative on the table was to report every requested URI in
    // `failed` when a sync is refused for being concurrent — which would make
    // that field mean "could not be resolved" and "was never attempted" at
    // once. Same key, two questions: the defect this project has split five
    // times already.
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

describe('a size refusal carries both numbers', () => {
  it('refuses a limit without a size and a size without a limit', () => {
    // Same discipline as `job_queue_full`: the limit alone does not say how
    // far over the caller is, and the size alone cannot be read without it.
    expect(assetTooLargeDetails.safeParse({ limit_bytes: 100 }).success).toBe(false)
    expect(assetTooLargeDetails.safeParse({ size_bytes: 200 }).success).toBe(false)
    expect(assetTooLargeDetails.safeParse({ limit_bytes: 100, size_bytes: 200 }).success).toBe(true)
  })
})

describe('the wave declares its codes', () => {
  it('carries asset_missing and asset_too_large', () => {
    expect(ERROR_CODES).toContain('asset_missing')
    expect(ERROR_CODES).toContain('asset_too_large')
  })
})

describe('a sync reason is not a mesh URI', () => {
  it('keeps non-URI explanations out of `failed`', () => {
    // Three kinds of string were reaching `failed`: unresolvable package://
    // URIs, the literal `robot_description` from a failed URDF upload, and
    // English sentences from the cloud. The console prints that array under
    // "these meshes could not be resolved", so a developer whose robot dropped
    // mid-sync was told to find a mesh named "the robot disconnected
    // mid-sync". `reason` is where anything that is not a URI goes.
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
