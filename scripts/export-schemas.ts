// SPDX-License-Identifier: Apache-2.0
/**
 * Exports every wire schema as JSON Schema into artifacts/schema/.
 *
 * The bridge (Python) validates frames against these files with `jsonschema`
 * — no codegen step in W0. A test guards that the committed artifacts match
 * a fresh export, so the artifacts can never silently go stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ROUTES, ROUTE_SECTIONS, type RouteEntry } from '../src/routes.js'
import {
  bridgeHello,
  cloudHelloOk,
  cloudHelloError,
  cloudPing,
  bridgePong,
  datapointFrame,
  bridgeState,
  bridgePressure,
  cloudConfig,
  bridgeConfigApplied,
  cloudIntrospectRequest,
  bridgeIntrospect,
  cloudTypeRequest,
  bridgeTypeDefinitions,
} from '../src/protocol.js'
import {
  snapshotHeader,
  cloudCameraStart,
  cloudCameraStop,
  bridgeCameraState,
} from '../src/protocol.js'
import { applyError } from '../src/common.js'
import { MCP_APP_PATHS } from '../src/mcp.js'
import {
  cameraListResponse,
  liveSessionResponse,
  snapshotMetaResponse,
} from '../src/rest.js'
import { robotConfigDoc, datapointConfig, validationIssue, configState, cameraSource } from '../src/config.js'
import { AUDIT_RETENTION_DAYS } from '../src/audit.js'
import { rosGraph, typeDefinition } from '../src/introspection.js'
import {
  robot,
  createRobotRequest,
  createRobotResponse,
  exposureCounts,
  robotListItem,
  robotListResponse,
  datapointValue,
  robotDetailResponse,
  configDraftResponse,
  publishConfigResponse,
  introspectionResponse,
  datapointListResponse,
  robotDetailsDoc,
} from '../src/rest.js'
import {
  clientAuth,
  authOk,
  authError,
  clientSubscribe,
  clientUnsubscribe,
  subscribeError,
  datapointEvent,
  resourceHealthEvent,
  orgEvent,
  orgEventSubscribe,
  orgEventUnsubscribe,
  orgEventReplay,
  orgEventDropped,
} from '../src/realtime.js'
import { apiError } from '../src/errors.js'
import {
  org,
  sessionTokens,
  signUpRequest,
  signUpResponse,
  waitlistRequest,
  developerLoginRequest,
  fleetlessUser,
  fleetlessUserListResponse,
  createTeamInviteRequest,
  teamInvite,
  pendingTeamInvite,
  pendingTeamInviteListResponse,
  acceptTeamInviteRequest,
  patchFleetlessUserRequest,
  tierChangeRequest,
  authMeResponse,
  patchOrgRequest,
  patchAuthMeRequest,
} from '../src/identity.js'
import { patchOrgResponse } from '../src/identity.js'
import {
  app,
  createAppRequest,
  serverKey,
  createServerKeyResponse,
  role,
  rolePermissions,
} from '../src/apps.js'
import { appListResponse, roleListResponse, serverKeyListResponse } from '../src/apps.js'
import {
  clientLoginRequest,
  clientRefreshRequest,
  clientLogoutRequest,
  clientRegisterRequest,
  clientVerifyEmailRequest,
  clientResendVerificationRequest,
  clientPasswordResetRequest,
  clientPasswordResetConfirmRequest,
  clientAcceptInvitationRequest,
  clientProviderListQuery,
  clientProviderListResponse,
  clientOidcStartQuery,
  clientOidcCallbackQuery,
  clientOidcExchangeRequest,
  clientMcpInteraction,
  clientMcpInteractionDecisionResponse,
  mcpConsentGrant,
  mcpConsentGrantListResponse,
  clientIdentity,
} from '../src/client-auth.js'
import {
  appUser,
  appUserListResponse,
  createAppUserRequest,
  patchAppUserRequest,
  createAppInvitationRequest,
  appInvitation,
  appInvitationListResponse,
  appOidcProvider,
  appOidcProviderListResponse,
  createAppOidcProviderRequest,
  patchAppOidcProviderRequest,
  appAuthConfig,
  putAppAuthConfigRequest,
  appMailTemplate,
  appMailTemplateListResponse,
  putAppMailTemplateRequest,
  mailTemplatePreviewRequest,
  mailTemplatePreviewResponse,
  mailTemplateProblemDetails,
  mailOutcome,
} from '../src/app-users.js'
import { auditActor, auditEvent, auditListResponse, auditQuery } from '../src/audit.js'
import {
  datapointAlertRow,
  alertListResponse,
  orgFiringAlertsResponse,
  datapointDisplay,
  putDatapointDisplayRequest,
} from '../src/alerts.js'
import { orgAlertsQuery } from '../src/alerts.js'
import { job, jobEvent } from '../src/jobs.js'
import { jobActor, jobRun, jobRunQuery, jobRunListResponse, jobRunSummaryQuery, jobRunSummary } from '../src/jobs.js'
import { actionConfig, serviceConfig, publisherConfig, parameterSpec } from '../src/config.js'
import {
  clientInvoke,
  clientCancel,
  clientPublish,
  commandResult,
  errorFrame,
} from '../src/realtime.js'
import {
  cloudInvoke,
  cloudCancel,
  cloudPublish,
  bridgeJobUpdate,
  bridgeJobLost,
  bridgeAssetsAvailable,
  cloudAssetRequest,
  bridgeAssetProgress,
} from '../src/protocol.js'
import { asset, assetKind, assetListResponse, assetSyncStatus, URDF_ASSET_NAME } from '../src/assets.js'
import { missingAssetQuery } from '../src/assets.js'
import { mcpRobotDatasheet, mcpRolePreviewResponse } from '../src/mcp.js'
import { ASSET_UPLOAD_MAX_BYTES } from '../src/assets.js'
import { ASSET_UPLOAD_HEADERS, SNAPSHOT_HEADERS } from '../src/rest.js'
import { invokeRequest, invokeResponse, publishRequest, jobResponse, exposureListResponse } from '../src/rest.js'
import { invokeOrServiceResponse, historyResponse } from '../src/rest.js'
import { latencyBucket, robotLatencySeries, orgLatencyQuery, orgLatencyResponse } from '../src/rest.js'
import { orgUsageQuery, orgUsageResponse } from '../src/rest.js'
import { orgHealthQuery, patchRobotResponse, putRobotDetailsResponse, robotDeleteQuery, serviceCallResponse } from '../src/rest.js'
import { patchRobotRequest, renameSlugRequest, renameSlugResponse, slugUsageResponse } from '../src/rest.js'
import { assetSyncRequest, assetSyncResponse, urdfCompleteness } from '../src/assets.js'
import { updateAppRequest } from '../src/apps.js'
import { parameterInvalidDetails, parameterViolation } from '../src/errors.js'
import {
  passwordChangeRequest,
  passwordResetConfirm,
  passwordResetRequest,
  refreshRequest,
} from '../src/identity.js'
import { busyDetails, jobState } from '../src/jobs.js'
import {
  authorizationServerMetadata,
  dynamicClientRegistrationRequest,
  dynamicClientRegistrationResponse,
  oauthRedirectResponse,
  oauthTokenRequest,
  oauthTokenResponse,
  protectedResourceMetadata,
} from '../src/oauth.js'
import { oauthAuthorizeQuery } from '../src/oauth.js'
import {
  cameraDescriptor,
  cancelRequest,
  configVersionResponse,
  configVersionsResponse,
  fetchTypesRequest,
  fetchTypesResponse,
  putConfigDraftRequest,
  putRobotDetailsRequest,
  rateLimitDetails,
  releaseLiveQuery,
  robotJobsResponse,
  typesResponse,
} from '../src/rest.js'
import {
  historyQuery,
  historySamplesResponse,
  historyBucketsResponse,
  orgQuotas,
  orgQuotaUsage,
  orgQuotaUsageCounts,
  robotDeletionSummary,
  resourceHealthState,
  resourceHealthListResponse,
} from '../src/rest.js'

export const exportedSchemas = {
  // FL-006 — the MCP server's datasheet. REST-only shapes: the bridge has no
  // MCP surface at all, so these are here for the same reason the other REST
  // responses are — "every wire schema", one map, no second place to look.
  // They replaced W7c's `mcp-tool-preview` pair when the per-slug tool
  // preview gave way to a fixed catalog.
  'mcp-robot-datasheet': mcpRobotDatasheet,
  'mcp-role-preview-response': mcpRolePreviewResponse,
  // W7 — assets. The three bridge<->cloud frames belong here for the reason
  // stated below: the bridge validates against these files, so a frame absent
  // from this map is a frame it cannot check. The bytes themselves never ride
  // the socket — these describe the conversation, not the payload.
  'bridge-assets-available': bridgeAssetsAvailable,
  'cloud-asset-request': cloudAssetRequest,
  'bridge-asset-progress': bridgeAssetProgress,
  asset: asset,
  'asset-list-response': assetListResponse,
  'asset-sync-status': assetSyncStatus,
  // W5 — cameras. Every bridge<->cloud frame is validated against its
  // generated schema in both directions, so a frame missing from this map is
  // a frame the bridge cannot check.
  'snapshot-header': snapshotHeader,
  'cloud-camera-start': cloudCameraStart,
  'cloud-camera-stop': cloudCameraStop,
  'bridge-camera-state': bridgeCameraState,
  'camera-list-response': cameraListResponse,
  'live-session-response': liveSessionResponse,
  'snapshot-meta-response': snapshotMetaResponse,
  // W6 — retention, history, quotas, camera sources.
  'camera-source': cameraSource,
  'history-query': historyQuery,
  'history-samples-response': historySamplesResponse,
  'history-buckets-response': historyBucketsResponse,
  'org-quotas': orgQuotas,
  'org-quota-usage': orgQuotaUsage,
  'org-quota-usage-counts': orgQuotaUsageCounts,
  // W6a — deletion and the resource-health channel.
  'robot-deletion-summary': robotDeletionSummary,
  'resource-health-state': resourceHealthState,
  'resource-health-list-response': resourceHealthListResponse,
  'resource-health-event': resourceHealthEvent,
  'bridge-hello': bridgeHello,
  'cloud-hello-ok': cloudHelloOk,
  'cloud-hello-error': cloudHelloError,
  'cloud-ping': cloudPing,
  'bridge-pong': bridgePong,
  'datapoint-frame': datapointFrame,
  'bridge-state': bridgeState,
  'bridge-pressure': bridgePressure,
  'cloud-config': cloudConfig,
  'bridge-config-applied': bridgeConfigApplied,
  // Registered on its own, unlike `parameterViolation` (embedded once, in
  // `apiError`'s array field, and not registered): `applyError` is embedded
  // in TWO schemas now — here, and in `configState.applied_errors` — the
  // same "reused, so registered" precedent `validationIssue` already sets.
  'apply-error': applyError,
  'cloud-introspect-request': cloudIntrospectRequest,
  'bridge-introspect': bridgeIntrospect,
  'cloud-type-request': cloudTypeRequest,
  'bridge-type-definitions': bridgeTypeDefinitions,
  'robot-config-doc': robotConfigDoc,
  'datapoint-config': datapointConfig,
  'validation-issue': validationIssue,
  'config-state': configState,
  'ros-graph': rosGraph,
  'type-definition': typeDefinition,
  robot: robot,
  'create-robot-request': createRobotRequest,
  'create-robot-response': createRobotResponse,
  'exposure-counts': exposureCounts,
  'robot-list-item': robotListItem,
  'robot-list-response': robotListResponse,
  'datapoint-value': datapointValue,
  'robot-detail-response': robotDetailResponse,
  'config-draft-response': configDraftResponse,
  'publish-config-response': publishConfigResponse,
  'introspection-response': introspectionResponse,
  'datapoint-list-response': datapointListResponse,
  'robot-details-doc': robotDetailsDoc,
  'client-auth': clientAuth,
  'auth-ok': authOk,
  'auth-error': authError,
  'client-subscribe': clientSubscribe,
  'client-unsubscribe': clientUnsubscribe,
  'subscribe-error': subscribeError,
  'datapoint-event': datapointEvent,
  'org-event': orgEvent,
  'org-event-subscribe': orgEventSubscribe,
  'org-event-unsubscribe': orgEventUnsubscribe,
  'org-event-replay': orgEventReplay,
  'org-event-dropped': orgEventDropped,
  'api-error': apiError,
  org: org,
  'auth-me-response': authMeResponse,
  'patch-org-request': patchOrgRequest,
  'patch-auth-me-request': patchAuthMeRequest,
  'session-tokens': sessionTokens,
  'sign-up-request': signUpRequest,
  'sign-up-response': signUpResponse,
  'waitlist-request': waitlistRequest,
  'developer-login-request': developerLoginRequest,
  // 2026-09-05 — the two identity spaces (app-user-auth, D1).
  'fleetless-user': fleetlessUser,
  'fleetless-user-list-response': fleetlessUserListResponse,
  'create-team-invite-request': createTeamInviteRequest,
  'team-invite': teamInvite,
  'pending-team-invite': pendingTeamInvite,
  'pending-team-invite-list-response': pendingTeamInviteListResponse,
  'accept-team-invite-request': acceptTeamInviteRequest,
  'patch-fleetless-user-request': patchFleetlessUserRequest,
  'tier-change-request': tierChangeRequest,
  // The per-app identity space. `providerSlug`, `allowedOrigin`, `emailDomain`
  // and the `appUrlTemplate` results are **not** registered on their own: each
  // is a string rule that only ever appears as a field of one of the objects
  // below, the `idpClaimMapping` precedent for a shape with no life of its own.
  'app-user': appUser,
  'app-user-list-response': appUserListResponse,
  'create-app-user-request': createAppUserRequest,
  'patch-app-user-request': patchAppUserRequest,
  'create-app-invitation-request': createAppInvitationRequest,
  'app-invitation': appInvitation,
  'app-invitation-list-response': appInvitationListResponse,
  'app-oidc-provider': appOidcProvider,
  'app-oidc-provider-list-response': appOidcProviderListResponse,
  'create-app-oidc-provider-request': createAppOidcProviderRequest,
  'patch-app-oidc-provider-request': patchAppOidcProviderRequest,
  'app-auth-config': appAuthConfig,
  'put-app-auth-config-request': putAppAuthConfigRequest,
  'app-mail-template': appMailTemplate,
  'app-mail-template-list-response': appMailTemplateListResponse,
  'put-app-mail-template-request': putAppMailTemplateRequest,
  'mail-template-preview-request': mailTemplatePreviewRequest,
  'mail-template-preview-response': mailTemplatePreviewResponse,
  'mail-template-problem-details': mailTemplateProblemDetails,
  'mail-outcome': mailOutcome,
  app: app,
  'create-app-request': createAppRequest,
  'server-key': serverKey,
  'create-server-key-response': createServerKeyResponse,
  role: role,
  'role-permissions': rolePermissions,
  'client-login-request': clientLoginRequest,
  'client-refresh-request': clientRefreshRequest,
  'client-logout-request': clientLogoutRequest,
  'client-register-request': clientRegisterRequest,
  'client-verify-email-request': clientVerifyEmailRequest,
  'client-resend-verification-request': clientResendVerificationRequest,
  'client-password-reset-request': clientPasswordResetRequest,
  'client-password-reset-confirm-request': clientPasswordResetConfirmRequest,
  'client-accept-invitation-request': clientAcceptInvitationRequest,
  'client-provider-list-query': clientProviderListQuery, // GET /api/client/providers
  'client-provider-list-response': clientProviderListResponse,
  'client-oidc-start-query': clientOidcStartQuery, // GET /api/client/oidc/:slug/start
  'client-oidc-callback-query': clientOidcCallbackQuery, // GET /api/client/oidc/callback — the IdP's wire
  'client-oidc-exchange-request': clientOidcExchangeRequest,
  'client-mcp-interaction': clientMcpInteraction,
  'client-mcp-interaction-decision-response': clientMcpInteractionDecisionResponse,
  // The consent MEMORY, as both withdrawal doors list it — the developer's
  // `GET /api/apps/:id/users/:userId/mcp-grants` and the app user's own
  // `GET /api/client/mcp/grants` answer the same shape, which is one schema
  // under one name rather than two that would drift.
  'mcp-consent-grant': mcpConsentGrant,
  'mcp-consent-grant-list-response': mcpConsentGrantListResponse,
  'client-identity': clientIdentity,
  'audit-actor': auditActor,
  'audit-event': auditEvent,
  'audit-list-response': auditListResponse,
  'audit-query': auditQuery,
  job: job,
  'job-event': jobEvent,
  'job-actor': jobActor,
  'job-run': jobRun,
  'job-run-query': jobRunQuery,
  'job-run-summary-query': jobRunSummaryQuery,
  'job-run-list-response': jobRunListResponse,
  'job-run-summary': jobRunSummary,
  'parameter-spec': parameterSpec,
  'action-config': actionConfig,
  'service-config': serviceConfig,
  'publisher-config': publisherConfig,
  'client-invoke': clientInvoke,
  'client-cancel': clientCancel,
  'client-publish': clientPublish,
  'command-result': commandResult,
  'error-frame': errorFrame,
  'cloud-invoke': cloudInvoke,
  'cloud-cancel': cloudCancel,
  'cloud-publish': cloudPublish,
  'bridge-job-update': bridgeJobUpdate,
  'bridge-job-lost': bridgeJobLost,
  'invoke-request': invokeRequest,
  'invoke-response': invokeResponse,
  'publish-request': publishRequest,
  'job-response': jobResponse,
  'exposure-list-response': exposureListResponse,
  'latency-bucket': latencyBucket,
  'robot-latency-series': robotLatencySeries,
  'org-latency-query': orgLatencyQuery,
  'org-latency-response': orgLatencyResponse,
  'org-usage-query': orgUsageQuery,
  'org-usage-response': orgUsageResponse,
  'patch-robot-request': patchRobotRequest,
  'rename-slug-request': renameSlugRequest,
  'rename-slug-response': renameSlugResponse,
  'slug-usage-response': slugUsageResponse,
  // Datapoint alerts and chart display config (2026-08-28
  // alerts-and-datapoint-modal-design, D1/D2/D5). `alertRowCondition`,
  // `alertSeverity` and `alertState` are not registered on their own —
  // embedded fields, the same call already made for `datapointRate`.
  'datapoint-alert-row': datapointAlertRow,
  'alert-list-response': alertListResponse,
  'org-firing-alerts-response': orgFiringAlertsResponse,
  'datapoint-display': datapointDisplay,
  'put-datapoint-display-request': putDatapointDisplayRequest,

  // --- The route manifest's referenced shapes (`src/routes.ts`) ------------
  //
  // **Registration is not a formality here: it is the guard.** A route entry
  // points at a zod object, and `schemaName` below resolves that object to the
  // artifact name the docs and the OpenAPI document link to. A schema a route
  // references and this map does not carry has no name to resolve to, so the
  // export throws rather than emitting a manifest with a hole in it. Every
  // entry below was added because a route pointed at it; the comment names
  // that route, so the next reader can tell a wire shape from a leftover.
  'refresh-request': refreshRequest, // POST /api/auth/refresh, POST /api/auth/logout
  'password-change-request': passwordChangeRequest, // POST /api/auth/password/change, POST /api/client/password/change
  'password-reset-request': passwordResetRequest, // POST /api/auth/password/reset
  'password-reset-confirm': passwordResetConfirm, // POST /api/auth/password/reset/confirm
  'update-app-request': updateAppRequest, // PATCH /api/apps/:id
  'oauth-redirect-response': oauthRedirectResponse, // POST /console/oauth/login, POST /console/oauth/signup/organization, POST /mcp/oauth/login, POST /mcp/oauth/consent
  // **The four OAuth shapes that spent a release registered here and named by
  // no route** (train 6 review, C26). The block that stood here argued they
  // were "documentation of a live wire, not leftovers" and left them
  // unreferenced on that basis — which is true of the wire and false of the
  // consequence: `openapi.json` carries a component only for what a route
  // names, so 25 fully-documented fields left the published reference with
  // nothing able to notice. The undocumented-field ratchet cannot see it by
  // construction, since it counts *gaps* and a fully documented schema leaving
  // makes its number improve. Three are now named by the routes that read
  // them; `oauthRegisterQuery`, whose one reason to exist was a per-app
  // registration parameter that shipped in the path instead, is deleted. The
  // guard that keeps this from recurring is in `test/routes.test.ts`.
  'oauth-token-request': oauthTokenRequest, // POST /mcp/oauth/token, POST /mcp/:appIdentifier/oauth/token
  'oauth-token-response': oauthTokenResponse, // POST /mcp/oauth/token
  'dynamic-client-registration-request': dynamicClientRegistrationRequest, // POST /mcp/oauth/register, POST /mcp/:appIdentifier/oauth/register
  'dynamic-client-registration-response': dynamicClientRegistrationResponse, // POST /mcp/oauth/register
  'authorization-server-metadata': authorizationServerMetadata, // GET /.well-known/oauth-authorization-server/mcp
  'protected-resource-metadata': protectedResourceMetadata, // GET /.well-known/oauth-protected-resource/mcp
  'put-robot-details-request': putRobotDetailsRequest, // PUT /api/robots/:id/details
  'put-config-draft-request': putConfigDraftRequest, // PUT /api/robots/:id/config/draft
  'config-versions-response': configVersionsResponse, // GET /api/robots/:id/config/versions
  'config-version-response': configVersionResponse, // GET /api/robots/:id/config/versions/:v
  'types-response': typesResponse, // GET /api/robots/:id/types
  'fetch-types-request': fetchTypesRequest, // POST /api/robots/:id/types/fetch
  'fetch-types-response': fetchTypesResponse, // POST /api/robots/:id/types/fetch
  'robot-jobs-response': robotJobsResponse, // GET /api/robots/:id/jobs
  'cancel-request': cancelRequest, // POST /api/robots/:id/jobs/:slug/cancel
  'release-live-query': releaseLiveQuery, // DELETE /api/robots/:id/cameras/:slug/live
  // **Two routes answer one of two shapes, so each names a union.** Both
  // carried `response: null` while their handler demonstrably answers
  // something — which the generated reference renders as *returns nothing*,
  // the reading a `null` should be reserved for (`204`). The members stay
  // registered in their own right where they already were; the union is what
  // the route entry points at.
  'invoke-or-service-response': invokeOrServiceResponse, // POST /api/robots/:id/jobs/:slug
  'history-response': historyResponse, // GET /api/robots/:id/datapoints/:slug/history
  'asset-sync-request': assetSyncRequest, // POST /api/robots/:id/assets/sync
  'asset-sync-response': assetSyncResponse, // POST /api/robots/:id/assets/sync

  // --- Queries and envelopes the manifest names (2026-09-05 parked items) ---
  //
  // Every documented query string and every list/detail envelope the routes
  // above answer with. They were the fifteen holes the guard above describes:
  // a route pointed at each of them and `schemaName` had no name to resolve
  // to, so the export refused rather than emitting a manifest with a gap in
  // it. Comment names the route, same as the block above.
  'oauth-authorize-query': oauthAuthorizeQuery, // GET /mcp/oauth/authorize, GET /mcp/:appIdentifier/oauth/authorize
  'org-alerts-query': orgAlertsQuery, // GET /api/org/alerts
  'robot-delete-query': robotDeleteQuery, // DELETE /api/robots/:id
  'org-health-query': orgHealthQuery, // GET /api/org/health
  'missing-asset-query': missingAssetQuery, // GET /api/robots/:id/assets/missing
  'app-list-response': appListResponse, // GET /api/apps
  'role-list-response': roleListResponse, // GET /api/apps/:id/roles
  'server-key-list-response': serverKeyListResponse, // GET /api/apps/:id/server-keys
  'patch-org-response': patchOrgResponse, // PATCH /api/org
  'patch-robot-response': patchRobotResponse, // PATCH /api/robots/:id
  'put-robot-details-response': putRobotDetailsResponse, // PUT /api/robots/:id/details
  // The other half of `invoke-or-service-response`. `invokeResponse` was
  // already registered in its own right and this one was not, so the union
  // named a member the reference could not link to — the documented absence
  // the union comment above exists to have removed.
  'service-call-response': serviceCallResponse, // POST /api/robots/:id/jobs/:slug (the service half of the union)

  // --- Wire shapes the SDK re-exports as TypeScript types ------------------
  //
  // Not referenced by any route entry: each of these travels *inside* one of
  // the shapes above, and would have needed no artifact of its own for the
  // bridge or for OpenAPI. They are registered because `@fleetless/sdk`
  // re-exports them as types, and the generated SDK reference links each name
  // to a field table — a type a developer can import and cannot look up is the
  // documented absence this project keeps paying for.
  'job-state': jobState, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'busy-details': busyDetails, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'camera-descriptor': cameraDescriptor, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'urdf-completeness': urdfCompleteness, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'rate-limit-details': rateLimitDetails, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'parameter-invalid-details': parameterInvalidDetails, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
  'parameter-violation': parameterViolation, // re-exported by @fleetless/sdk as a type; the generated SDK reference links here
} as const

/**
 * Wire constants that are **not schemas**, exported so a non-TypeScript
 * consumer can vendor them instead of re-typing them (W7a).
 *
 * The bridge is the consumer. It cannot import this package, so through W7 it
 * carried `x-fleetless-asset-kind`, `x-fleetless-asset-name`,
 * `x-fleetless-sync-id` and `robot_description` as Python string literals
 * under a comment naming the TypeScript constant they were copied from — the
 * exact drift those constants exist to prevent, in the one repo that cannot
 * prevent it. A `zod` schema cannot describe a header name or a convention,
 * which is an argument for emitting the values once, not for writing them
 * down twice.
 *
 * Kept flat and JSON-only on purpose: this file is read by `json.load` and
 * indexed by these keys, so a value here is part of the wire contract and
 * renaming a key breaks a consumer exactly as renaming a schema field would.
 */
