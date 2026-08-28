import { describe, expect, it } from 'vitest'
import {
  orgUser,
  patchOrgRequest,
  tierChangeRequest,
  patchAuthMeRequest,
} from '../src/identity.js'
import { patchRobotRequest, renameSlugRequest } from '../src/rest.js'

const UUID = '3f1e9a2c-6d4b-4f0a-9c8e-1b2a3c4d5e6f'
const UUID2 = '7c2f1b40-8e3a-4d51-9f6b-2a1c3d4e5f60'
const NOW = '2026-08-10T20:00:00.000Z'

describe('W3a — org, member and robot patches; slug rename', () => {
  it('patchOrgRequest: strict, and pins the 120-char org-name bound', () => {
    expect(patchOrgRequest.safeParse({ name: 'a'.repeat(120) }).success).toBe(true)
    expect(patchOrgRequest.safeParse({ name: 'a'.repeat(121) }).success).toBe(false)
    expect(patchOrgRequest.safeParse({ name: '' }).success).toBe(false)
    // Extra key alongside a valid one, so this measures strictness and not the
    // required field — a lone typo would fail either way (see
    // federation-and-grants.test.ts's note on the same trap).
    expect(patchOrgRequest.safeParse({ name: 'Dehne Robotik', nam: 'x' }).success).toBe(false)
  })

  // `patchOrgMemberRequest` became `tierChangeRequest` on 2026-08-29: same
  // act (owner-only, last-owner guard), new field name and new tier names.
  it('tierChangeRequest: strict, and only the two known tiers', () => {
    expect(tierChangeRequest.safeParse({ tier: 'owner' }).success).toBe(true)
    expect(tierChangeRequest.safeParse({ tier: 'developer' }).success).toBe(true)
    expect(tierChangeRequest.safeParse({ tier: 'admin' }).success).toBe(false)
    expect(tierChangeRequest.safeParse({ tier: 'owner', tiers: ['owner'] }).success).toBe(false)
  })

  it('patchAuthMeRequest: strict, nullable, and pins the 120-char display_name bound', () => {
    expect(patchAuthMeRequest.safeParse({ display_name: 'a'.repeat(120) }).success).toBe(true)
    expect(patchAuthMeRequest.safeParse({ display_name: 'a'.repeat(121) }).success).toBe(false)
    expect(patchAuthMeRequest.safeParse({ display_name: '' }).success).toBe(false)
    expect(patchAuthMeRequest.safeParse({ display_name: null }).success).toBe(true)
    expect(patchAuthMeRequest.safeParse({ display_name: null, display_nam: 'x' }).success).toBe(false)
  })

  it('patchRobotRequest: strict, and pins the 63-char robot-name bound', () => {
    expect(patchRobotRequest.safeParse({ name: 'a'.repeat(63) }).success).toBe(true)
    expect(patchRobotRequest.safeParse({ name: 'a'.repeat(64) }).success).toBe(false)
    expect(patchRobotRequest.safeParse({ name: '' }).success).toBe(false)
    expect(patchRobotRequest.safeParse({ name: 'rx1', names: 'rx1' }).success).toBe(false)
  })

  it('renameSlugRequest: strict, and refuses a non-slug `to`', () => {
    expect(renameSlugRequest.safeParse({ from: 'front-camera', to: 'rear-camera' }).success).toBe(true)
    expect(renameSlugRequest.safeParse({ from: 'front-camera', to: 'rear-camera', note: 'x' }).success).toBe(false)
    // Shape only — not what a rename to that shape would collide with or
    // reserve. Whether `to` is already used on this robot, or one of the
    // built-ins, is checked once, behind the cloud's validation door, not
    // duplicated here (see the doc comment on `renameSlugRequest`).
    expect(renameSlugRequest.safeParse({ from: 'front-camera', to: 'Not A Slug' }).success).toBe(false)
  })

  /**
   * **The design's main defence, pinned explicitly.** `orgUser.display_name`
   * (`orgMember`'s successor since the 2026-08-29 identity merge) is required
   * (nullable, not optional) precisely so that any mapper the cloud writes
   * from a database row to this shape is *forced* to carry the column across —
   * an `.optional()` or `.nullish()` field would let a mapper that forgot the
   * column pass validation anyway, silently dropping it. This test exists to
   * go red the moment that requiredness is loosened; see the fix report for
   * the break-test run that confirmed it does.
   */
  it('orgUser: display_name is required (nullable, not optional) — parsing without the key fails', () => {
    const withKey = {
      id: UUID,
      org_id: UUID2,
      email: 'a@b.de',
      display_name: null,
      group_id: UUID2,
      has_password: true,
      mcp_access: 'default',
      tier: 'owner',
      created_at: NOW,
    }
    expect(orgUser.safeParse(withKey).success).toBe(true)

    const { display_name: _drop, ...withoutKey } = withKey
    expect(orgUser.safeParse(withoutKey).success).toBe(false)
  })
})
