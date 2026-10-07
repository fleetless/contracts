// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { orgPlan } from './plans.js'

/** The kinds `GET /api/admin/search` can answer, in S1 (fleetless/fleetless#268). A further kind joins the same union as its data arrives. */
export const ADMIN_SEARCH_KINDS = ['org', 'person', 'invoice', 'payment', 'robot'] as const
/** The most hits one search answers; past it, `truncated` says so. */
export const ADMIN_SEARCH_LIMIT = 50

export const adminSearchQuery = z.object({ q: z.string().trim().min(2).max(200) })
export type AdminSearchQuery = z.infer<typeof adminSearchQuery>

/**
 * One search result. `q` is matched literally, never as a wildcard pattern,
 * and case-insensitively. A `payment` hit's `payment_id` is `null` for a
 * `cst_` or `mdt_` match, which names the account and not a payment.
 */
export const adminSearchHit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('org'), org_id: z.uuid(), name: z.string() }),
  z.object({ kind: z.literal('person'), user_id: z.uuid(), email: z.string(), display_name: z.string().nullable(), org_id: z.uuid(), org_name: z.string() }),
  z.object({ kind: z.literal('invoice'), invoice_id: z.uuid(), number: z.string(), org_id: z.uuid().nullable(), org_name: z.string().nullable() }),
  z.object({ kind: z.literal('payment'), payment_id: z.uuid().nullable(), mollie_id: z.string(), matched: z.enum(['payment', 'customer', 'mandate', 'refund']), org_id: z.uuid(), org_name: z.string() }),
  z.object({ kind: z.literal('robot'), robot_id: z.uuid(), name: z.string(), org_id: z.uuid(), org_name: z.string() }),
])
export type AdminSearchHit = z.infer<typeof adminSearchHit>

export const adminSearchResponse = z.object({ hits: z.array(adminSearchHit).max(ADMIN_SEARCH_LIMIT), truncated: z.boolean() })
export type AdminSearchResponse = z.infer<typeof adminSearchResponse>

/**
 * `none` means no `billing_accounts` row; the other values mirror
 * `billingAccountStatus`. The payer, address and payment method never
 * appear here (§6, fleetless/fleetless#268): support may see exactly this
 * billing block, the status chip and next charge only.
 */
export const adminOrgBillingState = z.enum(['none', 'pending', 'active', 'past_due', 'canceled'])
export type AdminOrgBillingState = z.infer<typeof adminOrgBillingState>

/** `GET /api/admin/orgs/:id`'s response. Locks and plan changes travel in `plan`, which already carries them. */
export const adminOrgDetail = z.object({
  id: z.uuid(),
  name: z.string(),
  created_at: z.iso.datetime(),
  owner: z.object({ user_id: z.uuid(), email: z.string(), display_name: z.string().nullable() }).nullable(),
  plan: orgPlan,
  billing: z.object({ state: adminOrgBillingState, next_charge_at: z.iso.datetime().nullable() }),
  counts: z.object({ members: z.number().int().min(0), robots: z.number().int().min(0), robots_online: z.number().int().min(0), apps: z.number().int().min(0) }),
  last_activity_at: z.iso.datetime().nullable(),
})
export type AdminOrgDetail = z.infer<typeof adminOrgDetail>
