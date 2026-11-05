// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_KINDS,
  MAX_LOCK_SLUGS,
  ROUTES,
  accessWarning,
  appAccess,
  appAccessResponse,
  appLock,
  effectiveCapability,
  effectiveRightsQuery,
  effectiveRightsResponse,
  effectiveRobotRights,
  mcpCapabilities,
  mcpRobotDatasheet,
} from '../src/index.js'
import { openApiDocument } from '../scripts/export-schemas.js'

const robot = '01234567-89ab-4cde-8fab-0123456789ab'
const user = 'fedcba98-7654-4321-8fed-cba987654321'
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`
const route = (k: string) => ROUTES.find((r) => key(r) === k)

/** The JSON Schema artifact a consumer validates against, compiled the way a non-TypeScript consumer would. */
function artifact(name: string) {
  const ajv = new (Ajv2020 as any)({ strict: false })
  ;(addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))
}

const access = { default_role: 'observe', locked_kinds: ['publish'], locked: [{ robot_id: robot, slugs: ['arm_home'] }] }
const revision = '0123456789abcdef'.repeat(4)
const warning = { code: 'unknown_lock_slug', message: 'The robot has no capability named arm_home.', robot_id: robot, slug: 'arm_home' }
const capability = {
  name: 'arm_home', kind: 'invoke', granted: true, requirement: ['operate'], source: 'rule', rule_index: 0, rule_match: '/arm/*',
  satisfied_by: 'operate', locked: false, unknown_roles: [],
}
// The datasheet's capabilities are whatever `mcpCapabilities` names, all granted, so the fixture follows the shape rather than a name.
const datasheet = {
  robot_id: robot, robot_name: 'Arm',
  capabilities: Object.fromEntries(Object.keys(mcpCapabilities.shape).map((name) => [name, true])),
  exposures: [],
}
const rights = { robot_id: robot, robot_name: 'Arm', published_version: 3, reachable: true, capabilities: [capability], datasheet }

describe('appAccess', () => {
  it('takes a default role, the kinds to lock and the single locks', () => {
    expect(appAccess.safeParse(access).success).toBe(true)
    expect(appAccess.safeParse({ default_role: null, locked_kinds: [], locked: [] }).success).toBe(true)
    expect(artifact('app-access')(access)).toBe(true)
  })

  it('locks any kind of access, and nothing that is not one', () => {
    for (const kind of ACCESS_KINDS) expect(appAccess.safeParse({ ...access, locked_kinds: [kind] }).success, kind).toBe(true)
    for (const kind of ['presence', 'audit', 'Publish', '']) {
      expect(appAccess.safeParse({ ...access, locked_kinds: [kind] }).success, JSON.stringify(kind)).toBe(false)
    }
    expect(artifact('app-access')({ ...access, locked_kinds: ['presence'] })).toBe(false)
  })

  it('refuses a lock without a slug, a bad slug and a robot that is no uuid', () => {
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: [] }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: ['Arm Home'] }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: 'arm', slugs: ['arm_home'] }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ slugs: ['arm_home'] }] }).success).toBe(false)
    expect(appLock.safeParse({ robot_id: robot, slugs: ['arm_home', 'arm_park'] }).success).toBe(true)
    expect(artifact('app-access')({ ...access, locked: [{ robot_id: robot, slugs: [] }] })).toBe(false)
  })

  it('names a kind, a slug and a robot once', () => {
    expect(appAccess.safeParse({ ...access, locked_kinds: ['read', 'read'] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: ['arm_home', 'arm_home'] }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: ['arm_home'] }, { robot_id: robot, slugs: ['arm_park'] }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked_kinds: ['read', 'invoke'], locked: [{ robot_id: robot, slugs: ['arm_home'] }, { robot_id: user, slugs: ['arm_home'] }] }).success).toBe(true)
    // The artifact states the two list rules JSON Schema can state; one entry per robot is a cross-field rule only the parser holds.
    expect(artifact('app-access')({ ...access, locked_kinds: ['read', 'read'] })).toBe(false)
    expect(artifact('app-access')({ ...access, locked: [{ robot_id: robot, slugs: ['arm_home', 'arm_home'] }] })).toBe(false)
  })

  it('exports the cap of one lock, and the lock enforces exactly that cap', () => {
    const lock = (n: number) => appLock.safeParse({ robot_id: robot, slugs: Array.from({ length: n }, (_, i) => `s${i}`) })
    expect(MAX_LOCK_SLUGS).toBe(2000)
    expect(lock(MAX_LOCK_SLUGS).success).toBe(true)
    expect(lock(MAX_LOCK_SLUGS + 1).success).toBe(false)
  })

  it('bounds the lists: every kind once, the exposures one robot can have, a lock per robot', () => {
    const slugs = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
    const robots = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`)
    expect(appAccess.safeParse({ ...access, locked_kinds: [...ACCESS_KINDS] }).success).toBe(true)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: slugs(2000) }] }).success).toBe(true)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: slugs(2001) }] }).success).toBe(false)
    expect(artifact('app-access')({ ...access, locked: [{ robot_id: robot, slugs: slugs(2001) }] })).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: robots(1000).map((robot_id) => ({ robot_id, slugs: ['arm_home'] })) }).success).toBe(true)
    expect(appAccess.safeParse({ ...access, locked: robots(1001).map((robot_id) => ({ robot_id, slugs: ['arm_home'] })) }).success).toBe(false)
    expect(artifact('app-access')({ ...access, locked: robots(1001).map((robot_id) => ({ robot_id, slugs: ['arm_home'] })) })).toBe(false)
  })

  it('is a full replacement: every field is named, and no other', () => {
    for (const field of ['default_role', 'locked_kinds', 'locked']) {
      const { [field]: _left, ...rest } = access as Record<string, unknown>
      expect(appAccess.safeParse(rest).success, `${field} left out`).toBe(false)
    }
    expect(appAccess.safeParse({ ...access, warnings: [] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, extra: 1 }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, locked: [{ robot_id: robot, slugs: ['arm_home'], extra: 1 }] }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, default_role: 'Observe' }).success).toBe(false)
    expect(appAccess.safeParse({ ...access, default_role: '' }).success).toBe(false)
  })

  it('may carry the revision it was composed from; without it the body replaces whatever is stored', () => {
    expect(appAccess.safeParse({ ...access, revision }).success).toBe(true)
    expect(appAccess.safeParse(access).success).toBe(true)
    expect(artifact('app-access')({ ...access, revision })).toBe(true)
    expect(artifact('app-access')(access)).toBe(true)
  })

  it('refuses a revision that cannot be one: not 64 lower-case hexadecimal characters, null, or a number', () => {
    for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), revision + '0', revision.slice(1), null, 1]) {
      expect(appAccess.safeParse({ ...access, revision: bad }).success, JSON.stringify(bad)).toBe(false)
      expect(artifact('app-access')({ ...access, revision: bad }), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('appAccessResponse', () => {
  it('is the access as it stands together with its revision and its warnings', () => {
    expect(appAccessResponse.safeParse({ ...access, revision, warnings: [warning] }).success).toBe(true)
    expect(appAccessResponse.safeParse({ ...access, revision, warnings: [] }).success).toBe(true)
    expect(appAccessResponse.safeParse({ ...access, revision }).success, 'warnings are always present').toBe(false)
    expect(artifact('app-access-response')({ ...access, revision, warnings: [warning] })).toBe(true)
  })

  it('always carries the revision a write is checked against', () => {
    expect(appAccessResponse.safeParse({ ...access, warnings: [] }).success).toBe(false)
    expect(appAccessResponse.safeParse({ ...access, revision: 'abc', warnings: [] }).success).toBe(false)
    expect(artifact('app-access-response')({ ...access, warnings: [] })).toBe(false)
  })

  it('answers what the PUT takes plus the warnings, so a read can be sent back as it is', () => {
    const answer = appAccessResponse.parse({ ...access, revision, warnings: [warning] })
    const { warnings: _warnings, ...body } = answer
    expect(appAccess.safeParse(body).success).toBe(true)
  })

  it('names the three warnings an access can earn', () => {
    for (const code of ['unknown_default_role', 'unknown_lock_slug', 'lock_robot_not_attached']) {
      expect(accessWarning.safeParse({ ...warning, code }).success, code).toBe(true)
    }
    expect(accessWarning.safeParse({ ...warning, code: 'unknown_role' }).success).toBe(false)
    expect(accessWarning.safeParse({ code: 'unknown_default_role', message: 'No role has that key.', robot_id: null, slug: null }).success).toBe(true)
    expect(accessWarning.safeParse({ ...warning, message: '' }).success).toBe(false)
    const { slug: _slug, ...withoutSlug } = warning
    expect(accessWarning.safeParse(withoutSlug).success, 'a null is spelled out, never left off').toBe(false)
  })
})

describe('effectiveRightsQuery', () => {
  it('asks about a role or about a user, and exactly one of them', () => {
    expect(effectiveRightsQuery.safeParse({ role: 'observe' }).success).toBe(true)
    expect(effectiveRightsQuery.safeParse({ user }).success).toBe(true)
    expect(effectiveRightsQuery.safeParse({ role: 'observe', user }).success, 'both').toBe(false)
    expect(effectiveRightsQuery.safeParse({}).success, 'neither').toBe(false)
    expect(effectiveRightsQuery.safeParse({ role: undefined, user: undefined }).success, 'neither, spelled out').toBe(false)
  })

  it('refuses a role that is no key, a user that is no uuid and any other parameter', () => {
    expect(effectiveRightsQuery.safeParse({ role: 'Observe' }).success).toBe(false)
    expect(effectiveRightsQuery.safeParse({ user: 'u1' }).success).toBe(false)
    expect(effectiveRightsQuery.safeParse({ role: 'observe', app: robot }).success).toBe(false)
  })
})

describe('effective rights', () => {
  it('say per capability whether it is granted and where the requirement came from', () => {
    expect(effectiveCapability.safeParse(capability).success).toBe(true)
    for (const source of ['entry', 'rule', 'robot', 'org_default']) {
      expect(effectiveCapability.safeParse({ ...capability, source }).success, source).toBe(true)
    }
    expect(effectiveCapability.safeParse({ ...capability, source: 'lock' }).success).toBe(false)
    expect(effectiveCapability.safeParse({
      ...capability, name: 'job_history', kind: 'job_history', source: 'org_default', rule_index: null, rule_match: null,
      satisfied_by: null, locked: true, granted: false, unknown_roles: ['gone'],
    }).success).toBe(true)
    expect(effectiveCapability.safeParse({ ...capability, kind: 'presence' }).success).toBe(false)
    expect(effectiveCapability.safeParse({ ...capability, rule_index: -1 }).success).toBe(false)
    expect(effectiveCapability.safeParse({ ...capability, name: 'Arm Home' }).success).toBe(false)
    const { satisfied_by: _by, ...withoutBy } = capability
    expect(effectiveCapability.safeParse(withoutBy).success, 'a null is spelled out, never left off').toBe(false)
  })

  it('carry the datasheet an MCP session of that role would get', () => {
    expect(effectiveRobotRights.safeParse(rights).success).toBe(true)
    expect(effectiveRobotRights.safeParse({ ...rights, published_version: null, capabilities: [] }).success).toBe(true)
    expect(mcpRobotDatasheet.safeParse(datasheet).success, 'the fixture is a real datasheet').toBe(true)
    const { datasheet: _datasheet, ...withoutSheet } = rights
    expect(effectiveRobotRights.safeParse(withoutSheet).success).toBe(false)
    expect(effectiveRobotRights.safeParse({ ...rights, published_version: 0 }).success).toBe(false)
  })

  it('say whether a session of the role reaches the robot at all, and never leave it out', () => {
    expect(effectiveRobotRights.safeParse({ ...rights, reachable: false }).success).toBe(true)
    const { reachable: _reachable, ...withoutReach } = rights
    expect(effectiveRobotRights.safeParse(withoutReach).success).toBe(false)
    expect(effectiveRobotRights.safeParse({ ...rights, reachable: 'no' }).success).toBe(false)
    expect(artifact('effective-robot-rights')(rights)).toBe(true)
    expect(artifact('effective-robot-rights')(withoutReach)).toBe(false)
  })

  it('answer for a role that exists and for one that does not', () => {
    const answer = { role: 'operate', role_known: true, user_id: null, robots: [rights] }
    expect(effectiveRightsResponse.safeParse(answer).success).toBe(true)
    expect(effectiveRightsResponse.safeParse({ role: 'gone', role_known: false, user_id: user, robots: [] }).success).toBe(true)
    expect(effectiveRightsResponse.safeParse({ role: null, role_known: false, user_id: user, robots: [] }).success).toBe(true)
    expect(effectiveRightsResponse.safeParse({ ...answer, role_known: 'no' }).success).toBe(false)
    expect(effectiveRightsResponse.safeParse({ role: 'operate', role_known: true, robots: [] }).success).toBe(false)
    expect(artifact('effective-rights-response')(answer)).toBe(true)
  })
})

describe('the app access routes', () => {
  const THREE = ['GET /api/apps/:id/access', 'PUT /api/apps/:id/access', 'GET /api/apps/:id/effective-rights'] as const

  it('are three developer routes in the apps section, none owner-only', () => {
    for (const k of THREE) {
      const r = route(k)
      expect(r, `${k} is not in the manifest`).toBeDefined()
      expect(r!.section, k).toBe('apps')
      expect(r!.audience, k).toBe('developer')
      expect(r!.auth, k).toBe('developer')
      expect(r!.ownerTier, k).toBe(false)
      expect(r!.status, k).toBe(200)
      expect(r!.params.map((p) => p.name), k).toEqual(['id'])
      expect(r!.errors, k).toContain('not_found')
      expect(r!.errors, k).toContain('invalid_uuid')
      expect(r!.errors, k).not.toContain('tier_required')
    }
  })

  it('name their shapes', () => {
    expect(route('GET /api/apps/:id/access')).toMatchObject({ query: null, request: null, response: appAccessResponse })
    expect(route('PUT /api/apps/:id/access')).toMatchObject({ query: null, request: appAccess, response: appAccessResponse })
    expect(route('GET /api/apps/:id/effective-rights')).toMatchObject({ query: effectiveRightsQuery, request: null, response: effectiveRightsResponse })
  })

  it('refuse a malformed body or query, and nothing is created by asking', () => {
    expect(route('PUT /api/apps/:id/access')!.errors).toContain('validation_error')
    expect(route('GET /api/apps/:id/effective-rights')!.errors).toContain('validation_error')
    expect(route('GET /api/apps/:id/access')!.errors).not.toContain('validation_error')
  })

  it('say that only published configurations count, and what a role that is no role gets', () => {
    const notes = route('GET /api/apps/:id/effective-rights')!.notes ?? ''
    expect(notes).toMatch(/published/)
    expect(notes).toContain('role_known')
    expect(notes).toMatch(/nothing/)
    expect(route('PUT /api/apps/:id/access')!.notes ?? '').toMatch(/replace/i)
  })

  it('document the revision check: a stale body is a 409 that writes nothing, and a missing revision is last writer wins', () => {
    const put = route('PUT /api/apps/:id/access')!
    expect(put.errors).toContain('target_state_conflict')
    expect(put.notes ?? '').toMatch(/`revision`/)
    expect(put.notes ?? '').toMatch(/409 target_state_conflict/)
    expect(put.notes ?? '').toMatch(/stale/)
    expect(put.notes ?? '').toMatch(/last\s+writer wins/)
    expect(route('GET /api/apps/:id/access')!.errors).not.toContain('target_state_conflict')
    expect(route('GET /api/apps/:id/access')!.notes ?? '').toMatch(/`revision`/)
  })

  it('reach the OpenAPI document, the query as parameters', () => {
    const paths = openApiDocument().paths as Record<string, Record<string, any>>
    expect(Object.keys(paths['/api/apps/{id}/access'] ?? {}).sort()).toEqual(['get', 'put'])
    const query = (paths['/api/apps/{id}/effective-rights']?.get?.parameters ?? []).filter((p: any) => p.in === 'query').map((p: any) => p.name)
    expect(query.sort()).toEqual(['role', 'user'])
  })
})
