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
 * `OAUTH_PATHS` (`oauth.ts`) was the precedent: ten paths declared once so
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
import { brandingConfig, createAppRequest, createServerKeyResponse, app as appSchema, rolePermissions, updateAppRequest } from './apps.js'
import { auditListResponse, auditQuery } from './audit.js'
import { clientIdentity, clientLoginRequest, clientLogoutRequest, clientLogoutResponse, clientRefreshRequest } from './client-auth.js'
import type { ErrorCode } from './errors.js'
import {
  acceptUserInviteRequest,
  appAssignment,
  appAssignmentListResponse,
  authMeResponse,
  createGroupRequest,
  createUserInviteRequest,
  groupListResponse,
  groupOidcProvider,
  groupUsageResponse,
  moveUserGroupRequest,
  orgFederationPolicy,
  orgFederationPolicyRequest,
  orgGroup,
  orgUser,
  orgUserListResponse,
  passwordChangeRequest,
  passwordResetConfirm,
  passwordResetRequest,
  patchAuthMeRequest,
  patchGroupRequest,
  patchOrgRequest,
  patchUserRequest,
  putAppGroupRequest,
  putAssignmentRequest,
  putGroupOidcProviderRequest,
  refreshRequest,
  sessionTokens,
  signUpRequest,
  signUpResponse,
  tierChangeRequest,
  userInvite,
  userInviteListResponse,
  waitlistRequest,
} from './identity.js'
import { jobRunListResponse, jobRunQuery, jobRunSummary, jobRunSummaryQuery } from './jobs.js'
import { mcpRolePreviewResponse } from './mcp.js'
import { consentGrantListResponse, consentRevokeResponse, oauthRedirectResponse } from './oauth.js'
import {
  orgLatencyQuery,
  orgLatencyResponse,
  orgQuotaUsage,
  orgUsageQuery,
  orgUsageResponse,
  resourceHealthListResponse,
} from './rest.js'

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type RouteAudience = 'developer' | 'client' | 'internal'
export type RouteAuth = 'developer' | 'developer_or_client' | 'none' | 'robot_upload' | 'in_handler'
export type RouteTransport = 'http' | 'websocket'
export type RouteSection =
  | 'health' | 'developer-auth' | 'client-auth' | 'org' | 'users' | 'apps'
  | 'robots' | 'config' | 'alerts' | 'commands' | 'cameras' | 'assets'
  | 'oauth' | 'mcp' | 'transports'

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
  readonly response: ZodType | null
  readonly errors: readonly ErrorCode[]
  readonly transport: RouteTransport
  /** Markdown rendered under the route; the place for what the schema cannot say. */
  readonly notes?: string
}

export const ROUTE_SECTIONS: readonly { readonly id: RouteSection; readonly title: string }[] = [
  { id: 'health', title: 'Health' },
  { id: 'developer-auth', title: 'Developer auth' },
  { id: 'client-auth', title: 'End-user (client) auth' },
  { id: 'org', title: 'Org' },
  { id: 'users', title: 'Users, groups and assignments' },
  { id: 'apps', title: 'Apps' },
  { id: 'robots', title: 'Robots' },
  { id: 'config', title: 'Configuration (draft/publish)' },
  { id: 'alerts', title: 'Alerts' },
  { id: 'commands', title: 'Commands (jobs, publishers)' },
  { id: 'cameras', title: 'Cameras' },
  { id: 'assets', title: 'Assets (URDF, meshes)' },
  { id: 'oauth', title: 'OAuth 2.1' },
  { id: 'mcp', title: 'MCP' },
  { id: 'transports', title: 'Realtime and bridge transports' },
]

/** The routes that verify a credential inside the handler; `auth: 'in_handler'` is refused elsewhere. */
export const IN_HANDLER_ROUTES: readonly string[] = [
  'POST /mcp',
  'GET /api/asset-links/missing',
  'GET /api/asset-links/:token',
]

