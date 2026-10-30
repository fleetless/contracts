// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/** HTTPS syntax only. The cloud checks resolved addresses, redirects and reachability. */
export const httpsLegalUrl = z.url().max(2048).regex(/^https:\/\/(?=[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?(?:[/?#]|$))[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::[0-9]{1,5})?(?:[/?#]|$)/).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}, { message: 'must be an absolute HTTPS URL without credentials' })

/** A permanent link to exactly one dated version of a legal document. */
export const legalDocumentReference = z.object({
  version: z.string().trim().min(1).max(80),
  version_date: z.iso.date(),
  url: httpsLegalUrl,
}).strict()
export type LegalDocumentReference = z.infer<typeof legalDocumentReference>

/** The DPA is null only in an acceptance context where it does not apply. */
export const legalTextReferences = z.object({
  terms: legalDocumentReference,
  dpa: legalDocumentReference.nullable(),
}).strict()
export type LegalTextReferences = z.infer<typeof legalTextReferences>

export const TERMS_VERSION = '1.0'
export const TERMS_VERSION_DATE = '2026-11-01'
export const TERMS_VERSION_URL = 'https://fleetless.dev/terms/v1.0/'

export const DPA_VERSION = '1.0'
export const DPA_VERSION_DATE = '2026-11-01'
export const DPA_VERSION_URL = 'https://fleetless.dev/dpa/v1.0/'
