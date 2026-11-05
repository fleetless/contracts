// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  ROUTES,
  ROUTE_SECTIONS,
  collectionDefinitionsResponse,
  collectionExportQuery,
  collectionImportPreview,
  collectionImportRequest,
  collectionImportResult,
  collectionListResponse,
  collectionRecord,
  collectionRecordHistoryQuery,
  collectionRecordHistoryResponse,
  collectionRecordGetQuery,
  collectionRecordListQuery,
  collectionRecordListResponse,
  collectionRecordRestoreRequest,
  collectionRecordWrite,
  collectionsDraftResponse,
  collectionsPublishRequest,
  collectionsPublishResponse,
  collectionsPurgePreview,
  collectionsPurgeRequest,
  collectionsPurgeResponse,
  collectionsRestorePreview,
  collectionsRestorePreviewQuery,
  collectionsRestoreRequest,
  collectionsRestoreResponse,
  collectionsSchemaPreview,
  collectionsVersionResponse,
  collectionsVersionsResponse,
  putCollectionsDraftRequest,
} from '../src/index.js'
import { openApiDocument, routesArtifact } from '../scripts/export-schemas.js'

type Row = (typeof ROUTES)[number]
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`

const A = '/api/apps/:id/collections'
const C = '/api/client/collections'

/**
 * Every route of the section: method and path, the status it answers, and the schemas it names.
 * `null` is a route that names none.
 */
const DEVELOPER: [string, number, { query?: unknown; request?: unknown; response?: unknown }][] = [
  [`GET ${A}`, 200, { response: collectionListResponse }],
  [`GET ${A}/schema/draft`, 200, { response: collectionsDraftResponse }],
  [`PUT ${A}/schema/draft`, 200, { request: putCollectionsDraftRequest, response: collectionsDraftResponse }],
  [`DELETE ${A}/schema/draft`, 204, {}],
  [`GET ${A}/schema/preview`, 200, { response: collectionsSchemaPreview }],
  [`POST ${A}/schema/publish`, 200, { request: collectionsPublishRequest, response: collectionsPublishResponse }],
  [`GET ${A}/schema/versions`, 200, { response: collectionsVersionsResponse }],
  [`GET ${A}/schema/versions/:v`, 200, { response: collectionsVersionResponse }],
  [`GET ${A}/schema/versions/:v/restore-preview`, 200, { query: collectionsRestorePreviewQuery, response: collectionsRestorePreview }],
  [`POST ${A}/schema/versions/:v/restore`, 200, { request: collectionsRestoreRequest, response: collectionsRestoreResponse }],
  [`POST ${A}/history/purge-preview`, 200, { request: collectionsPurgeRequest, response: collectionsPurgePreview }],
  [`POST ${A}/history/purge`, 200, { request: collectionsPurgeRequest, response: collectionsPurgeResponse }],
  [`GET ${A}/:c/records`, 200, { query: collectionRecordListQuery, response: collectionRecordListResponse }],
  [`POST ${A}/:c/records`, 201, { request: collectionRecordWrite, response: collectionRecord }],
  [`GET ${A}/:c/records/:rid`, 200, { query: collectionRecordGetQuery, response: collectionRecord }],
  [`PATCH ${A}/:c/records/:rid`, 200, { request: collectionRecordWrite, response: collectionRecord }],
  [`DELETE ${A}/:c/records/:rid`, 204, {}],
  [`GET ${A}/:c/records/:rid/history`, 200, { query: collectionRecordHistoryQuery, response: collectionRecordHistoryResponse }],
  [`POST ${A}/:c/records/:rid/restore`, 200, { request: collectionRecordRestoreRequest, response: collectionRecord }],
  [`POST ${A}/:c/import/preview`, 200, { request: collectionImportRequest, response: collectionImportPreview }],
  [`POST ${A}/:c/import`, 200, { request: collectionImportRequest, response: collectionImportResult }],
  [`GET ${A}/:c/export`, 200, { query: collectionExportQuery }],
]

const CLIENT: [string, number, { query?: unknown; request?: unknown; response?: unknown }][] = [
  [`GET ${C}`, 200, { response: collectionDefinitionsResponse }],
  [`GET ${C}/:c/records`, 200, { query: collectionRecordListQuery, response: collectionRecordListResponse }],
  [`POST ${C}/:c/records`, 201, { request: collectionRecordWrite, response: collectionRecord }],
  [`GET ${C}/:c/records/:rid`, 200, { query: collectionRecordGetQuery, response: collectionRecord }],
  [`PATCH ${C}/:c/records/:rid`, 200, { request: collectionRecordWrite, response: collectionRecord }],
  [`DELETE ${C}/:c/records/:rid`, 204, {}],
  [`GET ${C}/:c/records/:rid/history`, 200, { query: collectionRecordHistoryQuery, response: collectionRecordHistoryResponse }],
  [`POST ${C}/:c/records/:rid/restore`, 200, { request: collectionRecordRestoreRequest, response: collectionRecord }],
  [`POST ${C}/:c/import/preview`, 200, { request: collectionImportRequest, response: collectionImportPreview }],
  [`POST ${C}/:c/import`, 200, { request: collectionImportRequest, response: collectionImportResult }],
  [`GET ${C}/:c/export`, 200, { query: collectionExportQuery }],
]

const section = ROUTES.filter((r) => r.section === 'collections')
const find = (route: string): Row | undefined => ROUTES.find((r) => key(r) === route)
const row = (route: string): Row => {
  const found = find(route)
  if (!found) throw new Error(`no route ${route}`)
  return found
}

describe('the collections section of the route manifest', () => {
  it('is titled App collections', () => {
    expect(ROUTE_SECTIONS.find((s) => s.id === 'collections')).toEqual({ id: 'collections', title: 'App collections' })
  })

  it('holds exactly the routes listed above, each once', () => {
    const expected = [...DEVELOPER, ...CLIENT].map(([route]) => route)
    expect(section.map(key).sort()).toEqual([...expected].sort())
    for (const route of expected) expect(ROUTES.filter((r) => key(r) === route), route).toHaveLength(1)
    expect(section).toHaveLength(33)
  })

  it('names the schemas and the success status of every route', () => {
    for (const [route, status, schemas] of [...DEVELOPER, ...CLIENT]) {
      const r = row(route)
      expect(r.status, `${route} status`).toBe(status)
      expect(r.query, `${route} query`).toBe(schemas.query ?? null)
      expect(r.request, `${route} request`).toBe(schemas.request ?? null)
      expect(r.response, `${route} response`).toBe(schemas.response ?? null)
    }
  })

  it('describes every path parameter, in the order of the path', () => {
    for (const r of section) {
      const inPath = [...r.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
      expect(r.params.map((p) => p.name), key(r)).toEqual(inPath)
      for (const p of r.params) expect(p.description.length, `${key(r)} :${p.name}`).toBeGreaterThan(20)
    }
  })

  it('lists only catalogued error codes, and names the ones the cloud answers', () => {
    for (const r of section) for (const code of r.errors) expect(ERROR_CODES, `${key(r)} lists ${code}`).toContain(code)
    expect(row(`POST ${A}/:c/records`).errors).toEqual(
      expect.arrayContaining(['required_missing', 'reference_invalid', 'robot_not_attached', 'plan_limit', 'rate_limited', 'collection_not_found']),
    )
    expect(row(`PATCH ${A}/:c/records/:rid`).errors).toContain('record_changed')
    expect(row(`DELETE ${A}/:c/records/:rid`).errors).toContain('record_referenced')
    for (const route of [`POST ${A}/schema/publish`, `POST ${A}/schema/versions/:v/restore`, `POST ${A}/history/purge`, `POST ${A}/:c/import`, `POST ${C}/:c/import`]) {
      expect(row(route).errors, route).toContain('confirmation_required')
    }
    // Only a request that can be told to confirm lists the refusal.
    for (const r of section.filter((x) => x.errors.includes('confirmation_required'))) expect(r.method, key(r)).toBe('POST')
  })
})

describe('who is addressed', () => {
  it('addresses developers on the app routes, with the developer guard', () => {
    for (const [route] of DEVELOPER) {
      const r = row(route)
      expect(r.audience, route).toBe('developer')
      expect(r.auth, route).toBe('developer')
      expect(r.rateLimited, route).toBe(false)
      expect(r.transport, route).toBe('http')
      expect(r.errors, route).toEqual(expect.arrayContaining(['unauthorized', 'token_expired', 'token_revoked']))
    }
  })

  it('addresses app users and server keys on the client twins, with the guard that takes either', () => {
    for (const [route] of CLIENT) {
      const r = row(route)
      expect(r.audience, route).toBe('client')
      expect(r.auth, route).toBe('developer_or_client')
      expect(r.rateLimited, route).toBe(false)
      expect(r.errors, route).toEqual(expect.arrayContaining(['unauthorized', 'token_expired', 'token_revoked', 'forbidden']))
    }
  })

  it('has no client twin of a schema or purge route', () => {
    for (const r of section.filter((x) => x.audience === 'client')) {
      expect(r.path, key(r)).not.toMatch(/\/schema|\/history\/purge/)
    }
  })

  it('gives every client record, import and export route the developer route it is the twin of', () => {
    for (const [route] of CLIENT.filter(([s]) => s !== `GET ${C}`)) {
      const r = row(route)
      const wanted = r.path.replace(C, A)
      const found = ROUTES.find((x) => x.method === r.method && x.path === wanted)
      expect(found, `${route} has no twin ${wanted}`).toBeDefined()
      expect(found!.request, route).toBe(r.request)
      expect(found!.query, route).toBe(r.query)
      expect(found!.response, route).toBe(r.response)
      expect(found!.status, route).toBe(r.status)
    }
  })
})

describe('the Owner tier', () => {
  it('belongs to the two purge routes and to nothing else in the section', () => {
    const owner = section.filter((r) => r.ownerTier).map(key).sort()
    expect(owner).toEqual([`POST ${A}/history/purge`, `POST ${A}/history/purge-preview`].sort())
  })

  it('answers a developer with tier_required on those and on no other', () => {
    for (const r of section) {
      if (r.ownerTier) expect(r.errors, key(r)).toContain('tier_required')
      else expect(r.errors, key(r)).not.toContain('tier_required')
    }
  })

  it('says that purging is not offered through MCP', () => {
    for (const route of [`POST ${A}/history/purge`, `POST ${A}/history/purge-preview`]) {
      expect(row(route).notes ?? '', route).toMatch(/Owner tier/)
    }
    expect(row(`POST ${A}/history/purge-preview`).notes ?? '').toMatch(/MCP/)
  })
})

describe('the bodies', () => {
  it('lets publish go without one, and no other route in the section', () => {
    expect(row(`POST ${A}/schema/publish`).requestOptional).toBe(true)
    for (const r of section.filter((x) => key(x) !== `POST ${A}/schema/publish`)) expect(r.requestOptional, key(r)).toBeUndefined()
  })

  it('hands back the export as a file, not as JSON', () => {
    for (const route of [`GET ${A}/:c/export`, `GET ${C}/:c/export`]) {
      const r = row(route)
      expect(r.contentType, route).toBe('text/csv')
      expect(r.response, route).toBeNull()
      expect(r.notes ?? '', route).toMatch(/format=json/)
    }
  })

  it('answers a created record with 201 and a deleted one with 204', () => {
    expect(row(`POST ${A}/:c/records`).status).toBe(201)
    expect(row(`POST ${C}/:c/records`).status).toBe(201)
    expect(row(`DELETE ${A}/:c/records/:rid`).status).toBe(204)
    expect(row(`DELETE ${A}/schema/draft`).status).toBe(204)
  })
})

describe('what the notes say', () => {
  it('states the rights rule and the difference between 404 and 403 on the first row of the section', () => {
    const notes = row(`GET ${A}`).notes ?? ''
    expect(notes).toMatch(/access/)
    expect(notes).toMatch(/`own`/)
    expect(notes).toMatch(/collection_not_found/)
    expect(notes).toMatch(/forbidden/)
    expect(notes).toMatch(/organization owner/)
  })

  it('states them again on the first client row, where app users read them', () => {
    const notes = row(`GET ${C}`).notes ?? ''
    expect(notes).toMatch(/access/)
    expect(notes).toMatch(/collection_not_found/)
    expect(notes).toMatch(/forbidden/)
    expect(notes).toMatch(/developer's bearer is answered `403 forbidden`/)
  })

  it('says on the first row of each group who it is for', () => {
    expect(row(`GET ${A}/schema/draft`).notes ?? '').toMatch(/Developers only/)
    expect(row(`GET ${A}/:c/records`).notes ?? '').toMatch(/collection_not_found/)
    expect(row(`GET ${C}/:c/records`).notes ?? '').toMatch(/collection_not_found/)
  })

  it('says that import and export need a server key on the client twins', () => {
    for (const route of [`POST ${C}/:c/import/preview`, `POST ${C}/:c/import`, `GET ${C}/:c/export`]) {
      expect(row(route).notes ?? '', route).toMatch(/server key/i)
      expect(row(route).notes ?? '', route).toMatch(/403 forbidden/)
    }
    // The other client twins do not claim it.
    for (const route of [`GET ${C}/:c/records`, `POST ${C}/:c/records`, `PATCH ${C}/:c/records/:rid`]) {
      expect(row(route).notes ?? '', route).not.toMatch(/A server key only/)
    }
  })

  it('explains the confirmation flow where a token is sent back', () => {
    for (const route of [`POST ${A}/schema/publish`, `POST ${A}/schema/versions/:v/restore`, `POST ${A}/history/purge`, `POST ${A}/:c/import`]) {
      expect(row(route).notes ?? '', route).toMatch(/confirmation_required/)
      expect(row(route).notes ?? '', route).toMatch(/details\.preview|`confirm`/)
    }
  })

  it('writes notes the docs style check accepts', () => {
    for (const r of section) {
      const notes = r.notes ?? ''
      expect(notes, `${key(r)} has a # the docs read as a colour`).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(notes, `${key(r)} sets a bare number in emphasis`).not.toMatch(/\*{1,2}\s*\d+(?:[.,]\d+)?\s*\*{1,2}/)
      expect(r.summary.endsWith('.'), key(r)).toBe(true)
    }
  })
})

describe('the rendered reference', () => {
  it('lists every route in routes.json under the section', () => {
    const artifact = routesArtifact()
    const rendered = artifact.routes.filter((r) => r.section === 'collections')
    expect(rendered).toHaveLength(33)
    expect(artifact.sections.map((s) => s.id)).toContain('collections')
  })

  it('has an OpenAPI operation for every route', () => {
    const paths = openApiDocument().paths as Record<string, Record<string, { tags: string[]; operationId: string }>>
    const ids = new Set<string>()
    for (const [route] of [...DEVELOPER, ...CLIENT]) {
      const [method, path] = route.split(' ') as [string, string]
      const operation = paths[path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')]?.[method.toLowerCase()]
      expect(operation, route).toBeDefined()
      expect(operation!.tags, route).toEqual(['collections'])
      expect(ids.has(operation!.operationId), `${route} repeats an operation id`).toBe(false)
      ids.add(operation!.operationId)
    }
  })

  it('documents the export as a CSV download', () => {
    const paths = openApiDocument().paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>>
    const operation = paths['/api/apps/{id}/collections/{c}/export']?.get
    expect(Object.keys(operation?.responses['200']?.content ?? {})).toEqual(['text/csv'])
  })
})
