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
import { AUDIT_RETENTION_DAYS } from '../src/audit.js'
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
import { ASSET_UPLOAD_MAX_BYTES } from '../src/assets.js'
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
 */
const SCHEMA_IO_INPUT: readonly string[] = [
  // --- socket frames, bridge <-> cloud -------------------------------------
  // Both directions, because both ends validate what they receive.
  'bridge-hello', 'cloud-hello-ok', 'cloud-hello-error', 'cloud-ping', 'bridge-pong',
  'datapoint-frame', 'bridge-state', 'cloud-config', 'bridge-config-applied',
  'cloud-introspect-request', 'bridge-introspect', 'cloud-type-request', 'bridge-type-definitions',
  'cloud-camera-start', 'cloud-camera-stop', 'bridge-camera-state',
  'bridge-assets-available', 'cloud-asset-request', 'bridge-asset-progress',
  'cloud-invoke', 'cloud-cancel', 'cloud-publish', 'bridge-job-update', 'bridge-job-lost',

  // --- socket frames, client <-> cloud -------------------------------------
  'client-auth', 'auth-ok', 'auth-error', 'client-subscribe', 'client-unsubscribe',
  'subscribe-error', 'datapoint-event', 'resource-health-event', 'job-event',
  'client-invoke', 'client-cancel', 'client-publish', 'command-result', 'error-frame',

  // --- REST request bodies and queries -------------------------------------
  'create-robot-request', 'sign-up-request', 'developer-login-request',
  'create-invitation-request', 'accept-invitation-request', 'create-app-request',
  'client-login-request', 'client-refresh-request', 'client-logout-request',
  'credential-write-request', 'history-query', 'invoke-request', 'publish-request',
  'role-permissions', 'mcp-tool-preview',

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
  'mcp-tool-preview-response', 'asset', 'asset-list-response', 'asset-sync-status',
  'camera-list-response', 'live-session-response', 'snapshot-meta-response',
  'history-samples-response', 'history-buckets-response', 'org-quotas', 'org-quota-usage',
  'org-quota-usage-counts', 'credential-summary', 'credential-list-response',
  'robot-deletion-summary', 'resource-health-state', 'resource-health-list-response',
  'validation-issue', 'config-state', 'ros-graph', 'type-definition', 'robot',
  'create-robot-response', 'robot-list-item', 'robot-list-response', 'datapoint-value',
  'robot-detail-response', 'config-draft-response', 'publish-config-response',
  'introspection-response', 'datapoint-list-response', 'api-error', 'org', 'org-member',
  'session-tokens', 'sign-up-response', 'end-user', 'invitation', 'app', 'server-key',
  'create-server-key-response', 'role', 'app-membership', 'client-identity', 'audit-actor',
  'audit-event', 'audit-list-response', 'job', 'invoke-response', 'job-response',
  'exposure-list-response',
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
  const constantsPath = join(import.meta.dirname, '..', 'artifacts', 'constants.json')
  writeFileSync(constantsPath, JSON.stringify(exportedConstants, null, 2) + '\n')
  console.log('wrote constants.json')
}