export const exportedConstants = {
  // W9d: the cloud must not derive the retention window a second time.
  AUDIT_RETENTION_DAYS,

  ASSET_UPLOAD_HEADERS,
  /**
   * **Der Deckel gehört hierher, weil die Bridge ihn sonst raten muss — und
   * genau das war der Defekt (W9b, DEF-127).**
   *
   * Der Vertrag sagt „eine Zahl, die Cloud und Bridge lesen". Für einen
   * TypeScript-Konsumenten stimmte das sofort; für die Bridge nicht, denn sie
   * kann das npm-Paket nicht importieren und liest ausschließlich dieses
   * Artefakt (`fleetless_bridge/contracts_constants.json`). Der Header war
   * angekommen, die Zahl nicht — **eine Grenze, die eine Seite nicht lesen
   * kann, ist wieder zwei Zahlen.** Gefunden von Rosie-W9b, bevor sie darauf
   * baute, in dem Commit, der das Raten abschaffen sollte.
   */
  ASSET_UPLOAD_MAX_BYTES,
  SNAPSHOT_HEADERS,
  URDF_ASSET_NAME,
  /**
   * **The `assetKind` *values*, because the bridge sends them and nothing
   * guarded them** (Momus-W7a, W7a review, answering this file's own question
   * about what else crosses the TypeScript/Python line).
   *
   * `assetKind` generates no standalone artifact, `asset.schema.json` is not
   * among the schemas the bridge vendors, and none of the vendored schemas
   * constrains `kind` — so `"urdf"`, `"mesh"`, `"texture"` lived as Python
   * string literals with nothing to check them against. Same wire, same enum,
   * same wave in which one line refusing an unknown kind killed a three-repo
   * chain and was found by the console owner in a repo that was not hers.
   */
  ASSET_KINDS: assetKind.options,
} as const

