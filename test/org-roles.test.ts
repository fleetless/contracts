// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_KINDS,
  ERROR_CODES,
  ROUTES,
  createOrgRoleRequest,
  danglingReference,
  orgRole,
  orgRoleListResponse,
  patchOrgRoleRequest,
  putRoleDefaultsRequest,
  referencePlace,
  roleCycleDetails,
  roleDefaultsResponse,
  roleRenamePreview,
} from '../src/index.js'

const id = '01234567-89ab-4cde-8fab-0123456789ab'
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`
const route = (k: string) => ROUTES.find((r) => key(r) === k)

/** The JSON Schema artifact a consumer validates against, compiled the way a non-TypeScript consumer would. */
function artifact(name: string) {
  const ajv = new (Ajv2020 as any)({ strict: false })
  ;(addFormats as any)(ajv)
  return ajv.compile(JSON.parse(readFileSync(new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8')))
}

const place = {
  kind: 'config', label: 'Arm', path: 'services.arm_home.role', robot_id: id, app_id: null, user_id: null,
  document: 'published', new_version: 4,
}
const role = { key: 'wartung', name: 'Maintenance', inherits: ['observe'], users: 3, invitations: 1, app_defaults: 0, references: 2 }

describe('createOrgRoleRequest', () => {
  it('accepts a key, a name and optional parents', () => {
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', inherits: ['observe'] }).success).toBe(true)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance' }).success).toBe(true)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', inherits: [] }).success).toBe(true)
  })

  it('refuses a key that is not a role key', () => {
    for (const bad of ['Wartung', '1abc', 'a'.repeat(64), '', 'night-shift', '_x']) {
      expect(createOrgRoleRequest.safeParse({ key: bad, name: 'Maintenance' }).success, JSON.stringify(bad)).toBe(false)
    }
    expect(createOrgRoleRequest.safeParse({ key: 'a'.repeat(63), name: 'Maintenance' }).success).toBe(true)
  })

  it('refuses the key `defaults`, which is the path of the organization\'s defaults', () => {
    expect(createOrgRoleRequest.safeParse({ key: 'defaults', name: 'Defaults' }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'default', name: 'Default' }).success).toBe(true)
    expect(createOrgRoleRequest.safeParse({ key: 'defaults_2', name: 'Defaults' }).success).toBe(true)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', inherits: ['defaults'] }).success).toBe(false)
    expect(artifact('create-org-role-request')({ key: 'defaults', name: 'Defaults' })).toBe(false)
    expect(artifact('create-org-role-request')({ key: 'defaults_2', name: 'Defaults' })).toBe(true)
  })

  it('bounds the name at 1 to 60 characters, after trimming', () => {
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: '' }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: '   ' }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'n'.repeat(61) }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'n'.repeat(60) }).success).toBe(true)
    const trimmed = createOrgRoleRequest.parse({ key: 'wartung', name: `  ${'n'.repeat(60)}  ` })
    expect(trimmed.name).toBe('n'.repeat(60))
  })

  it('refuses a parent that is not a role key, and every key it does not know', () => {
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', inherits: ['Observe'] }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', inherits: 'observe' }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung', name: 'Maintenance', users: 1 }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ name: 'Maintenance' }).success).toBe(false)
    expect(createOrgRoleRequest.safeParse({ key: 'wartung' }).success).toBe(false)
  })
})

describe('patchOrgRoleRequest', () => {
  it('needs at least one field', () => {
    expect(patchOrgRoleRequest.safeParse({}).success).toBe(false)
    expect(patchOrgRoleRequest.safeParse({ name: undefined }).success).toBe(false)
  })

  it('takes any one of its fields', () => {
    for (const body of [
      { name: 'Service' }, { inherits: [] }, { inherits: ['operate'] }, { key: 'service' },
      { key: 'service', update_references: true }, { key: 'service', update_references: true, confirm: 'abc' },
      { update_references: false },
    ]) {
      expect(patchOrgRoleRequest.safeParse(body).success, JSON.stringify(body)).toBe(true)
    }
  })

  it('refuses a malformed field and any key it does not know', () => {
    for (const body of [
      { key: 'Service' }, { name: '' }, { name: 'n'.repeat(61) }, { inherits: ['Operate'] },
      { update_references: 'yes' }, { confirm: '' }, { confirm: 1 }, { name: 'Service', role_id: id },
    ]) {
      expect(patchOrgRoleRequest.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
  })

  it('says in its artifact that nothing but its own fields is accepted', () => {
    const validate = artifact('patch-org-role-request')
    expect(validate({ key: 'service', update_references: true })).toBe(true)
    expect(validate({ key: 'Service' })).toBe(false)
  })

  it('cannot be renamed to the key `defaults`', () => {
    expect(patchOrgRoleRequest.safeParse({ key: 'defaults' }).success).toBe(false)
    expect(artifact('patch-org-role-request')({ key: 'defaults' })).toBe(false)
  })

  it('says in its artifact that the one-field rule is the cloud\'s to refuse', () => {
    // A `.refine()` has no JSON Schema form: the artifact lets an empty patch through, and the comment on the shape says why.
    expect(artifact('patch-org-role-request')({})).toBe(true)
  })

  it('says that a rename with nothing to rewrite needs no token', () => {
    const schema = JSON.parse(readFileSync(new URL('../artifacts/schema/patch-org-role-request.schema.json', import.meta.url), 'utf8'))
    expect(schema.properties.update_references.description).toContain('needs no token')
  })
})

describe('role defaults', () => {
  it('accepts a partial map of kinds to one role, a list or nobody', () => {
    for (const defaults of [
      { read: 'observe', invoke: ['operate', 'admin'], publish: null },
      { assets: [] }, { job_history: 'operate' }, {},
    ]) {
      expect(putRoleDefaultsRequest.safeParse({ defaults }).success, JSON.stringify(defaults)).toBe(true)
    }
  })

  it('refuses a kind that is not an access kind, a bad key, and any other key', () => {
    for (const body of [
      { defaults: { audit: 'observe' } }, { defaults: { read: 'Observe' } }, { defaults: { read: ['observe', 'Admin'] } },
      { defaults: { read: 3 } }, { defaults: { read: 'observe' }, extra: true }, {}, { defaults: null }, { read: 'observe' },
    ]) {
      expect(putRoleDefaultsRequest.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
    const validate = artifact('put-role-defaults-request')
    expect(validate({ defaults: { read: 'observe', publish: null } })).toBe(true)
    expect(validate({ defaults: { read: [] } })).toBe(true)
    expect(validate({ defaults: { read: 'Observe' } })).toBe(false)
  })

  it('answers every kind, an empty list meaning nobody', () => {
    const all = { read: ['observe'], invoke: ['operate'], publish: ['operate'], assets: [], job_history: ['operate', 'admin'] }
    expect(roleDefaultsResponse.safeParse({ defaults: all }).success).toBe(true)
    expect(Object.keys(all).sort()).toEqual([...ACCESS_KINDS].sort())
    for (const kind of ACCESS_KINDS) {
      const { [kind]: _left, ...rest } = all
      expect(roleDefaultsResponse.safeParse({ defaults: rest }).success, `${kind} missing`).toBe(false)
    }
    expect(roleDefaultsResponse.safeParse({ defaults: { ...all, read: 'observe' } }).success).toBe(false)
    const validate = artifact('role-defaults-response')
    expect(validate({ defaults: all })).toBe(true)
    expect(validate({ defaults: { ...all, assets: undefined } })).toBe(false)
  })
})

describe('what the role list answers', () => {
  it('describes a role with its counts', () => {
    expect(orgRole.safeParse(role).success).toBe(true)
    expect(orgRole.safeParse({ ...role, key: 'Wartung' }).success).toBe(false)
    expect(orgRole.safeParse({ ...role, name: '' }).success).toBe(false)
    for (const count of ['users', 'invitations', 'app_defaults', 'references']) {
      expect(orgRole.safeParse({ ...role, [count]: -1 }).success, count).toBe(false)
      expect(orgRole.safeParse({ ...role, [count]: 0.5 }).success, count).toBe(false)
      const { [count]: _left, ...rest } = role as Record<string, unknown>
      expect(orgRole.safeParse(rest).success, `${count} missing`).toBe(false)
    }
  })

  it('names a place a role key is written in, whatever the kind', () => {
    expect(referencePlace.safeParse(place).success).toBe(true)
    for (const kind of ['config', 'app_user', 'invitation', 'app_default', 'role_inherits', 'org_default']) {
      expect(referencePlace.safeParse({ ...place, kind }).success, kind).toBe(true)
    }
    expect(referencePlace.safeParse({ ...place, kind: 'collection_schema' }).success).toBe(false)
    expect(referencePlace.safeParse({
      kind: 'org_default', label: 'read', path: null, robot_id: null, app_id: null, user_id: null, document: null, new_version: null,
    }).success).toBe(true)
    expect(referencePlace.safeParse({ ...place, document: 'staged' }).success).toBe(false)
    expect(referencePlace.safeParse({ ...place, new_version: 0 }).success).toBe(false)
    const { path: _path, ...withoutPath } = place
    expect(referencePlace.safeParse(withoutPath).success, 'a null is spelled out, never left off').toBe(false)
  })

  it('names the inheriting role by its key, since display names are not unique', () => {
    const inherits = {
      kind: 'role_inherits', label: 'Maintenance', path: 'wartung', robot_id: null, app_id: null, user_id: null, document: null, new_version: null,
    }
    expect(referencePlace.safeParse(inherits).success).toBe(true)
    const schema = JSON.parse(readFileSync(new URL('../artifacts/schema/reference-place.schema.json', import.meta.url), 'utf8'))
    expect(schema.properties.path.description).toContain('key of the role that inherits')
  })

  it('lists the roles together with the keys that are named but are no role', () => {
    const list = { roles: [role], dangling: [{ key: 'gone', places: [place] }] }
    expect(orgRoleListResponse.safeParse(list).success).toBe(true)
    expect(orgRoleListResponse.safeParse({ roles: [role] }).success).toBe(false)
    expect(danglingReference.safeParse({ key: 'gone', places: [] }).success).toBe(true)
    expect(danglingReference.safeParse({ key: 'gone' }).success).toBe(false)
    expect(artifact('org-role-list-response')(list)).toBe(true)
  })
})

describe('the rename preview and the cycle', () => {
  it('carries every place a rename would rewrite and the token that confirms it', () => {
    const preview = { from: 'wartung', to: 'service', references: [place], reference_count: 1, confirm: 'a'.repeat(64) }
    expect(roleRenamePreview.safeParse(preview).success).toBe(true)
    expect(roleRenamePreview.safeParse({ ...preview, confirm: undefined }).success).toBe(false)
    expect(roleRenamePreview.safeParse({ ...preview, reference_count: -1 }).success).toBe(false)
    expect(roleRenamePreview.safeParse({ ...preview, references: [{ ...place, kind: 'nowhere' }] }).success).toBe(false)
  })

  it('names the loop as a list of keys', () => {
    expect(roleCycleDetails.safeParse({ cycle: ['a', 'b', 'a'] }).success).toBe(true)
    expect(roleCycleDetails.safeParse({ cycle: ['a'] }).success).toBe(false)
    expect(roleCycleDetails.safeParse({}).success).toBe(false)
  })

  it('has the three codes the role routes answer', () => {
    for (const code of ['role_cycle', 'role_key_taken', 'confirmation_required']) expect(ERROR_CODES, code).toContain(code)
  })
})

describe('the organization role routes', () => {
  const SIX = [
    ['GET /api/org/roles', 200],
    ['POST /api/org/roles', 201],
    ['PATCH /api/org/roles/:key', 200],
    ['DELETE /api/org/roles/:key', 204],
    ['GET /api/org/roles/defaults', 200],
    ['PUT /api/org/roles/defaults', 200],
  ] as const

  it('are six developer routes in the org section, none owner-only', () => {
    for (const [k, status] of SIX) {
      const r = route(k)
      expect(r, `${k} is not in the manifest`).toBeDefined()
      expect(r!.section, k).toBe('org')
      expect(r!.audience, k).toBe('developer')
      expect(r!.auth, k).toBe('developer')
      expect(r!.ownerTier, k).toBe(false)
      expect(r!.rateLimited, k).toBe(false)
      expect(r!.status, k).toBe(status)
      expect(r!.errors, k).not.toContain('tier_required')
      for (const guard of ['unauthorized', 'token_expired', 'token_revoked'] as const) expect(r!.errors, k).toContain(guard)
    }
    expect(ROUTES.filter((r) => r.path.startsWith('/api/org/roles')).length).toBe(SIX.length)
  })

  it('name their shapes', () => {
    expect(route('GET /api/org/roles')).toMatchObject({ request: null, response: orgRoleListResponse })
    expect(route('POST /api/org/roles')).toMatchObject({ request: createOrgRoleRequest, response: orgRole })
    expect(route('PATCH /api/org/roles/:key')).toMatchObject({ request: patchOrgRoleRequest, response: orgRole })
    expect(route('DELETE /api/org/roles/:key')).toMatchObject({ request: null, response: null })
    expect(route('GET /api/org/roles/defaults')).toMatchObject({ request: null, response: roleDefaultsResponse })
    expect(route('PUT /api/org/roles/defaults')).toMatchObject({ request: putRoleDefaultsRequest, response: roleDefaultsResponse })
  })

  it('declare the refusals they can answer, and no more', () => {
    const errors = (k: string) => new Set(route(k)!.errors)
    for (const k of ['POST /api/org/roles', 'PATCH /api/org/roles/:key', 'PUT /api/org/roles/defaults']) {
      expect(errors(k).has('validation_error'), k).toBe(true)
    }
    for (const k of ['PATCH /api/org/roles/:key', 'DELETE /api/org/roles/:key']) {
      expect(errors(k).has('not_found'), k).toBe(true)
      expect(errors(k).has('validation_error'), k).toBe(true)
    }
    expect(errors('POST /api/org/roles').has('role_key_taken')).toBe(true)
    expect(errors('POST /api/org/roles').has('role_cycle')).toBe(true)
    for (const code of ['role_cycle', 'role_key_taken', 'confirmation_required']) expect(errors('PATCH /api/org/roles/:key').has(code as never), code).toBe(true)
    for (const k of ['GET /api/org/roles', 'DELETE /api/org/roles/:key', 'GET /api/org/roles/defaults', 'PUT /api/org/roles/defaults']) {
      for (const code of ['role_cycle', 'role_key_taken', 'confirmation_required']) expect(errors(k).has(code as never), `${k} ${code}`).toBe(false)
    }
  })

  it('explain the two-call rename on PATCH', () => {
    const notes = route('PATCH /api/org/roles/:key')!.notes ?? ''
    expect(notes).toContain('update_references')
    expect(notes).toContain('confirm')
    expect(notes).toContain('409')
    expect(notes).toContain('confirmation_required')
  })

  it('answer a preview only when the rename has places to rewrite', () => {
    const notes = route('PATCH /api/org/roles/:key')!.notes ?? ''
    expect(notes).toContain('needs no token')
    expect(notes).not.toContain('With `update_references: true` and no `confirm`, nothing is changed')
  })

  it('reach the OpenAPI document under their own paths', async () => {
    const { openApiDocument } = await import('../scripts/export-schemas.js')
    const paths = openApiDocument().paths as Record<string, Record<string, unknown>>
    expect(Object.keys(paths['/api/org/roles'] ?? {}).sort()).toEqual(['get', 'post'])
    expect(Object.keys(paths['/api/org/roles/{key}'] ?? {}).sort()).toEqual(['delete', 'patch'])
    expect(Object.keys(paths['/api/org/roles/defaults'] ?? {}).sort()).toEqual(['get', 'put'])
  })
})
