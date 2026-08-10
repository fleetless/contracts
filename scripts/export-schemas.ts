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
import { robotConfigDoc, datapointConfig, validationIssue, configState } from '../src/config.js'
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
  clientSubscribe,
  clientUnsubscribe,
  subscribeError,
  datapointEvent,
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
import { clientLoginRequest, clientRefreshRequest, clientIdentity } from '../src/client-auth.js'
import { auditActor, auditEvent, auditListResponse } from '../src/audit.js'

export const exportedSchemas = {
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
  'client-identity': clientIdentity,
  'audit-actor': auditActor,
  'audit-event': auditEvent,
  'audit-list-response': auditListResponse,
} as const

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const dir = join(import.meta.dirname, '..', 'artifacts', 'schema')
  mkdirSync(dir, { recursive: true })
  for (const [name, schema] of Object.entries(exportedSchemas)) {
    writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n')
    console.log(`wrote ${name}.schema.json`)
  }
}