/**
 * Which zod rendering mode each artifact is published in. See the reasoning
 * at the `writeFileSync` below; the short version is that a schema somebody
 * validates an **incoming** document against is `input`, and a schema that
 * describes what a server **sends** is `output`.
 *
 * Everything not listed here is `output`, and listing is mandatory — the
 * check under this table refuses to export when the two sets disagree.
 *
 * **What input mode also does, named because the first version of this comment
 * read as if it were only about `.default()`** (Argus-W9, W9 review): it drops
 * `additionalProperties: false` as well. Of the 24 schemas the bridge vendors,
 * three still carry one.
 *
 * For an **incoming** frame that is right — the receiver strips unknown keys
 * anyway, and a schema that refuses them describes a stricter contract than
 * the code keeps. But the bridge also validates its **outgoing** frames
 * against these same copies in `test/schemas.py`, and there the relaxation
 * points the wrong way: a typo in an outgoing field name (`activejobs`) now
 * passes the vendored check and is silently dropped by zod in the cloud —
 * which is the very "documented absence" this file's own reasoning is about.
 *
 * That is a **consequence of the direction rule, not an oversight in it**: one
 * artifact cannot be both the description a receiver must accept and the
 * assertion a sender must meet. If the outgoing half turns out to be worth
 * guarding, it needs its own output-mode artifact rather than a weaker
 * classification here.
 */
