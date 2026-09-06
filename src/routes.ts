/**
 * **The route manifest: every HTTP route the cloud registers, declared once.**
 *
 * The cloud's `test/route-manifest.test.ts` boots the server and asserts set
 * equality with this list in both directions, so a route cannot be added,
 * renamed or removed without this file moving with it. `scripts/export-schemas.ts`
 * writes it to `artifacts/routes.json` (schemas resolved to artifact names)
 * and derives `artifacts/openapi.json` from it; the docs site renders its
 * route and field tables from those two files.
 *
 * `OAUTH_PATHS` (`oauth.ts`) was the precedent: nine paths declared once so
 * two repositories could not spell them differently. Its `idpStart` entry
 * named a route the cloud had deleted, and nothing noticed for months. This
 * list exists so that cannot happen again — and the cloud test is the half
 * that makes it true.
 *
 * **What an entry does not prove.** `errors` is hand-written: the codes a
 * route is known to answer, read from its handler, the service it calls and
 * the helpers they share. Nothing checks that each code is still reachable,
 * and a code the route stopped emitting stays listed until a reader
 * notices. A runtime tally across the suite was considered and rejected: a
 * code no test provokes would look identical to one the route cannot emit.
 *
 * `audience` is who the documentation addresses; `auth` is the mechanism,
 * and the cloud test checks it against the registered guards exactly
 * (`preHandler` names, `preParsing` names, an anonymous rate limiter).
 */
import type { ZodType } from 'zod'
import {
  appListResponse,
  createAppRequest,
  createServerKeyResponse,
  app as appSchema,
  role,
  roleListResponse,
  rolePermissions,
  serverKeyListResponse,
  updateAppRequest,
} from './apps.js'
import { alertListResponse, orgAlertsQuery, orgFiringAlertsResponse } from './alerts.js'
import { asset, assetListResponse, assetSyncRequest, assetSyncResponse, assetSyncStatus, missingAssetQuery } from './assets.js'
import { auditListResponse, auditQuery } from './audit.js'
import {
  CLIENT_OIDC_CALLBACK_PATH,
  clientAcceptInvitationRequest,
  clientIdentity,
  clientLoginRequest,
  clientLogoutRequest,
  clientMcpInteraction,
  clientMcpInteractionDecisionResponse,
  clientOidcCallbackQuery,
  clientOidcExchangeRequest,
  clientOidcStartQuery,
  clientPasswordResetConfirmRequest,
  clientPasswordResetRequest,
  clientProviderListQuery,
  clientProviderListResponse,
  clientRefreshRequest,
  clientRegisterRequest,
  clientResendVerificationRequest,
  clientVerifyEmailRequest,
  mcpConsentGrantListResponse,
} from './client-auth.js'
import {
  appAuthConfig,
  appInvitation,
  appInvitationListResponse,
  appMailTemplate,
  appMailTemplateListResponse,
  appOidcProvider,
  appOidcProviderListResponse,
  appUser,
  appUserListResponse,
  createAppInvitationRequest,
  createAppOidcProviderRequest,
  createAppUserRequest,
  mailOutcome,
  mailTemplatePreviewRequest,
  mailTemplatePreviewResponse,
  patchAppOidcProviderRequest,
  patchAppUserRequest,
  putAppAuthConfigRequest,
  putAppMailTemplateRequest,
} from './app-users.js'
import type { ErrorCode } from './errors.js'
import {
  acceptTeamInviteRequest,
  authMeResponse,
  createTeamInviteRequest,
  fleetlessUser,
  fleetlessUserListResponse,
  passwordChangeRequest,
  passwordResetConfirm,
  passwordResetRequest,
  patchAuthMeRequest,
  patchFleetlessUserRequest,
  patchOrgRequest,
  patchOrgResponse,
  pendingTeamInviteListResponse,
  refreshRequest,
  sessionTokens,
  signUpRequest,
  signUpResponse,
  teamInvite,
  tierChangeRequest,
  waitlistRequest,
} from './identity.js'
import { jobRunListResponse, jobRunQuery, jobRunSummary, jobRunSummaryQuery } from './jobs.js'
import { MCP_APP_PATHS, mcpRolePreviewResponse } from './mcp.js'
import {
  authorizationServerMetadata,
  dynamicClientRegistrationResponse,
  oauthRedirectResponse,
  oauthTokenResponse,
  protectedResourceMetadata,
} from './oauth.js'
import {
  cameraListResponse,
  cancelRequest,
  configDraftResponse,
  configVersionResponse,
  configVersionsResponse,
  createRobotRequest,
  createRobotResponse,
  datapointListResponse,
  datapointValue,
  exposureListResponse,
  fetchTypesRequest,
  fetchTypesResponse,
  historyQuery,
  historyResponse,
  introspectionResponse,
  invokeOrServiceResponse,
  invokeRequest,
  jobResponse,
  liveSessionResponse,
  orgHealthQuery,
  orgLatencyQuery,
  orgLatencyResponse,
  orgQuotaUsage,
  orgUsageQuery,
  orgUsageResponse,
  patchRobotRequest,
  patchRobotResponse,
  publishConfigResponse,
  publishRequest,
  putConfigDraftRequest,
  putRobotDetailsRequest,
  putRobotDetailsResponse,
  releaseLiveQuery,
  renameSlugRequest,
  renameSlugResponse,
  robotDeleteQuery,
  resourceHealthListResponse,
  robotDeletionSummary,
  robotDetailResponse,
  robotJobsResponse,
  robotListResponse,
  slugUsageResponse,
  snapshotMetaResponse,
  typesResponse,
} from './rest.js'

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type RouteAudience = 'developer' | 'client' | 'internal'
export type RouteAuth = 'developer' | 'developer_or_client' | 'none' | 'robot_upload' | 'in_handler'
export type RouteTransport = 'http' | 'websocket'
export type RouteSection =
  | 'health' | 'developer-auth' | 'client-auth' | 'org' | 'users' | 'apps'
  | 'robots' | 'config' | 'alerts' | 'commands' | 'cameras' | 'assets'
  | 'mcp' | 'transports'

export interface RouteParam {
  readonly name: string
  /** One sentence: what the segment identifies and where a caller gets it. */
  readonly description: string
}

export interface RouteEntry {
  readonly method: RouteMethod
  /** The display path with `:name` params and no inline regex. */
  readonly path: string
  readonly section: RouteSection
  /** One sentence ending in a full stop. */
  readonly summary: string
  readonly audience: RouteAudience
  readonly auth: RouteAuth
  /** A rate limiter is registered as an anonymous preHandler. */
  readonly rateLimited: boolean
  /** The handler additionally requires the Owner tier of a developer. */
  readonly ownerTier: boolean
  /** The success status the handler answers with. */
  readonly status: number
  readonly params: readonly RouteParam[]
  readonly query: ZodType | null
  readonly request: ZodType | null
  /**
   * The handler accepts a **missing** body; the schema still describes it when
   * one is present. Absent means a body is required.
   *
   * It exists because the OpenAPI render marked every request body `required`,
   * which documented a refusal `POST /api/robots/:id/jobs/:slug/cancel` does not
   * make: it parses `request.body ?? {}`, and a bodyless `POST` was every
   * caller's shape before `job_id` existed. Getting that wrong in the other
   * direction is what W5's worst bug was — a bodyless `POST` with a JSON
   * content type rejected outright — so this is a fact worth carrying rather
   * than a default worth assuming.
   */
  readonly requestOptional?: true
  readonly response: ZodType | null
  /**
   * For routes that answer bytes rather than JSON: the media type, or a family
   * such as `image/*` where the producer decides it. Implies `response: null`.
   *
   * It exists because `response: null` alone says two different things — *this
   * route sends no body* and *this route sends a body contracts cannot
   * describe* — and the generated reference rendered both as **returns
   * nothing**. Five routes that hand back a CSV, an XML document, a camera
   * frame or an asset were documented as answering nothing at all.
   */
  readonly contentType?: string
  readonly errors: readonly ErrorCode[]
  readonly transport: RouteTransport
  /** Markdown rendered under the route; the place for what the schema cannot say. */
  readonly notes?: string
}

export const ROUTE_SECTIONS: readonly { readonly id: RouteSection; readonly title: string }[] = [
  { id: 'health', title: 'Health' },
  { id: 'developer-auth', title: 'Developer auth' },
  { id: 'client-auth', title: 'App-user (client) auth' },
  { id: 'org', title: 'Org' },
  { id: 'users', title: 'Team' },
  { id: 'apps', title: 'Apps' },
  { id: 'robots', title: 'Robots' },
  { id: 'config', title: 'Configuration (draft/publish)' },
  { id: 'alerts', title: 'Alerts' },
  { id: 'commands', title: 'Commands (jobs, publishers)' },
  { id: 'cameras', title: 'Cameras' },
  { id: 'assets', title: 'Assets (URDF, meshes)' },
  { id: 'mcp', title: 'MCP' },
  { id: 'transports', title: 'Realtime and bridge transports' },
]

/**
 * **The per-app MCP paths as the manifest spells them**, built by the same
 * function the cloud, the console and the reverse proxy call — with the
 * display parameter `:appIdentifier` where a real identifier goes.
 *
 * The rows below take their `path` from this object rather than from a string
 * literal, which is the discipline `CLIENT_OIDC_CALLBACK_PATH` established: a
 * path an MCP client **discovers** cannot be allowed to be spelled twice, and
 * `MCP_APP_PATHS` is where it is spelled. `test/routes.test.ts` pins the
 * literal characters, because a row compared only against the constant it was
 * built from is two references to one string agreeing with themselves.
 */
const MCP_APP = MCP_APP_PATHS(':appIdentifier')

/** The one path parameter every per-app MCP route takes, described once rather than eight times. */
const APP_IDENTIFIER: RouteParam = {
  name: 'appIdentifier',
  description:
    "The app's public identifier — `app.identifier`, what the console prints beside its copy button. It is not a secret: it appears in this path, in both metadata documents, and in the URL an app user pastes into their AI tool.",
}

/** The routes that verify a credential inside the handler; `auth: 'in_handler'` is refused elsewhere. */
export const IN_HANDLER_ROUTES: readonly string[] = [
  'POST /mcp',
  // The per-app endpoint, all three verbs: the bearer decides which app user
  // is calling, and the path names none of that. Built from `MCP_APP` so the
  // list cannot drift from the rows.
  `POST ${MCP_APP.endpoint}`,
  `GET ${MCP_APP.endpoint}`,
  `DELETE ${MCP_APP.endpoint}`,
  // The one route whose bearer is **optional**: it answers the same document
  // with or without one, and only `already_granted` moves.
  'GET /api/client/mcp/interactions/:id',
  'GET /api/asset-links/missing',
  'GET /api/asset-links/:token',
]

/**
 * **The three refusals every `auth: 'developer'` route inherits from its guard**,
 * spelled once rather than retyped eighty times.
 *
 * They are the arms of `cloud/src/auth.ts`'s `requireDeveloper`: no bearer or an
 * unverifiable one is `401 unauthorized`, an expired one `401 token_expired`, a
 * vanished account or a bumped `token_version` `401 token_revoked`.
 *
 * **Three, not four: `403 forbidden` went with the Org Admins group.** It stood
 * for "an account that is no longer in the org's Org Admins group", and the
 * two-space cut leaves a Fleetless user who IS the team — `TokenRefusalReason`
 * in `cloud/src/auth.ts` is `'expired' | 'revoked' | 'invalid'`, and
 * `createRequireDeveloper` answers 401 codes only. A removed team member now
 * gets `401 token_revoked`; a reader of the API reference who branched on
 * `forbidden` to render "you lost console access" was branching on an answer no
 * developer-guarded route can send. The `forbidden` producers that remain
 * (`history.ts`, `commands.ts`, `cameras.ts`, `robots.ts`, `mcp.ts`) all sit on
 * `developer_or_client` or MCP surfaces, which is why `CLIENT_GUARD` keeps it.
 *
 * **Not `invalid_token`.** That code exists in `ERROR_CODES` and this guard has
 * never sent it; the three above are what `sendTokenRefusal` actually maps to.
 * Said plainly because the planning note for this file assumed otherwise, and a
 * documented refusal a caller cannot receive is the third failure mode in
 * CLAUDE.md's list.
 */
const DEVELOPER_GUARD = ['unauthorized', 'token_expired', 'token_revoked'] as const satisfies readonly ErrorCode[]

/**
 * The same, for `auth: 'developer_or_client'` — `createRequireDeveloperOrClient`,
 * which resolves a developer bearer, an end-user bearer **or** a server key
 * through one `resolveAnyToken`.
 *
 * **The same four codes, not five.** `sendTokenRefusal` has a fifth arm,
 * `account_blocked`, and this list carried it for exactly one commit. Nothing
 * reaches it: `TokenRefusalReason` admits `'blocked'`, but no site in
 * `cloud/src` constructs one — the only reasons ever returned are `'invalid'`,
 * `'revoked'` and `'forbidden'`. `auth.ts` says why on the line where the check
 * used to be: D2 replaced "block the account" with "remove the assignment", so
 * an app user who loses access loses it because no assignment resolves, and
 * there is no blocked state left to re-check.
 *
 * Listing it would have documented a refusal no caller can receive — the same
 * mistake as the `invalid_token` above, found by review rather than by any test
 * here, because a code in `ERROR_CODES` satisfies every check this file has.
 *
 * It keeps `forbidden`, which `DEVELOPER_GUARD` no longer carries: this guard's
 * routes have live 403 producers — a slug the role does not grant
 * (`routes/history.ts`), a capability the role does not carry
 * (`routes/commands.ts`), a camera or datapoint outside the grant
 * (`routes/cameras.ts`, `routes/robots.ts`). That divergence is the reason the
 * two lists were kept as separate constants while they still read alike.
 */
const CLIENT_GUARD = ['unauthorized', 'token_expired', 'token_revoked', 'forbidden'] as const satisfies readonly ErrorCode[]

