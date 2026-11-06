// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { collectionBinding, collectionKey } from './collections.js'

/**
 * What a role may do with the records of one collection, as the published
 * schema's `access` rules resolve for it (inheritance between roles applied,
 * a key that names no role granting nothing). One row per collection of the
 * latest published version; it rides on the effective-rights answer
 * (`GET /api/apps/:id/effective-rights` and the console tool's
 * `effective_rights`) so the "view as role" page can show it beside the
 * robots, and nothing here can be edited.
 *
 * **`update` and `delete` say which records, not just whether.** A bare `true`
 * would hide the one distinction `access` exists to draw: `all` is every
 * record, `own` only those the app user created, `false` none. `read` and
 * `create` have no such scope. `create` is `false` on a `one_per_robot`
 * collection, whose records Fleetless creates itself, and so is `delete`,
 * which the API never does there.
 *
 * Developers and server keys always may do everything; this row is about an
 * app user holding the role, so it says nothing about them.
 */
const records = z.union([z.literal('all'), z.literal('own'), z.literal(false)])

export const roleCollectionRights = z
  .object({
    collection: collectionKey.meta({ description: 'The collection\'s key.' }),
    label: z.string().meta({ description: 'The collection\'s label for people to read; its key when the schema gives none.' }),
    binding: collectionBinding,
    read: z.boolean().meta({ description: 'Whether the role may read the records.' }),
    create: z.boolean().meta({ description: 'Whether the role may create records.' }),
    update: records.meta({
      description: '`all`: the role may change every record. `own`: only records its user created. `false`: none.',
    }),
    delete: records.meta({
      description: '`all`: the role may delete every record. `own`: only records its user created. `false`: none.',
    }),
    robot_filter: z.boolean().meta({
      description:
        '`true` on a collection that belongs to robots (`per_robot`, `one_per_robot`): the role sees and writes only the records of robots a session of the role reaches, whatever the rights above say. `false` on a `global` collection.',
    }),
  })
  .meta({ description: 'What one role may do with the records of one collection.' })
export type RoleCollectionRights = z.infer<typeof roleCollectionRights>