const SCHEMA_IO_INPUT: readonly string[] = [
  // --- socket frames, bridge <-> cloud -------------------------------------
  // Both directions, because both ends validate what they receive.
  'bridge-hello', 'cloud-hello-ok', 'cloud-hello-error', 'cloud-ping', 'bridge-pong',
  'datapoint-frame', 'bridge-state', 'bridge-pressure', 'cloud-config', 'bridge-config-applied', 'apply-error',
  'cloud-introspect-request', 'bridge-introspect', 'cloud-type-request', 'bridge-type-definitions',
  'cloud-camera-start', 'cloud-camera-stop', 'bridge-camera-state',
  'bridge-assets-available', 'cloud-asset-request', 'bridge-asset-progress',
  'cloud-invoke', 'cloud-cancel', 'cloud-publish', 'bridge-job-update', 'bridge-job-lost',

  // --- socket frames, client <-> cloud -------------------------------------
  'client-auth', 'auth-ok', 'auth-error', 'client-subscribe', 'client-unsubscribe',
  'subscribe-error', 'datapoint-event', 'resource-health-event', 'job-event',
  'client-invoke', 'client-cancel', 'client-publish', 'command-result', 'error-frame',
  'org-event-subscribe', 'org-event-unsubscribe',

  // --- REST request bodies and queries -------------------------------------
  'create-robot-request', 'sign-up-request', 'waitlist-request', 'developer-login-request',
  'create-app-request',
  'create-team-invite-request', 'accept-team-invite-request',
  'patch-fleetless-user-request', 'tier-change-request',
  'client-login-request', 'client-refresh-request', 'client-logout-request',
  // The client auth API (2026-09-05). Every one is a document the server
  // validates on arrival, which is what `input` means.
  'client-register-request', 'client-verify-email-request',
  'client-resend-verification-request', 'client-password-reset-request',
  'client-password-reset-confirm-request', 'client-accept-invitation-request',
  'client-provider-list-query', 'client-oidc-start-query', 'client-oidc-callback-query',
  'client-oidc-exchange-request',
  // The app-user management surface.
  'create-app-user-request', 'patch-app-user-request',
  'create-app-invitation-request',
  'create-app-oidc-provider-request', 'patch-app-oidc-provider-request',
  'put-app-auth-config-request', 'put-app-mail-template-request',
  'mail-template-preview-request',
  'history-query', 'invoke-request', 'publish-request',
  'role-permissions', 'job-run-query', 'job-run-summary-query',
  'org-latency-query', 'audit-query', 'org-usage-query',
  'patch-org-request', 'patch-auth-me-request',
  'patch-robot-request', 'rename-slug-request',
  'put-datapoint-display-request',

  // --- Request bodies and queries the route manifest names ----------------
  'refresh-request', 'password-change-request', 'password-reset-request', 'password-reset-confirm',
  'update-app-request',
  'oauth-token-request', 'dynamic-client-registration-request',
  'put-robot-details-request', 'put-config-draft-request',
  'fetch-types-request', 'cancel-request', 'release-live-query', 'asset-sync-request',
  // The eight documented query strings (2026-09-05). A query is a document
  // the server validates on arrival, so `input` for the same reason every
  // other `*-query` above is.
  'oauth-authorize-query', 'org-alerts-query',
  'robot-delete-query', 'org-health-query', 'missing-asset-query',

  // --- shapes embedded in the above ----------------------------------------
  // A config document travels inside BOTH a draft PUT and the `cloud-config`
  // frame, so it is an accepted document on two surfaces and never a response
  // shape of its own.
  'robot-config-doc', 'datapoint-config', 'action-config', 'service-config',
  'publisher-config', 'parameter-spec', 'camera-source', 'robot-details-doc',
  'snapshot-header',
]

