// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/** Customer-confirmed controller details, independent of invoice data. */
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^\P{Cc}*$/u)
const email = z.email().max(320)

export const controllerRegisterAddress = z.object({
  line1: text(200),
  line2: text(200).nullable(),
  postalCode: text(32),
  city: text(120),
  country: z.string().regex(/^[A-Z]{2}$/),
}).strict()

export const controllerRegisterPrivacyContact = z.object({
  name: text(200), email, role: z.enum(['general', 'appointed_dpo']),
}).strict()

export const controllerRegisterRepresentative = z.object({
  name: text(200), email, address: text(500),
}).strict()

/** PUT replaces the whole confirmed record; null explicitly clears an optional contact. */
export const controllerRegisterWrite = z.object({
  legalName: text(200),
  address: controllerRegisterAddress,
  privacyContact: controllerRegisterPrivacyContact.nullable(),
  euRepresentative: controllerRegisterRepresentative.nullable(),
  confirmationSource: text(500),
}).strict()

/** A legacy record can exist before every required field was confirmed. */
export const controllerRegisterOrgRecord = controllerRegisterWrite.extend({
  legalName: text(200).nullable(),
  address: controllerRegisterAddress.nullable(),
  updatedAt: z.iso.datetime(),
  updatedByKind: z.enum(['owner', 'operator']),
  updatedById: z.uuid(),
}).strict()

export const controllerRegisterOrgResponse = z.object({
  orgId: z.uuid(),
  details: controllerRegisterOrgRecord.nullable(),
}).strict()

export type ControllerRegisterWrite = z.infer<typeof controllerRegisterWrite>
export type ControllerRegisterOrgResponse = z.infer<typeof controllerRegisterOrgResponse>
