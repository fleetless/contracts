// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * The `details` of a `413 file_too_large` refusal (2026-10-03,
 * fleetless/fleetless#136): one file is larger than `ASSET_FILE_MAX_BYTES`.
 * Not a store and not a plan limit — those are `409 plan_limit` and
 * `409 quota_exceeded`, and mean only "the store is full". `size_bytes` is
 * the file's size: the announced one when the refusal came before the body
 * was read, or the bytes that arrived when no size (or a false one) was
 * announced and the body still fit the server's body limit. It is `null` only
 * when the body limit stopped the upload, because then nobody counted the
 * bytes.
 */
export const fileTooLargeDetails = z.object({
  max_bytes: z.number().int().positive().meta({
    description: 'The most one asset file can be, in bytes: `ASSET_FILE_MAX_BYTES`, the same on every plan.',
  }),
  size_bytes: z.number().int().positive().nullable().meta({
    description: 'The refused file\'s size, in bytes: the announced size, or the bytes that arrived when none (or a false one) was announced; `null` only when the body limit stopped the upload and nobody counted the bytes.',
  }),
})
export type FileTooLargeDetails = z.infer<typeof fileTooLargeDetails>