/**
 * The other half, listed rather than inferred. Responses, and the entities
 * that only ever appear inside one — output mode is the correct description
 * here, because a response schema states what the server **will send**, with
 * every default already applied.
 */
const SCHEMA_IO_OUTPUT: readonly string[] = [
  'mcp-robot-datasheet', 'mcp-role-preview-response', 'asset', 'asset-list-response', 'asset-sync-status',
  'camera-list-response', 'live-session-response', 'snapshot-meta-response',
  'history-samples-response', 'history-buckets-response', 'org-quotas', 'org-quota-usage',
  'org-quota-usage-counts',
  'robot-deletion-summary', 'resource-health-state', 'resource-health-list-response',
  'validation-issue', 'config-state', 'ros-graph', 'type-definition', 'robot',
  'create-robot-response', 'exposure-counts', 'robot-list-item', 'robot-list-response', 'datapoint-value',
  'robot-detail-response', 'config-draft-response', 'publish-config-response',
  'introspection-response', 'datapoint-list-response', 'api-error', 'org',
  'session-tokens', 'sign-up-response', 'app', 'server-key',
  'fleetless-user', 'fleetless-user-list-response', 'team-invite',
  'pending-team-invite', 'pending-team-invite-list-response',
  'app-user', 'app-user-list-response', 'app-invitation',
  'app-invitation-list-response', 'app-oidc-provider',
  'app-oidc-provider-list-response', 'app-auth-config',
  'app-mail-template', 'app-mail-template-list-response',
  'mail-template-preview-response', 'mail-template-problem-details',
  'mail-outcome',
  'client-provider-list-response', 'client-mcp-interaction',
  'client-mcp-interaction-decision-response',
  'mcp-consent-grant', 'mcp-consent-grant-list-response',
  'create-server-key-response', 'role', 'client-identity', 'audit-actor',
  'audit-event', 'audit-list-response', 'job', 'invoke-response', 'job-response',
  'exposure-list-response', 'job-actor', 'job-run', 'job-run-list-response',
  'job-run-summary', 'latency-bucket', 'robot-latency-series', 'org-latency-response',
  'org-event', 'org-event-replay', 'org-event-dropped', 'org-usage-response',
  'auth-me-response', 'rename-slug-response', 'slug-usage-response',
  'datapoint-alert-row', 'alert-list-response', 'org-firing-alerts-response', 'datapoint-display',

  // --- Responses the route manifest names ---------------------------------
  'oauth-redirect-response', 'oauth-token-response', 'dynamic-client-registration-response',
  'authorization-server-metadata', 'protected-resource-metadata',
  'config-versions-response', 'config-version-response', 'types-response', 'fetch-types-response',
  'robot-jobs-response', 'asset-sync-response',
  'invoke-or-service-response', 'history-response',
  'app-list-response', 'role-list-response', 'server-key-list-response',
  'patch-org-response', 'patch-robot-response',
  'put-robot-details-response', 'service-call-response',

  // --- Embedded shapes the SDK re-exports as types -------------------------
  // Every one of these appears only inside a response, which is what makes
  // `output` the correct description: the artifact states what the server will
  // send, with defaults already applied.
  'job-state', 'busy-details', 'camera-descriptor', 'urdf-completeness',
  'rate-limit-details', 'parameter-invalid-details', 'parameter-violation',
]

const INPUT = new Set(SCHEMA_IO_INPUT)
export const schemaIo = (name: string): 'input' | 'output' => (INPUT.has(name) ? 'input' : 'output')

