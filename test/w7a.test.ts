import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assetKind, assetSyncRequest, ASSET_UPLOAD_HEADERS, URDF_ASSET_NAME } from '../src/index.js'
import { exportedConstants } from '../scripts/export-schemas.js'

/**
 * W7a — the register. What changed in contracts is small; what it has to stop
 * happening is not.
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
    // Through W7 the route read no body at all, so `{nonsense:1}` and `{}`
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
