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
import {
  bridgeHello,
  cloudHelloOk,
  cloudHelloError,
  cloudPing,
  bridgePong,
  datapointFrame,
  bridgeState,
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
import {
  cameraListResponse,
  liveSessionResponse,
  snapshotMetaResponse,
} from '../src/rest.js'
import { robotConfigDoc, datapointConfig, validationIssue, configState, cameraSource } from '../src/config.js'
import { rosGraph, typeDefinition } from '../src/introspection.js'
import {
  robot,
  createRobotRequest,
  createRobotResponse,
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
} from '../src/realtime.js'
import { apiError } from '../src/errors.js'
import {
  org,
  orgMember,
  sessionTokens,
  signUpRequest,
  signUpResponse,
  developerLoginRequest,
  endUser,
  invitation,
  createInvitationRequest,
  acceptInvitationRequest,
} from '../src/identity.js'
import {
  app,
  createAppRequest,
  serverKey,
  createServerKeyResponse,
  role,
  rolePermissions,
  appMembership,
} from '../src/apps.js'
import {
  clientLoginRequest,
  clientRefreshRequest,
  clientLogoutRequest,
  clientIdentity,
} from '../src/client-auth.js'
import { auditActor, auditEvent, auditListResponse } from '../src/audit.js'
import { job, jobEvent } from '../src/jobs.js'
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
import { mcpToolPreview, mcpToolPreviewResponse } from '../src/mcp.js'
import { ASSET_UPLOAD_HEADERS, SNAPSHOT_HEADERS } from '../src/rest.js'
import { invokeRequest, invokeResponse, publishRequest, jobResponse, exposureListResponse } from '../src/rest.js'
import {
  historyQuery,
  historySamplesResponse,
  historyBucketsResponse,
  orgQuotas,
  orgQuotaUsage,
  orgQuotaUsageCounts,
  credentialSummary,
  credentialListResponse,
  credentialWriteRequest,
  robotDeletionSummary,
  resourceHealthState,
  resourceHealthListResponse,
} from '../src/rest.js'

export const exportedSchemas = {
  // W7c — the MCP server. REST-only shapes: the bridge has no MCP surface at
  // all, so these are here for the same reason the other REST responses are —
  // "every wire schema", one map, no second place to look.
  'mcp-tool-preview': mcpToolPreview,
  'mcp-tool-preview-response': mcpToolPreviewResponse,
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
  // W6 — retention, history, quotas, credentials, camera sources.
  'camera-source': cameraSource,
  'history-query': historyQuery,
  'history-samples-response': historySamplesResponse,
  'history-buckets-response': historyBucketsResponse,
  'org-quotas': orgQuotas,
  'org-quota-usage': orgQuotaUsage,
  'org-quota-usage-counts': orgQuotaUsageCounts,
  'credential-summary': credentialSummary,
  'credential-list-response': credentialListResponse,
  'credential-write-request': credentialWriteRequest,
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
  'cloud-config': cloudConfig,
  'bridge-config-applied': bridgeConfigApplied,
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
  'api-error': apiError,
  org: org,
  'org-member': orgMember,
  'session-tokens': sessionTokens,
  'sign-up-request': signUpRequest,
  'sign-up-response': signUpResponse,
  'developer-login-request': developerLoginRequest,
  'end-user': endUser,
  invitation: invitation,
  'create-invitation-request': createInvitationRequest,
  'accept-invitation-request': acceptInvitationRequest,
  app: app,
  'create-app-request': createAppRequest,
  'server-key': serverKey,
  'create-server-key-response': createServerKeyResponse,
  role: role,
  'role-permissions': rolePermissions,
  'app-membership': appMembership,
  'client-login-request': clientLoginRequest,
  'client-refresh-request': clientRefreshRequest,
  'client-logout-request': clientLogoutRequest,
  'client-identity': clientIdentity,
  'audit-actor': auditActor,
  'audit-event': auditEvent,
  'audit-list-response': auditListResponse,
  job: job,
  'job-event': jobEvent,
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
  ASSET_UPLOAD_HEADERS,
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const dir = join(import.meta.dirname, '..', 'artifacts', 'schema')
  mkdirSync(dir, { recursive: true })
  for (const [name, schema] of Object.entries(exportedSchemas)) {
    // KNOWN CONTRADICTION, deferred to W6 with the fix already identified.
    //
    // Output mode marks a `.default()`ed field as *required*, because after
    // parsing it is always present. So the published schema says a config
    // frame must carry `cameras` (and the W4 kinds), while the source of
    // truth in `robotConfigDoc` promises the opposite and the bridge's own
    // runtime agrees with the promise, not the artifact. Fourth time
    // `.default()` has been mistaken for optionality in this project.
    //
    // `z.toJSONSchema(schema, { io: 'input' })` fixes THIS class — verified:
    // the config doc's `required` drops from all five kinds to `['datapoints']`.
    //
    // It does NOT fix every artifact/source disagreement, and an earlier
    // version of this comment implied it did. Measured (W6, Momus 10):
    // `historyQuery.limit` is `z.coerce.number()`, and both modes render it
    // identically as `{"type":"integer", ...}` —
    //
    //     output: {"type":"integer","exclusiveMinimum":0,"maximum":10000}
    //     input : {"type":"integer","exclusiveMinimum":0,"maximum":10000}
    //
    // — because zod renders a coercion's *result* type in either direction.
    // So the published artifact describes a shape a query string can never
    // carry, and anyone validating a real request against it rejects every
    // one that sets `limit`. Coercion needs a different fix from optionality:
    // an explicit `z.union([...]).pipe(...)` whose input branch IS the wire.
    // Left alone deliberately at the W6 boundary — nothing validates against
    // this artifact today, and the change alters parsing semantics and forces
    // a re-pin across four repos. Registered in DEFERRALS.md, W7.
    //
    // Same file, same class, smaller: the artifact publishes
    // `"additionalProperties": false` while the route accepts and strips
    // unknown query params (`?from=now-1m&bogus=1` → 200).
    // It is NOT applied yet because applying it here applies it to every
    // schema, including responses, where output mode is the correct
    // description: a response schema states what the server will send, and
    // relaxing it would be a different lie in the other direction. Measured
    // blast radius of the blanket switch: 90 artifacts, 436 deletions.
    // The real fix is per-schema — input mode for frames a receiver must
    // accept, output mode for responses — which is a judgement call over
    // ~60 schemas plus a re-vendor and a re-pin across four repos. That is
    // not work to do at a wave boundary with blockers in flight, and nothing
    // bites today because the cloud only ever sends a parsed document with
    // its defaults already applied.
    writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n')
    console.log(`wrote ${name}.schema.json`)
  }
  const constantsPath = join(import.meta.dirname, '..', 'artifacts', 'constants.json')
  writeFileSync(constantsPath, JSON.stringify(exportedConstants, null, 2) + '\n')
  console.log('wrote constants.json')
}