/**
 * **Every schema must be classified, and this is why that is code and not a
 * note.** An unlisted schema falling back to a default is exactly how this
 * class survived four waves: the wrong mode was never *chosen* for any of
 * them, it was inherited in silence. So both lists are checked against the
 * export in both directions — a new schema, a renamed one, or one classified
 * twice all stop the export rather than shipping a quietly wrong artifact.
 */
{
  const known = Object.keys(exportedSchemas)
  const classified = [...SCHEMA_IO_INPUT, ...SCHEMA_IO_OUTPUT]
  const missing = known.filter((n) => !classified.includes(n))
  const stale = classified.filter((n) => !known.includes(n))
  const twice = SCHEMA_IO_INPUT.filter((n) => SCHEMA_IO_OUTPUT.includes(n))
  const problems = [
    missing.length ? `not classified as input or output: ${missing.join(', ')}` : '',
    stale.length ? `classified but no longer exported: ${stale.join(', ')}` : '',
    twice.length ? `classified as both: ${twice.join(', ')}` : '',
  ].filter(Boolean)
  if (problems.length) {
    throw new Error(`SCHEMA_IO is out of step with exportedSchemas —\n  ${problems.join('\n  ')}`)
  }
}

/**
 * **The frames the bridge SENDS, published a second time in output mode.**
 *
 * These files are **not** a second contract. The contract is the input-mode
 * artifact next door, and it is right: it describes what a receiver accepts,
 * and this project's receivers strip unknown keys rather than refusing them.
 *
 * This set exists because the io split *removed* something (Argus-W9). Input
 * mode drops `additionalProperties: false`, and the bridge's own test harness
 * was using the vendored copies to check its **outgoing** frames — where a
 * relaxed schema points the wrong way. Rosie-W9d supplied the reason it
 * matters: every outgoing message in that repo is a hand-typed dict literal
 *
 *     json.dumps({"type": "hello", "protocol_version": …, "active_jobs": […]})
 *
 * with string keys and therefore **no static protection whatsoever** against a
 * typo — unlike an attribute on a dataclass, which would raise. `activejobs`
 * would pass a relaxed vendored check and then be silently dropped by zod in
 * the cloud: exactly the "documented absence" this whole class is about, on
 * the sending side.
 *
 * So: input mode for what a receiver must accept, output mode for what a
 * sender must produce. One artifact cannot be both, which is why there are
 * two rather than a weaker classification in `SCHEMA_IO`. Output mode also
 * marks `.default()` fields `required` here, and for an assertion about a
 * sender that is correct — the bridge does populate them, and this is where
 * that is claimed.
 *
 * **Only the bridge vendors these, and only its harness reads them.** They
 * never reach the wire and no consumer generates from them.
 */
export const BRIDGE_SENT_SCHEMAS: readonly string[] = [
  'bridge-hello', 'bridge-pong', 'bridge-config-applied', 'bridge-introspect',
  'bridge-type-definitions', 'datapoint-frame', 'bridge-job-update', 'bridge-job-lost',
  'snapshot-header', 'bridge-camera-state', 'bridge-assets-available', 'bridge-asset-progress',
]

/**
 * The same discipline as `SCHEMA_IO`'s check, for the same reason. A name here
 * that is not an exported socket frame classified as `input` is either a typo
 * or a schema that changed direction — and both should stop the export rather
 * than write a file nobody notices is wrong.
 */
{
  const known = Object.keys(exportedSchemas)
  const problems = BRIDGE_SENT_SCHEMAS.flatMap((n) =>
    !known.includes(n) ? [`${n}: not exported at all`]
    : schemaIo(n) !== 'input' ? [`${n}: classified as output, so it is not a frame a receiver validates`]
    : [],
  )
  if (problems.length) {
    throw new Error(`BRIDGE_SENT_SCHEMAS is out of step —\n  ${problems.join('\n  ')}`)
  }
}

/**
 * **The route manifest, rendered.** `src/routes.ts` declares every route once
 * and points at zod objects; the two functions below turn that into the two
 * artifacts the documentation site reads — `routes.json`, which is the manifest
 * with each schema resolved to its artifact name, and `openapi.json`, which is
 * the public half of it as an OpenAPI 3.1 document.
 *
 * They live in the export script rather than in `src/` on purpose: resolving a
 * schema to a *name* is only possible where the name/schema map is, and that map
 * is this file. `src/routes.ts` therefore never has to know what anything is
 * called, which is what keeps a rename from having two places to be wrong.
 */

/**
 * Artifact name of a schema object, by identity. A schema registered under
 * two names is a registration error — the artifact a route points at would
 * be a coin toss — so the map refuses to build.
 */
const nameOf = new Map<unknown, string>()
for (const [name, schema] of Object.entries(exportedSchemas)) {
  const seen = nameOf.get(schema)
  if (seen !== undefined) throw new Error(`schema exported twice: as ${seen} and as ${name}`)
  nameOf.set(schema, name)
}
function schemaName(schema: unknown, where: string): string {
  const name = nameOf.get(schema)
  if (name === undefined) {
    throw new Error(
      `${where}: schema is not registered in exportedSchemas — register it (and classify it in SCHEMA_IO_INPUT if it is a request or query)`,
    )
  }
  return name
}

export interface RouteArtifactEntry {
  method: string
  path: string
  section: string
  summary: string
  audience: string
  auth: string
  rateLimited: boolean
  ownerTier: boolean
  status: number
  params: { name: string; description: string }[]
  query: string | null
  request: string | null
  requestOptional?: true
  response: string | null
  contentType?: string
  errors: string[]
  transport: string
  notes?: string
}

export function routesArtifact(): { sections: typeof ROUTE_SECTIONS; routes: RouteArtifactEntry[] } {
  return {
    sections: ROUTE_SECTIONS,
    routes: ROUTES.map((r) => {
      const where = `${r.method} ${r.path}`
      // Built in two halves so the optional `requestOptional` can be inserted
      // where it belongs, between `request` and `response`. Assigning it
      // afterwards would append it past `transport` — a key set on an object it
      // is not already on goes to the end — and `routes.json`'s key order is
      // part of what the documentation reads.
      const entry: RouteArtifactEntry = {
        method: r.method,
        path: r.path,
        section: r.section,
        summary: r.summary,
        audience: r.audience,
        auth: r.auth,
        rateLimited: r.rateLimited,
        ownerTier: r.ownerTier,
        status: r.status,
        params: r.params.map((p) => ({ name: p.name, description: p.description })),
        query: r.query === null ? null : schemaName(r.query, `${where} query`),
        request: r.request === null ? null : schemaName(r.request, `${where} request`),
        ...(r.requestOptional === true ? { requestOptional: true as const } : {}),
        response: r.response === null ? null : schemaName(r.response, `${where} response`),
        // Same reason `requestOptional` is spread in above rather than assigned
        // afterwards: `routes.json`'s key order is part of what the
        // documentation site reads, and a key set on an object it is not
        // already on goes to the end.
        ...(r.contentType !== undefined ? { contentType: r.contentType } : {}),
        errors: [...r.errors],
        transport: r.transport,
      }
      if (r.notes !== undefined) entry.notes = r.notes
      return entry
    }),
  }
}

const SECURITY: Record<Exclude<RouteEntry['auth'], 'in_handler'>, object[]> = {
  developer: [{ developerSession: [] }],
  developer_or_client: [{ developerSession: [] }, { clientToken: [] }, { serverKey: [] }],
  none: [],
  robot_upload: [],
}

