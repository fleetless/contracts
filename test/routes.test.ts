import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_SECTIONS, IN_HANDLER_ROUTES, ERROR_CODES } from '../src/index.js'
import { IN_HANDLER_SECURITY, componentSchemaRaw, exportedSchemas, openApiDocument, routesArtifact } from '../scripts/export-schemas.js'

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

  it('marks a body optional only where there is a body to describe', () => {
    for (const r of ROUTES) {
      if (r.requestOptional === undefined) continue
      expect(r.requestOptional, key(r)).toBe(true)
      expect(r.request, `${key(r)} says its body is optional but declares no request schema`).not.toBe(null)
    }
  })

  it('decides security for every in_handler route by name, and for no other', () => {
    expect(Object.keys(IN_HANDLER_SECURITY).sort()).toEqual([...IN_HANDLER_ROUTES].sort())
  })

  /**
   * **`OAUTH_PATHS` is gone, and this test is what is left of the rule it
   * carried.** The constant existed so two repositories could not spell a
   * discovered path differently — and then reproduced the very defect it was
   * created after, standing for months with an `idpStart` entry naming a route
   * the cloud had deleted. Every one of its nine values named a route the
   * app-user-auth cut removes, so the constant went with them.
   *
   * The rule survives as the manifest's own: a path a client discovers is
   * declared here, and the cloud's `route-manifest.test.ts` asserts set
   * equality in both directions. This asserts the constant stays gone, so a
   * later reader does not re-introduce a second list beside the first.
   */
  it('declares the discoverable paths here and nowhere else', async () => {
    const barrel = await import('../src/index.js')
    expect('OAUTH_PATHS' in barrel).toBe(false)
    for (const p of [
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/oauth-protected-resource/mcp',
      '/mcp/oauth/register',
      '/mcp/oauth/token',
    ]) {
      expect(ROUTES.some((r) => r.path === p), `${p} is not in the manifest`).toBe(true)
    }
  })

  /**
   * The routes the app-level OAuth flow served. Set equality against the cloud
   * is enforced there, not here — but a manifest that still listed one of these
   * would make that test fail in the *other* repository, which is a worse place
   * to find out.
   */
  it('lists none of the deleted app OAuth flow', () => {
    const paths = new Set(ROUTES.map((r) => r.path))
    for (const gone of [
      '/oauth/authorize',
      '/oauth/token',
      '/oauth/register',
      '/oauth/consent',
      '/oauth/impersonate',
      '/oauth/idp-callback',
      '/login',
      '/mcp-stub/resource',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/:appIdentifier',
      '/.well-known/oauth-protected-resource',
      '/api/apps/:id/oauth-clients',
      '/api/apps/:id/branding',
      '/api/apps/:id/group',
      '/api/apps/:id/group-usage',
      '/api/org/groups',
      '/api/org/federation',
      '/api/org/users/:id/assignments',
      '/api/org/users/:id/move-group',
      '/api/client/grants',
    ]) {
      expect(paths.has(gone), gone).toBe(false)
    }
    // Non-vacuity: the manifest is not simply empty.
    expect(paths.has('/api/org/users')).toBe(true)
    expect(paths.has('/mcp/oauth/token')).toBe(true)
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
    expect(onDisk.routes.length).toBeGreaterThan(110)
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
    // `transport` as well as `audience`, because `openApiDocument()` filters on
    // both — a websocket entry with a schema would have put a component in the
    // expected set that the document never emits, and this test would have gone
    // red for a document that was right.
    const referenced = new Set(
      routesArtifact()
        .routes.filter((r) => r.audience !== 'internal' && r.transport === 'http')
        // **`r.query` is deliberately absent.** A query schema's properties are
        // inlined into the operation's `parameters`, so nothing in the document
        // ever points at the schema by name and it is not registered as a
        // component. Listing it here would demand a component no `$ref`
        // reaches — the orphan the hygiene block below refuses.
        .flatMap((r) => [r.request, r.response])
        .filter((n): n is string => n !== null),
    )
    // A recursive sub-schema is hoisted out of its component's `$defs` and named
    // `<component>--<defName>`, so the document carries components no route
    // references by name. They are admitted by SHAPE — the half before `--` must
    // be a referenced component — rather than listed, which would make this
    // assertion agree with whatever the renderer happened to produce.
    const expected = new Set([...referenced, 'api-error'])
    for (const name of Object.keys(doc.components.schemas)) {
      if (expected.has(name)) continue
      const [parent, def] = name.split('--')
      expect(expected.has(parent!) && def !== undefined && def.length > 0, `${name} is neither referenced nor a hoisted definition of a referenced component`).toBe(true)
      expected.add(name)
    }
    expect(Object.keys(doc.components.schemas).sort()).toEqual([...expected].sort())
    for (const s of Object.values(doc.components.schemas)) expect(s).not.toHaveProperty('$schema')
  })

  it('resolves every $ref in the whole document, and leaves no $defs anywhere', () => {
    const doc = openApiDocument()
    const names = new Set(Object.keys(doc.components.schemas))
    const refs: string[] = []
    const defs: string[] = []
    // Walked over the WHOLE document rather than over the components map: a
    // pointer inside an operation, inside a hoisted definition, or inside a
    // query parameter's inline schema is exactly as dangling as one at the top
    // of a component, and reading only the obvious level is how fourteen refs
    // to `#/$defs/__schema0` shipped in the first place.
    const walk = (value: unknown, where: string): void => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${where}[${i}]`))
      if (value === null || typeof value !== 'object') return
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === '$ref' && typeof v === 'string') refs.push(`${where}: ${v}`)
        else if (k === '$defs') defs.push(`${where}.$defs`)
        walk(v, `${where}.${k}`)
      }
    }
    walk(doc, '#')
    expect(defs, 'a $defs survived the hoist').toEqual([])
    expect(refs.length, 'the document has no $refs at all, which cannot be right').toBeGreaterThan(0)
    const dangling = refs.filter((r) => {
      const target = r.slice(r.indexOf(': ') + 2)
      return !target.startsWith('#/components/schemas/') || !names.has(target.slice('#/components/schemas/'.length))
    })
    expect(dangling, 'these $refs resolve to nothing').toEqual([])
  })

  it('says how the in-handler routes are authenticated, in the document a client reads', () => {
    const doc = openApiDocument()
    // `POST /mcp` needs a real bearer, so an empty `security` there would say
    // the opposite of what the route does. The two asset links genuinely have
    // no expressible scheme, and the description has to carry that instead.
    expect(doc.paths['/mcp'].post.security).toEqual([{ clientToken: [] }])
    for (const p of ['/api/asset-links/{token}', '/api/asset-links/missing']) {
      expect(doc.paths[p].get.security, p).toEqual([])
      expect(doc.paths[p].get.description, p).toMatch(/^The signed token in the path is the credential; no other authentication applies\./)
    }
  })

  it('requires a request body except where the handler accepts none', () => {
    const doc = openApiDocument()
    const optional = ROUTES.filter((r) => r.requestOptional === true).map((r) => `${r.method} ${r.path}`)
    expect(optional).toContain('POST /api/robots/:id/jobs/:slug/cancel')
    for (const [p, item] of Object.entries(doc.paths)) {
      for (const [m, op] of Object.entries(item as Record<string, { requestBody?: { required: boolean } }>)) {
        if (op.requestBody === undefined) continue
        const key = `${m.toUpperCase()} ${p.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ':$1')}`
        expect(op.requestBody.required, key).toBe(!optional.includes(key))
      }
    }
  })
})

/**
 * The parked items carried over from the 0.15.0 route-manifest round: the
 * routes whose shape the manifest knew only in prose.
 */
describe('the parked-items round', () => {
  it('names the invitation routes under /api/org/invitations and nothing under /api/org/users/invitations', () => {
    const keys = ROUTES.map(key)
    for (const k of [
      'POST /api/org/invitations',
      'GET /api/org/invitations',
      'DELETE /api/org/invitations/:id',
      'POST /api/org/invitations/:id/reissue',
      'POST /api/org/invitations/accept',
    ]) expect(keys).toContain(k)
    expect(keys.filter((k) => k.includes('/api/org/users/invitations'))).toEqual([])
  })

  it('leaves no prose in the manifest naming the retired invitation prefix', () => {
    // The paths above are the easy half. A `notes` or a param description still
    // spelling `/api/org/users/invitations` documents a route that answers 404,
    // which is the "documented answer no caller can receive" failure this file
    // exists to catch — and it is invisible to the path assertion above.
    const stale = ROUTES.filter((r) =>
      [r.summary, r.notes ?? '', ...r.params.map((p) => p.description)].some((t) => t.includes('/api/org/users/invitations')),
    )
    expect(stale.map(key)).toEqual([])
  })

  it('gives every documented JSON route a response schema or a content type', () => {
    const silent = ROUTES.filter(
      (r) =>
        r.audience !== 'internal' &&
        r.transport === 'http' &&
        r.response === null &&
        r.contentType === undefined &&
        ![204, 302, 202, 404].includes(r.status) &&
        r.path !== '/mcp',
    )
    expect(silent.map(key)).toEqual([])
  })

  it('contentType implies no schema and http', () => {
    for (const r of ROUTES.filter((r) => r.contentType !== undefined)) {
      expect(r.response, key(r)).toBeNull()
      expect(r.transport).toBe('http')
      expect(r.contentType).toMatch(/^[a-z]+\/[a-z0-9.+*-]+$/)
    }
    expect(ROUTES.filter((r) => r.contentType !== undefined).map(key).sort()).toEqual([
      'GET /api/asset-links/:token',
      'GET /api/audit/export',
      'GET /api/robots/:id/assets/:assetId',
      'GET /api/robots/:id/cameras/:slug/snapshot',
      'GET /api/robots/:id/urdf',
    ])
  })

  /**
   * Four of the nine routes this listed went with the app OAuth flow and the
   * group model. The rule is unchanged: a route whose prose names a
   * `?parameter=` declares a schema for it. `GET /api/org/users` left the list
   * rather than the manifest — its group filter described a model with no
   * successor, so it now takes no query at all.
   */
  it('declares a query schema on the routes that read one by hand', () => {
    for (const [m, p] of [
      ['GET', '/api/org/alerts'],
      ['DELETE', '/api/robots/:id'],
      ['GET', '/api/org/health'],
      ['GET', '/api/robots/:id/assets/missing'],
    ] as const) {
      const entry = ROUTES.find((r) => r.method === m && r.path === p)
      // **The entry is asserted before its `query` is.** `find(...)?.query` is
      // `undefined` both when a route declares no schema and when the route is
      // not in the manifest at all — one value for the two states this test
      // exists to tell apart, so a renamed path would have read as a passing
      // check on a route that no longer exists.
      expect(entry, `${m} ${p} is not in the manifest`).toBeDefined()
      expect(entry!.query, `${m} ${p} declares no query schema`).not.toBeNull()
    }
  })

  /**
   * **The rule, checked on the condition rather than on the wording.** A
   * documented route whose prose names a `?parameter=` must declare a query
   * schema. This is the guard that matters: an author who adds an undeclared
   * query and writes no confession at all still trips it, which the phrase
   * test below cannot do.
   *
   * Scoped to `audience !== 'internal'` because that is the scope of the rule
   * — a browser page the cloud serves to itself is not a documented API
   * surface — and to `transport === 'http'`, since the two websocket entries
   * carry no schemas by construction.
   */
  it('declares a query schema wherever a documented route names a query parameter', () => {
    // The one route that names a query it does not read: its
    // `registration_endpoint` VALUE is `…?app_identifier=`, which is another
    // route's parameter quoted inside this one's response. Listed with its
    // reason rather than pattern-matched away, because the next exemption
    // should have to be argued for too.
    const quotesAnothersQuery = ['GET /.well-known/oauth-authorization-server/:appIdentifier']
    const undeclared = ROUTES.filter(
      (r) =>
        r.audience !== 'internal' &&
        r.transport === 'http' &&
        r.query === null &&
        /\?[a-z_]+=/.test(`${r.summary} ${r.notes ?? ''}`) &&
        !quotesAnothersQuery.includes(key(r)),
    )
    expect(undeclared.map(key)).toEqual([])
  })

  /**
   * **And the wording, so the confession cannot be written either.** Every
   * phrase below appeared in this manifest while a route read a query
   * contracts could not describe, and each was removed by declaring the
   * schema rather than by rewording.
   *
   * **Query-specific on purpose.** A blanket ban on "no schema" would be red
   * at base on seven entries that are not about queries at all, and would
   * demand changes this project has argued against in writing: the
   * `{ "name": string }` role body that contracts deliberately does not
   * define, the impersonation wrapper, `POST /mcp/oauth/register`'s body —
   * whose notes say a strict schema there *"would answer 400 to a conforming
   * client and take the whole paste-the-URL flow down with it"* — and three
   * internal pages answering a cloud-local `{ next }`. A ratchet that fires on
   * deliberate, documented decisions is one somebody turns off.
   */
  it('lets no entry document a query as schema-free', () => {
    const confessions = [
      'no query schema',
      'declares no schema for it',
      'declares no schema for this query',
      'the parameter is read directly',
      'read parameter by parameter',
    ]
    const guilty = ROUTES.flatMap((r) => {
      const prose = `${r.summary} ${r.notes ?? ''}`.toLowerCase()
      return confessions.filter((c) => prose.includes(c)).map((c) => `${key(r)}: "${c}"`)
    })
    expect(guilty).toEqual([])
  })

  it('reserves every literal segment that shadows a slug in the same collection', async () => {
    // **Why `history` is in `RESERVED_SLUGS` at all**, asserted rather than
    // left in a comment: `GET /api/robots/:id/jobs/history` is a literal
    // sibling of `GET /api/robots/:id/jobs/:slug`, so an action named
    // `history` would have a job route no caller can reach. The manifest is
    // what decides this, which is why the guard lives here rather than beside
    // the constant — remove either half and it goes red.
    //
    // Derived from `:slug` positions rather than written as a list, so a
    // literal added beside a future slug collection is swept the day it
    // exists. The **prefix** is what makes a sibling: the first draft matched
    // any path ending `/jobs/<word>` and flagged `GET /api/org/jobs/summary`,
    // which is a different collection with no `:slug` in it at all — a guard
    // shaped like the assumption instead of like the collision.
    //
    // `indexOf`, not `endsWith`: a slug collection whose routes **continue
    // past the slug** is still a slug collection. `/api/robots/:id/cameras`
    // has no route ending in `/:slug` at all — every one goes on to
    // `/snapshot`, `/meta` or `/live` — so an `endsWith` derivation never
    // looked at it, and the sweep silently covered four of the five
    // collections while reporting on all of them.
    const { RESERVED_SLUGS } = await import('../src/index.js')
    const prefixes = new Set(ROUTES.filter((r) => r.path.includes('/:slug')).map((r) => r.path.slice(0, r.path.indexOf('/:slug'))))
    expect(prefixes.size, 'no :slug route to be shadowed').toBeGreaterThan(0)
    expect([...prefixes].sort()).toEqual([
      '/api/robots/:id/cameras',
      '/api/robots/:id/config/slug-usage',
      '/api/robots/:id/datapoints',
      '/api/robots/:id/jobs',
      '/api/robots/:id/publishers',
    ])
    const siblings = ROUTES.filter(
      (r) => [...prefixes].some((p) => r.path.startsWith(`${p}/`) && !r.path.slice(p.length + 1).includes('/') && r.path !== `${p}/:slug`),
    ).map((r) => r.path.slice(r.path.lastIndexOf('/') + 1))
    // Named, so that a sibling silently disappearing turns this into the
    // vacuous `.every()` over an empty array rather than a green run.
    expect([...new Set(siblings)].sort()).toEqual(['history'])
    for (const l of siblings) expect([...RESERVED_SLUGS], `a literal \`${l}\` segment shadows a slug of that name`).toContain(l)
  })
})