export const ROUTES: readonly RouteEntry[] = [
  /* ------------------------------------------------------------- health */
  {
    method: 'GET', path: '/healthz', section: 'health',
    summary: 'Reports whether the database, the object store and LiveKit each answered a probe.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'Answers `{ ok, dependencies: { database, storage, liveKit } }` — a cloud-local shape, not a wire contract, so nothing here pins it. ' +
      'The status is always `200`: each dependency is probed independently and a failure is reported in the body rather than thrown, because ' +
      '`/healthz` must never itself be a reason the process looks down. Read `ok`, not the status code.',
  },

  /* ----------------------------------------------------- developer auth */
  {
    method: 'POST', path: '/api/auth/signup', section: 'developer-auth',
    summary: 'Creates an org and its founding Owner, and answers a developer session.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 201,
    params: [], query: null, request: signUpRequest, response: signUpResponse,
    errors: ['rate_limited', 'signup_closed', 'validation_error', 'email_taken'], transport: 'http',
    notes:
      'While the deployment runs in closed beta this answers `403 signup_closed` before it looks at the body — there is nothing for a ' +
      'validation message, or an `email_taken` answer, to be right about when nothing will be created. Email is globally unique, so an ' +
      'address already registered in any org is refused.',
  },
  {
    method: 'POST', path: '/api/auth/refresh', section: 'developer-auth',
    summary: 'Rotates a developer refresh token and mints a fresh access token.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: refreshRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_expired', 'token_revoked'], transport: 'http',
    notes:
      'The whole family is re-checked here, not just the token: an account that has been removed from the org, or whose `token_version` was ' +
      'bumped by a password change, cannot mint a fresh console token and answers `token_revoked`. Refusing that only on the other routes ' +
      'would leave a session that is dead everywhere but here.',
  },
  {
    method: 'POST', path: '/api/auth/logout', section: 'developer-auth',
    summary: 'Revokes the whole refresh family behind a developer refresh token.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 204,
    params: [], query: null, request: refreshRequest, response: null,
    errors: ['rate_limited', 'validation_error'], transport: 'http',
    notes:
      'Unauthenticated by design — the refresh token in the body is the credential. A token the server does not recognise is still a `204`: ' +
      'the end state a caller asked for is the end state they get, and distinguishing the two would say whether a token ever existed. ' +
      'Open `/realtime` sockets for the session are closed too.',
  },
  {
    method: 'GET', path: '/api/auth/me', section: 'developer-auth',
    summary: 'Answers the calling developer and the org they belong to.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: authMeResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
  },
  {
    method: 'PATCH', path: '/api/auth/me', section: 'developer-auth',
    summary: "Changes the calling developer's own display name and nothing else.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: patchAuthMeRequest, response: authMeResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'No Owner tier: this can only ever touch the caller\'s own row, so there is nothing for a tier check to gate. Saving the name already ' +
      'held writes nothing and records no audit event — the org activity stream reaches every developer with the console open, and an event ' +
      'for a no-op would misreport that something changed.',
  },
  {
    method: 'POST', path: '/api/auth/password/change', section: 'developer-auth',
    summary: 'Verifies the current password, sets a new one and answers a fresh session.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: passwordChangeRequest, response: sessionTokens,
    errors: [...DEVELOPER_GUARD, 'validation_error', 'invalid_credentials'], transport: 'http',
    notes:
      'Every session of this account ends, including the caller\'s — the request carries nothing identifying its own refresh family, so there ' +
      'is none to spare. The answer is a working replacement pair, which is what the promise has to mean when nothing distinguishes one ' +
      'session from another.',
  },
  {
    method: 'POST', path: '/api/auth/password/reset', section: 'developer-auth',
    summary: 'Mails a password-reset link to the address, and answers the same either way.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 202,
    params: [], query: null, request: passwordResetRequest, response: null,
    errors: ['rate_limited', 'validation_error'], transport: 'http',
    notes:
      'Status, body and timing are identical for a known and an unknown address — any difference is an account-enumeration oracle, which is ' +
      'why the unknown branch still pays a real SMTP round trip to a discard address. An account provisioned through OIDC has no Fleetless ' +
      'password and is mailed nothing. A browser form post gets a `303` to the "check your mail" card instead of this `202`.',
  },

  /* ------------------------------------------- client auth (portal pages) */
  {
    method: 'GET', path: '/reset-password', section: 'client-auth',
    summary: 'Serves the auth portal\'s "forgot your password" card as an HTML page.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML, not JSON: this is a page a person opens, served by the cloud from the auth portal origin. `?sent=1` draws the "check your mail" ' +
      'state instead — one path, because that second card has no inputs and a second path would exist only to be redirected to. The value is ' +
      'caller-settable and discloses nothing, since the page it draws is a constant.',
  },
  {
    method: 'GET', path: '/reset-password/:token', section: 'client-auth',
    summary: 'Serves the "pick a new password" page for a mailed reset link.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'token', description: 'The opaque reset token from the mailed link; it is never sent as a query parameter.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML. An unknown, spent or expired token renders one "link no longer valid" page at `410` — they are one refusal on the wire already, ' +
      'and splitting them here would tell a stranger which tokens ever existed. No rate limiter: the GET changes nothing, and the POST it ' +
      'leads to is limited per IP.',
  },

  {
    method: 'POST', path: '/api/auth/password/reset/confirm', section: 'developer-auth',
    summary: 'Spends a reset token, sets the new password and ends every session of the account.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 204,
    params: [], query: null, request: passwordResetConfirm, response: null,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      'Unknown, spent and expired tokens all answer `410 token_spent`. Sessions are revoked under the account\'s actual kind — a console admin ' +
      'holds developer sessions, an app user holds end-user ones — so an app user\'s open `/realtime` socket does not outlive the reset. ' +
      'A browser form post gets the rendered "done" page instead of this `204`.',
  },
  {
    method: 'POST', path: '/api/waitlist', section: 'developer-auth',
    summary: 'Adds an address to the closed-beta waiting list.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 202,
    params: [], query: null, request: waitlistRequest, response: null,
    errors: ['rate_limited', 'validation_error'], transport: 'http',
    notes:
      'Answers `202` whether or not the address was already listed: the landing page\'s form must not be an oracle for who signed up. The ' +
      'operator notification is detached from the response — awaiting it made latency answer the question the status code refuses to — and is ' +
      'capped by its own global ceiling, above which the row is still written and the mail is skipped.',
  },

  /* ---------------------------------------------------------------- org */
  {
    method: 'GET', path: '/api/audit', section: 'org',
    summary: "Reads the org's audit log, newest first, cursor-paged over the durable sequence number.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: auditQuery, request: null, response: auditListResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      '`action` and `action_prefix` are mutually exclusive, a cross-field rule no JSON Schema can express — this route is where it is ' +
      'enforced. Nothing redacts an event\'s `details`: it is returned exactly as the call site wrote it.',
  },
  {
    method: 'GET', path: '/api/audit/export', section: 'org',
    summary: 'Downloads every audit event matching the same filters as a CSV attachment.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: auditQuery, request: null, response: null, contentType: 'text/csv',
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'Answers `text/csv; charset=utf-8` with a `Content-Disposition` attachment, not JSON — so it has no response schema. `AUDIT_CSV_COLUMNS` names the ' +
      'columns and their order. Takes the same filters as `GET /api/audit` but refuses `before_seq` and `limit` with `400 validation_error`: ' +
      'an export is not a page, it is everything the filter matches up to a fixed row ceiling.',
  },

  /* --------------------------------------------------------------- apps */
  {
    method: 'POST', path: '/api/apps', section: 'apps',
    summary: 'Creates an app, optionally attaching robots to it at the same time.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createAppRequest, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'validation_error', 'identifier_taken', 'quota_exceeded'], transport: 'http',
    notes:
      'Every robot id is checked before anything is created, so a bad one never leaves a robotless app to clean up. The identifier `mcp` is ' +
      'reserved by the central MCP server and refused as a `validation_error`. An app belongs to the org and to nothing inside it: the group ' +
      'an app used to be created in, and the `409 target_state_conflict` that refused the Org Admins one, are both gone with the group model.',
  },
  {
    method: 'GET', path: '/api/apps', section: 'apps',
    summary: "Lists every app in the caller's org.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: appListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes: 'Answers `{ "apps": [app, …] }` — the whole org, unpaged; an org\'s app count is bounded by quota.',
  },
  {
    method: 'GET', path: '/api/apps/:id', section: 'apps',
    summary: 'Reads one app of the org, with its robots and default role.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'An app belonging to another org reads exactly like one that does not exist — `404`, never a `403`.',
  },
  {
    method: 'PATCH', path: '/api/apps/:id', section: 'apps',
    summary: "Changes an app's name, its attached robots or its default role.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: updateAppRequest, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found'], transport: 'http',
    notes:
      'A `default_role_id` naming a role of another app is refused: it is the one cross-app authorization check this shape can carry. ' +
      'Changing the robot set closes every live subscription the app\'s users hold, since a grant may no longer name a reachable robot.',
  },
  {
    method: 'POST', path: '/api/apps/:id/roles', section: 'apps',
    summary: 'Creates a custom role on the app.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: role,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'The body is `{ "name": string }` — non-empty, trimmed, at most 120 characters — and is deliberately not a contract shape: contracts ' +
      'define the `role` this answers with, not this one trivial request. **The answer is a bare `role`, not an envelope**, unlike the ' +
      'listing beside it.',
  },
  {
    method: 'GET', path: '/api/apps/:id/roles', section: 'apps',
    summary: "Lists the app's roles, builtin and custom.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: roleListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Answers `{ "roles": [role, …] }`, builtin roles included — a role a developer never created is still one a user can hold.',
  },
  {
    method: 'PUT', path: '/api/apps/:id/roles/:roleId/permissions', section: 'apps',
    summary: "Replaces a role's grants and capabilities in one write.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'roleId', description: 'The role\'s uuid, from `GET /api/apps/:id/roles`; a role of another app answers `404`.' },
    ],
    query: null, request: rolePermissions, response: rolePermissions,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      '`role_id` in the body must name the role in the path, compared case-insensitively — a uuid is a value, not a string, and a client that ' +
      'uppercases them consistently must not be refused for repeating what the path says. A grant naming a robot the app does not have is ' +
      'refused rather than stored: a permission for something the role cannot reach reads as authoritative to whoever writes the next consumer. ' +
      'Every user holding this role has their live subscriptions re-authorized.',
  },
  {
    method: 'GET', path: '/api/apps/:id/roles/:roleId/permissions', section: 'apps',
    summary: "Reads a role's grants and capabilities.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'roleId', description: 'The role\'s uuid, from `GET /api/apps/:id/roles`; a role of another app answers `404`.' },
    ],
    query: null, request: null, response: rolePermissions,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'GET', path: '/api/apps/:id/roles/:roleId/mcp-tools', section: 'apps',
    summary: 'Previews the robot datasheets an MCP caller holding this role would be offered.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'roleId', description: 'The role\'s uuid, from `GET /api/apps/:id/roles`; a role of another app answers `404`.' },
    ],
    query: null, request: null, response: mcpRolePreviewResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Built by the same builder the MCP server\'s own `robot_describe` uses, so the two cannot drift. It answers what the role *would* be ' +
      'offered and consults nothing about any user\'s actual MCP entitlement. A robot the role grants nothing on still appears, with an empty ' +
      '`exposures` — dropping it would read as "not attached", which is a different fact.',
  },
  {
    method: 'POST', path: '/api/apps/:id/server-keys', section: 'apps',
    summary: 'Mints a server key for the app and returns the raw secret once.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 201,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: createServerKeyResponse,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'Owner tier only: a server key carries full app rights and outlives its creator\'s removal. The body is `{ "name": string }`, the same ' +
      'trivial shape role creation takes. `key` is the only moment the raw secret exists outside the caller\'s hands — it is never in a ' +
      'listing, never in an audit event, and cannot be read back.',
  },
  {
    method: 'GET', path: '/api/apps/:id/server-keys', section: 'apps',
    summary: "Lists the app's server keys as metadata, never the secrets.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: serverKeyListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "server_keys": [serverKey, …] }`. `serverKey` names the five fields it carries rather than spreading the stored row — that ' +
      'is what keeps this listing from becoming a second place a credential leaves the cloud.',
  },
  {
    method: 'POST', path: '/api/apps/:id/server-keys/:keyId/rotate', section: 'apps',
    summary: 'Replaces a server key\'s secret in place and returns the new one once.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'keyId', description: 'The server key\'s uuid, from `GET /api/apps/:id/server-keys`; a key of another app answers `404`.' },
    ],
    query: null, request: null, response: createServerKeyResponse,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Owner tier, for the reason creation is. The old secret is refused from this call on, and any `/realtime` socket that authenticated with ' +
      'it is closed — rotation is what a developer reaches for when a key has leaked, and the holder of that socket is exactly who they are ' +
      'rotating against.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/server-keys/:keyId', section: 'apps',
    summary: 'Revokes a server key and closes every socket holding it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 204,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'keyId', description: 'The server key\'s uuid, from `GET /api/apps/:id/server-keys`; a key of another app answers `404`.' },
    ],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Owner tier, like minting and rotating: all three decide who may speak for the whole app.',
  },


  /* -------------------------------------- the app's users and invitations */
  {
    method: 'GET', path: '/api/apps/:id/users', section: 'apps',
    summary: "Lists the app's users — the developer's own customers, not the Fleetless team.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appUserListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "users": [appUser, …] }`. **A different identity space from `GET /api/org/users`**, and nothing joins the two: an app user ' +
      'belongs to exactly one app, their address is unique per app rather than globally, and the same address may exist as unrelated accounts ' +
      'in several apps of one org. No password hash, no token and no provider secret appears here — `appUser` names the fields it carries ' +
      'rather than spreading the stored row.',
  },
  {
    method: 'POST', path: '/api/apps/:id/users', section: 'apps',
    summary: 'Creates an app user directly, without an invitation or a self-registration.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: createAppUserRequest, response: appUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'email_taken', 'target_state_conflict'], transport: 'http',
    notes:
      'The developer-authenticated door into the app\'s user table, and the one place `409 email_taken` is an honest answer about an app user: ' +
      'the caller is authenticated into this app already, so telling them the address is taken discloses nothing they could not read from the ' +
      'listing beside it. `POST /api/client/register` answers `202` to the same fact, because there the caller is a stranger. `404 not_found` ' +
      'is the app, or a `role_id` that is not a role of it — a role of another app is refused rather than stored, since a user holding one ' +
      'would carry rights nothing in this app can resolve. **The password policy answers `400 validation_error`**, not a code of its own: the ' +
      'twelve-character minimum is the `password` field\'s schema rule, and every route in this repository that takes a password refuses a ' +
      'short one exactly the way it refuses any other malformed field. An account created here is `active` immediately: a developer entering ' +
      'somebody by hand has made the decision the verification mail automates, and its address counts as proven. `409 target_state_conflict` ' +
      'names `default_role_id` when `role_id` is absent and the app has no default role, or its default names a role that no longer resolves ' +
      '— a user with no role holds rights nothing in this app can read, so nothing is created.',
  },
  {
    method: 'GET', path: '/api/apps/:id/users/:userId', section: 'apps',
    summary: 'Reads one user of the app.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' }],
    query: null, request: null, response: appUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'A user of another app, or of another org, reads exactly like one that does not exist — `404`, never a `403`.',
  },
  {
    method: 'PATCH', path: '/api/apps/:id/users/:userId', section: 'apps',
    summary: "Changes an app user's display name, role or status.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' }],
    query: null, request: patchAppUserRequest, response: appUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'target_state_conflict'], transport: 'http',
    notes:
      'The address is immutable: it is half of what identifies the account within the app, and a rewrite would silently move every token and ' +
      'invitation addressed to the old one. Setting `status` to `blocked` ends every session the user holds and closes their live ' +
      '`/realtime` subscriptions — blocking somebody who keeps a working socket is not blocking them. Moving them back to `active` mints ' +
      'nothing; they log in again. \n\n**`active` is a way out of `blocked` and out of nothing else.** An account still ' +
      '`pending_verification` answers `409 target_state_conflict` naming `status` with rule `unverified`: activating it would let somebody ' +
      'who typed an address they do not own log in without ever spending the mailed token. Unblocking restores the status the account had — ' +
      '`active` for one whose address was proven, `pending_verification` for one blocked before it ever verified. A write that names the ' +
      'status the account already holds changes nothing and mints no event, so it does not end the sessions a re-sent form would otherwise ' +
      'have killed. A `role_id` naming a role of another app is `404 not_found`, the same refusal creation makes.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/users/:userId', section: 'apps',
    summary: 'Deletes an app user and ends every session they hold.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Sessions are revoked before the row goes, for the reason `DELETE /api/org/users/:id` states: a live user with a dead session is ' +
      'recoverable by retrying, a deleted user whose token still works is not. Outstanding invitations and unspent tokens for that address are ' +
      'expired with it — a link mailed before the deletion is a standing re-admission ticket. **Nothing outside this app is touched**: a ' +
      'Fleetless user sharing the address keeps their console account, and an account with the same address in a sibling app is a different ' +
      'person as far as this platform is concerned.',
  },
  {
    method: 'POST', path: '/api/apps/:id/users/:userId/reset-password', section: 'apps',
    summary: "Mails an app user a password-reset link on the developer's behalf.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 202,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' }],
    query: null, request: null, response: mailOutcome,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'target_state_conflict'], transport: 'http',
    notes:
      'The support door beside `POST /api/client/password/reset`: the same one-hour token and the same link, triggered by a developer for a ' +
      'user who asked them rather than the form. **No enumeration discipline applies** — the caller is authenticated into the app and can read ' +
      'the user list — so this one answers what actually happened: `{ "mail": mailStatus }`, where `not_configured` is a deployment without a ' +
      'mailer and `failed` is the state worth somebody\'s attention. `409 target_state_conflict` names `reset_url` when the app has configured ' +
      'none: the token would be minted and the link would point nowhere, so nothing is minted. The same `409` names `password` with rule ' +
      '`not_set` for an account that has none — an OIDC-only app user, whom a reset link would hand a second, quieter door — and `status` ' +
      'with rule `blocked` for a blocked one, since `POST /api/client/password/reset` mails a blocked account nothing and the two doors may ' +
      'not disagree. Setting the password directly is deliberately not offered; a developer who could would hold their customers\' ' +
      'credentials.',
  },
  /* ---------------------------- the MCP clients one app user has connected */
  {
    method: 'GET', path: '/api/apps/:id/users/:userId/mcp-grants', section: 'apps',
    summary: 'Lists the MCP clients one app user has consented to.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' }],
    query: null, request: null, response: mcpConsentGrantListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'A consent is remembered so that a later authorization can skip the app\'s own screen, and a client\'s registration lapsing does not ' +
      'end it — so a person who approved something once had no way back and neither did the developer supporting them. This is the reading ' +
      'half of that door. \n\n**Every name here is a claim the client made about itself.** Dynamic registration takes no credential, so ' +
      '`client_name` is attacker-chosen text, unverified on every row, and `client_name_verified` is the literal `false`; a console that renders it as an ' +
      'identity is rendering a string somebody picked. **Withdrawn grants are absent** rather than listed as withdrawn: the question is what ' +
      'is connected now. \n\nThe user is scoped to the app and the app to the org, so a user of a sibling app and one that does not exist ' +
      'read identically — `404`, never a `403`. **A developer sees which clients their customer connected and nothing those clients did**: ' +
      'this route reads the consent table alone, and no scope, token or session of the person appears in it, because the authorization ' +
      'server issues no scopes at all.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/users/:userId/mcp-grants/:clientId', section: 'apps',
    summary: 'Withdraws one app user\'s consent to an MCP client, on the developer\'s behalf.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [
      { name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' },
      { name: 'userId', description: 'The app user\'s uuid, from `GET /api/apps/:id/users`; a user of another app answers `404`.' },
      { name: 'clientId', description: 'The MCP client, as `GET /api/apps/:id/users/:userId/mcp-grants` reports its `client_id`. Not a uuid — it is the identifier the dynamic registration issued.' },
    ],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'The support door beside `DELETE /api/client/mcp/grants/:clientId`, which is the same act by the person themselves. Audited as ' +
      '`app_user.mcp_grant_revoked` with the client id and nothing else. \n\n**`204` whether or not there was anything to withdraw**, so a ' +
      'double-clicked button and a client id no grant names both land on the end state the caller asked for. The alternative — `404` for a ' +
      'client this user never approved — would make the route an oracle for which clients somebody has connected, answered before the ' +
      'listing beside it was read; and it would turn the ordinary retry into a refusal. Only a withdrawal that actually ended a standing ' +
      'agreement writes an audit event, so the log counts consents ended rather than buttons pressed. **`404` is still the app and the ' +
      'user**, which are the two things the caller must own. \n\n**It does not end an MCP session already running.** The access token that ' +
      'consent produced is a fifteen-minute bearer the transport checks against the account, not against this table, so a session in flight ' +
      'survives until it expires; there is no refresh grant on this authorization server, so nothing can extend it, and the next ' +
      'authorization shows the consent screen again. Blocking the account (`PATCH /api/apps/:id/users/:userId`) is what ends a live session ' +
      'now, and it ends every one of their sessions rather than this client\'s.',
  },

  {
    method: 'GET', path: '/api/apps/:id/invitations', section: 'apps',
    summary: "Lists the app's outstanding invitations, without their tokens.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appInvitationListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "invitations": [pendingAppInvitation, …] }` — pending only, since an accepted invitation is history rather than something to ' +
      'revoke. **No `accept_url`**, the rule the team listing already keeps: this list exists so a developer can see what is outstanding and ' +
      'withdraw it, and neither needs the token, while a list that carried it would turn every screenshot and browser-history entry of that ' +
      'page into a live credential for somebody else\'s account. `mail` is omitted too — it described what happened at creation time, and ' +
      're-serving it invites a reader to take it as current.',
  },
  {
    method: 'POST', path: '/api/apps/:id/invitations', section: 'apps',
    summary: 'Invites an address into the app with a role, and optionally mails the link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: createAppInvitationRequest, response: appInvitation,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'email_taken', 'target_state_conflict', 'rate_limited'],
    transport: 'http',
    notes:
      '**An app user, not a team member.** `POST /api/org/invitations` is the other space and leads to the console; this link leads into the ' +
      'developer\'s own app. The role is resolved and stored now, so a later change to `default_role_id` does not re-aim a link already sent. ' +
      'An invitation **always bypasses `allowed_domains`**. \n\nThe answer carries `accept_url`, which is `null` when the app has configured no ' +
      '`invite_url` — there is nowhere for the link to point, and Fleetless serves an app user no page of its own. That is a `201` with a ' +
      'null link, not a refusal: the invitation exists and a developer may hand the token over by another route. Asking to **mail** it in that ' +
      'state is `409 target_state_conflict` naming `invite_url`, because a mail carrying a dead link is worse than no mail. The same `409` ' +
      'names `default_role_id` when `role_id` is absent and the app has no default role, or its default no longer resolves: an invitation ' +
      'that names no role has nothing to hand its acceptor, so it is refused here rather than at the acceptance a week later. `409 ' +
      'email_taken` is an address the app already has as a user; `404 not_found` is the app or a `role_id` that is not one of its roles. ' +
      '\n\nCreating shares the reissue route\'s ceiling of **five invitation mails a minute per app**, answering `429 rate_limited` with ' +
      '`retry_after_ms`: re-creating an invitation for one address replaces it and mails again, so a limit that bound only reissue would be ' +
      'a limit on the wrong door.',
  },
  {
    method: 'POST', path: '/api/apps/:id/invitations/:invId/reissue', section: 'apps',
    summary: 'Mints a fresh token onto the same invitation and returns the new link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'invId', description: 'The invitation\'s uuid, from `GET /api/apps/:id/invitations`; an invitation of another app answers `404`.' }],
    query: null, request: null, response: appInvitation,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'rate_limited'], transport: 'http',
    notes:
      'The old link stops resolving the instant this returns: the row is found by token hash and the previous hash is gone. Two live links to ' +
      'one invitation would reopen the door the listing\'s missing `accept_url` closes. \n\n**The answer carries a new `id`.** The old row ' +
      'is revoked and a fresh one takes its place, so a caller holding the previous `id` gets `404` from its next revoke or reissue: re-read ' +
      'the listing after this call rather than keeping the id you sent. The seven days start again. \n\nLimited server-side to **five ' +
      'reissues a minute per app** — shared with `POST /api/apps/:id/invitations`, since both mint a link and mail it — answering `429 ' +
      'rate_limited` with `retry_after_ms`. A disabled button is a hint, this is the limit. An invitation that has already been accepted is ' +
      'not pending and answers `404`.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/invitations/:invId', section: 'apps',
    summary: 'Revokes a pending invitation so its link stops resolving.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'invId', description: 'The invitation\'s uuid, from `GET /api/apps/:id/invitations`; an invitation of another app answers `404`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'An invitation that was already accepted is not pending and answers `404`, the same answer one that never existed gets — the account it ' +
      'created is a user now, and deleting that is `DELETE /api/apps/:id/users/:userId`. A revoked token answers `410 token_spent` at ' +
      '`POST /api/client/invitations/accept`, the same answer one that expired or never existed gets — the developer withdrew it deliberately, ' +
      'and an answer saying so would tell whoever still holds the link that it was once real.',
  },

  /* --------------------------------------- the app's OIDC providers (D4) */
  {
    method: 'GET', path: '/api/apps/:id/oidc-providers', section: 'apps',
    summary: "Lists every OIDC provider configured on the app, enabled or not.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appOidcProviderListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "providers": [appOidcProvider, …] }` — **the management view, so a disabled provider is here** and is absent from the public ' +
      '`GET /api/client/providers`. An app may have any number: the at-most-one rule this replaces was a property of the deleted group, not of ' +
      'identity, and a developer serving two customers needs two. **No client secret appears in the answer**, by construction of ' +
      '`appOidcProvider` — a secret a response can carry is a secret in every log that captured a response, which is the rule server keys and ' +
      'the deleted group provider already kept.',
  },
  {
    method: 'POST', path: '/api/apps/:id/oidc-providers', section: 'apps',
    summary: 'Configures an OIDC provider on the app after checking that its issuer answers.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: createAppOidcProviderRequest, response: appOidcProvider,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'duplicate_slug', 'provider_misconfigured', 'idp_unavailable'],
    transport: 'http',
    notes:
      '**Discovery runs before the row is written**, so a provider that cannot work is refused while the developer is looking at the form ' +
      'rather than a week later in an app user\'s failed sign-in. `502 idp_unavailable` is an issuer that could not be reached and may work on ' +
      'a retry; `422 provider_misconfigured` is one that answered with something unusable — not a discovery document, an `issuer` disagreeing ' +
      'with the configured one, or an `authorization_endpoint`, `token_endpoint` or `jwks_uri` that is not an http(s) URL — and will answer ' +
      'the same until somebody changes the configuration. That is the whole ' +
      'reason the two codes are separate: one says wait, the other says fix it. \n\nThe issuer is **shape-checked** by `idpIssuer` (http(s), ' +
      'no credentials, query or fragment) and that is not the SSRF defence: it cannot tell a loopback dev provider from a loopback database, ' +
      'and the real check refuses loopback, link-local and private ranges at the fetch itself. `409 duplicate_slug` is a slug this app already ' +
      'uses — slugs are unique per app and immutable, since linked identities are keyed by them. `404 not_found` is the app. **The client ' +
      'secret goes in here and comes back out of nothing**: not this answer, not the read, not an audit detail.',
  },
  {
    method: 'GET', path: '/api/apps/:id/oidc-providers/:providerId', section: 'apps',
    summary: 'Reads one OIDC provider of the app, without its client secret.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'providerId', description: 'The provider\'s uuid, from `GET /api/apps/:id/oidc-providers`; a provider of another app answers `404`.' }],
    query: null, request: null, response: appOidcProvider,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'A provider of another app, or of another org, reads exactly like one that does not exist — `404`, never a `403`. The stored client ' +
      'secret is not in `appOidcProvider` and there is no route that reads one back; a developer who has lost theirs sends a replacement ' +
      'through the `PATCH`.',
  },
  {
    method: 'PATCH', path: '/api/apps/:id/oidc-providers/:providerId', section: 'apps',
    summary: "Changes a provider's name, issuer, client, scopes, linking policy or enabled flag.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'providerId', description: 'The provider\'s uuid, from `GET /api/apps/:id/oidc-providers`; a provider of another app answers `404`.' }],
    query: null, request: patchAppOidcProviderRequest, response: appOidcProvider,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'provider_misconfigured', 'idp_unavailable'], transport: 'http',
    notes:
      '**`slug` is not in the body and offering it is a `400 validation_error`** naming the field, because the request is strict: the slug is ' +
      'in the path and is what `app_user_identities` rows are keyed by, so a rename would orphan every linked account. An answer that ignored ' +
      'it silently is the failure `updateAppRequest` was made strict to avoid. \n\n**`client_secret` absent means keep the stored one**, so a ' +
      'routine scope edit need not put the secret back on the wire. Changing the issuer re-runs discovery, which is why this route carries the ' +
      'same `422 provider_misconfigured` and `502 idp_unavailable` the create does — and identities linked under the old issuer keep their ' +
      '`(provider, subject)` key rather than being re-resolved. `409 duplicate_slug` is absent because the one field that could collide cannot ' +
      'be written here. Turning `enabled` off keeps the row and its linked identities: the provider disappears from ' +
      '`GET /api/client/providers` and a start answers `provider_disabled`.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/oidc-providers/:providerId', section: 'apps',
    summary: 'Deletes an OIDC provider and every identity linked through it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'providerId', description: 'The provider\'s uuid, from `GET /api/apps/:id/oidc-providers`; a provider of another app answers `404`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '**The linked identities go with it, and the app users do not.** An account that only ever signed in through this provider survives with ' +
      'no way back in until the developer mails them a reset link or re-configures the provider — deleting the accounts instead would make a ' +
      'mistyped click destroy the developer\'s customers. Setting `enabled` to `false` on the `PATCH` is the reversible door and is what a ' +
      'developer switching a provider off should use; this one is not reversible, because a re-created provider with the same slug resolves ' +
      'no old `(provider, subject)` link. Answers `204` and `404` only: a provider in use is still deleted, since the alternative is a row ' +
      'nothing can remove.',
  },

  /* ------------------------------- the app's auth configuration and mails */
  {
    method: 'GET', path: '/api/apps/:id/auth-config', section: 'apps',
    summary: "Reads the app's auth settings: self-registration, domains, origins, URLs and the MCP switch.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appAuthConfig,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'One row per app, created with the app and never absent — an app that has configured nothing reads back the defaults rather than a ' +
      '`404`. `oidc_callback_url` is in the answer and not in the request: it is minted by the cloud from its own public base URL, is the same ' +
      'for every app and every provider, and is the value a developer registers at their identity provider.',
  },
  {
    method: 'PUT', path: '/api/apps/:id/auth-config', section: 'apps',
    summary: "Replaces the app's auth settings in one write.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: putAppAuthConfigRequest, response: appAuthConfig,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found'], transport: 'http',
    notes:
      '**A replace, not a merge, and `.strict()`**: every field arrives or the write is refused, so a client built against an older shape ' +
      'cannot silently clear a setting it does not know about. `oidc_callback_url` and `updated_at` are refused in the body — a writable ' +
      'callback URL would let a caller point the return leg of an OIDC sign-in, which carries an authorization code, at a host they own. ' +
      '\n\n`400 validation_error` is where the three field rules land: a URL template must be https (or `http` on `localhost`) and carry its ' +
      'placeholder exactly once, an origin must be a bare scheme-host-port with no path, and a domain must be lowercase. Each refuses at ' +
      'configuration time because each would otherwise fail silently later — a second placeholder leaves one occurrence literal in a mailed ' +
      'link, an origin with a path can never equal a browser\'s `Origin` header, and a capitalised domain can never match a lowercased address.',
  },
  {
    method: 'GET', path: '/api/apps/:id/mail-templates', section: 'apps',
    summary: 'Lists the custom mail templates the app has, which may be none.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appMailTemplateListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "templates": [appMailTemplate, …] }` with **only the kinds that have a custom template** — at most three. A kind that does ' +
      'not appear is one using the Fleetless default text, which is an ordinary state and not a missing row. Mails to *Fleetless* users, a ' +
      'team invitation or a console password reset, are not in this list and are deliberately not customisable: they are about this platform, ' +
      'not about the developer\'s product.',
  },
  {
    method: 'GET', path: '/api/apps/:id/mail-templates/:kind', section: 'apps',
    summary: 'Reads one custom mail template of the app.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'kind', description: 'Which of the three mails this template replaces — a `mailTemplateKind`: `invite`, `verify` or `reset`.' }],
    query: null, request: null, response: appMailTemplate,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found'], transport: 'http',
    notes:
      'The `kind` segment is a `mailTemplateKind`, so a fourth word is `400 validation_error` — the path names a set that is closed, and ' +
      'answering `404` about it would read as "this app has no such template" when the truth is that no app can. `404 not_found` is the app, ' +
      'or a kind this app has left on the Fleetless default: there is no stored row to read back, and inventing one would present the default ' +
      'text as something the developer wrote.',
  },
  {
    method: 'PUT', path: '/api/apps/:id/mail-templates/:kind', section: 'apps',
    summary: 'Stores or replaces the app\'s template for one kind of mail, refusing one that does not render.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'kind', description: 'Which of the three mails this template replaces — a `mailTemplateKind`: `invite`, `verify` or `reset`.' }],
    query: null, request: putAppMailTemplateRequest, response: appMailTemplate,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'template_invalid', 'rate_limited'], transport: 'http',
    notes:
      'The body carries `subject`, `text` and an optional `html`, each a Liquid template; `kind` is in the path and `updated_at` is the ' +
      'server\'s, so neither may arrive. `text` is required even when `html` is given — a mail with no text part is unreadable to a client ' +
      'that refuses HTML. \n\n**Liquid runs in strict mode and every part is rendered here before anything is stored**, so `422 ' +
      'template_invalid` is an unknown variable or a syntax error rather than an empty line in a mail somebody already received. Its `details` ' +
      'is a `mailTemplateProblemDetails` naming which of the three parts failed and the renderer\'s own message, because an error that did not ' +
      'say which leaves the developer re-reading all three. The permitted variables are `MAIL_TEMPLATE_VARIABLES` and the set is closed. ' +
      'Rendering here promises nothing about send time: a template that fails for one recipient falls back to the Fleetless default and writes ' +
      'an audit event, and no answer on this route can say otherwise. \n\nA rendered part is capped while it is being written, so a template ' +
      'that would produce megabytes answers `422 template_invalid` rather than building the string first. Limited server-side to **ten calls ' +
      'a minute per app**, shared with the preview, answering `429 rate_limited` with `retry_after_ms`.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/mail-templates/:kind', section: 'apps',
    summary: 'Drops the app\'s custom template for one kind, returning that mail to the Fleetless default.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'kind', description: 'Which of the three mails this template replaces — a `mailTemplateKind`: `invite`, `verify` or `reset`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found'], transport: 'http',
    notes:
      'The mail keeps being sent — this removes the developer\'s wording, not the message. A kind that already has no custom template answers ' +
      '`404 not_found` rather than `204`: there is nothing here to reach the end state of, and the two facts are worth telling apart to ' +
      'somebody who thinks they still have a template stored.',
  },
  {
    method: 'POST', path: '/api/apps/:id/mail-templates/:kind/preview', section: 'apps',
    summary: 'Renders a template with sample data and answers the three parts, storing nothing.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'kind', description: 'Which of the three mails this template replaces — a `mailTemplateKind`: `invite`, `verify` or `reset`.' }],
    query: null, request: mailTemplatePreviewRequest, response: mailTemplatePreviewResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'template_invalid', 'rate_limited'], transport: 'http',
    notes:
      'Takes the same document the PUT does and writes nothing, so a developer can see the rendered subject, text and HTML before anybody ' +
      'receives them. The sample data fills every variable in `MAIL_TEMPLATE_VARIABLES`, including `link`, which is a plausible URL and not a ' +
      'live token. `422 template_invalid` carries the same `mailTemplateProblemDetails` the PUT does, which is the point of previewing: the ' +
      'error arrives on the screen where the template is being written. `404 not_found` is the app — a kind with no stored template previews ' +
      'perfectly well, since the body being rendered is the one in the request. \n\n**The sample data does not vary with the `kind`.** ' +
      'Every kind renders against one fixed set: an invite-shaped `link` and `expires_in_hours: 24`, where a real reset mail says 1 and a ' +
      'real invitation says 168. A preview shows how the template renders, not what the recipient of that kind will read. \n\nLimited ' +
      'server-side to **ten calls a minute per app**, shared with the PUT, answering `429 rate_limited` with `retry_after_ms`: rendering is ' +
      'synchronous CPU work on the shared cloud and an unbounded loop of it is a denial of service against every other org.',
  },
  {
    method: 'POST', path: '/api/apps/:id/mail-templates/:kind/test', section: 'apps',
    summary: 'Sends the rendered template as a real mail to the calling developer.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 202,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }, { name: 'kind', description: 'Which of the three mails this template replaces — a `mailTemplateKind`: `invite`, `verify` or `reset`.' }],
    query: null, request: mailTemplatePreviewRequest, response: mailOutcome,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'validation_error', 'not_found', 'template_invalid', 'rate_limited', 'target_state_conflict'],
    transport: 'http',
    notes:
      '**The recipient is the calling developer\'s own address and cannot be chosen.** A test send that named an arbitrary address would be a ' +
      'mail relay with an authentication step in front of it. The body and the sample data are the preview\'s, so what arrives is what the ' +
      'preview showed, in a real client with real HTML. \n\nThe answer is `{ "mail": mailStatus }` rather than an empty `202`, because the one ' +
      'thing a developer needs next is whether a mail actually left: `not_configured` on a deployment with no mailer looks exactly like a ' +
      'successful send otherwise, and they wait for a message nobody posted. `409 target_state_conflict` is that state made explicit where the ' +
      'deployment can already tell — there is no mailer configured at all, so nothing will be attempted. `422 template_invalid` refuses before ' +
      'sending, and `429 rate_limited` bounds how often this can be used to mail anybody, the developer included.',
  },

  /* ------------------------------------------- the team and its invites */
  {
    method: 'GET', path: '/api/org/users', section: 'users',
    summary: "Lists the organisation's Fleetless users — the team who reach the console.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: fleetlessUserListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes:
      '**Fleetless users, not an app\'s users.** The two identity spaces are separate and nothing joins them, so an app\'s users are listed ' +
      'per app and never appear here. There is nothing to narrow by: the group filter this route used to take described a model with no ' +
      'successor, and every Fleetless user of the org is in this answer.',
  },
  {
    method: 'GET', path: '/api/org/users/:id', section: 'users',
    summary: 'Reads one Fleetless user of the org.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The Fleetless user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: fleetlessUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'POST', path: '/api/org/invitations', section: 'users',
    summary: 'Invites an address onto the team and returns the accept link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createTeamInviteRequest, response: teamInvite,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'validation_error', 'email_taken'], transport: 'http',
    notes:
      '**A Fleetless user, not an app user.** Inviting somebody into an app is `POST /api/apps/:id/invitations` and is a different link into ' +
      'a different space. `tier` is required, because "I did not think about it" and "I meant developer" must not be the same request on the ' +
      'field that decides who can remove whom. **Inviting an Owner is Owner-only** — an invitation carrying `tier: "owner"` is a promotion ' +
      'with an extra step, since the response hands back the `accept_url`. `ownerTier` is `false` here because the gate is on that value, not ' +
      'on the route: any team member may invite a developer. **This collection sits beside `/api/org/users`, not under it**: an invitation is ' +
      'not a user yet, and the old spelling put a literal `invitations` where `GET /api/org/users/:id` expects a uuid — reachable only because ' +
      'a router ranks a static segment above a parametric one.',
  },
  {
    method: 'GET', path: '/api/org/invitations', section: 'users',
    summary: 'Lists the pending team invitations of the org, without their tokens.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: pendingTeamInviteListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes:
      'No `accept_url` is in this listing, and that omission is the point: it exists so an admin can spot a backdoor invitation planted for an ' +
      'address they merely control, not so anyone can re-read a link.',
  },
  {
    method: 'DELETE', path: '/api/org/invitations/:id', section: 'users',
    summary: 'Revokes a pending invitation so its link stops resolving.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The invitation\'s uuid, as listed by `GET /api/org/invitations`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'An invitation that was already accepted is not pending and answers `404`, the same answer one that never existed gets.',
  },
  {
    method: 'POST', path: '/api/org/invitations/:id/reissue', section: 'users',
    summary: 'Mints a fresh token onto the same invitation and returns the new accept link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The invitation\'s uuid, as listed by `GET /api/org/invitations`.' }],
    query: null, request: null, response: teamInvite,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'rate_limited'], transport: 'http',
    notes:
      'The old link stops resolving the instant this returns — the row is looked up by token hash and the previous hash is gone. Two live ' +
      'links to one invitation would reopen the door the listing\'s missing `accept_url` closes. Limited server-side to once a minute per ' +
      'invitation, answering `429 rate_limited` with `retry_after_ms`; a disabled button is a hint, this is the limit. Re-issuing an ' +
      'owner-tier invitation needs Owner tier, exactly as creating one does.',
  },
  {
    method: 'POST', path: '/api/org/invitations/accept', section: 'users',
    summary: 'Spends an invitation token and creates the login it was addressed to.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 204,
    params: [], query: null, request: acceptTeamInviteRequest, response: null,
    errors: ['rate_limited', 'validation_error', 'token_spent', 'email_taken'], transport: 'http',
    notes:
      '**`204`, not a session.** The console signs in through its own OAuth portal, so a session minted here would be a second credential door ' +
      'for one account — and every security property would then have to be right in two places. Unknown, expired and already-accepted tokens ' +
      'collapse into `410 token_spent`. A browser form post gets the rendered "you\'re in" page instead.',
  },
  {
    method: 'GET', path: '/accept-invite/:token', section: 'users',
    summary: 'Serves the invitation card a mailed accept link opens.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'token', description: 'The opaque invitation token from the mailed link; it is never sent as a query parameter.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML, served by the cloud from the auth portal origin; the form on it posts to `POST /api/org/invitations/accept`. An unknown, ' +
      'spent or expired token renders the "link no longer valid" page at `410`, which offers the password-reset page — the only self-service ' +
      'door the portal has, since an invitation cannot be re-issued by the person holding it.',
  },
  {
    method: 'PATCH', path: '/api/org/users/:id', section: 'users',
    summary: "Changes a team member's display name.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The Fleetless user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: patchFleetlessUserRequest, response: fleetlessUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'Nothing here has a consequence a PATCH body cannot carry: the tier is its own route, because it is owner-only and has a last-owner ' +
      'guard, and the address is immutable. The audit event records which fields were addressed, never their values.',
  },
  {
    method: 'DELETE', path: '/api/org/users/:id', section: 'users',
    summary: 'Removes a team member and ends every session they hold.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The Fleetless user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'last_owner'], transport: 'http',
    notes:
      'Sessions are revoked before the row is deleted: a still-existing user with a dead session is recoverable by retrying, a deleted user ' +
      'whose old token still works is not. Any team invitation still outstanding for that address is expired too — a link mailed before the ' +
      'removal is a standing re-admission ticket. **App accounts sharing the address are untouched**, in this org and in every other: they are ' +
      'separate identities in a separate space, and deleting a colleague must not delete a customer. Removing an Owner needs Owner tier, and ' +
      'removing the last one is `409 last_owner`.',
  },
  {
    method: 'PUT', path: '/api/org/users/:id/tier', section: 'users',
    summary: 'Promotes or demotes a team member between Owner and developer tier.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [{ name: 'id', description: 'The Fleetless user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: tierChangeRequest, response: fleetlessUser,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'validation_error', 'last_owner'],
    transport: 'http',
    notes:
      'Owner tier, unconditionally — this is the route the whole owner-exclusive list is about. A uuid that is not a Fleetless user of this ' +
      'org answers `404 not_found`, the same as one that does not exist anywhere: the `409 target_state_conflict` documented here until the ' +
      'two-space cut had exactly one producer, the Org Admins membership check, and went with it. Demoting the last Owner is `409 ' +
      'last_owner`, decided by a row lock inside the writing ' +
      'transaction rather than by a read beforehand. Setting the tier already held changes nothing and writes no audit event. No session is ' +
      'revoked: a tier is re-read from the row on every request, so no issued token carries a stale copy of it.',
  },

  {
    method: 'PATCH', path: '/api/org', section: 'org',
    summary: 'Renames the org.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [], query: null, request: patchOrgRequest, response: patchOrgResponse,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'validation_error'], transport: 'http',
    notes:
      'Answers `{ "org": org }`. Owner tier, and the gate runs ' +
      'before the body is looked at, so a malformed rename and a forbidden one answer the same way. Renaming to the name already held writes ' +
      'nothing and records no audit event.',
  },





  /* --------------------------------------------------------------- mcp */
  {
    method: 'GET', path: '/.well-known/oauth-protected-resource/mcp', section: 'mcp',
    summary: 'Publishes what the MCP endpoint says about who may authorize for it.',
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: protectedResourceMetadata,
    errors: [], transport: 'http',
    notes:
      'RFC 9728, for the one central MCP endpoint. `resource` and `authorization_servers` are the same URL: the MCP server is its own ' +
      'authorization server here. One document for the whole deployment, because there is one endpoint and it is scoped to nothing ' +
      'narrower: every Fleetless user of every org authorizes for the same resource, and the token names the person.',
  },
  {
    method: 'GET', path: '/.well-known/oauth-authorization-server/mcp', section: 'mcp',
    summary: 'Publishes the authorization-server metadata an MCP client reads to sign a person in.',
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: authorizationServerMetadata,
    errors: [], transport: 'http',
    notes:
      '`registration_endpoint` being present is the whole point of the dynamic-registration work: a client that finds it registers itself and ' +
      'never asks a person for a `client_id`. `authorization_endpoint` is the only field that moves to the auth-portal origin when one is ' +
      'configured — `issuer`, `token_endpoint` and the resource identifier stay canonical, because a client checks a token\'s `iss` and `aud` ' +
      'against those strings and moving them would invalidate every token ever minted.',
  },
  {
    method: 'POST', path: '/mcp/oauth/register', section: 'mcp',
    summary: 'Registers an MCP client dynamically, with no app identifier and no human in the loop.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 201,
    params: [], query: null, request: null, response: dynamicClientRegistrationResponse,
    errors: ['rate_limited'], transport: 'http',
    notes:
      'RFC 7591, and deliberately **not** parsed against `dynamicClientRegistrationRequest`: that shape is strict, and a strict schema here ' +
      'would answer `400` to a conforming client and take the whole paste-the-URL flow down with it. `client_name` and `redirect_uris` are ' +
      'read by hand; everything else is ignored. What comes back is what was actually granted, which §3.2.1 allows a server to substitute — ' +
      'this authorization server issues `authorization_code` only, so a client that asked for `refresh_token` is registered and told plainly ' +
      'that it did not get one. The registration carries a TTL. Refusals are `oauthError`; the rate limiter answers `apiError`.',
  },
  {
    method: 'GET', path: '/mcp/oauth/authorize', section: 'mcp',
    summary: 'Starts an MCP sign-in and redirects the browser to the identify card.',
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 302,
    params: [], query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'Client and `redirect_uri` are validated first and a failure there never redirects, the same open-redirect discipline the app flow ' +
      'applies; those refusals are `oauthError`. Exact `redirect_uri` matching for both client kinds — the loopback-port wildcard of RFC 8252 ' +
      '§7.3 belongs to the one central client alone, whose URIs are configured ahead of time and cannot name an ephemeral port. A client that ' +
      'registered itself seconds ago can name the port it bound, and widening the wildcard there would only widen where a stolen `client_id` ' +
      'may send a browser. Nothing about the person is decided here — the next card asks for an email address and the password step after ' +
      'it resolves the account; this route knows only the client.',
  },
  {
    method: 'GET', path: '/mcp/oauth/interaction/:id', section: 'mcp',
    summary: 'Serves the "what is your email address" card of an MCP sign-in.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id minted by `GET /mcp/oauth/authorize`, which redirects the browser here.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML, and a GET rather than the body of the authorize response — so it is reloadable, bookmarkable and survives a back button, which ' +
      'the inline page it replaced was not. An expired, consumed, unknown or hand-edited interaction renders one page at `410`, and so does a ' +
      'client whose dynamic registration lapsed in between.',
  },
  {
    method: 'POST', path: '/mcp/oauth/identify', section: 'mcp',
    summary: 'Takes the email address and hands back the password step.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      'The identifier-first step, with nothing left to identify: Fleetless users are password-only (design D1/D7), so **this step does not ' +
      'read the address at all** — it renders the password card for a known address, an unknown one and an empty one alike, and the login ' +
      'step below answers the same `401` for all three. That is a property of the shape rather than of two branches agreeing: there is no ' +
      'lookup here whose result could differ. A browser form post gets the password card; a JSON caller gets `{ "next" }`, which has no ' +
      'schema. Still rate limited per (route, ip, email), because it is an unauthenticated endpoint that renders a page.',
  },
  {
    method: 'POST', path: '/mcp/oauth/login', section: 'mcp',
    summary: 'Checks the password and hands back where the MCP sign-in continues.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: oauthRedirectResponse,
    errors: ['rate_limited', 'validation_error', 'token_spent', 'invalid_credentials'], transport: 'http',
    notes:
      'The body is `{ "interaction_id", "email", "password" }`, read field by field rather than through a contract shape. A browser gets a ' +
      '`303` — to the consent screen for a self-registered client, or straight to the callback for the central one — where a JSON caller gets ' +
      'this `200` and `redirect_to`.',
  },
  {
    method: 'GET', path: '/mcp/oauth/consent/:id', section: 'mcp',
    summary: 'Serves the consent screen for an MCP client that registered itself.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id from the sign-in; the login step redirects the browser here.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML. The browser-proof cookie is checked on this GET, not only on the POST. The **central** client never reaches this screen and ' +
      'renders the `410` page instead: it is configured by the operator, so there is no self-registered stranger for a person to weigh up.',
  },
  {
    method: 'POST', path: '/mcp/oauth/consent', section: 'mcp',
    summary: 'Records the allow-or-deny and sends the browser back to the MCP client.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: oauthRedirectResponse,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      'Fail-closed exactly as the app flow\'s consent POST is: the body carries the pressed button\'s `decision`, and anything that is not the ' +
      'Allow value — a missing field included — denies. A denial still answers a `redirect_to`, carrying `error=access_denied` back to the ' +
      'client, because a client that is refused must learn so from its own callback rather than from a page nobody sent it.',
  },
  {
    method: 'POST', path: '/mcp/oauth/token', section: 'mcp',
    summary: 'Exchanges an MCP authorization code for an access token.',
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: oauthTokenResponse,
    errors: [], transport: 'http',
    notes:
      'Only `authorization_code` is supported — there is no refresh grant here, so a session ends when its token expires and the client signs ' +
      'in again. Refusals are RFC 6749 §5.2\'s `oauthError`, so this route emits none of the codes in this reference. The response carries no ' +
      '`refresh_token`; the shape is the same `oauthTokenResponse` the app flow answers, whose refresh field is optional. The code is ' +
      'single-use, PKCE-verified, and its `resource` must match the audience it was authorized for.',
  },

  /* ------------------------------- developer auth (the console\'s OAuth portal) */
  {
    method: 'GET', path: '/console/oauth/authorize', section: 'developer-auth',
    summary: 'Starts a console sign-in and redirects the browser to the identify card.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 302,
    params: [], query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'The authorization-code leg of the console\'s own OAuth flow: PKCE `S256` is required and `redirect_uri` must match a configured console ' +
      'callback exactly, never a prefix. Refusals use RFC 6749\'s flat `oauthError` shape, not the `apiError` envelope, so they carry none of ' +
      'the codes in this reference. A bad `redirect_uri` never redirects — until the URI is known-good, sending a browser to it is the attack; ' +
      'later errors go back to the callback as query parameters. `?prompt=create` starts at sign-up rather than sign-in.',
  },
  {
    method: 'GET', path: '/console/oauth/interaction/:id', section: 'developer-auth',
    summary: 'Serves the "what is your email address" card of a console sign-in.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id minted by `GET /console/oauth/authorize`, which redirects the browser here.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML. An expired, consumed, unknown or hand-edited interaction renders one page at `410`: which of the four it was is not a fact a ' +
      'stranger may learn, and to the person it is one fact anyway. The page resolves nothing about the address typed into it, so there is no ' +
      'enumeration oracle here at all.',
  },
  {
    method: 'POST', path: '/console/oauth/identify', section: 'developer-auth',
    summary: 'Takes the email address and hands back the password step.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null,
    errors: ['rate_limited', 'token_spent'], transport: 'http',
    notes:
      'A browser form post gets the password card as HTML; a JSON caller gets `{ "next": "/console/oauth/login" }`, which has no schema — the ' +
      'step made no decision, and it says so rather than inventing a redirect. A dead interaction is `410 token_spent`. Rate limited despite ' +
      'spending no credential: it is an unauthenticated endpoint that renders a page.',
  },
  {
    method: 'POST', path: '/console/oauth/login', section: 'developer-auth',
    summary: 'Checks the password and mints the authorization code the console exchanges.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: oauthRedirectResponse,
    errors: ['rate_limited', 'token_spent', 'invalid_credentials'], transport: 'http',
    notes:
      'This is the only place a Fleetless developer password may be typed; `POST /api/auth/login` is gone, because a second credential door ' +
      'means every security property has to be right in two places. A browser form post gets a `303` to the callback URL; a JSON caller gets ' +
      'that same URL as `redirect_to` at `200`. An argon2 verify runs whether or not the address exists, and the Org Admins check runs after ' +
      'it — filtering first would hand back a faster "no" for a non-admin account, which is a timing oracle. Wrong password, unknown address ' +
      'and "not an org admin" render identical bytes under one `401`.',
  },
  {
    method: 'GET', path: '/console/oauth/signup/:id', section: 'developer-auth',
    summary: 'Serves step one of console sign-up, the account card.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id minted by `GET /console/oauth/authorize` with `?prompt=create`.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML. While the deployment runs in closed beta this renders the "sign-up is closed" card at `403` instead, keeping the interaction alive ' +
      'and pointing back at sign-in — the person may well already have an account.',
  },
  {
    method: 'POST', path: '/console/oauth/signup', section: 'developer-auth',
    summary: 'Takes the sign-up email and password and hands back the organization step.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null,
    errors: ['rate_limited', 'token_spent', 'signup_closed', 'validation_error', 'email_taken'], transport: 'http',
    notes:
      'A browser form post gets the organization card; a JSON caller gets `{ "next", "email" }`, which has no schema. The plaintext password ' +
      'exists for this one request: what is stored is its argon2 hash, on the interaction row, which expires with it. A per-interaction proof ' +
      'cookie is set here — it is what stops a third party from finishing a sign-up somebody else started. Sign-up is the one surface whose job ' +
      'is to say an address is taken, so `409 email_taken` is not a leak here.',
  },
  {
    method: 'POST', path: '/console/oauth/signup/organization', section: 'developer-auth',
    summary: 'Takes the organization name and creates the org and its founding Owner.',
    audience: 'internal', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: oauthRedirectResponse,
    errors: ['rate_limited', 'token_spent', 'signup_closed', 'wrong_browser', 'validation_error', 'email_taken'], transport: 'http',
    notes:
      'The same single transaction `POST /api/auth/signup` runs. Step one must have run in **this** browser: a missing or mismatched proof ' +
      'cookie is `401 wrong_browser` and the person is sent back to step one. A browser form post gets a `303` to the console callback; a JSON ' +
      'caller gets `redirect_to` at `200`.',
  },
  {
    method: 'POST', path: '/console/oauth/token', section: 'developer-auth',
    summary: "Exchanges the console's authorization code for a developer session.",
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: sessionTokens, errors: [], transport: 'http',
    notes:
      'Called by the console\'s own server, never by a browser. Refusals use RFC 6749 §5.2\'s flat `oauthError` shape — it is a token endpoint, ' +
      'and that is the dialect a caller of one expects — so it emits none of the codes in this reference. Proof of possession is checked before ' +
      'the replay check, and the single-use consume is atomic, so exactly one caller ever mints. The Org Admins membership is re-read here: the ' +
      'code was minted earlier, and a user moved out in between must not get a console session.',
  },

  /* ---------------------------------------------------- mcp (the endpoint) */
  {
    method: 'GET', path: '/mcp/welcome', section: 'mcp',
    summary: 'Serves the page that tells a person which URL to paste into their MCP client.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML, one fixed document rendered once at startup — its inputs are process configuration, not request state. Cached for five minutes ' +
      'rather than a day, because the URLs it names can change with a deployment. Its content security policy admits the page\'s own inline ' +
      'style and script by SHA-256 rather than by `unsafe-inline`, and forbids every external fetch outright. A configured friendly URL that ' +
      'is not a usable absolute http(s) URL is ignored rather than rendered: a typo in a deployment variable must not put a broken URL in ' +
      'front of every end user.',
  },
  {
    method: 'POST', path: '/mcp', section: 'mcp',
    summary: 'The central MCP endpoint: a stateless Streamable HTTP transport carrying the robot and console tool catalogs.',
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null,
    errors: ['unauthorized', 'forbidden'], transport: 'http',
    notes:
      'JSON-RPC over MCP\'s Streamable HTTP, so neither the request nor the response is a shape contracts describes; the tool arguments and ' +
      'results are the schemas in each tool definition. **Fleetless users only** — an app\'s users reach their own app endpoint instead. ' +
      '**The bearer is verified inside the handler**, not by a route guard: the identity comes from the token and the path names none, and ' +
      'the refusal has to carry a `WWW-Authenticate` challenge that a guard shared with the REST surface does not send. `Origin` is checked ' +
      'against the cloud\'s own, and a foreign one is the `403 forbidden` above. **Both catalogs, unconditionally**: every caller admitted ' +
      'here is a Fleetless user, so the tool list has nothing left to vary with and the admin-ness check on `tools/call` is gone — a console ' +
      'tool that is still narrower than the catalog refuses for itself (`console_robot_delete` answers `tier_required` to a non-Owner). ' +
      '`403 forbidden` is also what an `mcp_session` token whose subject is an **app user** gets: this endpoint serves the team only, and such ' +
      'a token belongs to its own app\'s endpoint. The code is `forbidden` rather than `mcp_disabled` because nothing is switched off — the ' +
      'caller is at the wrong server — and per-app sign-in mints exactly such tokens, so the two states must not share a word. ' +
      '`mcp_access_denied` is gone with the per-user override and the ' +
      'group flag it read: every Fleetless user has MCP access here (D1). Stateless: a fresh transport per request, no session id, nothing ' +
      'survives the call.',
  },


  /* ----------------------------------------- mcp (one app's own server, D7) */
  {
    method: 'POST', path: MCP_APP.endpoint, section: 'mcp',
    summary: "One app's MCP endpoint: the same stateless Streamable HTTP transport, carrying that app's robots.",
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 200,
    params: [APP_IDENTIFIER], query: null, request: null, response: null,
    errors: ['not_found', 'unauthorized', 'forbidden'], transport: 'http',
    notes:
      'JSON-RPC over MCP\'s Streamable HTTP, so neither the request nor the response is a shape contracts describes — exactly as `POST /mcp` ' +
      'is, and stateless for the same reason: a fresh transport per request, no session id, nothing surviving the call. **App users only.** ' +
      'The tools are this app\'s robots filtered by the caller\'s role, built by the same builder `GET /api/apps/:id/roles/:roleId/mcp-tools` ' +
      'previews, so the console\'s preview and the live catalog cannot drift. The console tool family belongs to the central endpoint and is ' +
      'offered here to nobody. \n\n**The bearer is verified inside the handler**, not by a route guard, for the two reasons the central ' +
      'endpoint gives — the identity comes from the token and the path names none of it, and the refusal has to carry a `WWW-Authenticate` ' +
      'challenge a guard shared with the REST surface does not send. The challenge names **this app\'s** protected-resource document (RFC ' +
      '9728\'s `resource_metadata`), which is how an MCP client discovers the right authorization server from a bare `401`; pointing it at ' +
      'the central document would send every app\'s client to the wrong sign-in. \n\n**`404 not_found` covers an identifier no app carries AND ' +
      'an app whose `appAuthConfig.mcp_enabled` is off — one answer for both, the same one the two metadata documents and `register` give.** ' +
      'A separate `403 mcp_disabled` here would hand an anonymous caller a three-way oracle (`404` = no such app, `403` = the app exists ' +
      'with MCP off, `401` = the app exists and is live), which is exactly the distinction discovery collapses; there is no point ' +
      'collapsing it in one place and publishing it in another. The switch is re-read on every request rather than cached off the token, so ' +
      'a developer turning it off ends the sessions already running, and it is decided **before the bearer is looked at** — the reverse of ' +
      'the usual order, and deliberate: it is a fact about the path, an app identifier is public, and an absent server that answered `401` ' +
      'would send a client hunting a credential no credential can satisfy. `401 unauthorized` is a missing, unverifiable or expired bearer, ' +
      'or an `aud` that is not this endpoint. `403 forbidden` is a token that verifies and is not this app\'s user: another app\'s session, a ' +
      'Fleetless user\'s central `mcp_session`, an account that is `blocked` or still `pending_verification`, or a foreign `Origin`.',
  },
  {
    method: 'GET', path: MCP_APP.endpoint, section: 'mcp',
    summary: "Answers the standalone SSE stream's GET, which a stateless transport does not serve.",
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 405,
    params: [APP_IDENTIFIER], query: null, request: null, response: null,
    errors: ['not_found', 'unauthorized', 'forbidden'], transport: 'http',
    notes:
      'MCP\'s Streamable HTTP gives this path three verbs: `POST` carries JSON-RPC, `GET` opens the server-initiated SSE stream, and `DELETE` ' +
      'ends a session. This server has no sessions — the argument is in `MCP_PROTOCOL_VERSION`\'s own note, and W8\'s second cloud instance is ' +
      'where a per-process session map would break — so `GET` and `DELETE` answer `405`, which is what a client is built to fall back from. ' +
      '\n\n**The `405` is this cloud\'s own answer, not the SDK\'s**, and the difference was measured: MCP SDK 1.30.0 opens an SSE stream on ' +
      '`GET` (`handleGetRequest`) and answers `200` on `DELETE` (`handleDeleteRequest`), neither of which a stateless server has any ' +
      'business doing, so the cloud writes the `405` itself in the transport\'s own JSON-RPC error shape with `Allow: POST`. \n\n**The row exists so that the `405` is not a `404`.** An unregistered verb answers ' +
      '`404`, and at a path whose last segment is an app identifier a `404` already means *no such app* — one answer for two states, which is ' +
      'the failure this project keeps paying for. Registering the verb lets the endpoint say "this app\'s server is here; this verb is not ' +
      'part of it". The central `/mcp` registers neither verb and does not need to: its path takes no parameter, so nothing can misread its ' +
      '`404`. \n\n**The `405` body is the transport\'s JSON-RPC error object, not the `apiError` envelope.** The three codes above are the ' +
      'refusals that come *first* — the app, its switch, then the bearer, in the order `POST` describes — and they are `apiError` because ' +
      'they are answered before the transport is reached at all. If this server ever becomes stateful, this row and the `DELETE` beside it ' +
      'are where that lands, and the cloud\'s route-manifest test is what would make both repositories notice.',
  },
  {
    method: 'DELETE', path: MCP_APP.endpoint, section: 'mcp',
    summary: 'Answers the session-termination DELETE, which a stateless transport has no session to end.',
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 405,
    params: [APP_IDENTIFIER], query: null, request: null, response: null,
    errors: ['not_found', 'unauthorized', 'forbidden'], transport: 'http',
    notes:
      'The other half of what the `GET` row above explains, and registered for the same reason: without a row here, a client tidying up after ' +
      'itself would read `404` and could not tell a stateless server from an app that does not exist. `405`, from the same transport, with ' +
      'the same three refusals ahead of it. A caller that wants a session to end simply stops sending requests — there is no server-side state ' +
      'for this verb to remove, which is the point rather than a limitation.',
  },
  {
    method: 'GET', path: MCP_APP.protectedResourceMetadata, section: 'mcp',
    summary: "Publishes what one app's MCP endpoint says about who may authorize for it.",
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [APP_IDENTIFIER], query: null, request: null, response: protectedResourceMetadata,
    errors: ['not_found'], transport: 'http',
    notes:
      'RFC 9728, for the resource `<PUBLIC_API_BASE_URL>/mcp/<identifier>`. `resource` and `authorization_servers` are the same URL: each ' +
      'app\'s MCP server is its own authorization server, as the central one is, and that identity is what keeps one app\'s tokens out of ' +
      'another\'s — the audience a token carries is this app\'s endpoint URL and nothing broader. \n\n**The identifier goes last, after the ' +
      'document name.** §3.1 inserts `/.well-known/oauth-protected-resource` *before* the resource\'s path, so the document for `/mcp/<id>` is ' +
      'at `/.well-known/oauth-protected-resource/mcp/<id>`; a hand-written `/.well-known/oauth-protected-resource/<id>` is a path no ' +
      'conforming client ever fetches. `MCP_APP_PATHS` builds both, which is why this row does not spell either. \n\n**An app with MCP ' +
      'switched off answers `404`, the same as an identifier no app carries, and that is a decision rather than a gap.** A metadata document ' +
      'is present or it is absent; `403` is not a state a client\'s discovery code models, and one that met it would either error out or ' +
      'retry forever. Nothing is being hidden — the identifier is public and is in this very path — the two answers are simply the same ' +
      'answer: there is no MCP server here to authorize for. **Every other unauthenticated route on this surface says the same** — the ' +
      'authorization-server document, `register`, `authorize` and the transport itself all answer `404` for both states, so nothing an ' +
      'anonymous caller can reach distinguishes them. A person whose app has the switch off learns that from the console, not from a ' +
      'status code a stranger can also read.',
  },
  {
    method: 'GET', path: MCP_APP.authorizationServerMetadata, section: 'mcp',
    summary: "Publishes the authorization-server metadata an MCP client reads to sign in to one app.",
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [APP_IDENTIFIER], query: null, request: null, response: authorizationServerMetadata,
    errors: ['not_found'], transport: 'http',
    notes:
      'RFC 8414, for the issuer `<PUBLIC_API_BASE_URL>/mcp/<identifier>` — the same path rule as the document above, and the same `404` for a ' +
      'switched-off app. `registration_endpoint` is present for the reason the central document states: a client that finds it registers ' +
      'itself and never asks a person for a `client_id`. \n\n**`issuer`, `token_endpoint` and the resource identifier are minted from the ' +
      'canonical public base, never from the friendly `mcp.fleetless.dev` alias or the request\'s `Host`**, because a client checks a minted ' +
      'token\'s `iss` and `aud` against these exact strings. \n\n**Unlike the central document, `authorization_endpoint` does not move to an ' +
      'auth-portal origin**, and there is nothing here for one to serve: this authorization step renders no Fleetless page at all. It ' +
      'redirects to the app\'s own `mcp_login_url` (D7), which is on the developer\'s origin already.',
  },
  {
    method: 'POST', path: MCP_APP.register, section: 'mcp',
    summary: 'Registers an MCP client dynamically for one app, with no human in the loop.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 201,
    params: [APP_IDENTIFIER], query: null, request: null, response: dynamicClientRegistrationResponse,
    errors: ['rate_limited', 'not_found'], transport: 'http',
    notes:
      'RFC 7591, and deliberately **not** parsed against `dynamicClientRegistrationRequest`, for the reason `POST /mcp/oauth/register` gives: ' +
      'that shape is strict, and a strict schema here would answer `400` to a conforming client and take the whole paste-the-URL flow down ' +
      'with it. `client_name` and `redirect_uris` are read by hand; everything else is ignored, and what comes back is what was actually ' +
      'granted, which §3.2.1 allows — `authorization_code` only, so a client that asked for `refresh_token` is registered and told plainly ' +
      'that it did not get one. The registration carries a TTL. \n\n**The registration is scoped to this app.** A `client_id` minted here ' +
      'authorizes at this app\'s endpoint and nowhere else, so a client registered against one app cannot walk into another\'s authorize with ' +
      'it, and a developer who switches MCP off is not left with strangers\' registrations valid somewhere adjacent. \n\nRefusals are ' +
      '`oauthError`; the rate limiter and `404 not_found` answer `apiError`. That `404` covers an unknown identifier **and** an app with the ' +
      'switch off, mirroring the two metadata documents this endpoint is discovered from — a client that could not read those has no business ' +
      'registering here, and giving it a third distinct answer would only tell it something the documents deliberately do not.',
  },
  {
    method: 'GET', path: MCP_APP.authorize, section: 'mcp',
    summary: "Starts an MCP sign-in and redirects the browser to the app's own login page.",
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 302,
    params: [APP_IDENTIFIER], query: null, request: null, response: null,
    errors: ['not_found', 'target_state_conflict'], transport: 'http',
    notes:
      '**Fleetless renders no page here, and that is the whole of D7.** The route writes an interaction — ten minutes, as the OIDC ones live ' +
      '— and redirects to `appAuthConfig.mcp_login_url` with `{interaction}` filled in. The app then authenticates the person with its own ' +
      'UI, reads `GET /api/client/mcp/interactions/:id` to show the client\'s claimed name and the scopes it asked for, and calls approve or ' +
      'deny. \n\nClient and `redirect_uri` are validated first and a failure there never redirects — the open-redirect discipline `GET ' +
      '/mcp/oauth/authorize` and `GET /api/client/oidc/:slug/start` both keep — and those refusals are RFC 6749\'s flat `oauthError`, which ' +
      'is why none of them appear above. `redirect_uri` is matched **exactly** against the registration, with no loopback-port wildcard: ' +
      'every client here registered itself minutes ago and can name the port it bound, so a wildcard would only widen where a stolen ' +
      '`client_id` may send a browser. \n\nThe two codes above are the `apiError` envelope because they are refusals about the **app**, ' +
      'decided before an OAuth parameter is looked at. **`404 not_found` covers an identifier no app carries AND an app with MCP switched ' +
      'off** — the same single answer the two metadata documents, `register` and the transport give. An earlier draft answered `403 ' +
      'mcp_disabled` here, on the argument that a client which registered while the switch was on is owed the difference between "turned ' +
      'off" and "mistyped"; that argument does not survive the caller being anonymous. This route takes no credential, so the extra code ' +
      'was readable by anyone who could type an identifier, and it handed back precisely the existence distinction every neighbouring ' +
      'route collapses. `mcp_disabled` survives only where the caller has already proved they belong to the app — the two decision routes ' +
      'under `/api/client/mcp/interactions/:id`. `409 ' +
      'target_state_conflict` names `mcp_login_url` with rule `not_set`: MCP is enabled and no page is configured to send the person to. It ' +
      'is the same code and the same shape `send_mail` answers for an unconfigured `invite_url`, and the refusal is the honest one — ' +
      'Fleetless has nowhere to redirect, and rendering a page of its own instead would contradict D2.',
  },
  {
    method: 'POST', path: MCP_APP.token, section: 'mcp',
    summary: "Exchanges one app's MCP authorization code for an access token.",
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [APP_IDENTIFIER], query: null, request: null, response: oauthTokenResponse,
    errors: [], transport: 'http',
    notes:
      'Only `authorization_code`, PKCE-verified and single-use. There is no refresh grant here either, so a session ends when its token ' +
      'expires and the client signs in again; the shape is the same `oauthTokenResponse` the central endpoint answers, whose refresh field is ' +
      'optional and stays empty. **The `aud` is this app\'s endpoint URL on the canonical public base**, and the code\'s `resource` must match ' +
      'it — that is the whole of what stops a token minted for one app being spent at another\'s endpoint. \n\n**Every refusal is RFC 6749 ' +
      '§5.2\'s `oauthError`, so this route emits none of the codes in this reference — including the ones about the app.** An unknown ' +
      'identifier and a switched-off app are `invalid_client` here, not the `404` and `403` the authorize route beside it answers. The ' +
      'difference is who reads the answer: authorize is walked by a browser and its refusal is read by a person, while this endpoint is ' +
      'called by a client\'s own code in the middle of a flow, and handing that code an envelope its OAuth library cannot parse turns a clean ' +
      'refusal into an unexplained crash.',
  },

  /* -------------------------------------------------- app-user (client) auth */
  {
    method: 'POST', path: '/api/client/login', section: 'client-auth',
    summary: 'Signs an app user in with an app identifier, an email address and a password.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientLoginRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'invalid_credentials'], transport: 'http',
    notes:
      'One refusal for every miss — unknown app, unknown address, wrong password, a `blocked` account and one still `pending_verification` — ' +
      'because the caller supplies the `app_identifier` unauthenticated, so "this app knows this user" is not a fact the answer may carry. ' +
      'The argon2 verify is paid unconditionally, including for an unknown app identifier, so response time is not an oracle either.',
  },
  {
    method: 'POST', path: '/api/client/register', section: 'client-auth',
    summary: 'Creates an app user in the `pending_verification` state and mails them a verification link.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 202,
    params: [], query: null, request: clientRegisterRequest, response: null,
    errors: ['rate_limited', 'validation_error', 'not_found', 'registration_closed', 'domain_not_allowed', 'target_state_conflict'],
    transport: 'http',
    notes:
      '**`202` and an empty body for every request policy allows** — a new address, one this app already knows and one it does not answer ' +
      'identically, in status, body and timing. An answer that depended on existence would be the account-enumeration oracle the whole ' +
      'client family is built to avoid. The account cannot log in until the mailed link is spent; `POST /api/client/verify-email` is what ' +
      'does that. \n\n**An address on an account still `pending_verification` is re-registered, not ignored.** The password and display name ' +
      'from this call replace what is stored, every outstanding verification link for the address stops working, and a fresh one is mailed. ' +
      'Otherwise whoever typed an address first would own the password of the account its real owner later verifies. An address on an ' +
      '`active` account changes nothing and sends nothing — that account has already been proven, and its way back in is ' +
      '`POST /api/client/password/reset`. Neither case is visible in the answer. ' +
      '\n\nThe refusals it *does* make are about policy or about what the caller typed, never about a person. `403 registration_closed` when the ' +
      'app has self-registration off and `403 domain_not_allowed` when the address is outside `allowed_domains`: both are the developer\'s own ' +
      'configuration, and a stranger learns the app\'s policy rather than who is in it. **A password under twelve characters is part of that ' +
      '`400 validation_error`** and not a code of its own — the minimum is the `password` field\'s schema rule, and the error names the field, ' +
      'which is what a form needs to mark it. `404 not_found` names an ' +
      '**app identifier no app carries**, and never an address: an app identifier is already public (it is in the MCP metadata path and in the ' +
      'developer\'s own URLs), while collapsing it into `registration_closed` sent a developer who mistyped their own identifier hunting a ' +
      'configuration bug that was not there. `409 target_state_conflict` when the app has configured no `verify_url` or has no default role — ' +
      'there would be nowhere to send the person and no role to give them, and mailing a link that leads nowhere is worse than refusing.',
  },
  {
    method: 'POST', path: '/api/client/verify-email', section: 'client-auth',
    summary: 'Spends a verification token, activates the account and answers a session.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientVerifyEmailRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      '**The answer is a session, not a `204`.** Somebody who has just proved they can read the mail should not be asked to type their ' +
      'password again on the next screen, and the app has an access token to carry them into it. The token is spent first and the account is ' +
      'activated second, as **two writes**: the spend is the atomic one, so a link opened twice cannot mint two sessions, but a process that ' +
      'died between them would leave a spent token on an account still `pending_verification`, whose recovery is ' +
      '`POST /api/client/resend-verification`. Spending the token also proves the address, so a later `PATCH` may return the account to ' +
      '`active` after a block. ' +
      '\n\n**One refusal for every token that does not work: `410 token_spent`** — unknown, past its twenty-four hours, or already used. ' +
      'There is one code because distinguishing them would tell a stranger whether a token ever existed, and because the recovery is the same ' +
      'in all three cases: ask for a fresh link with `POST /api/client/resend-verification`. An app rendering this refusal should offer that ' +
      'and nothing conditional on which of the three it was.',
  },
  {
    method: 'POST', path: '/api/client/resend-verification', section: 'client-auth',
    summary: 'Mails the verification link again, and answers the same whether or not the address exists.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 202,
    params: [], query: null, request: clientResendVerificationRequest, response: null,
    errors: ['rate_limited', 'validation_error', 'not_found'], transport: 'http',
    notes:
      '**`202` in status, body and timing** for an address that names a `pending_verification` account, one that names an already-active ' +
      'account, and one that names nothing at all. A mail is sent only in the first case. This is the same discipline `POST ' +
      '/api/client/register` keeps, by the other door: an answer that varied here would undo it. `404 not_found` is the **app identifier** and ' +
      'nothing else, exactly as on `register` — the address is never the subject of a refusal. Limited per app, address and IP, so this cannot ' +
      'be used to mail somebody repeatedly.',
  },
  {
    method: 'POST', path: '/api/client/password/reset', section: 'client-auth',
    summary: 'Mails an app user a reset link, and answers the same either way.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 202,
    params: [], query: null, request: clientPasswordResetRequest, response: null,
    errors: ['rate_limited', 'validation_error', 'not_found'], transport: 'http',
    notes:
      '**The app-user twin of `POST /api/auth/password/reset`, and a different shape** because the two surfaces name a person differently: a ' +
      'Fleetless address is globally unique and resolves alone, an app user\'s is unique only within their app, so the pair is the identifier. ' +
      'Status, body and timing are identical for a known and an unknown address. An account with no Fleetless password — one created through an ' +
      'identity provider — is mailed nothing and still answers `202`. `404 not_found` is the **app identifier**, never the address. The link ' +
      'points at the app\'s `reset_url`; an app that has configured none can send no mail, which the `202` does not distinguish, because saying ' +
      'so would answer for the address as well.',
  },
  {
    method: 'POST', path: '/api/client/password/reset/confirm', section: 'client-auth',
    summary: 'Spends a reset token, sets the new password and answers a fresh session.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientPasswordResetConfirmRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      '**Every refresh family of that account is revoked**, then a fresh pair is minted for the caller — a forgotten password is one of the two ' +
      'states where somebody else may be holding a live session, and the person completing the reset is the one who should keep theirs. The ' +
      'account is activated if it was still `pending_verification`: reading a mail at that address is the same proof verification asks for. ' +
      '\n\n**One refusal for every token that does not work: `410 token_spent`** — unknown, past its hour, or already used. There is one code ' +
      'because distinguishing them would tell a stranger whether a token ever existed, and the recovery is identical either way: ask for a new ' +
      'link. A replacement password under twelve characters is a `400 validation_error` naming the `new_password` field — the twelve-character ' +
      'minimum is that field\'s schema rule, and it is refused the way any other malformed field is.',
  },
  {
    method: 'POST', path: '/api/client/invitations/accept', section: 'client-auth',
    summary: 'Spends an invitation token, creates or activates the app user and answers a session.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientAcceptInvitationRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_spent', 'email_taken', 'target_state_conflict'], transport: 'http',
    notes:
      '**An app invitation, not a team one.** `POST /api/org/invitations/accept` is the other space and answers `204`; this one answers a ' +
      'session, because the person is landing in the developer\'s app and there is no second door for them to sign in through. The role is the ' +
      'one the invitation fixed at creation, so a later change to the app\'s default role does not re-aim a link already in somebody\'s inbox, ' +
      'and the invitation **bypasses `allowed_domains`** — a developer inviting somebody by hand has already made the decision the whitelist ' +
      'automates. \n\n**One refusal for every token that does not work: `410 token_spent`** — unknown, expired past the seven days, revoked by ' +
      'the developer, or already accepted. There is one code because telling them apart would say whether a token ever existed, and because ' +
      'the one thing the holder of a dead link can do is ask the developer for a new one, whichever of the four it was. A chosen password ' +
      'under twelve characters is part of the `400 validation_error`, naming the `password` field. `409 email_taken` is an address this app ' +
      'has acquired since the invitation was written **as an account that is already in use** — the invitation stays outstanding rather ' +
      'than being spent, so the developer can revoke it or point the person at the login. An address that registered itself and is still ' +
      '`pending_verification` is not that state: accepting sets the password the invitee just chose, activates the account and gives it the ' +
      'invitation\'s role, because reading the invitation mail proves the address the verification link was waiting on. \n\n`409 ' +
      'target_state_conflict` names `role_id` with rule `not_set` when the role the invitation was fixed to has since been deleted and the ' +
      'app has no default role to fall back on: there is no access to hand the acceptor, and creating an account with none would be worse ' +
      'than saying so.',
  },
  {
    method: 'POST', path: '/api/client/refresh', section: 'client-auth',
    summary: 'Rotates an app-user refresh token and mints a fresh access token.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientRefreshRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_expired', 'token_revoked'], transport: 'http',
    notes:
      'The account is re-proved here, not just the token: refresh is where every session eventually re-proves itself, so a user who was ' +
      'blocked or deleted loses the family here even if the proactive revoke had not landed. A family minted from a `resource`-carrying token ' +
      'exchange keeps its audience across every rotation.',
  },
  {
    method: 'POST', path: '/api/client/logout', section: 'client-auth',
    summary: 'Revokes an app-user refresh family.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 204,
    params: [], query: null, request: clientLogoutRequest, response: null,
    errors: ['rate_limited', 'validation_error'], transport: 'http',
    notes:
      '**`204`, and a token the server does not recognise gets it too** — the end state a caller asked for is the end state they get, and ' +
      'distinguishing the two would say whether a token ever existed. It answered a body until 2026-09-05, reporting what was left of the ' +
      'session at the identity provider; that belonged to the hosted login flow, where Fleetless owned the browser. The developer\'s app owns ' +
      'it now and redirects to its own provider itself, knowing which one it is. Open `/realtime` sockets for the session are closed.',
  },
  {
    method: 'POST', path: '/api/client/password/change', section: 'client-auth',
    summary: "Changes an app user's own password and answers a fresh session.",
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: passwordChangeRequest, response: sessionTokens,
    errors: [...CLIENT_GUARD, 'validation_error', 'invalid_credentials', 'target_state_conflict'], transport: 'http',
    notes:
      'The guard admits all three caller kinds, but a password belongs to an app user specifically — a developer bearer or a server key ' +
      'reaching this is `401 unauthorized`. Every other session of the account ends; the answer is the replacement pair, so the tab that made ' +
      'the change stays signed in. An app user belongs to one app, so "every session" is this app\'s. An account that has **no password** — ' +
      'an OIDC-only app user, which the schema admits — answers `409 target_state_conflict` naming the `password` field with rule `not_set`, ' +
      'not `401`: the session is live and the token is fine, it is the account that has nothing to change, and telling such a caller to sign ' +
      'in again sends them round a loop that ends here.',
  },
  {
    method: 'GET', path: '/api/client/me', section: 'client-auth',
    summary: 'Answers who the calling token is and what it is allowed to reach.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: clientIdentity,
    errors: [...CLIENT_GUARD], transport: 'http',
    notes:
      'The one route that answers for all three caller kinds — a developer bearer, an app-user bearer and a server key — which is why the ' +
      'shape names each of `developer_id`, `app_user_id` and `server_key_id` and fills exactly one.',
  },

  /* ---------------------------------------- app-user sign-in through an IdP */
  {
    method: 'GET', path: '/api/client/providers', section: 'client-auth',
    summary: "Lists the app's enabled sign-in providers, so the app can draw its buttons.",
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: clientProviderListQuery, request: null, response: clientProviderListResponse,
    errors: ['validation_error', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "providers": [{ slug, name }, …] }` and **nothing else**: the issuer, the client id, the scopes and the linking policy are ' +
      'management-side facts, and this route is public. An app with no provider answers an empty array, which is the state of an app that ' +
      'offers password login alone; a **disabled** provider is not a button that refuses, it is a button that is not there. \n\n`404 ' +
      'not_found` is the app identifier and can be nothing else — the answer does not vary by person, so there is no address here to be ' +
      'silent about. **Not rate limited**, unlike the rest of the public client family: it reads back two strings of the developer\'s own ' +
      'public configuration, an app\'s login page calls it on every render, and there is nothing behind it to enumerate. The limiter on ' +
      '`start` is where the cost of this flow actually is.',
  },
  {
    method: 'GET', path: '/api/client/oidc/:slug/start', section: 'client-auth',
    summary: "Begins a federated sign-in and redirects the browser to the app's identity provider.",
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 302,
    params: [{ name: 'slug', description: 'The provider to sign in with, as listed by `GET /api/client/providers`; an unknown slug answers `404`.' }],
    query: clientOidcStartQuery, request: null, response: null,
    errors: ['rate_limited', 'validation_error', 'not_found', 'provider_disabled', 'invalid_redirect_uri', 'provider_misconfigured', 'idp_unavailable'],
    transport: 'http',
    notes:
      '**Every refusal here is JSON, answered before any redirect** — the `apiError` envelope, not the `?error=` redirect the callback uses. ' +
      'The difference is the open-redirect discipline: the callback knows a `redirect_uri` this route has already confirmed, and this route ' +
      'does not, so sending a browser anywhere on the strength of an unvalidated parameter is the attack rather than the error report. ' +
      '`400 invalid_redirect_uri` is a malformed target or an origin outside the app\'s `allowed_origins`, and it is checked **first**. ' +
      '\n\n`404 not_found` is an unknown `app_identifier` or a slug this app does not carry; `403 provider_disabled` is a slug it carries with ' +
      '`enabled` off, which is a distinction a developer\'s own page can render as "temporarily off" rather than "gone". `422 ' +
      'provider_misconfigured` and `502 idp_unavailable` are the provider\'s discovery failing the two ways the create route already ' +
      'describes. \n\n**The app runs its own PKCE against Fleetless here**, which is a second exchange independent of the one Fleetless runs ' +
      'against the identity provider: `code_challenge` binds the one-time code the callback returns to a verifier only the app\'s page holds. ' +
      '`state` comes back unchanged on the success redirect and on the error redirect alike. Rate limited per ip, because this is the ' +
      'unauthenticated door that makes Fleetless fetch a remote system.',
  },
  {
    method: 'GET', path: CLIENT_OIDC_CALLBACK_PATH, section: 'client-auth',
    summary: "Takes the identity provider's redirect and sends the browser back to the app.",
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 302,
    params: [], query: clientOidcCallbackQuery, request: null, response: null, errors: ['rate_limited'], transport: 'http',
    notes:
      '**One callback URL for every app and every provider**, and the value of `appAuthConfig.oidc_callback_url` — the string a developer ' +
      'registers at their IdP. `CLIENT_OIDC_CALLBACK_PATH` in `client-auth.ts` is the single spelling of this path; the URL is that path on ' +
      'the cloud\'s canonical public base, never a friendly alias, because the provider compares the redirect target against the one string ' +
      'it was given. ' +
      '\n\n**Rate limited per ip, generously.** The first draft left this route unlimited on the argument that the caller is an identity ' +
      'provider redirecting somebody\'s browser, so a limiter would drop real sign-ins on the strength of traffic none of those people sent. ' +
      'The cost of that argument is a `state` obtained from one `start` being replayable for the interaction\'s full ten minutes, unbounded ' +
      'and unauthenticated, with every replay driving a server-side POST to the developer\'s token endpoint and one audit row into their org ' +
      '— an amplifier against a third party. The interaction is now spent on **every** terminal outcome, refusals included, which closes ' +
      'the replay itself; the limiter is the ceiling on how fast the attempts may arrive at all. It is per ip and sized for a browser, so a ' +
      'person completing a sign-in never meets it. `429 rate_limited` is the one `apiError` this route can answer, and it is not a sign-in ' +
      'outcome — it is a refusal to begin the work, which is why it does not ride back to the app as an `?error=`. \n\nThe query is the ' +
      '**provider\'s** rather than a Fleetless shape, and `clientOidcCallbackQuery` describes it **without being strict**: `state` always, ' +
      '`code` on success, `error` and `error_description` on the provider\'s own refusal, and whatever else that provider adds \u2014 RFC 9207\'s ' +
      '`iss`, a `session_state`, a vendor field. Refusing those would refuse conforming providers, the trap `POST /mcp/oauth/register` ' +
      'documents avoiding. `state` is the required field because it is the only one Fleetless minted. ' +
      '\n\n**It lists `rate_limited` and no other code, because every sign-in outcome it has is a redirect.** Success and failure alike are ' +
      'a `302` to the app\'s own ' +
      '`redirect_uri`: `?code=…&state=…` when a session was resolved, `?error=<clientOidcErrorCode>&state=…` when it was not, so the app ' +
      'renders its own message and can bind either answer to the request it started. Fleetless shows an app user no page (D2). \n\n**The one ' +
      'exception is a `state` that resolves to no interaction** — unknown, hand-edited, or past its ten minutes. Then there is no confirmed ' +
      'redirect target to carry the answer to, and bouncing a browser to an unvalidated one is the hole the whole flow is arranged to avoid, ' +
      'so the cloud renders an HTML problem page at `400`. That is the only Fleetless-rendered surface an app user can reach. It is HTML ' +
      'rather than an `apiError`, which is why no code is listed: a code here would document an envelope no caller receives, and this ' +
      'manifest\'s other HTML pages (`GET /mcp/oauth/interaction/:id`, `GET /console/oauth/interaction/:id`) say their status in prose for ' +
      'the same reason.',
  },
  {
    method: 'POST', path: '/api/client/oidc/exchange', section: 'client-auth',
    summary: 'Trades the one-time code from the callback for an app-user session.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientOidcExchangeRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_spent'], transport: 'http',
    notes:
      'The second half of the app\'s own PKCE: the `code` from the callback redirect plus the `code_verifier` for the challenge `start` ' +
      'carried. Sixty seconds, single-use, and worth nothing to whoever intercepted the redirect without the verifier. \n\n**One refusal for ' +
      'every code that does not work: `410 token_spent`** — unknown, past its sixty seconds, already exchanged, or presented with a verifier ' +
      'that does not match. There is one code because this code **is a credential**: telling the four apart would say whether a given value ' +
      'ever existed, and the recovery is the same in all four — start the sign-in again. The MCP interaction routes collapse their four ' +
      'states the same way and for the same reason, and answer `interaction_expired` rather than this code — the difference is what the value ' +
      'is, not how vague the answer is: a mailed one-time code is a credential, an interaction id names a pending request, and the two ' +
      'deserve different advice on the app\'s own page.',
  },

  /* --------------------------- the app's own MCP consent screen (D7) */
  {
    method: 'GET', path: '/api/client/mcp/interactions/:id', section: 'client-auth',
    summary: 'Reads a pending MCP authorization so the app can draw its own consent screen.',
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id, as `GET /mcp/:appIdentifier/oauth/authorize` put it into the app\'s `mcp_login_url`.' }],
    query: null, request: null, response: clientMcpInteraction,
    errors: ['interaction_expired'], transport: 'http',
    notes:
      '**The bearer is optional, which is why the credential is decided in the handler rather than by a guard.** An app renders this page ' +
      'before it knows who is at the keyboard — the client\'s claimed name, marked unverified, and the scopes it asked for — and reads the ' +
      'document again once the person has signed in. The only field that moves is `already_granted`: a grant belongs to a user, so without a ' +
      'token there is no user for it to be about and it is `false`. An app-user token for a **different** app is treated as absent rather ' +
      'than refused, for the same reason: nothing in this document is that user\'s, so there is nothing to refuse them, and a `401` would ' +
      'break the page for somebody whose browser happens to hold another app\'s session. \n\n**One code for every interaction that is not live: ' +
      '`410 interaction_expired`.** Unknown, past its ten minutes, already decided, an interaction of the central flow, or one whose ' +
      'authorize step never handed a browser to the app — one status and ' +
      'one body, so an id nobody holds cannot be told from one that ran out. **The last of those is what makes the redirect stamp a ' +
      'real gate rather than a note**: an id invented or replayed outside the flow names no interaction this route will describe, and ' +
      'a page reloading its own consent screen is a second read rather than a second redirect, so it keeps working. A `404` beside it would let a caller who did not start the flow ' +
      'ask whether somebody else\'s sign-in is in progress, which is the only question this document could be used to answer. The word is ' +
      'still `interaction_expired` rather than `token_spent`, because an interaction id names a pending request rather than a credential and ' +
      'the app\'s page owes the person the better advice: "that took too long, start again". \n\n**Not rate limited**, unlike most of the ' +
      'public client family and unlike the two decisions beside it: the id is ' +
      'unguessable and names a request the server already holds, the answer says nothing about any person, and the app\'s consent page fetches ' +
      'it on every render. There is nothing behind it to enumerate — to somebody who did not start the flow, an id that resolves and one ' +
      'that does not are equally uninformative.',
  },
  {
    method: 'POST', path: '/api/client/mcp/interactions/:id/approve', section: 'client-auth',
    summary: 'Approves a pending MCP authorization on behalf of the signed-in app user.',
    audience: 'client', auth: 'developer_or_client', rateLimited: true, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id the app read with `GET /api/client/mcp/interactions/:id`.' }],
    query: null, request: null, response: clientMcpInteractionDecisionResponse,
    errors: [...CLIENT_GUARD, 'rate_limited', 'interaction_expired', 'mcp_disabled'], transport: 'http',
    notes:
      'The person is already signed in **at the app**, by whatever means that app uses, and this is the app telling Fleetless what they ' +
      'decided. Fleetless never sees that sign-in, which is D7 in one sentence. \n\nThe guard admits all three caller kinds and the handler ' +
      'takes one: a developer bearer or a server key reaching this is `401 unauthorized`, because a consent is a person\'s and a server key ' +
      'is not a person — the same shape `POST /api/client/password/change` has. `403 mcp_disabled` is the app\'s switch, re-read here as it is ' +
      'on every request — and it is the one refusal on this surface that names the switch, because reaching it needs an app-user session ' +
      'of that very app. \n\n**An interaction of ANOTHER app answers `410 interaction_expired`, not `403`.** An interaction of one app ' +
      'cannot be decided with a session from another — that is what stops a developer running two apps from letting one speak for the ' +
      'other — but saying so with a distinct code would tell any bearer holder that the id names a real, live interaction somewhere else, ' +
      'which is the existence answer the shared `410` exists to withhold. Unknown, expired, already decided, an interaction of the central ' +
      'flow, and one belonging to a different app are one status and one body. Approve ' +
      'and deny spend an interaction alike, so the second call gets it whichever route made the first. \n\n**Rate limited per app user, ' +
      'unlike the read.** The read is a public document about a request the server already holds; this one spends something, and a decision ' +
      'is the one thing a leaked interaction id would be worth hammering for. The limit is on the signed-in account rather than on the ip, ' +
      'because that is what the caller has had to prove. \n\n**The answer is a redirect target, not a redirect.** `redirect_to` is the MCP client\'s own callback carrying ' +
      'the authorization code, and the app\'s page sends the browser there. The app is holding that browser and Fleetless is answering its ' +
      'JSON call, so a `302` here would be a redirect on the wrong request. Approving records the grant for this user and this client, which ' +
      'is what a later `already_granted` reads back.',
  },
  {
    method: 'POST', path: '/api/client/mcp/interactions/:id/deny', section: 'client-auth',
    summary: 'Denies a pending MCP authorization on behalf of the signed-in app user.',
    audience: 'client', auth: 'developer_or_client', rateLimited: true, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The interaction id the app read with `GET /api/client/mcp/interactions/:id`.' }],
    query: null, request: null, response: clientMcpInteractionDecisionResponse,
    errors: [...CLIENT_GUARD, 'rate_limited', 'interaction_expired', 'mcp_disabled'], transport: 'http',
    notes:
      'The same route with the opposite decision, and **it answers a `redirect_to` as well** — the client\'s own callback carrying ' +
      '`error=access_denied`. A client that is refused must learn so from the place it is waiting rather than from a page nobody sent it, ' +
      'the discipline `POST /mcp/oauth/consent` already keeps. \n\n**Two routes rather than one with a `decision` field**, which is what the ' +
      'hosted consent screen has to be: there the decision arrives from a browser form, so anything that is not the Allow value must deny, ' +
      'and a missing field failing closed is a rule somebody has to keep getting right. Here the caller is the app\'s own server-side code ' +
      'and the path *is* the decision — there is no value to misread. The refusals are the approve route\'s, for the reasons stated there, ' +
      'including the limiter: **rate limited per app user**, on the signed-in account rather than the ip, because a denial spends the ' +
      'interaction exactly as an approval does and a caller holding a leaked id must not be able to burn other people\'s sign-ins in a loop.',
  },


  /* ------------------------- the app user's own list of connected clients */
  {
    method: 'GET', path: '/api/client/mcp/grants', section: 'client-auth',
    summary: 'Lists the MCP clients the signed-in app user has consented to.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: mcpConsentGrantListResponse,
    errors: [...CLIENT_GUARD], transport: 'http',
    notes:
      '**So the developer\'s app can offer a "connected apps" screen of its own**, which is the only place an end user could ever be shown ' +
      'this: Fleetless renders no page for an app\'s users (D2), and the console is the developer\'s tool rather than their customers\'. ' +
      '\n\nThe answer is about the bearer\'s own account and takes no user id — there is no id to pass and therefore nothing to pass the ' +
      'wrong one. The guard admits all three caller kinds because it is shared, and the handler takes one: a developer bearer or a server ' +
      'key is `401 unauthorized`, the shape `POST /api/client/password/change` has, because a consent is a person\'s and a server key is not ' +
      'a person. \n\n**Every `client_name` is unverified**, on every row: dynamic registration takes no credential, so the name is text the ' +
      'client chose about itself and `client_name_verified` is the literal `false`. A screen that renders it as an identity is showing ' +
      'somebody a string an attacker picked, and this list is read long after the moment of approval, when nobody remembers what they ' +
      'clicked. **Withdrawn grants are absent**, not listed as withdrawn. \n\n**Not rate limited and not gated on the app\'s MCP switch.** ' +
      'It reads one small table for one account, and a person must be able to see and end what they agreed to even after a developer ' +
      'switches MCP off — a withdrawal door that closes with the feature is a door that is shut exactly when somebody wants it.',
  },
  {
    method: 'DELETE', path: '/api/client/mcp/grants/:clientId', section: 'client-auth',
    summary: 'Withdraws the signed-in app user\'s consent to one MCP client.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'clientId', description: 'The MCP client, as `GET /api/client/mcp/grants` reports its `client_id`. Not a uuid — it is the identifier the dynamic registration issued.' }],
    query: null, request: null, response: null, errors: [...CLIENT_GUARD], transport: 'http',
    notes:
      'The person\'s own door, beside the developer\'s `DELETE /api/apps/:id/users/:userId/mcp-grants/:clientId`. It acts on the bearer\'s ' +
      'own account and on no other — the path carries a client and never a subject — so there is no user for a caller to name and none to ' +
      'confuse. The shared guard admits all three caller kinds and the handler takes one: a developer bearer or a server key is `401 ' +
      'unauthorized`, because withdrawing a consent is the same person\'s act as giving it. Audited as `app_user.mcp_grant_revoked`, ' +
      'with the app user themselves as the actor. \n\n**`204` whether or not there was ' +
      'anything to withdraw.** A client id this account never approved, and one it withdrew a minute ago, both answer the end state that was ' +
      'asked for: a `404` would tell the caller which clients some account has connected, and would make the ordinary double-click a ' +
      'failure. Only a withdrawal that ended a standing agreement is audited. \n\n**It does not end an MCP session already running.** That ' +
      'consent minted a fifteen-minute access token, and the MCP transport checks it against the account rather than against this table, so ' +
      'a session in flight survives until it expires. Nothing can extend it — this authorization server issues no refresh tokens — and the ' +
      'next authorization asks again. An app that needs a client cut off **now** blocks the account, which ends every session that account ' +
      'holds rather than this client\'s alone.',
  },

  /* ------------------------------------------------------------- robots */
  {
    method: 'POST', path: '/api/robots', section: 'robots',
    summary: 'Creates a robot and returns its bridge token once.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createRobotRequest, response: createRobotResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error', 'quota_exceeded'], transport: 'http',
    notes:
      '`token` is the only moment the raw bridge token exists outside the caller\'s hands — the cloud stores a hash, so nothing can read it ' +
      'back and a caller who loses it rotates rather than recovers. Audited: this mints a credential that can speak for the org from anywhere, ' +
      'and the event carries no `details`, because the one interesting value here is the token. `max_robots` is checked before anything is ' +
      'created, which is only safe because robot deletion exists.',
  },
  {
    method: 'GET', path: '/api/robots', section: 'robots',
    summary: "Lists the org's robots with their connection state and exposure counts.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: robotListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
  },
  {
    method: 'GET', path: '/api/robots/:id', section: 'robots',
    summary: 'Reads one robot with its published configuration state and live bridge state.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: robotDetailResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'A robot belonging to another org reads exactly like one that does not exist — `404`, never a `403`.',
  },
  {
    method: 'PATCH', path: '/api/robots/:id', section: 'robots',
    summary: 'Renames the robot.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: patchRobotRequest, response: patchRobotResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'Answers `{ "robot": robot }`. The lookup runs before the ' +
      'body is parsed, so a robot outside the caller\'s org answers `404` whether or not the body was also malformed. Saving the name already ' +
      'held writes nothing and records no audit event.',
  },
  {
    method: 'GET', path: '/api/robots/:id/deletion-preview', section: 'robots',
    summary: 'Reports what deleting the robot would destroy, without destroying it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: robotDeletionSummary,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'The same shape the delete\'s own audit event carries, computed by the same function on purpose: the confirmation dialog and the eventual ' +
      'receipt agree by construction, and any difference between them is real drift — a robot that kept recording in between — rather than two ' +
      'estimates that quietly disagree.',
  },
  {
    method: 'DELETE', path: '/api/robots/:id', section: 'robots',
    summary: 'Deletes a robot and everything it produced.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 204,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: robotDeleteQuery, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'robot_in_use', 'robot_deletion_partial'], transport: 'http',
    notes:
      'Owner tier, and the gate runs **after** the org-scoped lookup: a developer-tier admin therefore sees the same `404` a stranger would ' +
      'for a robot outside their org, rather than a tier refusal that confirms the id exists. A full cascade — everything the robot produced ' +
      'goes, except the audit trail, which is a record of what happened and must survive the thing it happened to. An open live session is ' +
      '`409 robot_in_use` unless `?force=true` is passed, matched as the bare string so the caller has to actually say it. A cascade that ' +
      'fails partway is `500 robot_deletion_partial` with the progress, never a bare `internal_error` that would read as "nothing happened".',
  },
  {
    method: 'PUT', path: '/api/robots/:id/details', section: 'robots',
    summary: 'Replaces the developer-maintained details document shown alongside the robot.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: putRobotDetailsRequest, response: putRobotDetailsResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'Answers `{ "details": robotDetailsDoc }` — the stored document, which is the one that was sent. The update is fanned out to every ' +
      '`/realtime` subscriber of the `robot_details` built-in, so a client watching the robot sees the new document without polling.',
  },
  {
    method: 'GET', path: '/api/robots/:id/datapoints', section: 'robots',
    summary: 'Lists the datapoints of a robot, filtered to what the caller\'s role grants.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: null, request: null, response: datapointListResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'A developer bearer sees the robot\'s whole list unfiltered; an end user or a server key sees only the slugs their role grants, and a ' +
      'robot their app does not attach answers `404` exactly as one that does not exist.',
  },
  {
    method: 'GET', path: '/api/robots/:id/exposures', section: 'robots',
    summary: 'Lists every grantable slug of a robot with its kind — the material the roles matrix is built from.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: exposureListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Developer-only: this is what a role *could* be granted, which is a configuration fact rather than something an end user is entitled to enumerate.',
  },
  {
    method: 'GET', path: '/api/robots/:id/datapoints/:slug', section: 'robots',
    summary: 'Reads the latest value of one datapoint.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The datapoint\'s slug from the published configuration, as listed by `GET /api/robots/:id/datapoints`.' },
    ],
    query: null, request: null, response: datapointValue,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'unknown_datapoint', 'no_data'], transport: 'http',
    notes:
      'For a client caller the grant check runs **before** any existence lookup, with no extra query on either path to time: a denied slug and ' +
      'a nonexistent one must be one answer. That is why an ungranted slug is `403 forbidden` while a granted-but-unconfigured one is ' +
      '`404 unknown_datapoint` and a configured one with no sample yet is `404 no_data` — three facts a caller who is entitled to them needs ' +
      'told apart. The plane built-ins (`bridge_state`, `robot_details`) answer here too, without appearing in any document.',
  },

  /* ------------------------------------------------- config (draft/publish) */
  {
    method: 'GET', path: '/api/robots/:id/config/draft', section: 'config',
    summary: "Reads the robot's configuration draft, its author text and its current issues.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: configDraftResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Issues are recomputed on every read and every write, so an editor never has to guess whether it may publish. `doc` is `null` for a ' +
      'draft that is valid YAML but not a Fleetless configuration — a state the format admits and the publish route refuses.',
  },
  {
    method: 'PUT', path: '/api/robots/:id/config/draft', section: 'config',
    summary: 'Replaces the draft with the author\'s text and answers the parsed document with its issues.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: putConfigDraftRequest, response: configDraftResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'invalid_yaml', 'unstorable_yaml'], transport: 'http',
    notes:
      'The request carries the **text**, not a document: the author\'s comments and layout are what a restore has to give back, so the source ' +
      'is what is stored and the document is derived from it. Text that is not YAML at all is `422 invalid_yaml`, and text that parses but ' +
      'cannot be stored — an anchor cycle, say — is `422 unstorable_yaml`. A document with schema errors is still stored, because the ' +
      'draft is where a developer works; publishing is where the errors block.',
  },
  {
    method: 'POST', path: '/api/robots/:id/config/publish', section: 'config',
    summary: 'Publishes the draft as an immutable version and sends it to the robot.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: publishConfigResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'draft_not_a_document'], transport: 'http',
    notes:
      'A draft that is valid YAML but not a Fleetless configuration is `422 draft_not_a_document`, carrying every issue rather than the ' +
      'blocking subset — nothing about that text is publishable, so there is no subset to pick, and the warning naming the checks that could ' +
      'not run is part of reading the list correctly. A document with `severity: "error"` issues is `422 validation_error` with just those. ' +
      'The draft\'s own text travels into the version, so a restore later returns what the author wrote rather than a re-rendering of it.',
  },
  {
    method: 'GET', path: '/api/robots/:id/config/versions', section: 'config',
    summary: 'Lists the published configuration versions of a robot with their publish times.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: configVersionsResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'GET', path: '/api/robots/:id/config/versions/:v', section: 'config',
    summary: 'Reads one published version: its document and the author text it was published from.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' },
      { name: 'v', description: 'The version number, as listed by `GET /api/robots/:id/config/versions`.' },
    ],
    query: null, request: null, response: configVersionResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'A `:v` that is not a version number and one that names no version of this robot are the same `404`; the refusal quotes what the caller actually sent.',
  },
  {
    method: 'POST', path: '/api/robots/:id/config/versions/:v/restore', section: 'config',
    summary: 'Copies a published version back into the draft, text and document both.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' },
      { name: 'v', description: 'The version number, as listed by `GET /api/robots/:id/config/versions`.' },
    ],
    query: null, request: null, response: configDraftResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '**Both halves, not just the document** — a restore that put back the document alone would hand the author a configuration stripped of ' +
      'every comment they wrote, which is the loss this format exists to prevent. The answer is read off the row that was written, not off the ' +
      'version that was meant to be written. Nothing is published: the restored draft still has to be published to reach the robot.',
  },
  {
    method: 'POST', path: '/api/robots/:id/config/rename-slug', section: 'config',
    summary: 'Renames a slug in the draft and rewrites every role grant and history row that named it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: renameSlugRequest, response: renameSlugResponse,
    errors: [
      ...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'draft_not_a_document',
      'unknown_slug', 'reserved_slug', 'duplicate_slug', 'internal_error',
    ], transport: 'http',
    notes:
      'One transaction over three places a slug is written down: the draft document, every app-role grant carrying it, and the recorded ' +
      'history rows. The published configuration is immutable, so `requires_publish` says the rename is not live on the robot yet. A draft ' +
      'that is not a document is `409 draft_not_a_document` — the same word the usage preview uses for the same state.',
  },
  {
    method: 'GET', path: '/api/robots/:id/config/slug-usage/:slug', section: 'config',
    summary: 'Reports what a rename of one slug would touch, before a developer confirms it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' },
      { name: 'slug', description: 'The slug in the **draft** whose blast radius is being previewed.' },
    ],
    query: null, request: null, response: slugUsageResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'draft_not_a_document'], transport: 'http',
    notes:
      'A draft that is valid YAML but not a Fleetless document is refused rather than answered with `alert_count: 0`: the two states are ' +
      '*this slug has no alerts* and *there is no document to ask*, and a zero cannot tell them apart — it would show a smaller blast radius ' +
      'than the rename actually has. The other three counts are real whatever the draft holds, and a partial answer to a preview whose whole ' +
      'purpose is to be complete is not worth the ambiguity.',
  },

  /* -------------------------------------------------------------- alerts */
  {
    method: 'GET', path: '/api/robots/:id/alerts', section: 'alerts',
    summary: "Lists a robot's alerts as defined in its published configuration, joined with their runtime state.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: alertListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '**Read-only, and that is the design.** An alert used to be created, edited and deleted through this file; it is now a key in the ' +
      'published document, which is what makes every change to one versioned, comparable and revertible. The **published** version is read, ' +
      'never the draft: an alert typed but not published is evaluated by nothing, and reporting its state would claim a reading no machine has taken.',
  },
  {
    method: 'GET', path: '/api/org/alerts', section: 'alerts',
    summary: 'Lists every firing alert across the org, with the robot each belongs to.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: orgAlertsQuery, request: null, response: orgFiringAlertsResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      '`?state=firing` is required and is the only value accepted — refused rather than silently ignored, because a door with one answer must ' +
      'not advertise a dial. A firing row whose definition has left the document, or ' +
      'has been disabled, is skipped: it can never be evaluated again, so it can never resolve, and it would otherwise sit in the overview\'s ' +
      'open-issues tile forever.',
  },

  /* ------------------------------------------------- robots (introspection) */
  {
    method: 'GET', path: '/api/robots/:id/introspection', section: 'robots',
    summary: 'Reads the cached ROS graph of a robot and whether it is stale.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: introspectionResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'A robot that has never been introspected answers `200` with a **`null` body**, not a `404`: an enrichment that has not happened yet is ' +
      'not a missing resource. The response schema describes the non-null case. `stale` is true whenever the bridge is offline — the snapshot ' +
      'survives a disconnect, since a robot that has never connected is still configurable.',
  },
  {
    method: 'POST', path: '/api/robots/:id/introspection/refresh', section: 'robots',
    summary: 'Asks the robot for a fresh ROS graph, stores it and answers it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: introspectionResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'robot_offline', 'bridge_timeout'], transport: 'http',
    notes:
      '`stale` is `false` by construction here: the graph came from the robot just now. `409 robot_offline` means nothing is connected; ' +
      '`504 bridge_timeout` means something was and did not answer. Anything else is rethrown rather than turned into a tidy status.',
  },
  {
    method: 'GET', path: '/api/robots/:id/types', section: 'robots',
    summary: 'Lists every ROS message type definition stored for the robot.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: null, response: typesResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'A plain read with no bridge involved — the robot need not be online.',
  },
  {
    method: 'POST', path: '/api/robots/:id/types/fetch', section: 'robots',
    summary: 'Fetches named message type definitions from the robot and stores them.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: fetchTypesRequest, response: fetchTypesResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'robot_offline', 'bridge_timeout'], transport: 'http',
    notes:
      '`unresolved` names the types the robot could not produce; it is an answer, not a failure, because a graph often references a type whose ' +
      'package is not installed. The robot lookup runs before the body is parsed, so a robot outside the caller\'s org answers `404` whether or ' +
      'not the body was also malformed.',
  },

  /* ---------------------------------------------- commands (jobs, publishers) */
  {
    method: 'GET', path: '/api/robots/:id/jobs', section: 'commands',
    summary: 'Reads the current job on every slug of the robot the caller is granted.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: null, request: null, response: robotJobsResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '**At most one entry per slug, and not a history endpoint.** The first version answered every job the registry still held — six rows and ' +
      'four full result payloads after a few minutes of traffic on one robot, unbounded for a robot that has run all day. This reads the ' +
      'one-current-job-per-slug map instead. It exists because the per-slug route alone cannot cover it: a reconciled-but-unminted job, or one ' +
      'left on a slug a republish removed, has no slug-shaped door to be found through.',
  },
  {
    method: 'GET', path: '/api/robots/:id/jobs/history', section: 'commands',
    summary: 'Reads what has run on the robot, newest first, cursor-paged.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: jobRunQuery, request: null, response: jobRunListResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'capability_required', 'validation_error'], transport: 'http',
    notes:
      'Needs the `action_history` capability, and **this route is what makes that switch mean something** — it was unkeepable while nothing ' +
      'durable recorded what had run. Two residuals worth stating rather than implying away. `history` is a syntactically valid slug and ' +
      'Fastify matches a static segment first, so a robot with a service literally slugged `history` can no longer be **read** through ' +
      '`GET /api/robots/:id/jobs/:slug`; invoking, cancelling and the listing are unaffected. And a run row names its actor by email address, ' +
      'so an end user holding this capability learns which other people have been driving the machine. `robot_id` in the query is shared with ' +
      'the org-wide read; a *different* one here is refused rather than quietly answered about the robot in the path.',
  },
  {
    method: 'POST', path: '/api/robots/:id/jobs/:slug', section: 'commands',
    summary: 'Invokes an action or calls a service on the robot.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 202,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The action or service slug from the published configuration; the cloud already knows which kind it is.' },
    ],
    query: null, request: invokeRequest, response: invokeOrServiceResponse,
    errors: [
      ...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'parameter_invalid',
      'robot_offline', 'busy', 'bridge_timeout', 'internal_error',
    ], transport: 'http',
    notes:
      '**One route for both kinds**, because a path segment naming the kind would demand a fact a role grant does not carry. An action answers ' +
      '`202` with an `invokeResponse` the moment the job exists; a service answers `200` with a `serviceCallResponse` once the result is in — ' +
      'two shapes, carried by one union (`invokeOrServiceResponse`) and told apart by whether `kind` or a bare `result` arrives. Parameters are checked **before** anything about the world (offline, busy): ' +
      'the same request must get the same verdict whether or not the robot happens to be reachable, or a developer testing against an offline ' +
      'robot never learns their parameters were wrong. A service the robot reports as failed answers `502` carrying **the job\'s own error ' +
      'code**, which is an open set and not one of the codes above.',
  },
  {
    method: 'GET', path: '/api/robots/:id/jobs/:slug', section: 'commands',
    summary: 'Reads the most recent job on one slug.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The action or service slug from the published configuration.' },
    ],
    query: null, request: null, response: jobResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: '`job` is `null` when nothing has ever run on that slug — an answer, not a `404`.',
  },
  {
    method: 'POST', path: '/api/robots/:id/jobs/:slug/cancel', section: 'commands',
    summary: 'Cancels the job running on one slug.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The action slug from the published configuration; a service slug is refused.' },
    ],
    query: null, request: cancelRequest, requestOptional: true, response: jobResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'not_cancellable', 'robot_offline'], transport: 'http',
    notes:
      'The body is optional: a bodyless `POST` was every caller\'s shape before `job_id` existed, and absent or `job_id: null` both mean ' +
      '"cancel whatever is running". A named `job_id` that is **not** what is running cancels nothing and answers `404` — the caller named an ' +
      'id and thereby ruled the other one out. A service is `422 not_cancellable`: a service call has no goal to cancel. Nothing running is a ' +
      '`200` with `job: null`.',
  },
  {
    method: 'POST', path: '/api/robots/:id/publishers/:slug', section: 'commands',
    summary: 'Publishes one message onto a configured publisher.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 204,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The publisher slug from the published configuration.' },
    ],
    query: null, request: publishRequest, response: null,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'parameter_invalid', 'robot_offline', 'publisher_busy'], transport: 'http',
    notes:
      'Fire and forget — not a job, so there is nothing to poll and nothing to cancel. A publisher is held exclusively by one caller until it ' +
      'has been quiet long enough, and another caller meanwhile is `409 publisher_busy` with the timeout and a retry hint. Parameters are ' +
      'checked before offline and before exclusivity, the same order the invoke path uses and for the same reason. The **acquisition** is ' +
      'audited, not every message: auditing only takeovers left the single-operator case with no record of who was driving at all.',
  },

  /* ------------------------------------------------------------- cameras */
  {
    method: 'GET', path: '/api/robots/:id/cameras', section: 'cameras',
    summary: 'Lists the cameras of a robot, filtered to what the caller\'s role grants.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: null, request: null, response: cameraListResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'GET', path: '/api/robots/:id/cameras/:slug/snapshot', section: 'cameras',
    summary: 'Returns the most recent snapshot frame as image bytes.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The camera slug from the published configuration, as listed by `GET /api/robots/:id/cameras`.' },
    ],
    query: null, request: null, response: null, contentType: 'image/*',
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'no_snapshot_yet'], transport: 'http',
    notes:
      'Image bytes, not JSON, so it has no response schema. `contentType` is the family rather than a type: the frame is served in **the ' +
      'mime the producer sent it as**, so which image format arrives is the camera configuration\'s answer, not this route\'s. The age, ' +
      'capture time and dimensions ride in the `x-fleetless-*` headers ' +
      '`SNAPSHOT_HEADERS` names — which a browser can only read because CORS exposes them. **Never checks whether the bridge is online**: a ' +
      'snapshot read is a pure cache read, which is what makes "the last frame, with its real age" true for free across a disconnect. There is ' +
      'nothing here to refuse, and `age_ms` carries the whole honesty story. `cache-control: no-store`, because a picture of someone\'s ' +
      'premises does not belong on disk longer than the request that fetched it.',
  },
  {
    method: 'GET', path: '/api/robots/:id/cameras/:slug/snapshot/meta', section: 'cameras',
    summary: 'Reports the age and dimensions of the latest snapshot without downloading it.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The camera slug from the published configuration, as listed by `GET /api/robots/:id/cameras`.' },
    ],
    query: null, request: null, response: snapshotMetaResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Exists so a client polling at the camera\'s own interval does not re-fetch a whole frame merely to learn whether a newer one arrived. ' +
      'Nothing captured yet is **nulls, not a `404`**: "nothing yet" is an answer.',
  },
  {
    method: 'POST', path: '/api/robots/:id/cameras/:slug/live', section: 'cameras',
    summary: 'Takes a hold on a live camera stream and returns a room token.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 201,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The camera slug from the published configuration, as listed by `GET /api/robots/:id/cameras`.' },
    ],
    query: null, request: null, response: liveSessionResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'robot_offline', 'camera_offline', 'live_unavailable'], transport: 'http',
    notes:
      'Refcounted: the first viewer starts the robot publishing and the last release stops it. No token is ever minted for an ungranted or ' +
      'offline camera — both refusals return before the hold is taken. `409 camera_offline` means the **robot itself** reported the failure; ' +
      '`502 live_unavailable` means this cloud could not start the stream. The difference matters, and it is why a failure the robot named is ' +
      'never dressed up as one this side invented.',
  },
  {
    method: 'DELETE', path: '/api/robots/:id/cameras/:slug/live', section: 'cameras',
    summary: 'Releases a live hold, one session or all of this caller\'s.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 204,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The camera slug from the published configuration, as listed by `GET /api/robots/:id/cameras`.' },
    ],
    query: releaseLiveQuery, request: null, response: null,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`?session_id=` releases that one hold; omitting it releases every hold this caller\'s identity has on this camera, which a client that ' +
      'lost its id — or a tab that is already closing — still needs. A malformed `session_id` is `400 invalid_uuid`, never a silent fallback ' +
      'to the blunt form, which would strand this identity\'s other tabs over a typo. A named-and-unknown id is `404`; a stale one, real and ' +
      'already ended, is idempotently `204`.',
  },

  /* -------------------------------------------------------- robots (history) */
  {
    method: 'GET', path: '/api/robots/:id/datapoints/:slug/history', section: 'robots',
    summary: 'Reads recorded samples of one datapoint, or aggregated buckets over a window.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'slug', description: 'The datapoint\'s slug from the published configuration.' },
    ],
    query: historyQuery, request: null, response: historyResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'invalid_range', 'not_recorded', 'not_aggregatable'], transport: 'http',
    notes:
      'Two answers, carried by one union (`historyResponse`): without `window` it is a `historySamplesResponse`, with one it is a ' +
      '`historyBucketsResponse`, told apart by `kind`. `window` and `agg` must be given together or not at all — one without the other is refused rather than ' +
      'defaulted, since a silently chosen aggregation is a chart that lies quietly. A range and window that would produce more buckets than ' +
      '`limit` is `400 invalid_range` computed **before** the query runs: the bucket response carries no `truncated` field, so a refusal is ' +
      'the only honest answer. `409 not_recorded` says retention is off for this slug **right now** and deliberately does not claim the table ' +
      'is empty — rows written before the switch was flipped still exist, unreadable through any route and still counting against the quota.',
  },

  /* ------------------------------------------------------ assets (URDF, meshes) */
  {
    method: 'GET', path: '/api/robots/:id/assets', section: 'assets',
    summary: "Lists the robot's synced assets and how complete its URDF is.",
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: null, request: null, response: assetListResponse,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'capability_required'], transport: 'http',
    notes:
      'Needs the `assets` capability, refused as `403 capability_required` rather than a bare `forbidden`: the code says a capability is ' +
      'missing and the message says which, so a developer who switched the wrong toggle on is told what to switch. The capability is checked ' +
      'before existence, so a denied robot and an absent one read alike to a caller with no right to tell them apart. `urdf` reports whether a ' +
      'URDF is present and which of its mesh references have no stored asset.',
  },
  {
    method: 'GET', path: '/api/robots/:id/assets/:assetId', section: 'assets',
    summary: 'Returns one stored asset as bytes.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' },
      { name: 'assetId', description: 'The asset\'s uuid, as listed by `GET /api/robots/:id/assets`.' },
    ],
    query: null, request: null, response: null, contentType: 'application/octet-stream',
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'capability_required', 'internal_error'], transport: 'http',
    notes:
      'Bytes, so it has no response schema. **`contentType` here is the floor, not the answer**: the header carries the asset\'s own stored ' +
      'media type when that type is on the cloud\'s allow-list, and `application/octet-stream` only when it is not — an allow-list rather than ' +
      'a pass-through, because a stored type is developer-supplied and a browser will act on it. `X-Content-Type-Options: nosniff` rides along ' +
      'for the same reason. A row whose blob has vanished from object storage is a logged ' +
      '`500 internal_error`, not a `404`: the asset exists and this cloud could not read it, which is a different fact from "there is no such asset".',
  },
  {
    method: 'GET', path: '/api/robots/:id/urdf', section: 'assets',
    summary: 'Returns the robot\'s URDF with every mesh reference rewritten to a Fleetless URL.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: null, request: null, response: null, contentType: 'application/xml',
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'capability_required', 'internal_error'], transport: 'http',
    notes:
      'XML, so no response schema. **Every `filename` is rewritten, not only a resolvable `package://` one** — an absolute URL that arrived in ' +
      'a URDF from ROS graph input must never be served through untouched, because a mesh loader attaches the caller\'s bearer token to ' +
      'whatever absolute URL it is handed. Anything with no stored asset points at `GET /api/robots/:id/assets/missing` instead. A robot with ' +
      'no synced URDF is `404`.',
  },
  {
    method: 'GET', path: '/api/robots/:id/assets/missing', section: 'assets',
    summary: 'The placeholder a rewritten URDF points at for a mesh Fleetless does not hold.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 404,
    params: [{ name: 'id', description: 'The robot\'s uuid; an end user reaches it through an app that attaches it.' }],
    query: missingAssetQuery, request: null, response: null,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found', 'capability_required', 'asset_missing'], transport: 'http',
    notes:
      '**This route has no success answer** — `404 asset_missing` naming the unresolved reference is what it exists to give, and `status` says ' +
      'so rather than declaring a `200` no caller can ever receive. `?name=` is echoed into the message and changes the sentence, never the ' +
      'outcome; it discloses nothing, since it is what the caller sent. It carries the same `assets` capability gate as the real bytes would: a ' +
      'missing-asset placeholder is not an exemption from the authorization the thing it stands in for needs.',
  },
  {
    method: 'GET', path: '/api/asset-links/missing', section: 'assets',
    summary: 'The bearer-free placeholder a *linked* URDF points at for an unresolvable mesh.',
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 404,
    params: [], query: null, request: null, response: null,
    errors: ['asset_missing'], transport: 'http',
    notes:
      '**No success answer either**, for the reason its authenticated twin has none. Unauthenticated by design and unauthenticated in fact: it ' +
      'reads nothing and reveals nothing the caller did not put in the query string itself, so there is no credential for the handler to ' +
      'verify and none is required. It sits under the signed-link prefix because that is where a linked URDF\'s references have to point.',
  },
  {
    method: 'GET', path: '/api/asset-links/:token', section: 'assets',
    summary: 'Serves one asset, or a rendered URDF, to whoever holds a signed link.',
    audience: 'client', auth: 'in_handler', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'token', description: 'The signed, time-limited link an MCP tool minted; it is the whole credential.' }],
    query: null, request: null, response: null, contentType: 'application/octet-stream',
    errors: ['not_found', 'internal_error'], transport: 'http',
    notes:
      '**The token is the authorization** — there is no route guard on purpose, and verifying it is the whole gate. An MCP session token is ' +
      'refused on REST by design, so the asset tools mint a fifteen-minute signed link instead and this spends it. The capability was checked ' +
      'at mint against the minting caller\'s own access; the residual — whoever holds the URL reads that asset until it expires — is named ' +
      'rather than closed by a second gate, which would be a different policy for one decision. Every refusal collapses into one `404` with ' +
      'one message, including a malformed id inside a validly signed token, because a link holder has no business learning which of them it ' +
      'was. A URDF served this way has **its own references minted as links**, back-dated so they expire with the parent — otherwise spending ' +
      'a link in its last second would hand out another fifteen minutes, and each of those another. **`contentType` is the floor, not the ' +
      'answer**: an asset is served in its own stored media type where that type is allow-listed and `application/octet-stream` otherwise, and ' +
      'a linked URDF is `application/xml`. `cache-control: no-store`, since the URL ' +
      'itself is the credential.',
  },
  {
    method: 'POST', path: '/api/robots/:id/assets/sync', section: 'assets',
    summary: 'Asks the robot to upload its URDF and meshes, and returns the sync id.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: true, status: 202,
    params: [{ name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' }],
    query: null, request: assetSyncRequest, response: assetSyncResponse,
    errors: [...CLIENT_GUARD, 'tier_required', 'invalid_uuid', 'validation_error', 'not_found', 'robot_offline', 'busy'], transport: 'http',
    notes:
      'Owner tier, unconditionally. The guard admits an end user or a server key, but only a developer session gets past the handler — and the ' +
      'body is parsed **before** that `401`, because this route has always answered a malformed body first and the order has to survive. The ' +
      'request is strict: a caller naming a source that does not exist learns so, instead of silently getting a bridge sync they did not ask ' +
      'for. A robot that has reported nothing available to sync is `404`. A second sync is `409 busy` naming the `sync_id` that is actually ' +
      'running, so the caller who pressed the button twice can pick it straight up.',
  },
  {
    method: 'GET', path: '/api/robots/:id/assets/sync/:syncId', section: 'assets',
    summary: 'Reports how far an asset sync has got.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The robot\'s uuid, as returned by `POST /api/robots` or listed by `GET /api/robots`.' },
      { name: 'syncId', description: 'The sync id from `POST /api/robots/:id/assets/sync`, or from its `409 busy` refusal.' },
    ],
    query: null, request: null, response: assetSyncStatus,
    errors: [...CLIENT_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Developer sessions only, like starting a sync: the guard admits three caller kinds and the handler answers `401 unauthorized` to the ' +
      'other two. A sync belonging to another robot reads exactly like one that never existed, which is why the robot is resolved first.',
  },

  /* ------------------------------------------------ org (quotas and fleet reads) */
  {
    method: 'GET', path: '/api/org/quotas', section: 'org',
    summary: "Reports every quota's limit next to what the org is currently using.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: orgQuotaUsage,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes:
      'Every dial is read at the moment of the call and nothing is cached, so an exhausted quota is self-evident from this one answer rather ' +
      'than something a developer needs audit access to discover. `max_end_users` counts app users only — an org admin is not an app user, and ' +
      'counting the whole pool would report the Owner an org has by construction as consumption.',
  },
  {
    method: 'GET', path: '/api/org/health', section: 'org',
    summary: 'Reports the health of every camera and streaming resource across the org.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: orgHealthQuery, request: null, response: resourceHealthListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`?robot_id=` narrows it to one robot; omitted, the answer is the whole org. Org-wide rather than per-robot because ' +
      'the console shows health on the robot list too, and a per-robot path would make that N requests to render one screen. This is the ' +
      'snapshot half of the channel; the live half is the `/realtime` socket.',
  },
  {
    method: 'GET', path: '/api/org/jobs', section: 'org',
    summary: 'Reads durable job-run history across the org, newest first, cursor-paged.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: jobRunQuery, request: null, response: jobRunListResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'Developer-only, and that is a property of the scope: a run row names the actor who invoked it, so a client-facing version would tell ' +
      'one end user which others have been driving the machine. Page until the cursor is null, not until a page looks short. A malformed ' +
      '`robot_id` is refused by the query schema as a `validation_error`; an unknown but well-formed one is an empty list, never a `404` — it ' +
      'is a filter.',
  },
  {
    method: 'GET', path: '/api/org/jobs/summary', section: 'org',
    summary: 'Counts the running, started and failed job runs since a moment the caller names.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: jobRunSummaryQuery, request: null, response: jobRunSummary,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      '`since_ms` is required and has no default: which day "today" is, only the browser knows, and a cloud that chose its own boundary would ' +
      'show a developer in another timezone a number they cannot reproduce. The window is echoed back so a rendered tile can say what it is ' +
      'describing.',
  },
  {
    method: 'GET', path: '/api/org/latency', section: 'org',
    summary: 'Reads one-minute bridge latency buckets per robot over a window the caller names.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: orgLatencyQuery, request: null, response: orgLatencyResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'Both bounds are required: the table holds a bucket per robot per minute, so "everything" is thousands of rows per robot and a default ' +
      'window would be a query size chosen by whoever forgot to pass one. `from_ms < to_ms` is a cross-field rule the published JSON Schema ' +
      'cannot express, so this route is the only place it is enforced. `truncated` costs whole robots off the end of the id order, not the ' +
      'tail of every series — narrow the window or name a `robot_id`.',
  },
  {
    method: 'GET', path: '/api/org/usage', section: 'org',
    summary: 'Reads what the org consumed per day, per app and per metric.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: orgUsageQuery, request: null, response: orgUsageResponse,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'A window longer than `USAGE_WINDOW_MAX_DAYS` is refused naming the field, not silently capped: a caller who asked for more than the ' +
      'platform will answer is owed a refusal, not a shorter answer they will mistake for the whole picture. `from_day <= to_day` is a ' +
      'cross-field rule no JSON Schema can express and is enforced here. The window is echoed back.',
  },
  /* ------------------------------------------------- assets (robot upload) */
  {
    method: 'POST', path: '/api/bridge/assets', section: 'assets',
    summary: 'Takes one asset file from a robot during a sync.',
    audience: 'internal', auth: 'robot_upload', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: null, response: asset,
    errors: ['unauthorized', 'rate_limited', 'asset_too_large', 'validation_error', 'not_found', 'quota_exceeded', 'bad_request'], transport: 'http',
    notes:
      'The body is the **raw file bytes**, not JSON, so it has no request schema; everything about the file — its kind, its name, its sync id ' +
      'and its announced size — rides in the `x-fleetless-asset-*` headers `ASSET_UPLOAD_HEADERS` names. The credential is a short-lived ' +
      'upload token minted by `POST /api/robots/:id/assets/sync`, verified in a `preParsing` hook so a refusal precedes the work rather than ' +
      'following it: a `preHandler` would already have buffered the whole file. The announced size is refused there too, before a single byte ' +
      'is read — it is an announcement and not a proof, so it only ever rejects early and never accepts early, and a body that lies small is ' +
      'still caught by the real length check. Past both, Fastify\'s own body limit answers a bare `413 bad_request` with neither ceiling nor ' +
      'size in it. Rate limited per robot inside that same hook, which is why `rateLimited` is `false`: there is no rate-limiting preHandler ' +
      'registered on this route.',
  },

  /* ------------------------------------ realtime and bridge transports */
  {
    method: 'GET', path: '/bridge', section: 'transports',
    summary: 'The robot bridge\'s WebSocket: the versioned bridge protocol, not a client-facing surface.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 101,
    params: [], query: null, request: null, response: null, errors: ['protocol_mismatch', 'invalid_token'], transport: 'websocket',
  },
  {
    method: 'GET', path: '/realtime', section: 'transports',
    summary: 'The client WebSocket: subscriptions on datapoints, jobs, bridge state and presence, plus full command parity with REST.',
    audience: 'client', auth: 'none', rateLimited: false, ownerTier: false, status: 101,
    params: [], query: null, request: null, response: null, errors: ['invalid_token', 'rate_limited'], transport: 'websocket',
    notes: 'Authentication happens in the first frame, not on the upgrade. The frame types are the `realtime` schemas.',
  },
]