/**
 * **The four refusals every `auth: 'developer'` route inherits from its guard**,
 * spelled once rather than retyped eighty times.
 *
 * They are the arms of `cloud/src/auth.ts`'s `requireDeveloper`: no bearer or an
 * unverifiable one is `401 unauthorized`, an expired one `401 token_expired`, a
 * vanished account or a bumped `token_version` `401 token_revoked`, and an
 * account that is no longer in the org's Org Admins group `403 forbidden`.
 *
 * **Not `invalid_token`.** That code exists in `ERROR_CODES` and this guard has
 * never sent it; the four above are what `sendTokenRefusal` actually maps to.
 * Said plainly because the planning note for this file assumed otherwise, and a
 * documented refusal a caller cannot receive is the third failure mode in
 * CLAUDE.md's list.
 */
const DEVELOPER_GUARD = ['unauthorized', 'token_expired', 'token_revoked', 'forbidden'] as const satisfies readonly ErrorCode[]

/**
 * The same, for `auth: 'developer_or_client'` — `createRequireDeveloperOrClient`,
 * which resolves a developer bearer, an end-user bearer **or** a server key
 * through one `resolveAnyToken`. It carries one arm the developer-only guard
 * cannot reach: `account_blocked`, for an end user whose account was disabled.
 */
