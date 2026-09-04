import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_SECTIONS, IN_HANDLER_ROUTES, ERROR_CODES } from '../src/index.js'
import { exportedSchemas, openApiDocument, routesArtifact } from '../scripts/export-schemas.js'

const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`

describe('the route manifest', () => {
  it('has no duplicate method+path', () => {
    const keys = ROUTES.map(key)
    expect(keys.length, 'duplicate entries').toBe(new Set(keys).size)
  })

  it('declares every :param of its path, in order, and nothing else', () => {
    for (const r of ROUTES) {
      const inPath = [...r.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
      expect(r.params.map((p) => p.name), key(r)).toEqual(inPath)
      for (const p of r.params) expect(p.description.length, `${key(r)} :${p.name} has no description`).toBeGreaterThan(10)
    }
  })

  it('lists only catalogued error codes', () => {
    for (const r of ROUTES) for (const c of r.errors) expect(ERROR_CODES, `${key(r)} lists ${c}`).toContain(c)
  })

  it('uses a section every entry can be rendered under', () => {
    const ids = new Set(ROUTE_SECTIONS.map((s) => s.id))
    for (const r of ROUTES) expect(ids.has(r.section), key(r)).toBe(true)
    expect(ROUTE_SECTIONS.length).toBe(new Set(ROUTE_SECTIONS.map((s) => s.id)).size)
  })

  it('stores display paths, never an inline regex', () => {
    for (const r of ROUTES) expect(r.path, key(r)).not.toMatch(/[()]/)
  })

  it('allows in_handler auth only on the three routes that verify a credential themselves', () => {
    const inHandler = ROUTES.filter((r) => r.auth === 'in_handler').map(key).sort()
    expect(inHandler).toEqual([...IN_HANDLER_ROUTES].sort())
  })

  it('describes websocket upgrades as GET with no schemas', () => {
    const ws = ROUTES.filter((r) => r.transport === 'websocket')
    expect(ws.map(key).sort()).toEqual(['GET /bridge', 'GET /realtime'])
    for (const r of ws) {
      expect(r.method).toBe('GET')
      expect([r.query, r.request, r.response]).toEqual([null, null, null])
    }
  })

  it('keeps internal entries to the sections where browser pages, machine hooks and the bridge live', () => {
    const allowed = new Set(['health', 'developer-auth', 'client-auth', 'users', 'oauth', 'mcp', 'assets', 'transports'])
    for (const r of ROUTES.filter((r) => r.audience === 'internal')) expect(allowed.has(r.section), `${key(r)} is internal in section ${r.section}`).toBe(true)
  })

  it('has a one-sentence summary, and a status its handler actually answers, on every entry', () => {
    for (const r of ROUTES) {
      expect(r.summary.length, key(r)).toBeGreaterThan(15)
      expect(r.summary.endsWith('.'), `${key(r)} summary ends without a full stop`).toBe(true)
      // 100, not 200, because a websocket upgrade answers `101` — the rule this
      // replaces predates the two transport entries and would have failed on
      // both. And below 500, because `status` is what the route answers on the
      // path the documentation describes, never a server fault.
      expect(r.status >= 100 && r.status < 500, `${key(r)} status ${r.status}`).toBe(true)
      // **Two routes have no success answer at all**, and saying `200` about
      // them would document a status no caller can ever receive — the failure
      // this codebase keeps paying for. The missing-asset placeholders exist to
      // answer `404 asset_missing` about a reference nothing resolves, so that
      // refusal IS the status. The rule is not an exemption for those two: any
      // entry whose declared status is a refusal must say so completely — the
      // code it answers with is listed, it declares no response schema for a
      // body it never sends, and it explains itself in prose.
      if (r.status >= 400) {
        expect(r.errors.length, `${key(r)} declares a refusal status but lists no error code`).toBeGreaterThan(0)
        expect(r.response, `${key(r)} declares a refusal status but also a response schema`).toBe(null)
        expect(r.notes, `${key(r)} declares a refusal status without saying why`).toBeTruthy()
      }
    }
  })

  it('OAUTH_PATHS names no route the cloud deleted', async () => {
    const { OAUTH_PATHS } = await import('../src/index.js')
    expect(Object.keys(OAUTH_PATHS)).not.toContain('idpStart')
    for (const p of Object.values(OAUTH_PATHS)) expect(ROUTES.some((r) => r.path === p), `${p} is not in the manifest`).toBe(true)
  })
})

describe('the route artifacts', () => {
  const dir = join(import.meta.dirname, '..', 'artifacts')

  it('routes.json on disk matches a fresh export (staleness guard)', () => {
    expect(JSON.parse(readFileSync(join(dir, 'routes.json'), 'utf8'))).toEqual(routesArtifact())
  })

  it('routes.json exists and carries every manifest entry (the never-registered guard)', () => {
    expect(existsSync(join(dir, 'routes.json'))).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(dir, 'routes.json'), 'utf8'))
    expect(onDisk.routes.length).toBe(ROUTES.length)
    expect(onDisk.routes.length).toBeGreaterThan(150)
    expect(onDisk.sections).toEqual(ROUTE_SECTIONS)
  })

  it('every schema a route references is exported and named in routes.json', () => {
    const onDisk = JSON.parse(readFileSync(join(dir, 'routes.json'), 'utf8'))
    for (const r of onDisk.routes) for (const k of ['query', 'request', 'response'] as const) {
      if (r[k] === null) continue
      expect(Object.keys(exportedSchemas), `${r.method} ${r.path} ${k}=${r[k]}`).toContain(r[k])
      expect(existsSync(join(dir, 'schema', `${r[k]}.schema.json`)), `${r[k]} has no artifact`).toBe(true)
    }
  })

  it('openapi.json on disk matches a fresh render', () => {
    expect(JSON.parse(readFileSync(join(dir, 'openapi.json'), 'utf8'))).toEqual(openApiDocument())
  })

  it('openapi.json describes only developer and client HTTP routes, with {param} paths and a component per referenced schema', () => {
    const doc = openApiDocument()
    expect(doc.openapi).toBe('3.1.0')
    const documented = ROUTES.filter((r) => r.audience !== 'internal' && r.transport === 'http')
    const ops = Object.entries(doc.paths).flatMap(([p, item]) => Object.keys(item as object).map((m) => `${m.toUpperCase()} ${p}`))
    expect(ops.sort()).toEqual(documented.map((r) => `${r.method} ${r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')}`).sort())
    for (const p of Object.keys(doc.paths)) expect(p).not.toMatch(/:/)
    const referenced = new Set(routesArtifact().routes.filter((r) => r.audience !== 'internal').flatMap((r) => [r.query, r.request, r.response]).filter((n): n is string => n !== null))
    expect(Object.keys(doc.components.schemas).sort()).toEqual([...referenced, 'api-error'].sort())
    for (const s of Object.values(doc.components.schemas)) expect(s).not.toHaveProperty('$schema')
  })
})
