// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/** Persist before the start request; reuse only for identical input within one org. */
export const purchaseOperationKey = z.uuid().meta({ description: 'Client-generated UUID persisted before the start request. Unique per org and reused only for identical input.' })
