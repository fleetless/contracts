// SPDX-License-Identifier: Apache-2.0
import { z, type ZodType } from 'zod'
import { OPERATOR_REASON_MAX_LENGTH, OPERATOR_REASON_MIN_LENGTH } from './operator.js'

/**
 * One line of a command's preview (fleetless/fleetless#268): `changes`
 * moves a value from `from` to `to`, `triggers` sets something off (a mail,
 * a refund, a document), `keeps` states that something explicitly stays as
 * it is.
 */
export const previewEffect = z.object({
  kind: z.enum(['changes', 'triggers', 'keeps']).meta({ description: '`changes`: a value moves from `from` to `to`. `triggers`: something is set off (a mail, a refund, a document). `keeps`: something explicitly stays as it is.' }),
  label: z.string().min(1).max(300),
  from: z.string().max(300).nullable().optional(),
  to: z.string().max(300).nullable().optional(),
  amount_cents: z.number().int().optional(),
})
export type PreviewEffect = z.infer<typeof previewEffect>

/** What a command's preview answers before an execute: at least one effect. */
export const operatorPreview = z.object({ effects: z.array(previewEffect).min(1).max(50) })
export type OperatorPreview = z.infer<typeof operatorPreview>

const reason = z.string().trim().min(OPERATOR_REASON_MIN_LENGTH).max(OPERATOR_REASON_MAX_LENGTH)

/**
 * The request body of an operator command, parameterised over its own
 * input shape: a `preview` that only reads, or an `execute` that carries the
 * reason, the preview it confirms and a replay key (fleetless/fleetless#268).
 */
export function operatorCommandRequest<I extends ZodType>(input: I) {
  return z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('preview'), input }),
    z.object({ mode: z.literal('execute'), input, reason, preview_token: z.string().min(1).max(512), idempotency_key: z.uuid() }),
  ])
}

/** The audit rows a command's execute wrote: the operator audit always, the org's audit when the command named one. */
export const operatorAuditRef = z.object({ operator_audit: z.uuid(), org_audit: z.uuid().nullable() })
export type OperatorAuditRef = z.infer<typeof operatorAuditRef>

/**
 * The response of an operator command, parameterised over its preview and
 * result shapes: a preview mode answers `preview` and a token to confirm it
 * with; an execute answers `result` and the audit rows it wrote.
 */
export function operatorCommandResponse<P extends ZodType, R extends ZodType>(preview: P, result: R) {
  return z.union([
    z.object({ preview, preview_token: z.string().min(1) }),
    z.object({ result, audit_ref: operatorAuditRef }),
  ])
}

/** `409 preview_stale`'s `details`: a fresh preview and its token, to confirm instead. */
export const previewStaleDetails = z.object({ preview: operatorPreview, preview_token: z.string().min(1) })
export type PreviewStaleDetails = z.infer<typeof previewStaleDetails>

/** The no-op command's input: the org whose audit the row proves the protocol against. */
export const noopCommandInput = z.object({ org_id: z.uuid() })
export type NoopCommandInput = z.infer<typeof noopCommandInput>
/** The no-op command's result: it changes nothing, always. */
export const noopCommandResult = z.object({ changed: z.literal(false) })
export type NoopCommandResult = z.infer<typeof noopCommandResult>
export const noopCommandRequest = operatorCommandRequest(noopCommandInput)
export const noopCommandResponse = operatorCommandResponse(operatorPreview, noopCommandResult)