/**
 * **`auth: 'in_handler'` is three different credentials, not one**, so a single
 * blanket entry in `SECURITY` was wrong: it said `security: []` — *this route
 * needs no authentication* — about `POST /mcp`, which needs an OAuth access
 * token and answers `401` with a `WWW-Authenticate` challenge without one.
 *
 * `POST /mcp`'s bearer is an OAuth access token, which `clientToken` already
 * describes. The two asset-link routes carry their signed token **in the
 * path**, and OpenAPI has no security scheme for that — `apiKey` covers a
 * header, a query parameter or a cookie, and nothing else — so `[]` plus a
 * sentence at the top of the operation description is the honest form. It is
 * the one case where an empty list is a statement rather than an oversight,
 * which is why it is written here beside the other two rather than inherited.
 *
 * Keyed by `METHOD /path`, and a test holds its keys to `IN_HANDLER_ROUTES`:
 * a further in-handler route added without a decision here would otherwise
 * inherit the same silent `[]` this comment exists to have removed.
 */
const MCP_APP = MCP_APP_PATHS(':appIdentifier')

export const IN_HANDLER_SECURITY: Record<string, object[]> = {
  'POST /mcp': [{ clientToken: [] }],
  // The per-app endpoint's three verbs carry the same OAuth access token, and
  // the two that answer `405` carry it too: the app, its switch and the bearer
  // are all checked before the transport is reached, so a caller without one
  // gets the `401` challenge rather than the method refusal.
  [`POST ${MCP_APP.endpoint}`]: [{ clientToken: [] }],
  [`GET ${MCP_APP.endpoint}`]: [{ clientToken: [] }],
  [`DELETE ${MCP_APP.endpoint}`]: [{ clientToken: [] }],
  // **The one optional bearer in the manifest**, and OpenAPI spells optional as
  // "this scheme, or nothing": the empty requirement object is the second
  // alternative. Written as two entries rather than `[]`, which would say the
  // token is never read — it is, and `already_granted` is what it changes.
  'GET /api/client/mcp/interactions/:id': [{ clientToken: [] }, {}],
  'GET /api/asset-links/:token': [],
  'GET /api/asset-links/missing': [],
}

/** The sentence prepended to the description of an operation whose credential is a path segment. */
const PATH_TOKEN_NOTE = 'The signed token in the path is the credential; no other authentication applies.'

/**
 * **A component and every definition it hides underneath it.**
 *
 * `z.toJSONSchema` extracts a recursive sub-schema into the document's own
 * `$defs` and points at it with `#/$defs/<name>` — a pointer that is correct in
 * a standalone JSON Schema file and **dangling in an OpenAPI document**, where
 * the document root is the whole API and `$defs` is not one of its members. Two
 * components hit this (`types-response` and `fetch-types-response`, both
 * carrying the recursive `typeDefinition`), and the result was fourteen
 * `$ref`s to `#/$defs/__schema0`, which resolves to nothing at all: a tool
 * reading the document either errors or silently treats the field as untyped.
 *
 * So each `$defs` entry is hoisted to a component of its own, named
 * `<component>--<defName>`, and every pointer to it is rewritten. The name is
 * prefixed rather than used bare because zod's generated names are positional
 * (`__schema0`) — two components would otherwise collide on one, and the later
 * hoist would silently win.
 *
 * The rewrite walks the whole value, the hoisted definitions included: a
 * recursive definition refers to *itself* through the same pointer, so
 * rewriting only the parent would leave the inner one dangling and look fixed
 * from the outside.
 */
/**
 * **The editor's keywords, which OpenAPI has no idea what to do with.**
 *
 * `src/config.ts` annotates the config document with `defaultSnippets`,
 * `patternErrorMessage` and `enumDescriptions` so the console's Monaco YAML
 * editor can offer a snippet, explain a failed pattern in words, and gloss an
 * enum member. Those are `monaco-yaml`/`vscode-json-languageservice` vendor
 * keywords: they belong in `artifacts/schema/*.json`, which is the file the
 * editor loads, and nowhere near a document a client generator reads.
 *
 * JSON Schema says an unknown keyword is ignored, so nothing *breaks* — but
 * 122 of them travelled into `openapi.json` as noise a reader has to learn is
 * not part of the API, and one (`defaultSnippets`) carries whole example
 * documents. So they are stripped **here and only here**: the per-file write
 * path below renders straight from zod and keeps every one.
 *
 * Recursive, because they sit on nested properties rather than at the root,
 * and applied after the `$defs` hoist so a hoisted definition is stripped too.
 */
const EDITOR_KEYWORDS = ['defaultSnippets', 'patternErrorMessage', 'enumDescriptions', 'markdownDescription', 'markdownEnumDescriptions']
function stripEditorKeywords<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripEditorKeywords) as unknown as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !EDITOR_KEYWORDS.includes(k))
      .map(([k, v]) => [k, stripEditorKeywords(v)]),
  ) as unknown as T
}

function componentSchemasRaw(name: string): Record<string, Record<string, unknown>> {
  const schema = exportedSchemas[name as keyof typeof exportedSchemas]
  const { $schema: _dropped, $defs, ...rest } = z.toJSONSchema(schema, { io: schemaIo(name) }) as Record<string, unknown>
  const defs = ($defs as Record<string, unknown> | undefined) ?? {}
  const rename = new Map(Object.keys(defs).map((d) => [`#/$defs/${d}`, `#/components/schemas/${name}--${d}`]))
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        k === '$ref' && typeof v === 'string' && rename.has(v) ? rename.get(v)! : rewrite(v),
      ]),
    )
  }
  const out: Record<string, Record<string, unknown>> = { [name]: rewrite(rest) as Record<string, unknown> }
  for (const [defName, def] of Object.entries(defs)) out[`${name}--${defName}`] = rewrite(def) as Record<string, unknown>
  return out
}

/** The same components, with the editor-only keywords removed — what OpenAPI gets. */
function componentSchemas(name: string): Record<string, Record<string, unknown>> {
  return stripEditorKeywords(componentSchemasRaw(name))
}

/** The component itself, for the one caller that reads a query schema's own `properties`. */
function componentSchema(name: string): Record<string, unknown> {
  return componentSchemas(name)[name]!
}

/**
 * The unstripped render of one component, exported for the test that proves the
 * strip is scoped to OpenAPI. Nothing in the export path calls it: the per-file
 * artifacts are written straight from `z.toJSONSchema` below, not from here.
 */
export function componentSchemaRaw(name: string): Record<string, unknown> {
  return componentSchemasRaw(name)[name]!
}