const CLIENT_GUARD = ['unauthorized', 'token_expired', 'token_revoked', 'account_blocked', 'forbidden'] as const satisfies readonly ErrorCode[]

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
    summary: 'Creates an org, its Org Admins group and the founding Owner, and answers a developer session.',
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
      'The whole family is re-checked here, not just the token: an account that has left the Org Admins group cannot mint a fresh console ' +
      'token, and answers `token_revoked`. Refusing that only on the other routes would leave a session that is dead everywhere but here.',
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
    params: [], query: auditQuery, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'Answers `text/csv` with a `Content-Disposition` attachment, not JSON — so it has no response schema. `AUDIT_CSV_COLUMNS` names the ' +
      'columns and their order. Takes the same filters as `GET /api/audit` but refuses `before_seq` and `limit` with `400 validation_error`: ' +
      'an export is not a page, it is everything the filter matches up to a fixed row ceiling.',
  },

  /* --------------------------------------------------------------- apps */
  {
    method: 'POST', path: '/api/apps', section: 'apps',
    summary: 'Creates an app in a group, optionally attaching robots to it at the same time.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createAppRequest, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'validation_error', 'target_state_conflict', 'identifier_taken', 'quota_exceeded'], transport: 'http',
    notes:
      'Every robot id is checked before anything is created, so a bad one never leaves a robotless app to clean up. The Org Admins group is ' +
      'refused with `409 target_state_conflict`: admins hold no assignments, so an app there would be one nobody can be assigned to. The ' +
      'identifier `mcp` is reserved by the central MCP server and refused as a `validation_error`.',
  },
  {
    method: 'GET', path: '/api/apps', section: 'apps',
    summary: "Lists every app in the caller's org.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes: 'Answers `{ "apps": [app, …] }`. The envelope has no schema of its own in contracts; each element is an `app`.',
  },
  {
    method: 'GET', path: '/api/apps/:id', section: 'apps',
    summary: 'Reads one app of the org, with its group, robots and default role.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'An app belonging to another org reads exactly like one that does not exist — `404`, never a `403`.',
  },
  {
    method: 'PATCH', path: '/api/apps/:id', section: 'apps',
    summary: "Changes an app's name, its attached robots, its default role or whether it accepts dynamic clients.",
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
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'The body is `{ "name": string }` — non-empty, trimmed, at most 120 characters — and is deliberately not a contract shape: contracts ' +
      'define the `role` this answers with, not this one trivial request. The answer is a `role`.',
  },
  {
    method: 'GET', path: '/api/apps/:id/roles', section: 'apps',
    summary: "Lists the app's roles, builtin and custom.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Answers `{ "roles": [role, …] }`. The envelope has no schema of its own in contracts; each element is a `role`.',
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
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'Answers `{ "server_keys": [serverKey, …] }`. The envelope has no schema of its own in contracts; each element is a `serverKey`, which ' +
      'names the five fields it carries rather than spreading the stored row — that is what keeps this listing from becoming a second place a ' +
      'credential leaves the cloud.',
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

  /* ------------------------------------- users, groups and assignments */
  {
    method: 'GET', path: '/api/org/groups', section: 'users',
    summary: 'Lists every group in the org with its member and app counts.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: groupListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
  },
  {
    method: 'GET', path: '/api/org/groups/:id', section: 'users',
    summary: 'Reads one group with its member and app counts.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: null, response: orgGroup,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'A group of another org reads exactly like one that does not exist.',
  },
  {
    method: 'POST', path: '/api/org/groups', section: 'users',
    summary: 'Creates a group, optionally with MCP access enabled for its members.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createGroupRequest, response: orgGroup,
    errors: [...DEVELOPER_GUARD, 'validation_error'], transport: 'http',
    notes:
      'The `is_org_admins` flag is not an argument here and cannot be: it has exactly one writer, org creation, so no door can mint a second ' +
      'admin group even by accident.',
  },
  {
    method: 'PATCH', path: '/api/org/groups/:id', section: 'users',
    summary: "Renames a group or flips its MCP gate.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: patchGroupRequest, response: orgGroup,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'The Org Admins group is renamable through exactly this door. `is_org_admins` cannot arrive at all — the shape is strict and does not ' +
      'carry it, so offering it is a refusal rather than a silent drop.',
  },
  {
    method: 'DELETE', path: '/api/org/groups/:id', section: 'users',
    summary: 'Deletes an empty group.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'group_not_deletable', 'group_in_use'], transport: 'http',
    notes:
      'The Org Admins group answers `409 group_not_deletable`; a group still holding users or apps answers `409 group_in_use` with both ' +
      'counts. Both refusals are re-counted inside the deleting transaction rather than pre-checked, so there is one policy and not a weaker ' +
      'second one. `GET /api/org/groups/:id/usage` is the read that explains them.',
  },
  {
    method: 'GET', path: '/api/org/groups/:id/usage', section: 'users',
    summary: 'Reports what a group holds, before an admin decides to delete it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: null, response: groupUsageResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`users_affected` is the group\'s whole membership, not only the members holding assignments: deleting a group affects everyone in it, ' +
      'and a count that excluded the unassigned would understate exactly the people an admin has to re-home first. Counts for showing, never ' +
      'for deciding — the delete re-counts in its own transaction.',
  },
  {
    method: 'GET', path: '/api/org/users', section: 'users',
    summary: "Lists the org's user pool, optionally narrowed to one group.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: orgUserListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`?group_id=` narrows it; there is no query schema, the parameter is read directly. A group of another org answers `404` rather than an ' +
      'empty list, which would be indistinguishable from "that group exists here and is empty" — a statement about somebody else\'s org. A ' +
      'malformed value is `400 invalid_uuid`, so a typo can be told from a deletion.',
  },
  {
    method: 'GET', path: '/api/org/users/:id', section: 'users',
    summary: 'Reads one user of the org.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: orgUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'POST', path: '/api/org/users/invitations', section: 'users',
    summary: 'Invites an address into a group and returns the accept link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 201,
    params: [], query: null, request: createUserInviteRequest, response: userInvite,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'validation_error', 'target_state_conflict', 'email_taken'], transport: 'http',
    notes:
      'One invitation flow for every group; what the invitee becomes is `group_id`. **Inviting an Owner is Owner-only** — an invitation ' +
      'carrying `tier: "owner"` is a promotion with an extra step, since the response hands back the `accept_url`. `ownerTier` is `false` ' +
      'here because the gate is on that value, not on the route: any org admin may invite a developer. A tier is required for the Org Admins ' +
      'group and refused for every other.',
  },
  {
    method: 'GET', path: '/api/org/users/invitations', section: 'users',
    summary: 'Lists the pending invitations of the org, without their tokens.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: userInviteListResponse,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes:
      'No `accept_url` is in this listing, and that omission is the point: it exists so an admin can spot a backdoor invitation planted for an ' +
      'address they merely control, not so anyone can re-read a link.',
  },
  {
    method: 'DELETE', path: '/api/org/users/invitations/:id', section: 'users',
    summary: 'Revokes a pending invitation so its link stops resolving.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The invitation\'s uuid, as listed by `GET /api/org/users/invitations`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'An invitation that was already accepted is not pending and answers `404`, the same answer one that never existed gets.',
  },
  {
    method: 'POST', path: '/api/org/users/invitations/:id/reissue', section: 'users',
    summary: 'Mints a fresh token onto the same invitation and returns the new accept link.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The invitation\'s uuid, as listed by `GET /api/org/users/invitations`.' }],
    query: null, request: null, response: userInvite,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'rate_limited'], transport: 'http',
    notes:
      'The old link stops resolving the instant this returns — the row is looked up by token hash and the previous hash is gone. Two live ' +
      'links to one invitation would reopen the door the listing\'s missing `accept_url` closes. Limited server-side to once a minute per ' +
      'invitation, answering `429 rate_limited` with `retry_after_ms`; a disabled button is a hint, this is the limit. Re-issuing an ' +
      'owner-tier invitation needs Owner tier, exactly as creating one does.',
  },
  {
    method: 'POST', path: '/api/org/users/invitations/accept', section: 'users',
    summary: 'Spends an invitation token and creates the login it was addressed to.',
    audience: 'developer', auth: 'none', rateLimited: true, ownerTier: false, status: 204,
    params: [], query: null, request: acceptUserInviteRequest, response: null,
    errors: ['rate_limited', 'validation_error', 'token_spent', 'email_taken'], transport: 'http',
    notes:
      '**`204`, not a session.** Most invitees are not org admins, so a console session minted here would be refused on the very next request; ' +
      'and a body whose shape depended on the invitee\'s group would give one route two answers. Unknown, expired and already-accepted tokens ' +
      'collapse into `410 token_spent`. A browser form post gets the rendered "you\'re in" page instead.',
  },
  {
    method: 'GET', path: '/accept-invite/:token', section: 'users',
    summary: 'Serves the invitation card a mailed accept link opens.',
    audience: 'internal', auth: 'none', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'token', description: 'The opaque invitation token from the mailed link; it is never sent as a query parameter.' }],
    query: null, request: null, response: null, errors: [], transport: 'http',
    notes:
      'HTML, served by the cloud from the auth portal origin; the form on it posts to `POST /api/org/users/invitations/accept`. An unknown, ' +
      'spent or expired token renders the "link no longer valid" page at `410`, which offers the password-reset page — the only self-service ' +
      'door the portal has, since an invitation cannot be re-issued by the person holding it.',
  },
  {
    method: 'PATCH', path: '/api/org/users/:id', section: 'users',
    summary: "Changes a user's display name or their MCP access override.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: patchUserRequest, response: orgUser,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'Nothing here has a consequence a PATCH body cannot carry: the group and the tier are their own routes, because both cascade. The audit ' +
      'event records which fields were addressed, never their values.',
  },
  {
    method: 'GET', path: '/api/org/users/:id/usage', section: 'users',
    summary: 'Previews what moving a user into another group would delete.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: groupUsageResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      '`?group_id=` names the group the user would move into and is required; there is no query schema, the parameter is read directly. Absent ' +
      'is `400 validation_error` with rule `required`, malformed is `400 invalid_uuid`, and well-formed but not a group of this org is ' +
      '`validation_error` with rule `unknown_group` — three different facts a caller needs told apart. Reads only, and never a lock.',
  },
  {
    method: 'POST', path: '/api/org/users/:id/move-group', section: 'users',
    summary: 'Moves a user into another group, deleting every assignment the move invalidates.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: moveUserGroupRequest, response: orgUser,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'validation_error', 'last_owner'], transport: 'http',
    notes:
      '`acknowledge_assignment_loss: true` is a literal in the shape, so there is no request of this form without it and nothing has to ' +
      'remember to check. **Moving an Owner needs Owner tier** — it takes the Owner capability away, which is a demotion by another door — but ' +
      '`ownerTier` is `false` because that gate fires only when the target is an Owner. Moving the last Owner out is `409 last_owner`. A move ' +
      'out of Org Admins closes the user\'s open `/realtime` socket.',
  },
  {
    method: 'DELETE', path: '/api/org/users/:id', section: 'users',
    summary: 'Removes a user and ends every session they hold.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'last_owner'], transport: 'http',
    notes:
      'Sessions are revoked before the row is deleted: a still-existing user with a dead session is recoverable by retrying, a deleted user ' +
      'whose old token still works is not. Both kinds go, since one row can hold console and app sessions at once. Any invitation still ' +
      'outstanding for that address is expired too — a link mailed before the removal is a standing re-admission ticket. Removing an Owner ' +
      'needs Owner tier, and removing the last one is `409 last_owner`.',
  },
  {
    method: 'PUT', path: '/api/org/users/:id/tier', section: 'users',
    summary: "Promotes or demotes an org admin between Owner and developer tier.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`; must be a member of the Org Admins group.' }],
    query: null, request: tierChangeRequest, response: orgUser,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'invalid_uuid', 'not_found', 'validation_error', 'target_state_conflict', 'last_owner'],
    transport: 'http',
    notes:
      'Owner tier, unconditionally — this is the route the whole owner-exclusive list is about. A user outside the Org Admins group carries no ' +
      'tier at all and answers `409 target_state_conflict`. Demoting the last Owner is `409 last_owner`, decided by a row lock inside the ' +
      'writing transaction rather than by a read beforehand. Setting the tier already held changes nothing and writes no audit event. No ' +
      'session is revoked: a tier is re-read from the row on every request, so no issued token carries a stale copy of it.',
  },
  {
    method: 'GET', path: '/api/org/users/:id/assignments', section: 'users',
    summary: 'Lists the apps a user is assigned to and the role they hold in each.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' }],
    query: null, request: null, response: appAssignmentListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
  },
  {
    method: 'PUT', path: '/api/org/users/:id/assignments/:appId', section: 'users',
    summary: 'Assigns a user to an app in a role, or changes the role they already hold.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [
      { name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' },
      { name: 'appId', description: 'The app\'s uuid; it must belong to the same group as the user.' },
    ],
    query: null, request: putAssignmentRequest, response: appAssignment,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'target_state_conflict', 'validation_error'], transport: 'http',
    notes:
      'An app outside the user\'s group is `409 target_state_conflict` with rule `group_mismatch` — the group is what pairs a user with the ' +
      'apps they can be assigned to. A role belonging to another app is a `validation_error`. Re-roling closes the user\'s live subscriptions ' +
      'on that app.',
  },
  {
    method: 'DELETE', path: '/api/org/users/:id/assignments/:appId', section: 'users',
    summary: 'Removes a user\'s assignment to one app and ends their sessions for it.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [
      { name: 'id', description: 'The user\'s uuid, as listed by `GET /api/org/users`.' },
      { name: 'appId', description: 'The app\'s uuid; only sessions and subscriptions for this app are ended.' },
    ],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Only that app\'s sessions end; the user\'s access to every other app they are assigned to is untouched.',
  },
  {
    method: 'GET', path: '/api/apps/:id/group-usage', section: 'users',
    summary: 'Previews what re-linking an app to another group would delete.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: groupUsageResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      '`?group_id=` names the target group and is required, with the same three distinct refusals `GET /api/org/users/:id/usage` gives. The app ' +
      'is scoped first, so none of them can confirm that an app the caller does not own exists.',
  },
  {
    method: 'PUT', path: '/api/apps/:id/group', section: 'users',
    summary: 'Re-links an app to another group, deleting every assignment the move invalidates.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: putAppGroupRequest, response: appSchema,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error', 'target_state_conflict'], transport: 'http',
    notes:
      'The destructive half of the pair: every assignment naming this app whose user is not in the new group dies with the change, which is why ' +
      'the shape demands a literal acknowledgement. The Org Admins group is refused for the reason app creation refuses it. One edit can cut a ' +
      'whole team off at once, so every live subscription on the app is closed.',
  },

  /* ------------------------------------------------ org (federation, OIDC) */
  {
    method: 'GET', path: '/api/org/federation', section: 'org',
    summary: 'Reads whether a federated login may join an existing account by verified email.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: orgFederationPolicy,
    errors: [...DEVELOPER_GUARD], transport: 'http',
    notes: 'Any org admin may read it; only an Owner may change it.',
  },
  {
    method: 'PUT', path: '/api/org/federation', section: 'org',
    summary: 'Sets whether a federated login may join an existing account by verified email.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [], query: null, request: orgFederationPolicyRequest, response: orgFederationPolicy,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'validation_error'], transport: 'http',
    notes:
      'Owner tier: what this flag decides is account linking across the whole org, not a per-app setting. It lives on the org rather than on an ' +
      'app because the thing it governs — one user row per address — is org-scoped.',
  },
  {
    method: 'GET', path: '/api/org/groups/:id/oidc-provider', section: 'org',
    summary: "Reads a group's OIDC provider configuration, without the client secret.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: null, response: groupOidcProvider,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      'A group with no provider answers `404`, not an empty object. The secret is write-only and comes back through nothing — not this read, ' +
      'not the PUT\'s own response, not an audit detail; the stored row this maps from has none to carry.',
  },
  {
    method: 'PUT', path: '/api/org/groups/:id/oidc-provider', section: 'org',
    summary: "Sets or rotates a group's OIDC provider and its just-in-time grants.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: putGroupOidcProviderRequest, response: groupOidcProvider,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'target_state_conflict', 'validation_error'], transport: 'http',
    notes:
      'Any org admin, not Owner only: configuring a group\'s provider is member management. The Org Admins group is refused with ' +
      '`409 target_state_conflict` — console login is always the Fleetless password provider. `client_secret` is optional so a rotation need ' +
      'not resend it, but the first write of a provider must carry one. Each JIT grant\'s app must belong to this group, its role to that app, ' +
      'and no two grants may name the same app. An issuer resolving to a loopback or private address is refused here as a shape check; the ' +
      'authoritative SSRF defence is at the discovery fetch.',
  },
  {
    method: 'DELETE', path: '/api/org/groups/:id/oidc-provider', section: 'org',
    summary: "Removes a group's OIDC provider.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The group\'s uuid, as listed by `GET /api/org/groups`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Deleting a provider a group never had is an honest `404`, not a silent `204`.',
  },
  {
    method: 'PATCH', path: '/api/org', section: 'org',
    summary: 'Renames the org.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: true, status: 200,
    params: [], query: null, request: patchOrgRequest, response: null,
    errors: [...DEVELOPER_GUARD, 'tier_required', 'validation_error'], transport: 'http',
    notes:
      'Answers `{ "org": org }`. The envelope has no schema of its own in contracts; the value is an `org`. Owner tier, and the gate runs ' +
      'before the body is looked at, so a malformed rename and a forbidden one answer the same way. Renaming to the name already held writes ' +
      'nothing and records no audit event.',
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
    summary: 'Takes the organization name and creates the org, its admin group and its founding Owner.',
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

  /* ------------------------------------------------------- apps (branding) */
  {
    method: 'GET', path: '/api/apps/:id/branding', section: 'apps',
    summary: "Reads the app's login-page branding, or null when it has none.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: brandingConfig,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`null` is an answer, not an absence: an app that never configured branding is in that state and renders neutral Fleetless. So this is ' +
      '`200` with a `null` body rather than a `404`, and rather than a default object a caller could mistake for a stored one.',
  },
  {
    method: 'PUT', path: '/api/apps/:id/branding', section: 'apps',
    summary: "Replaces the app's login-page branding.",
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: brandingConfig, response: brandingConfig,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found', 'validation_error'], transport: 'http',
    notes:
      'A replace, not a merge. The app is scoped before the body is parsed, so an app the caller does not own answers `404` whether or not the ' +
      'colour was also malformed.',
  },
  {
    method: 'DELETE', path: '/api/apps/:id/branding', section: 'apps',
    summary: 'Drops the app back to neutral Fleetless branding.',
    audience: 'developer', auth: 'developer', rateLimited: false, ownerTier: false, status: 204,
    params: [{ name: 'id', description: 'The app\'s uuid, as returned by `POST /api/apps` or listed by `GET /api/apps`.' }],
    query: null, request: null, response: null,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes: 'Deleting branding an app never had is not an error: the end state is what was asked for.',
  },

  /* --------------------------------------------------- end-user (client) auth */
  {
    method: 'POST', path: '/api/client/login', section: 'client-auth',
    summary: 'Signs an app user in with an app identifier, an email address and a password.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientLoginRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'invalid_credentials'], transport: 'http',
    notes:
      'One refusal for every miss — unknown app, unknown address, wrong password, or no assignment to this app — because the caller supplies ' +
      'the `app_identifier` unauthenticated, so "this app knows this user" is not a fact the answer may carry. The argon2 verify is paid ' +
      'unconditionally, including for an unknown app identifier, so response time is not an oracle either.',
  },
  {
    method: 'POST', path: '/api/client/refresh', section: 'client-auth',
    summary: 'Rotates an app-user refresh token and mints a fresh access token.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientRefreshRequest, response: sessionTokens,
    errors: ['rate_limited', 'validation_error', 'token_expired', 'token_revoked'], transport: 'http',
    notes:
      'The assignment is re-proved here, not just the token: refresh is where every session eventually re-proves itself, so a user whose ' +
      'assignment to this app was removed loses the family here even if the proactive revoke had not landed. A family minted from a ' +
      '`resource`-carrying token exchange keeps its audience across every rotation.',
  },
  {
    method: 'POST', path: '/api/client/logout', section: 'client-auth',
    summary: 'Revokes an app-user refresh family and reports whether the identity provider can also be signed out.',
    audience: 'client', auth: 'none', rateLimited: true, ownerTier: false, status: 200,
    params: [], query: null, request: clientLogoutRequest, response: clientLogoutResponse,
    errors: ['rate_limited', 'validation_error'], transport: 'http',
    notes:
      'The Fleetless session is over before the identity provider is consulted, and nothing in that outbound call can put it back. ' +
      '`idp_logout` reports which of five outcomes applies; `session_unknown` means no live session was found for the token, which is not the ' +
      'same fact as "this session had no identity provider". A row that cannot produce an `id_token_hint` is never reported as `redirect`. ' +
      'Open `/realtime` sockets are closed.',
  },
  {
    method: 'POST', path: '/api/client/password/change', section: 'client-auth',
    summary: "Changes an app user's own password and answers a fresh session.",
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: passwordChangeRequest, response: sessionTokens,
    errors: [...CLIENT_GUARD, 'validation_error', 'invalid_credentials'], transport: 'http',
    notes:
      'The guard admits all three caller kinds, but a password belongs to an app user specifically — a developer bearer or a server key ' +
      'reaching this is `401 unauthorized`. Every session of the account ends, across every app, since a password is account-wide; the answer ' +
      'is the replacement pair.',
  },
  {
    method: 'GET', path: '/api/client/grants', section: 'client-auth',
    summary: 'Lists the OAuth clients this app user has consented to.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: consentGrantListResponse,
    errors: [...CLIENT_GUARD], transport: 'http',
    notes: 'App-user only: a developer bearer or a server key reaching this through the client surface is `401 unauthorized`.',
  },
  {
    method: 'DELETE', path: '/api/client/grants/:client_id', section: 'client-auth',
    summary: 'Revokes one consent grant and every refresh family issued under it.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [{ name: 'client_id', description: 'The OAuth client id, as listed by `GET /api/client/grants`.' }],
    query: null, request: null, response: consentRevokeResponse,
    errors: [...CLIENT_GUARD, 'not_found'], transport: 'http',
    notes:
      'Ends both the future and the already-issued: the consent stops being usable, and every refresh family for that client and user is ' +
      'revoked. `tokens_revoked` reports how many. App-user only.',
  },
  {
    method: 'GET', path: '/api/client/me', section: 'client-auth',
    summary: 'Answers who the calling token is and what it is allowed to reach.',
    audience: 'client', auth: 'developer_or_client', rateLimited: false, ownerTier: false, status: 200,
    params: [], query: null, request: null, response: clientIdentity,
    errors: [...CLIENT_GUARD], transport: 'http',
    notes:
      'The one route that answers for all three caller kinds — a developer bearer, an app-user bearer and a server key — which is why the ' +
      'shape names each of `developer_id`, `end_user_id` and `server_key_id` and fills exactly one.',
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
    params: [], query: null, request: null, response: resourceHealthListResponse,
    errors: [...DEVELOPER_GUARD, 'invalid_uuid', 'not_found'], transport: 'http',
    notes:
      '`?robot_id=` narrows it to one robot; there is no query schema, the parameter is read directly. Org-wide rather than per-robot because ' +
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
]