/**
 * **OpenAPI is not the editor's copy of a schema.** `src/config.ts` carries
 * `defaultSnippets`, `patternErrorMessage` and `enumDescriptions` in its
 * `.meta()` for the console's Monaco YAML editor — vendor keywords no OpenAPI
 * reader knows, which travel into every component hoisted from a schema that
 * has them. They stay in the per-file `artifacts/schema/*.json`, which is
 * where the editor reads them from; the first assertion below proves the strip
 * is scoped to the OpenAPI render rather than applied to the source.
 */
describe('openapi hygiene', () => {
  // The three the config schemas actually carry. `stripEditorKeywords` removes
  // five; the other two (`markdownDescription`, `markdownEnumDescriptions`) are
  // stripped pre-emptively and appear in no source, so asserting their presence
  // here would assert something untrue about the artifact.
  const EDITOR_KEYS_IN_USE = ['defaultSnippets', 'patternErrorMessage', 'enumDescriptions']

  /**
   * **An allowlist, because a denylist here shares its list with the thing it
   * is checking.** The first version of this assertion walked the document for
   * the same five keys `stripEditorKeywords` removes — so a *sixth* vendor
   * keyword added to `src/config.ts` would pass the exporter and pass the test,
   * for the same reason and at the same moment. Two halves of one list is one
   * mechanism, and a guard cannot be the thing it guards.
   *
   * So the assertion is inverted: every key at a schema-keyword position must
   * be a keyword JSON Schema 2020-12 or OpenAPI 3.1 defines. The exporter keeps
   * its denylist — an allowlist that *strips* would silently drop a legitimate
   * keyword a zod upgrade starts emitting, which is a worse failure than noise
   * because nothing would report it.
   *
   * A red here is not automatically a bug: it says a key nobody classified
   * reached the document, and names it and its path so the reader can decide
   * whether to strip it or widen this list.
   */
  const OPENAPI_SCHEMA_KEYWORDS = new Set(
    ('$ref $defs $comment $id $schema type properties required additionalProperties items prefixItems anyOf oneOf allOf ' +
      'not enum const default description title examples deprecated readOnly writeOnly format pattern minLength maxLength ' +
      'minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minItems maxItems uniqueItems minProperties maxProperties ' +
      'propertyNames patternProperties contains minContains maxContains if then else dependentRequired dependentSchemas ' +
      'unevaluatedProperties unevaluatedItems contentMediaType contentEncoding contentSchema discriminator xml externalDocs ' +
      'example nullable').split(' '),
  )

  // Which keywords hold schemas, and in what shape. Descending is driven by
  // this rather than by "anything that is an object", because `enum`, `const`,
  // `examples` and `default` hold **data** — a user-supplied object in an
  // `examples` array would otherwise have its own field names read as
  // keywords. The keys of the name-keyed maps are names too, and are skipped
  // for the same reason: `properties.defaultSnippets` is a field called
  // `defaultSnippets`, not the editor keyword.
  const NAME_KEYED_SCHEMA_MAPS = ['properties', '$defs', 'patternProperties', 'dependentSchemas']
  const SINGLE_SCHEMA = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema']
  const SCHEMA_LIST = ['anyOf', 'oneOf', 'allOf', 'prefixItems']

  it('carries only JSON Schema and OpenAPI keywords, and leaves the editor its own', () => {
    const doc = openApiDocument()
    const offenders: string[] = []
    const distinct = new Set<string>()
    let nodes = 0
    const walkSchema = (node: unknown, path: string) => {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return
      nodes += 1
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        distinct.add(k)
        if (!OPENAPI_SCHEMA_KEYWORDS.has(k)) offenders.push(`${k} at ${path}.${k}`)
        if (NAME_KEYED_SCHEMA_MAPS.includes(k)) for (const [n, sub] of Object.entries((v as Record<string, unknown>) ?? {})) walkSchema(sub, `${path}.${k}.${n}`)
        else if (SINGLE_SCHEMA.includes(k)) walkSchema(v, `${path}.${k}`)
        else if (SCHEMA_LIST.includes(k)) (v as unknown[]).forEach((sub, i) => walkSchema(sub, `${path}.${k}[${i}]`))
      }
    }

    // The schema positions, enumerated rather than found by shape: a walk of
    // the whole document would read `info`, `servers`, `tags` and every
    // operation's own keys as schema keywords and drown the assertion.
    let entries = 0
    for (const [name, schema] of Object.entries(doc.components.schemas as Record<string, unknown>)) { entries += 1; walkSchema(schema, `components.schemas.${name}`) }
    for (const [p, item] of Object.entries(doc.paths as Record<string, Record<string, any>>)) {
      for (const [m, op] of Object.entries(item)) {
        for (const [i, par] of ((op.parameters ?? []) as any[]).entries()) if (par.schema) { entries += 1; walkSchema(par.schema, `paths.${p}.${m}.parameters[${i}].schema`) }
        for (const [mt, c] of Object.entries((op.requestBody?.content ?? {}) as Record<string, any>)) if (c.schema) { entries += 1; walkSchema(c.schema, `paths.${p}.${m}.requestBody.content['${mt}'].schema`) }
        for (const [code, r] of Object.entries((op.responses ?? {}) as Record<string, any>)) for (const [mt, c] of Object.entries((r.content ?? {}) as Record<string, any>)) if (c.schema) { entries += 1; walkSchema(c.schema, `paths.${p}.${m}.responses.${code}.content['${mt}'].schema`) }
      }
    }

    // **The walk has to be shown to have happened.** An assertion over an
    // empty `offenders` is green whether the document is clean or the walker
    // descended into nothing at all — the vacuous `.every()` in another shape.
    // Floors rather than exact counts, so adding a route does not edit this.
    expect(entries, 'no schema position was visited').toBeGreaterThan(300)
    expect(nodes, 'the walker never descended past the entry points').toBeGreaterThan(1000)
    // Three keywords that can only be reached by descending through a
    // name-keyed map, a schema list and a `$ref` respectively.
    for (const k of ['properties', 'oneOf', '$ref']) expect([...distinct], `never reached a ${k}`).toContain(k)

    expect(offenders).toEqual([])

    // The strip is OpenAPI-only: the per-file artifact the console's editor
    // loads still carries every one of them.
    for (const k of EDITOR_KEYS_IN_USE) expect(JSON.stringify(componentSchemaRaw('robot-config-doc')), k).toContain(k)
  })

  it('registers exactly the components something references', () => {
    const doc = openApiDocument()
    const refs = new Set<string>()
    JSON.stringify(doc, (k, v) => { if (k === '$ref' && typeof v === 'string') refs.add(v.replace('#/components/schemas/', '')); return v })
    expect(refs.size, 'no $ref found at all — the walk is looking at the wrong shape').toBeGreaterThan(0)
    expect(Object.keys(doc.components.schemas).sort()).toEqual([...refs].sort())
  })

  it('answers bytes with a content entry on the five byte routes', () => {
    const doc = openApiDocument()
    const op = doc.paths['/api/audit/export'].get
    expect(op.responses['200'].content['text/csv'].schema).toEqual({ type: 'string' })
    const snap = doc.paths['/api/robots/{id}/cameras/{slug}/snapshot'].get
    expect(snap.responses['200'].content['image/*'].schema).toEqual({ type: 'string', format: 'binary' })
  })

  it('carries contentType in routes.json, once per byte route', () => {
    const carriers = routesArtifact().routes.filter((r) => r.contentType !== undefined)
    expect(carriers.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      ROUTES.filter((r) => r.contentType !== undefined).map(key).sort(),
    )
    expect(carriers.length, 'no route carries a contentType — the manifest half is missing').toBe(5)
    // Key order is what the documentation site reads: `contentType` sits
    // between `response` and `errors`, not appended past `transport`.
    for (const r of carriers) {
      const keys = Object.keys(r)
      expect(keys.indexOf('contentType'), `${r.method} ${r.path}`).toBe(keys.indexOf('response') + 1)
    }
  })
})