export function openApiDocument(): Record<string, any> {
  const artifact = routesArtifact()
  const paths: Record<string, Record<string, unknown>> = {}
  const components: Record<string, unknown> = { 'api-error': componentSchema('api-error') }
  for (const r of artifact.routes) {
    if (r.audience === 'internal' || r.transport !== 'http') continue
    const path = r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    const parameters: object[] = r.params.map((p) => ({ name: p.name, in: 'path', required: true, description: p.description, schema: { type: 'string' } }))
    if (r.query !== null) {
      const q = componentSchema(r.query)
      const required = new Set((q.required as string[] | undefined) ?? [])
      for (const [name, schema] of Object.entries((q.properties as Record<string, unknown>) ?? {})) {
        parameters.push({ name, in: 'query', required: required.has(name), schema })
      }
      // **The query schema itself is deliberately NOT registered as a
      // component.** Its properties are inlined into the parameters above, so
      // nothing in the document ever `$ref`s it — registering it produced
      // fifteen components (seven queries plus the definitions hoisted with
      // them) that no pointer reaches, which is exactly the shape of a
      // dangling name a reader cannot tell from a real one.
    }
    const operation: Record<string, unknown> = {
      operationId: `${r.method.toLowerCase()}_${r.path.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')}`,
      summary: r.summary,
      tags: [r.section],
      security: r.auth === 'in_handler' ? IN_HANDLER_SECURITY[`${r.method} ${r.path}`] ?? [] : SECURITY[r.auth as Exclude<RouteEntry['auth'], 'in_handler'>],
      parameters,
      responses: {
        // **`status` is not always a success.** Two routes exist to refuse —
        // the missing-asset placeholders, whose whole job is to say
        // `404 asset_missing` about a reference nothing resolves — and calling
        // that "Success." in a generated document would state something no
        // caller can ever observe. `routes.ts` declares the status the handler
        // actually answers; this says which of the two kinds it is.
        [String(r.status)]:
          r.status >= 400
            ? { description: 'The only answer this route gives; see the error codes below.' }
            : r.contentType !== undefined
              // **A route that answers bytes has no response schema, and
              // `{ description: 'Success.' }` alone reads as "no body".** Five
              // routes are in that position — the audit CSV, a camera frame,
              // two asset downloads and the URDF — so the media type the
              // manifest declares becomes the response's `content` key. The
              // schema is the OpenAPI spelling for "opaque bytes"; `text/csv`
              // is text, the other four are binary.
              ? { description: 'Success.', content: { [r.contentType]: { schema: r.contentType === 'text/csv' ? { type: 'string' } : { type: 'string', format: 'binary' } } } }
              : r.response === null
                ? { description: 'Success.' }
                : { description: 'Success.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${r.response}` } } } },
        default: {
          description: `An error envelope. Codes this route is known to answer: ${r.errors.map((c) => `\`${c}\``).join(', ') || 'none listed'}.`,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/api-error' } } },
        },
      },
    }
    // The path-token sentence leads, because it is the fact that changes what a
    // reader does: `security: []` on these two says "no scheme applies", and
    // without this it reads as "no credential needed" — the opposite.
    const pathToken = r.auth === 'in_handler' && (IN_HANDLER_SECURITY[`${r.method} ${r.path}`]?.length ?? 0) === 0
    const description = pathToken ? (r.notes === undefined ? PATH_TOKEN_NOTE : `${PATH_TOKEN_NOTE} ${r.notes}`) : r.notes
    if (description !== undefined) operation.description = description
    if (r.request !== null) {
      // A route whose handler reads `request.body ?? {}` accepts a missing body,
      // and `required: true` would document a refusal it does not make.
      operation.requestBody = {
        required: r.requestOptional !== true,
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${r.request}` } } },
      }
      Object.assign(components, componentSchemas(r.request))
    }
    if (r.response !== null) Object.assign(components, componentSchemas(r.response))
    ;(paths[path] ??= {})[r.method.toLowerCase()] = operation
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Fleetless API',
      version: '1',
      description:
        'Generated from the route manifest the cloud is tested against. Request and response shapes are the same JSON Schemas the platform validates with.',
    },
    servers: [{ url: 'https://api.fleetless.dev' }],
    tags: artifact.sections.map((s) => ({ name: s.id, description: s.title })),
    paths,
    components: {
      securitySchemes: {
        developerSession: { type: 'http', scheme: 'bearer', description: 'A developer session token from the console login.' },
        clientToken: { type: 'http', scheme: 'bearer', description: 'An end-user token from the client login or the hosted login.' },
        serverKey: { type: 'http', scheme: 'bearer', description: 'An app server key (`flk_…`).' },
      },
      // Code point, not `localeCompare`: that one's ordering depends on the
      // host's ICU data, so the same source could emit two different documents
      // on two machines and the staleness guard would call one of them stale.
      schemas: Object.fromEntries(Object.entries(components).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    },
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const dir = join(import.meta.dirname, '..', 'artifacts', 'schema')
  mkdirSync(dir, { recursive: true })
  for (const [name, schema] of Object.entries(exportedSchemas)) {
    // **Per-schema `io` mode — DEF-059, closed in W9d.** For four waves this
    // file emitted every artifact in zod's *output* mode, and recorded the
    // resulting contradiction in a comment rather than fixing it.
    //
    // Output mode describes what a value looks like **after** parsing, so a
    // `.default()`ed field is marked `required` — the artifact said a config
    // frame must carry `cameras`, while `robotConfigDoc` promises the opposite
    // and the bridge's runtime keeps that promise. Fifth instance by W6b, and
    // by then it had reached the handshake itself: `bridgeHello.active_jobs`
    // is `.default([])`, was published as `required`, and the bridge's own
    // vendored copy therefore disagreed with the contract about a **documented
    // absence**. Latent for this bridge, which always sends the key; real for
    // any other implementation.
    //
    // The blanket switch was never the fix, and measuring it is what showed
    // why: input mode across all 113 schemas is the correct description for a
    // frame a receiver must accept and **the wrong one for a response**, where
    // output mode states what the server will actually send. Relaxing those
    // would be a different lie in the other direction.
    //
    // So the mode is decided per schema, by direction, and the direction is
    // not a judgement call — it follows from who validates the document:
    //
    //   input   every socket frame, in both directions, because for each one
    //           there is a receiver that validates it against this artifact
    //           (which is the reason these files exist at all); every REST
    //           request body and query; and every shape embedded in one.
    //   output  every REST response, and every entity that only ever appears
    //           inside one.
    //
    // `SCHEMA_IO` below carries that decision for all 113, and the
    // exhaustiveness check underneath makes it structural rather than a note:
    // a schema added without a classification fails the export instead of
    // quietly inheriting output mode, which is exactly how this class survived
    // four waves.
    writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(z.toJSONSchema(schema, { io: schemaIo(name) }), null, 2) + '\n')
    console.log(`wrote ${name}.schema.json`)
  }
  const outgoingDir = join(import.meta.dirname, '..', 'artifacts', 'schema-outgoing')
  mkdirSync(outgoingDir, { recursive: true })
  for (const name of BRIDGE_SENT_SCHEMAS) {
    const schema = exportedSchemas[name as keyof typeof exportedSchemas]
    writeFileSync(join(outgoingDir, `${name}.schema.json`), JSON.stringify(z.toJSONSchema(schema, { io: 'output' }), null, 2) + '\n')
  }
  console.log(`wrote ${BRIDGE_SENT_SCHEMAS.length} outgoing (output-mode) schemas`)
  const constantsPath = join(import.meta.dirname, '..', 'artifacts', 'constants.json')
  writeFileSync(constantsPath, JSON.stringify(exportedConstants, null, 2) + '\n')
  console.log('wrote constants.json')

  writeFileSync(join(import.meta.dirname, '..', 'artifacts', 'routes.json'), JSON.stringify(routesArtifact(), null, 2) + '\n')
  console.log(`wrote routes.json (${ROUTES.length} routes)`)
  writeFileSync(join(import.meta.dirname, '..', 'artifacts', 'openapi.json'), JSON.stringify(openApiDocument(), null, 2) + '\n')
  console.log('wrote openapi.json')
}
