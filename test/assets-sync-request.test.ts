import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assetKind, assetSyncRequest, assetSyncStatus, createAppRequest, ASSET_UPLOAD_HEADERS, URDF_ASSET_NAME } from '../src/index.js'

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const NOW = '2026-08-17T00:00:00.000Z'
import { exportedConstants } from '../scripts/export-schemas.js'

/**
 * The sync request. What it adds to the contracts is small; what it has to
 * stop happening is not.
 */
describe('assetKind carries textures', () => {
  it('accepts `texture` and still refuses an invented kind', () => {
    expect(assetKind.safeParse('texture').success).toBe(true)
    expect(assetKind.safeParse('material').success).toBe(false)
  })
})

describe('assetSyncRequest has a consumer, and therefore a shape that bites', () => {
  it('refuses a source that does not exist rather than silently syncing', () => {
    expect(assetSyncRequest.safeParse({ source: 'bridge' }).success).toBe(true)
    // The zip path is in the register with a condition, not in this enum.
    expect(assetSyncRequest.safeParse({ source: 'upload' }).success).toBe(false)
  })

  it('refuses an unknown key instead of stripping it', () => {
    // The route once read no body at all, so `{nonsense:1}` and `{}`
    // behaved exactly like a well-formed request. A plain object would strip
    // the key and answer 200 — which is the same silence with a schema in
    // front of it.
    expect(assetSyncRequest.safeParse({ source: 'bridge', nonsense: 1 }).success).toBe(false)
    expect(assetSyncRequest.safeParse({}).success).toBe(false)
  })
})

describe('constants the bridge cannot import', () => {
  it('publishes them as an artifact that matches the source (staleness guard)', () => {
    const onDisk = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'),
    )
    expect(onDisk).toEqual(exportedConstants)
  })

  it('carries exactly the strings the bridge had hand-copied', () => {
    // The point of the artifact is that these values stop existing twice. If
    // this test is ever the thing that goes red, the bridge's vendored copy is
    // what has to move — not this expectation.
    expect(exportedConstants.ASSET_UPLOAD_HEADERS).toEqual(ASSET_UPLOAD_HEADERS)
    expect(exportedConstants.URDF_ASSET_NAME).toBe(URDF_ASSET_NAME)
    expect(ASSET_UPLOAD_HEADERS.kind).toBe('x-fleetless-asset-kind')
    expect(ASSET_UPLOAD_HEADERS.name).toBe('x-fleetless-asset-name')
    expect(ASSET_UPLOAD_HEADERS.syncId).toBe('x-fleetless-sync-id')
    expect(URDF_ASSET_NAME).toBe('robot_description')
  })
})

describe('creating an app with robots', () => {
  it('accepts `robot_ids` instead of dropping it in silence', () => {
    const base = { name: 'Ops', identifier: 'ops' }
    expect(createAppRequest.safeParse(base).success).toBe(true)
    const withRobots = createAppRequest.safeParse({ ...base, robot_ids: [UUID] })
    expect(withRobots.success).toBe(true)
    // The point of the change: the value survives parsing. This used to
    // read `undefined`, and the caller got a 201 with an empty app.
    expect(withRobots.success && withRobots.data.robot_ids).toEqual([UUID])
  })

  it('refuses a key nobody defined rather than stripping it', () => {
    expect(createAppRequest.safeParse({ name: 'Ops', identifier: 'ops', robotIds: [UUID] }).success).toBe(false)
  })
})

describe('failed says why, not just what', () => {
  const base = {
    sync_id: UUID, robot_id: UUID, state: 'failed' as const,
    done: 0, total: 2, reason: null, started_at: NOW, updated_at: NOW,
  }

  it('refuses the bare string it used to carry', () => {
    // Six producers wrote three different facts into a flat string[]; the
    // console printed all of them under "these meshes could not be resolved",
    // and reconciliation could not tell "no longer referenced" from
    // "referenced and not delivered" — so N14 had to decline reconciling any
    // partial sync at all.
    expect(assetSyncStatus.safeParse({ ...base, failed: ['package://p/m.stl'] }).success).toBe(false)
  })

  it('carries the distinction reconciliation needs', () => {
    const ok = assetSyncStatus.safeParse({
      ...base,
      failed: [
        { reference: 'package://p/gone.stl', kind: 'unresolvable' },
        { reference: 'package://p/here.stl', kind: 'upload_failed' },
      ],
    })
    expect(ok.success).toBe(true)
    // `unresolvable` is the ONLY kind a reconciliation may drop — the other
    // two both mean "we meant to provide this and did not".
    expect(ok.success && ok.data.failed.filter((f) => f.kind !== 'unresolvable')).toHaveLength(1)
  })

  it('refuses a kind nobody defined, and still bounds the list', () => {
    expect(assetSyncStatus.safeParse({ ...base, failed: [{ reference: 'x', kind: 'dunno' }] }).success).toBe(false)
    const tooMany = Array.from({ length: 1001 }, () => ({ reference: 'package://p/m.stl', kind: 'unresolvable' }))
    expect(assetSyncStatus.safeParse({ ...base, failed: tooMany }).success).toBe(false)
  })
})
