// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { legalDocumentReference } from './legal.js'
import { orgAddons } from './plans.js'
import { purchaseOperationKey } from './purchase-operation-key.js'
import { confirmationProof } from './confirmation-proof.js'

const utc = z.iso.datetime().regex(/Z$/)
const text = z.string().min(1).regex(/\S/)
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const proof = confirmationProof.regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
const cursorPayload = z.strictObject({ v: z.literal(1), created_at: utc, id: z.uuid() })
const cursor = z.string().min(1)
  .regex(/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$/)
  .refine(value => {
    try {
      const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
      const parsed = cursorPayload.safeParse(JSON.parse(bytes))
      return parsed.success && bytes === JSON.stringify({ v: parsed.data.v, created_at: parsed.data.created_at, id: parsed.data.id })
    } catch { return false }
  }, 'Cursor must encode canonical JSON with v, created_at and id in that order.')
  .meta({ description: 'Canonical unpadded base64url of UTF-8 JSON {v:1,created_at:UTC,id:UUID}, in that exact key order. Consumers must validate the decoded payload and organization scope; JSON Schema checks encoding syntax only.' })

export const legalOfferListQuery = z.strictObject({
  limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/).optional(),
  cursor: cursor.optional(),
})
export type LegalOfferListQuery = z.infer<typeof legalOfferListQuery>

const price = {
  plan: z.enum(['plus', 'pro']), cycle: z.enum(['monthly', 'yearly']), addons: orgAddons.strict(),
  current_net_cents: cents, offered_net_cents: cents,
  offered_period_start_at: utc, price_start_at: utc, currency: z.literal('eur'),
}
const summary = {
  id: z.uuid(), revision: z.uuid(), decision_state: z.enum(['open', 'declined', 'accepted', 'withdrawn']),
  organization_name: text, announced_at: utc.nullable(),
}
export const legalOfferSummary = z.discriminatedUnion('kind', [
  z.strictObject({ ...summary, kind: z.literal('terms'), current_terms: legalDocumentReference,
    proposed_terms: legalDocumentReference, published_at: utc, acceptance_deadline_at: utc,
    terms_access: z.enum(['pending', 'suspended', 'unrestricted']), summary: text }),
  z.strictObject({ ...summary, kind: z.literal('price'), ...price }),
])
export type LegalOfferSummary = z.infer<typeof legalOfferSummary>

export const legalOfferListResponse = z.strictObject({ offers: z.array(legalOfferSummary), next_cursor: cursor.nullable() })
export type LegalOfferListResponse = z.infer<typeof legalOfferListResponse>

export const legalOfferDisplayRequest = z.strictObject({ operation_key: purchaseOperationKey })
export type LegalOfferDisplayRequest = z.infer<typeof legalOfferDisplayRequest>
export const legalOfferDecisionRequest = z.strictObject({
  operation_key: purchaseOperationKey, decision: z.enum(['accept', 'decline']), confirmation_proof: proof,
})
export type LegalOfferDecisionRequest = z.infer<typeof legalOfferDecisionRequest>
export const legalOfferDecisionLookupQuery = z.strictObject({ operation_key: purchaseOperationKey })
export type LegalOfferDecisionLookupQuery = z.infer<typeof legalOfferDecisionLookupQuery>

const snapshot = {
  snapshot_id: z.uuid(), offer_id: z.uuid(), revision: z.uuid(), operation_key: purchaseOperationKey,
  owner_id: z.uuid(), organization_id: z.uuid(), organization_name: text,
  title: text, text, accept_label: text,
  current_terms: legalDocumentReference, dpa: z.null(), issued_at: utc, expires_at: utc,
}
const termsSnapshot = {
  ...snapshot, kind: z.literal('terms'), text_id: z.literal('DR-3032-2026-11-02-H.3-terms'),
  accept_label: z.literal('Accept'),
  proposed_terms: legalDocumentReference, published_at: utc, acceptance_deadline_at: utc,
  summary: text, read_changes_label: text,
}
/** Shape validation cannot prove the served wording, Owner, offer or state binding. */
export const legalOfferDecisionSnapshot = z.union([
  z.strictObject({ ...termsSnapshot, terms_access: z.literal('pending'), decline_label: z.literal('Decline') }),
  z.strictObject({ ...termsSnapshot, terms_access: z.literal('suspended'), decline_label: z.null() }),
  z.strictObject({ ...snapshot, kind: z.literal('price'), text_id: z.literal('DR-1374-draft-3-H.3-price'),
    decline_label: text, proposed_terms: z.null(), ...price, current_agreed_price_id: z.uuid(), offered_price_proposal_id: z.uuid() }),
]).superRefine((value, ctx) => {
  const lifetime = Date.parse(value.expires_at) - Date.parse(value.issued_at)
  if (lifetime <= 0 || lifetime > 600_000) ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'Display lifetime must be positive and at most ten minutes.' })
})
export type LegalOfferDecisionSnapshot = z.infer<typeof legalOfferDecisionSnapshot>

export const legalOfferDisplayResponse = z.strictObject({
  confirmation_proof: proof, expires_at: utc, snapshot: legalOfferDecisionSnapshot,
}).superRefine((value, ctx) => {
  if (value.expires_at !== value.snapshot.expires_at) ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'Display and snapshot expiry must match.' })
})
export type LegalOfferDisplayResponse = z.infer<typeof legalOfferDisplayResponse>

const result = { offer_id: z.uuid(), decision_id: z.uuid(), decided_at: utc, terms: legalDocumentReference, dpa: z.null() }
export const legalOfferDecisionResult = z.union([
  z.strictObject({ ...result, kind: z.literal('terms'), decision: z.literal('accept'), effective_at: utc, price_start_at: z.null(),
    terms_access: z.strictObject({ state: z.literal('unrestricted'), acceptance_deadline_at: utc }) }),
  z.strictObject({ ...result, kind: z.literal('terms'), decision: z.literal('decline'), effective_at: z.null(), price_start_at: z.null(),
    terms_access: z.strictObject({ state: z.literal('pending'), acceptance_deadline_at: utc }) }),
  z.strictObject({ ...result, kind: z.literal('price'), decision: z.literal('accept'), effective_at: z.null(), price_start_at: utc, terms_access: z.null() }),
  z.strictObject({ ...result, kind: z.literal('price'), decision: z.literal('decline'), effective_at: z.null(), price_start_at: z.null(), terms_access: z.null() }),
])
export type LegalOfferDecisionResult = z.infer<typeof legalOfferDecisionResult>

export const legalOfferConflictDetails = z.strictObject({
  field: z.enum(['offer', 'confirmation_proof', 'operation_key', 'period', 'term']),
  rule: z.enum(['withdrawn', 'stale', 'expired', 'reused', 'boundary_changed', 'deadline_unavailable']),
})
export type LegalOfferConflictDetails = z.infer<typeof legalOfferConflictDetails>
