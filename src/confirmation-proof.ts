// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/** Syntax only: Cloud verifies the stored proof binding and expiry. */
export const confirmationProof = z.string().regex(/^[A-Za-z0-9_-]{43}$/).meta({
  description: 'Opaque 32-byte Cloud proof, unpadded base64url. Syntax alone is not evidence.',
})
export type ConfirmationProof = z.infer<typeof confirmationProof>
