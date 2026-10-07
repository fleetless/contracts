// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * The three roles an operator assertion may name (fleetless/fleetless#268). The
 * cloud looks up which of them a route needs from `RouteEntry.operator`;
 * a role not listed here makes an assertion malformed (`401`).
 */
export const OPERATOR_ROLES = ['operator-admin', 'operator-finance', 'operator-support'] as const
export const operatorRole = z.enum(OPERATOR_ROLES)
export type OperatorRole = z.infer<typeof operatorRole>

/**
 * How the operator app confirms a command's execute (fleetless/fleetless#268).
 * Set only on command routes, never on a read.
 */
export const CONFIRMATION_LEVELS = ['click', 'second_click', 'type_to_confirm'] as const
export const confirmationLevel = z.enum(CONFIRMATION_LEVELS)
export type ConfirmationLevel = z.infer<typeof confirmationLevel>

/** The operator assertion's `iss` claim; the cloud refuses any other issuer. */
export const OPERATOR_ASSERTION_ISSUER = 'fleetless-operator'
/** The `Authorization` header scheme the assertion is sent with: `Authorization: Operator <jwt>`. */
export const OPERATOR_AUTH_SCHEME = 'Operator'
/** The longest `exp - iat` the cloud accepts; a longer-lived assertion is malformed (`401`). */
export const OPERATOR_ASSERTION_MAX_LIFETIME_SECONDS = 60
/** How far into the future `iat` may lie before the cloud refuses it as malformed (`401`). */
export const OPERATOR_ASSERTION_MAX_FUTURE_SKEW_SECONDS = 30
/** How long a `jti` is remembered to refuse a replay, in the cloud process's memory. */
export const OPERATOR_ASSERTION_REPLAY_WINDOW_SECONDS = 120
/** The shortest `reason` a command execute may send, after trimming. */
export const OPERATOR_REASON_MIN_LENGTH = 10
/** The longest `reason` a command execute may send. */
export const OPERATOR_REASON_MAX_LENGTH = 2000
/** How long a preview token stays valid before an execute against it answers `409 preview_stale`. */
export const OPERATOR_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000

/**
 * The claims of an operator assertion (fleetless/fleetless#268): an EdDSA JWT
 * naming the acting person and their roles. The cloud verifies the
 * signature against `OPERATOR_ASSERTION_KEYS` and this shape against the
 * claims before trusting any of it.
 */
export const operatorAssertionClaims = z.object({
  iss: z.literal(OPERATOR_ASSERTION_ISSUER),
  aud: z.string().min(1),
  sub: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.email().max(320),
  roles: z.array(operatorRole).max(OPERATOR_ROLES.length),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(16).max(128),
})
export type OperatorAssertionClaims = z.infer<typeof operatorAssertionClaims>
