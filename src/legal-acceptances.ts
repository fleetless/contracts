// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { legalDocumentReference } from './legal.js'

/** The cloud decodes the canonical [accepted_at, id] token; this checks its wire syntax. */
const legalAcceptanceCursor = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/)

export const legalAcceptanceListQuery = z.object({
  limit: z.union([z.string().regex(/^(?:0{0,2}[1-9]|0?[1-9][0-9]|100)$/), z.number().int().min(1).max(100)])
    .transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  cursor: legalAcceptanceCursor.optional(),
}).strict()
export type LegalAcceptanceListQuery = z.infer<typeof legalAcceptanceListQuery>

export const legalAcceptanceVersionRow = z.object({
  id: z.uuid(),
  context: z.enum(['registration', 'invitation', 'order', 'existing_org']),
  accepted_at: z.iso.datetime({ precision: 6 }),
  text_id: z.string().min(1).max(80).regex(/\S/),
  terms: legalDocumentReference,
  dpa: legalDocumentReference.nullable(),
}).strict()
export type LegalAcceptanceVersionRow = z.infer<typeof legalAcceptanceVersionRow>

export const legalAcceptanceListResponse = z.object({
  acceptances: z.array(legalAcceptanceVersionRow),
  next_cursor: legalAcceptanceCursor.nullable(),
}).strict()
export type LegalAcceptanceListResponse = z.infer<typeof legalAcceptanceListResponse>
