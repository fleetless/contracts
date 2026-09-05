import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_SECTIONS, IN_HANDLER_ROUTES, ERROR_CODES, mailOutcome, CLIENT_OIDC_CALLBACK_PATH, clientOidcCallbackQuery, clientOidcErrorCode } from '../src/index.js'
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

  /**
   * **The federated MCP callback, which D1 leaves with no flow to resume.**
   * `GET /mcp/oauth/idp-callback` existed so a group's identity provider could
   * redirect a browser back into the central sign-in; Fleetless users are
   * password-only, so nothing can start that round trip. It survived the cut as
   * a handler that ignored its input and answered `400`, documented in this
   * manifest as a `302` that "resumes the MCP sign-in as the federated user" —
   * a route reference telling a customer's still-configured IdP that the
   * sign-in continues. Deleted in both repositories, and guarded here because
   * the manifest is what a re-add would have to pass through.
   */
  it('lists no federated MCP callback — Fleetless users sign in with a password and nothing else', () => {
    const paths = new Set(ROUTES.map((r) => r.path))
    expect(paths.has('/mcp/oauth/idp-callback')).toBe(false)
    // Non-vacuity: the rest of that flow is still here.
    expect(paths.has('/mcp/oauth/identify')).toBe(true)
    expect(paths.has('/mcp/oauth/login')).toBe(true)
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
 * **The app-user auth surface, pinned as two sets rather than as examples.**
 *
 * The cloud registers these routes in a later task of the same train and its
 * `route-manifest.test.ts` asserts set equality with `ROUTES` in both
 * directions — so what is written here is what the cloud must serve, and an
 * implementer reading one row is reading their contract.
 *
 * Both assertions are over the **set**, which is the whole reason they exist.
 * A guard written against one hand-picked route proves that route and says
 * nothing about the seventeen beside it, and this project has paid for that
 * shape seven times in one wave: an enum guard that checked arity, an identity
 * test that compared labels while the bodies diverged, a message rule verified
 * on the one document that happened to be converted. So each block names every
 * member, asserts the count, and then asserts the property over all of them —
 * a route added to the family without the guard, or dropped from it, fails on
 * the membership line before the property line is reached.
 */
describe('the app-user auth surface', () => {
  /**
   * The public half. Every one is reachable without a credential, because the
   * person calling it does not have one yet — they are registering, spending a
   * mailed token or accepting an invitation. `auth: 'none'` is therefore the
   * *design*, not an omission, and the rate limiter is the only thing standing
   * in front of them: `rateLimited` is asserted here beside it so that reading
   * "no auth" can never be read as "no protection".
   *
   * Login, refresh and logout are train 1's and carry exactly this shape —
   * each takes its credential in the body rather than in a header, so none of
   * them has a guard either. They are in the list because the property is about
   * the family, not about what landed when.
   */
  const PUBLIC_CLIENT = [
    'POST /api/client/login',
    'POST /api/client/refresh',
    'POST /api/client/logout',
    'POST /api/client/register',
    'POST /api/client/verify-email',
    'POST /api/client/resend-verification',
    'POST /api/client/password/reset',
    'POST /api/client/password/reset/confirm',
    'POST /api/client/invitations/accept',
    'POST /api/client/oidc/exchange',
  ]

  /**
   * **Filtered to `POST`, and the narrowing is train 3's, not a loosening.**
   * The property this asserts is about routes that parse a **body** handed over
   * by a stranger, which is what the `request` assertion below reads and what
   * the rate limiter in front of them is sized for. Train 3 adds two public
   * `GET`s to the same section — the provider listing and the OIDC start — and
   * neither takes a body, neither is rate limited on the same footing, and one
   * is not rate limited at all. Sweeping them in here would have forced this
   * block to grow exceptions until it asserted nothing; they get their own set
   * pin below, which states each limiter decision and its reason instead.
   */
  it('opens the whole public client POST family without a credential, behind the rate limiter', () => {
    const rows = ROUTES.filter((r) => r.section === 'client-auth' && r.auth === 'none' && r.audience === 'client' && r.method === 'POST')
    expect(rows.map(key).sort(), 'the public client family is exactly these routes').toEqual([...PUBLIC_CLIENT].sort())
    expect(rows.length).toBe(PUBLIC_CLIENT.length)
    for (const r of rows) {
      expect(r.rateLimited, `${key(r)} is unauthenticated and not rate limited`).toBe(true)
      expect(r.errors, `${key(r)} is rate limited and does not say so`).toContain('rate_limited')
      // Each one parses a body it was handed by a stranger; a route in this
      // family with no request schema would be taking input nothing describes.
      expect(r.request, `${key(r)} takes no described body`).not.toBeNull()
    }
  })

  /**
   * The developer half: everything hanging off an app that concerns its users,
   * its invitations, its auth configuration or its mail templates.
   *
   * Derived from the path by prefix rather than listed only as literals, so a
   * nineteenth route added under one of the four collections is swept the day
   * it exists — and then pinned against the literal list, so one silently
   * disappearing turns the sweep into the vacuous filter over an empty array
   * this codebase keeps catching.
   */
  const APP_AUTH_FAMILY = /^\/api\/apps\/:id\/(users|invitations|auth-config|mail-templates)(\/|$)/

  const APP_AUTH_ROUTES = [
    'GET /api/apps/:id/users',
    'POST /api/apps/:id/users',
    'GET /api/apps/:id/users/:userId',
    'PATCH /api/apps/:id/users/:userId',
    'DELETE /api/apps/:id/users/:userId',
    'POST /api/apps/:id/users/:userId/reset-password',
    'GET /api/apps/:id/invitations',
    'POST /api/apps/:id/invitations',
    'POST /api/apps/:id/invitations/:invId/reissue',
    'DELETE /api/apps/:id/invitations/:invId',
    'GET /api/apps/:id/auth-config',
    'PUT /api/apps/:id/auth-config',
    'GET /api/apps/:id/mail-templates',
    'GET /api/apps/:id/mail-templates/:kind',
    'PUT /api/apps/:id/mail-templates/:kind',
    'DELETE /api/apps/:id/mail-templates/:kind',
    'POST /api/apps/:id/mail-templates/:kind/preview',
    'POST /api/apps/:id/mail-templates/:kind/test',
  ]

  /**
   * **The three codes the developer guard sends, read off a route that has
   * nothing else.**
   *
   * Written as a derivation rather than as three string literals because
   * `DEVELOPER_GUARD` is private to `routes.ts`: a literal copy here would be a
   * second list beside the first, and the second is always the one that drifts.
   * `GET /api/auth/me` lists the guard and no code of its own, so its `errors`
   * *is* the constant — and the length assertion below is what makes that claim
   * checkable rather than assumed.
   */
  const guard = ROUTES.find((r) => key(r) === 'GET /api/auth/me')!.errors

  it('guards every app-user, invitation, auth-config and mail-template route with the developer guard', () => {
    expect(guard.length, 'GET /api/auth/me no longer lists the bare developer guard').toBe(3)
    expect([...guard].sort()).toEqual(['token_expired', 'token_revoked', 'unauthorized'])

    const rows = ROUTES.filter((r) => APP_AUTH_FAMILY.test(r.path))
    expect(rows.map(key).sort(), 'the app auth family is exactly these routes').toEqual([...APP_AUTH_ROUTES].sort())
    expect(rows.length).toBe(APP_AUTH_ROUTES.length)

    for (const r of rows) {
      expect(r.auth, `${key(r)} is not developer-guarded`).toBe('developer')
      expect(r.audience, `${key(r)} is not addressed to a developer`).toBe('developer')
      expect(r.section, `${key(r)} is filed outside the apps section`).toBe('apps')
      for (const c of guard) expect(r.errors, `${key(r)} does not list the guard's ${c}`).toContain(c)
      // Every one takes an app uuid in the path, so every one can be handed a
      // string that is not one. A row that does not say so documents a refusal
      // its caller will receive anyway.
      expect(r.errors, `${key(r)} takes :id and does not list invalid_uuid`).toContain('invalid_uuid')
      expect(r.errors, `${key(r)} cannot say the app does not exist`).toContain('not_found')
      expect(r.notes, `${key(r)} says nothing about what it does or what it refuses`).toBeTruthy()
    }
  })

  /**
   * **Every dead token collapses onto one code, on all three routes that spend
   * one.** The first draft of this manifest split them — `token_expired` for one
   * past its lifetime, `invalid_token` for a string that is no token,
   * `invite_expired` and `invite_used` on the invitation route — on the argument
   * that the recoveries differ and the app should be able to say which.
   *
   * They do not differ enough to pay for it. `token_spent`'s own entry in
   * `errors.ts` makes the call: distinguishing them tells a stranger whether a
   * token ever existed, and asking for a new link is the recovery in every case.
   * A split here would also have been the only place on the client surface where
   * an answer varies by whether something exists, which is the discipline the
   * whole family is built around.
   *
   * The assertion is written as a **denial over the set**, not as a check that
   * `token_spent` is listed: listing the right code proves nothing about the
   * four wrong ones sitting beside it, and a row that answered both would pass a
   * presence-only test while documenting exactly the oracle this forbids. The
   * `notes` check is the third arm — the lead's ruling asked each row to say why
   * there is one code, and prose that goes missing is invisible to a test over
   * `errors` alone.
   */
  const TOKEN_SPENDING = [
    'POST /api/client/verify-email',
    'POST /api/client/password/reset/confirm',
    'POST /api/client/invitations/accept',
    // Train 3's. Not a mailed link, and the argument still lands: the one-time
    // code from an OIDC callback IS a credential, so unknown, expired, spent
    // and PKCE-mismatched collapse for the same reason. The interaction *id*
    // beside it does not — its own client learns it from its own redirect —
    // which is why `interaction_expired` exists and is denied below.
    'POST /api/client/oidc/exchange',
  ]

  it('collapses every dead token onto token_spent, and says so, on all four routes that spend one', () => {
    const rows = ROUTES.filter((r) => TOKEN_SPENDING.includes(key(r)))
    expect(rows.map(key).sort(), 'the token-spending routes are exactly these four').toEqual([...TOKEN_SPENDING].sort())

    for (const r of rows) {
      const errors: readonly string[] = r.errors
      expect(errors, `${key(r)} spends a token and cannot say the token is dead`).toContain('token_spent')
      for (const split of ['token_expired', 'token_revoked', 'invalid_token', 'invite_expired', 'invite_used', 'interaction_expired']) {
        expect(errors, `${key(r)} splits a dead token into ${split}, which is the enumeration oracle`).not.toContain(split)
      }
      expect(r.notes ?? '', `${key(r)} does not explain its one refusal`).toContain('token_spent')
    }

    // The two codes that existed only for the split. Asserted here as well as in
    // `identity-apps-and-roles.test.ts` because this is the file that would
    // re-introduce them: a row listing a code is what puts it back in use, and a
    // catalogue entry with no producer is how it got here the first time.
    const codes: readonly string[] = ERROR_CODES
    for (const gone of ['invite_expired', 'invite_used']) {
      expect(codes, `${gone} is back in the catalogue with nothing to emit it`).not.toContain(gone)
    }
  })

  /**
   * **A short password is a `validation_error`, because that is what the cloud
   * sends.**
   *
   * The first draft of these rows listed `weak_password` on all four routes that
   * take one. `weak_password` is in `ERROR_CODES` and has been since before this
   * train, but a grep across `cloud/src`, `cloud/test`, `sdk`, `console` and
   * `bridge` finds **no producer at all**: `POST /api/auth/signup` and
   * `POST /api/auth/password/change` both hand a failed parse to
   * `validationError(reply, parsed.error)`, and the browser sign-up page sends
   * `validation_error` with the message "password must be at least 12
   * characters". The twelve-character minimum is the `password` field's own
   * schema rule, so it fails the same way every other malformed field does.
   *
   * Documenting `weak_password` would therefore have been a refusal no caller
   * can receive — the third failure mode in this project's list — on four routes
   * at once. The assertion is a denial paired with the positive, over the set,
   * because "lists `validation_error`" alone would stay green with
   * `weak_password` sitting beside it.
   */
  const PASSWORD_TAKING = [
    'POST /api/client/register',
    'POST /api/client/password/reset/confirm',
    'POST /api/client/invitations/accept',
    'POST /api/apps/:id/users',
  ]

  it('answers a short password with validation_error on every route that takes one', () => {
    const rows = ROUTES.filter((r) => PASSWORD_TAKING.includes(key(r)))
    expect(rows.map(key).sort(), 'the password-taking routes are exactly these four').toEqual([...PASSWORD_TAKING].sort())

    for (const r of rows) {
      const errors: readonly string[] = r.errors
      expect(errors, `${key(r)} takes a password and cannot refuse a malformed one`).toContain('validation_error')
      expect(errors, `${key(r)} lists weak_password, which nothing in cloud/src emits`).not.toContain('weak_password')
      expect(r.notes ?? '', `${key(r)} does not say what a short password answers`).toContain('validation_error')
    }

    // Non-vacuity, and the precedent the rule is read off: the two developer
    // routes that have taken a password since long before this train answer the
    // same way. If either ever grows a `weak_password`, these rows should be
    // revisited together rather than drifting apart.
    for (const k of ['POST /api/auth/signup', 'POST /api/auth/password/change']) {
      const errors: readonly string[] = ROUTES.find((r) => key(r) === k)!.errors
      expect(errors, `${k} no longer refuses a malformed body`).toContain('validation_error')
      expect(errors, `${k} grew a weak_password; the four rows above assume it has none`).not.toContain('weak_password')
    }
  })

  /**
   * The two `202`s that answer a body. Everything else in this train that
   * answers `202` answers nothing at all, and the difference is deliberate: on
   * the public routes the body would be an enumeration oracle, while on these
   * two the caller is already authenticated into the app and the one thing they
   * need next is whether a mail actually left.
   */
  it('gives the two developer-triggered mail routes a mail outcome and the public 202s no body', () => {
    const withOutcome = ROUTES.filter((r) => r.status === 202 && r.response === mailOutcome).map(key).sort()
    expect(withOutcome).toEqual([
      'POST /api/apps/:id/mail-templates/:kind/test',
      'POST /api/apps/:id/users/:userId/reset-password',
    ])
    for (const k of ['POST /api/client/register', 'POST /api/client/resend-verification', 'POST /api/client/password/reset']) {
      const r = ROUTES.find((x) => key(x) === k)!
      expect(r.status, k).toBe(202)
      expect(r.response, `${k} answers a body a stranger could read an account's existence out of`).toBeNull()
    }
  })
})

/**
 * **The per-app OIDC surface (train 3), pinned as two sets and one path.**
 *
 * Nine rows: five under `/api/apps/:id/oidc-providers` for the developer who
 * configures a provider, and four public ones the app user's browser walks
 * through. The cloud registers exactly these in tasks 3.2 and 3.3, and its
 * `route-manifest.test.ts` asserts set equality with `ROUTES` in both
 * directions — so what is asserted here is what the cloud must serve.
 *
 * Written the way train 2's block is, and for the reason stated there: each
 * assertion names every member, asserts the count, then asserts the property
 * over all of them. A guard written against one hand-picked row proves that row
 * and nothing about the eight beside it.
 */
describe('the per-app OIDC surface', () => {
  const PROVIDER_ROUTES = [
    'GET /api/apps/:id/oidc-providers',
    'POST /api/apps/:id/oidc-providers',
    'GET /api/apps/:id/oidc-providers/:providerId',
    'PATCH /api/apps/:id/oidc-providers/:providerId',
    'DELETE /api/apps/:id/oidc-providers/:providerId',
  ]

  const CLIENT_OIDC_ROUTES = [
    'GET /api/client/providers',
    'GET /api/client/oidc/:slug/start',
    'GET /api/client/oidc/callback',
    'POST /api/client/oidc/exchange',
  ]

  it('adds exactly nine rows for the train, and no tenth path under either prefix', () => {
    const added = ROUTES.filter((r) => /^\/api\/apps\/:id\/oidc-providers(\/|$)/.test(r.path) || /^\/api\/client\/(providers|oidc)(\/|$)/.test(r.path))
    expect(added.map(key).sort(), 'the OIDC surface is exactly these nine routes').toEqual([...PROVIDER_ROUTES, ...CLIENT_OIDC_ROUTES].sort())
    expect(added.length).toBe(9)
  })

  /**
   * The developer half, held to the same four properties train 2's app-auth
   * family is: the developer guard, the app uuid's `invalid_uuid`, a `404` for
   * an app or provider that is not the caller's, and prose.
   *
   * The guard is read off `GET /api/auth/me` rather than retyped, for the
   * reason the other block states — `DEVELOPER_GUARD` is private to
   * `routes.ts`, and a literal copy here would be the second list that drifts.
   */
  const guard = ROUTES.find((r) => key(r) === 'GET /api/auth/me')!.errors

  it('puts every provider route behind the developer guard, in the apps section', () => {
    expect(guard.length, 'GET /api/auth/me no longer lists the bare developer guard').toBe(3)
    const rows = ROUTES.filter((r) => PROVIDER_ROUTES.includes(key(r)))
    expect(rows.map(key).sort(), 'the provider family is exactly these five routes').toEqual([...PROVIDER_ROUTES].sort())
    expect(rows.length).toBe(PROVIDER_ROUTES.length)

    for (const r of rows) {
      expect(r.auth, `${key(r)} is not developer-guarded`).toBe('developer')
      expect(r.audience, `${key(r)} is not addressed to a developer`).toBe('developer')
      expect(r.section, `${key(r)} is filed outside the apps section`).toBe('apps')
      expect(r.rateLimited, `${key(r)} is authenticated and claims a limiter`).toBe(false)
      for (const c of guard) expect(r.errors, `${key(r)} does not list the guard's ${c}`).toContain(c)
      expect(r.errors, `${key(r)} takes :id and does not list invalid_uuid`).toContain('invalid_uuid')
      expect(r.errors, `${key(r)} cannot say the app or the provider does not exist`).toContain('not_found')
      expect(r.notes, `${key(r)} says nothing about what it does or what it refuses`).toBeTruthy()
    }
  })

  /**
   * **The two routes that run discovery say so, and the three that do not, do
   * not.** `provider_misconfigured` and `idp_unavailable` describe a remote
   * system Fleetless fetched; listing either on a route that fetches nothing
   * would document a refusal no caller can receive, and omitting it from one
   * that does leaves a developer reading `502` with no entry to look it up in.
   *
   * Asserted as a partition over all five rather than as a presence check on
   * the two, because the interesting half is the denial: a `GET` that grew
   * these codes is the shape this catches.
   */
  it('lists the discovery refusals on create and patch, and on no other provider route', () => {
    const WRITES = ['POST /api/apps/:id/oidc-providers', 'PATCH /api/apps/:id/oidc-providers/:providerId']
    for (const r of ROUTES.filter((x) => PROVIDER_ROUTES.includes(key(x)))) {
      const errors: readonly string[] = r.errors
      const runsDiscovery = WRITES.includes(key(r))
      for (const c of ['provider_misconfigured', 'idp_unavailable']) {
        expect(errors.includes(c), `${key(r)} ${runsDiscovery ? 'runs discovery and cannot report' : 'fetches nothing and claims'} ${c}`).toBe(runsDiscovery)
      }
      // Both codes are in the catalogue, and both say why they are not each
      // other: one means retry, the other means fix the configuration.
      expect(r.notes ?? '', key(r)).toBeTruthy()
    }
    for (const k of WRITES) {
      const notes = ROUTES.find((r) => key(r) === k)!.notes ?? ''
      expect(notes, `${k} lists two discovery codes and explains neither`).toContain('provider_misconfigured')
      expect(notes, `${k} lists two discovery codes and explains neither`).toContain('idp_unavailable')
    }
  })

  /**
   * **`duplicate_slug` belongs to create alone**, because the slug is the only
   * field that can collide and `patchAppOidcProviderRequest` does not carry it
   * — it is in the path and `app_user_identities` rows are keyed by it. A
   * `PATCH` row listing it would document a refusal the request shape makes
   * unreachable, which is this project's third failure mode.
   */
  it('answers duplicate_slug on create and on nothing else in the family', () => {
    const withDuplicate = ROUTES.filter((r) => PROVIDER_ROUTES.includes(key(r)) && (r.errors as readonly string[]).includes('duplicate_slug'))
    expect(withDuplicate.map(key)).toEqual(['POST /api/apps/:id/oidc-providers'])
    // Non-vacuity in the other direction: the patch is in the family and is the
    // row this would most plausibly drift onto.
    const patch = ROUTES.find((r) => key(r) === 'PATCH /api/apps/:id/oidc-providers/:providerId')!
    expect(patch.errors, 'the patch takes no slug and cannot refuse a duplicate one').not.toContain('duplicate_slug')
    expect(patch.request, 'the patch declares no body to be strict about').not.toBeNull()
  })

  /**
   * The public half. Every one is reached without a credential, because the
   * person walking through it does not have one yet — that is the whole point
   * of the flow. Two of them are also reached by somebody who is not the app
   * at all: the identity provider redirects a browser into the callback.
   */
  it('opens every client OIDC route without a credential, in the client-auth section', () => {
    const rows = ROUTES.filter((r) => CLIENT_OIDC_ROUTES.includes(key(r)))
    expect(rows.map(key).sort(), 'the client OIDC family is exactly these four routes').toEqual([...CLIENT_OIDC_ROUTES].sort())
    expect(rows.length).toBe(CLIENT_OIDC_ROUTES.length)

    for (const r of rows) {
      expect(r.auth, `${key(r)} asks an app user for a credential they do not have yet`).toBe('none')
      expect(r.audience, `${key(r)} is not addressed to an app's own users`).toBe('client')
      expect(r.section, `${key(r)} is filed outside the client-auth section`).toBe('client-auth')
      expect(r.ownerTier, key(r)).toBe(false)
      expect(r.notes, `${key(r)} says nothing about what it does or what it refuses`).toBeTruthy()
      // No credential, so no guard code can reach any of them. A row carrying
      // one would describe a `401` an unauthenticated route cannot send.
      for (const c of ['unauthorized', 'token_expired', 'token_revoked', 'forbidden']) {
        expect(r.errors, `${key(r)} has no guard and lists the guard's ${c}`).not.toContain(c)
      }
    }
  })

  /**
   * **Which of the four are rate limited, stated as a partition and paired
   * with the sentence that says why.**
   *
   * The train-2 family could assert "unauthenticated ⇒ limited" over the whole
   * set. Here it is genuinely mixed, and a mixed set is exactly where a
   * presence-only check stops meaning anything: `start` is the door that makes
   * Fleetless fetch a stranger's server and `exchange` mints a session, while
   * the provider listing is a render-time read of public configuration and the
   * callback is entered by an IdP redirecting a browser — limiting that one
   * would drop real users' sign-ins on somebody else's traffic.
   *
   * So each row is asserted **both ways**, and the two limited ones must also
   * list `rate_limited`: a limiter a caller cannot see documented is a `429`
   * nobody can look up.
   */
  it('limits the start and the exchange, and deliberately not the listing or the callback', () => {
    const LIMITED = ['GET /api/client/oidc/:slug/start', 'POST /api/client/oidc/exchange']
    const rows = ROUTES.filter((r) => CLIENT_OIDC_ROUTES.includes(key(r)))
    expect(rows.length).toBe(CLIENT_OIDC_ROUTES.length)
    for (const r of rows) {
      const limited = LIMITED.includes(key(r))
      expect(r.rateLimited, `${key(r)} rate limiting disagrees with the ruling`).toBe(limited)
      expect((r.errors as readonly string[]).includes('rate_limited'), `${key(r)} limiter and its error code disagree`).toBe(limited)
    }
    // The two unlimited ones say why in prose, because a reader who finds no
    // limiter on a public route should not have to guess whether it was a
    // decision or an omission.
    expect(ROUTES.find((r) => key(r) === 'GET /api/client/providers')!.notes ?? '').toContain('Not rate limited')
    expect(ROUTES.find((r) => key(r) === 'GET /api/client/oidc/callback')!.notes ?? '').toContain('Not rate limited')
    // The two are unlimited for **different** reasons, and a row that copied
    // the other's sentence would pass a bare "says Not rate limited" check
    // while documenting the wrong argument. So each is held to its own.
    expect(ROUTES.find((r) => key(r) === 'GET /api/client/providers')!.notes ?? '').toContain('nothing behind it to enumerate')
    expect(ROUTES.find((r) => key(r) === 'GET /api/client/oidc/callback')!.notes ?? '').toContain('drop real sign-ins')
  })

  /**
   * **The start refuses in JSON, before any redirect** — the open-redirect
   * discipline `GET /mcp/oauth/authorize` and `GET /console/oauth/authorize`
   * already keep. The row is the only place a developer can read that, so the
   * codes and the sentence are both asserted; the codes alone would stay green
   * if the prose that explains the ordering went missing, which is the state
   * that would let somebody "simplify" the refusal into a redirect.
   */
  it('gives the start every refusal it answers as JSON, redirect-URI check first', () => {
    const r = ROUTES.find((x) => key(x) === 'GET /api/client/oidc/:slug/start')!
    expect(r.status, 'the start answers a redirect on the happy path').toBe(302)
    expect(r.response, 'a 302 carries no body').toBeNull()
    expect([...r.errors].sort()).toEqual([
      'idp_unavailable', 'invalid_redirect_uri', 'not_found', 'provider_disabled',
      'provider_misconfigured', 'rate_limited', 'validation_error',
    ])
    expect(r.query, 'the start reads its parameters from the query and declares none').not.toBeNull()
    expect(r.notes ?? '', 'the row does not say the refusals precede the redirect').toContain('before any redirect')
    expect(r.notes ?? '', 'the row does not say the redirect URI is checked first').toContain('checked **first**')
  })

  /**
   * **The callback lists no error code, and that is a claim rather than a
   * gap.** Every outcome it has is a `302` carrying `?code=` or
   * `?error=<clientOidcErrorCode>` to the app's own redirect URI; the single
   * exception renders HTML, which is not the `apiError` envelope the `errors`
   * column describes. Listing `bad_request` would have documented a body no
   * caller receives.
   *
   * The empty list is therefore asserted **together with** the prose that makes
   * it honest — on its own, `errors: []` is indistinguishable from a row
   * somebody forgot to fill in, which is the reading this test exists to
   * prevent.
   */
  it('leaves the callback with no error codes, and says where its failures actually go', () => {
    const r = ROUTES.find((x) => key(x) === 'GET /api/client/oidc/callback')!
    expect(r.errors, 'the callback answers the apiError envelope now; the row must say which codes').toEqual([])
    expect(r.status, 'the callback answers the app with a redirect').toBe(302)
    expect(r.response, 'a 302 carries no body').toBeNull()
    // The provider's own wire, declared rather than read by hand — the rule
    // the parked-items round enforces — and **not strict**, so a provider that
    // adds RFC 9207's `iss` or a `session_state` is not refused at the one
    // point in the flow where refusing means a sign-in that already succeeded
    // is thrown away. `state` is the only required field, because it is the
    // only one Fleetless minted.
    expect(r.query, "the IdP's query is undeclared").toBe(clientOidcCallbackQuery)
    const cb = clientOidcCallbackQuery.shape
    expect(Object.keys(cb).sort()).toEqual(['code', 'error', 'error_description', 'state'])
    expect(clientOidcCallbackQuery.safeParse({ state: 's' }).success, 'code is not optional').toBe(true)
    expect(clientOidcCallbackQuery.safeParse({ code: 'c' }).success, 'state is not required').toBe(false)
    expect(
      clientOidcCallbackQuery.safeParse({ state: 's', code: 'c', iss: 'https://idp.example', session_state: 'x' }).success,
      'a conforming provider sending RFC 9207 iss is refused',
    ).toBe(true)
    const notes = r.notes ?? ''
    expect(notes, 'the row does not say failures ride back on the redirect').toContain('?error=<clientOidcErrorCode>&state=')
    expect(notes, 'the row does not name the one Fleetless-rendered page').toContain('HTML problem page at `400`')
    expect(notes, 'the row does not say which state renders it').toContain('`state` that resolves to no interaction')

    // Non-vacuity for the empty list: some route in this manifest does list
    // codes, so `toEqual([])` is a fact about this row and not about the field.
    expect(ROUTES.find((x) => key(x) === 'POST /api/client/oidc/exchange')!.errors.length).toBeGreaterThan(0)
  })

  /**
   * **One spelling of the callback path, in the manifest and in the constant.**
   *
   * `OAUTH_PATHS` existed to stop two repositories spelling a discovered path
   * differently and then did exactly that, standing for months with an entry
   * naming a route the cloud had deleted. This path is worse to get wrong: it
   * is copied out of the console into somebody else's IdP configuration, where
   * a divergence breaks every sign-in and nothing here can see it.
   *
   * So the row is built **from** the constant — `path: CLIENT_OIDC_CALLBACK_PATH`
   * in `routes.ts` — and this asserts the value as a literal. Comparing the row
   * to the constant alone would be two references to one string agreeing with
   * themselves; the literal is what pins the actual characters a developer
   * types at their provider.
   */
  it('spells the callback path once, and it is the value the constant carries', () => {
    expect(CLIENT_OIDC_CALLBACK_PATH).toBe('/api/client/oidc/callback')
    expect(ROUTES.some((r) => r.path === CLIENT_OIDC_CALLBACK_PATH && r.method === 'GET'), 'the manifest has no row at the constant').toBe(true)
    // And nothing else in the manifest claims a second callback under the same
    // prefix — a route added there would be a second door onto one flow.
    expect(ROUTES.filter((r) => r.path.startsWith('/api/client/oidc/') && r.path.includes('callback')).map(key)).toEqual([
      'GET /api/client/oidc/callback',
    ])
  })

  /** The code train 3 introduces, registered rather than assumed. */
  it('registers provider_misconfigured, distinct from idp_unavailable', () => {
    const codes: readonly string[] = ERROR_CODES
    expect(codes).toContain('provider_misconfigured')
    expect(codes).toContain('idp_unavailable')
    expect(codes.indexOf('provider_misconfigured')).not.toBe(codes.indexOf('idp_unavailable'))
    // It is also one of the redirect codes the callback hands the app, which is
    // a different enum with the same member on purpose.
    expect(clientOidcErrorCode.options).toContain('provider_misconfigured')
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
      '/api/client/oidc',
      '/api/robots/:id/cameras',
      '/api/robots/:id/config/slug-usage',
      '/api/robots/:id/datapoints',
      '/api/robots/:id/jobs',
      '/api/robots/:id/publishers',
    ])

    /**
     * **`/api/client/oidc` is a `:slug` collection `RESERVED_SLUGS` cannot
     * defend, and does not have to.** Its `:slug` is a `providerSlug` —
     * lowercase and *hyphen*-separated, chosen by a developer for their own
     * sign-in button — and `RESERVED_SLUGS` is the reserved-name list of the
     * robot **config document**, a different grammar naming a different thing.
     * Adding `callback` and `exchange` to it to satisfy this sweep would have
     * refused those two names to every datapoint, action and camera on every
     * robot, to defend a collision that does not exist.
     *
     * It does not exist because the literals sit at a **different depth** from
     * the slug: every route under this prefix continues past `:slug`
     * (`/:slug/start`), so a provider named `callback` is reached at
     * `/api/client/oidc/callback/start` and never shadows
     * `/api/client/oidc/callback`. That is the property asserted below, rather
     * than assumed — and it is what a second route added at `/:slug` exactly
     * would break, which is why the exemption is written as a check.
     */
    const OIDC = '/api/client/oidc'
    const segments = (p: string) => p.split('/').length
    const oidcSlugRoutes = ROUTES.filter((r) => r.path.startsWith(`${OIDC}/:slug`))
    expect(oidcSlugRoutes.map(key), 'the OIDC slug collection is not the one route this exemption was argued for').toEqual([
      'GET /api/client/oidc/:slug/start',
    ])
    const oidcLiterals = ROUTES.filter((r) => r.path.startsWith(`${OIDC}/`) && !r.path.startsWith(`${OIDC}/:`))
    expect(oidcLiterals.map(key).sort(), 'the literal siblings of the provider slug').toEqual([
      'GET /api/client/oidc/callback',
      'POST /api/client/oidc/exchange',
    ])
    for (const lit of oidcLiterals) {
      for (const sl of oidcSlugRoutes) {
        expect(segments(sl.path), `${key(lit)} sits at the depth of ${key(sl)} and shadows a provider slug`).not.toBe(segments(lit.path))
      }
    }

    // The robot half, which is what RESERVED_SLUGS is for.
    const robotPrefixes = [...prefixes].filter((p) => p.startsWith('/api/robots/'))
    expect(robotPrefixes.length, 'the robot slug collections vanished from the sweep').toBe(5)
    const siblings = ROUTES.filter(
      (r) => robotPrefixes.some((p) => r.path.startsWith(`${p}/`) && !r.path.slice(p.length + 1).includes('/') && r.path !== `${p}/:slug`),
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
