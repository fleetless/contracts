// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { COLLECTION_LIMITS, collectionKey } from './collections.js'
import { collectionFilter, collectionRecordListQuery } from './collections-records.js'

/**
 * Getting records into and out of a collection in bulk: a CSV or JSON file in,
 * a CSV or JSON file out.
 *
 * **An import is all or nothing.** One invalid row, a reference that cannot be
 * resolved, a plan limit that would be exceeded or a deletion that a `prevent`
 * reference blocks fails the whole file, and nothing is written. The same
 * request is made twice: the first time (or the `…/import/preview` route)
 * answers a preview, the second carries the preview's `token` as `confirm`
 * and imports. If the data changed in between so that the counts differ, the
 * token no longer matches and the answer is `409 confirmation_required` with
 * the current preview.
 */

/** The most errors a preview lists; `errors_total` stays exact. */
const IMPORT_ERRORS_LISTED = 1000

const count = z.number().int().min(0)

const confirm = z
  .string()
  .min(1)
  .meta({
    description:
      'The `token` of the preview of exactly this import. A missing or outdated token is answered with `confirmation_required` and the current preview.',
  })

/** What a mapping can send a column to: a field, the robot of the record, or nowhere. */
const mappingTarget = collectionKey.or(z.literal('')).meta({
  description: 'The key of the field the column is imported into, the literal `robot`, or an empty string to leave the column out.',
})

/**
 * The scope of a `mirror` import: the part of the collection in which records
 * that are missing from the file are deleted. A mirror without a scope covers
 * the whole collection.
 */
const importScope = z
  .object({
    filter: collectionFilter
      .meta({ description: 'Only records matching this filter can be deleted. The same filter object that record lists take as JSON text.' })
      .optional(),
    robot_id: z.uuid().meta({ description: 'Only records of this robot can be deleted.' }).optional(),
  })
  .strict()
  .refine((scope) => !(scope.filter !== undefined && scope.robot_id !== undefined), {
    message: 'A scope is a filter or a robot, not both',
    path: ['robot_id'],
  })
  .meta({
    description:
      'Limits which records `mirror` may delete: those matching a filter, or those of one robot. Name one of them. Without a scope the whole collection is mirrored.',
  })

/**
 * An import, as a preview request and as the confirming request: the same body,
 * with `confirm` added the second time.
 *
 * `mode: 'mirror'` needs `key`, because records are matched to the file by it.
 * That is a rule across two fields, which JSON Schema cannot express, so the
 * published artifact describes both as independent and the cloud is the only
 * place that refuses the combination with a `400 validation_error`.
 */
export const collectionImportRequest = z
  .object({
    format: z.enum(['csv', 'json']).meta({
      description:
        '`csv`: UTF-8 text with a header row, as in RFC 4180; a `json` field is written as JSON text in its cell. `json`: an array of objects, one per record.',
    }),
    content: z.string().max(COLLECTION_LIMITS.importBytes).meta({
      description: `The file as text, at most ${COLLECTION_LIMITS.importBytes.toLocaleString('en-US')} characters and ${COLLECTION_LIMITS.importRows.toLocaleString('en-US')} rows.`,
    }),
    mapping: z.record(z.string(), mappingTarget).meta({
      description:
        'Where each column of the file goes, by the column name in the header (for JSON, the property name). A column that is not listed is imported into the field with the same key.',
    }).optional(),
    references: z.record(collectionKey, collectionKey).meta({
      description:
        'For each reference field, by its key: the unique field of the target collection that the values in its column identify, for example `name`. A reference field that is not listed takes record ids.',
    }).optional(),
    key: collectionKey.meta({
      description:
        'A unique field that matches rows to existing records: a row whose value is found updates that record, the rest create records. Without a key every row creates a record. A collection with one record per robot is only updated, matched by robot, and needs no key.',
    }).optional(),
    mode: z.enum(['upsert', 'mirror']).meta({
      description:
        '`upsert` (the default) creates and updates records. `mirror` also deletes the records of `scope` that are not in the file, and needs `key`.',
    }).optional(),
    scope: importScope.optional(),
    robot_id: z.uuid().meta({
      description: 'The robot every row belongs to, in a collection that belongs to robots, when the file has no `robot` column.',
    }).optional(),
    confirm: confirm.optional(),
  })
  .strict()
  .refine((request) => request.mode !== 'mirror' || request.key !== undefined, {
    message: 'Mode "mirror" needs a key: records are matched to the file by it',
    path: ['key'],
  })
  .meta({ description: 'Imports a file of records into a collection, all or nothing.' })
export type CollectionImportRequest = z.infer<typeof collectionImportRequest>

/** One thing wrong with the file. */
const importError = z
  .object({
    row: count.meta({
      description: 'The row the problem is in, counted from 1 over the records of the file, so the header of a CSV is not counted. 0 marks a problem with the file as a whole.',
    }),
    column: z.string().meta({ description: 'The column as named in the file. Empty when the problem is not about one column.' }),
    value: z.string().meta({ description: 'The value as found in the file.' }),
    reason: z.string().min(1).meta({ description: 'What is wrong with it, in words.' }),
  })
  .meta({ description: 'A row, column and value that stop the import, with the reason.' })

/**
 * What an import would do. `token` is present exactly when the file has no
 * errors, since a file with errors cannot be imported and so needs no
 * confirmation.
 */
export const collectionImportPreview = z
  .object({
    counts: z
      .object({
        unchanged: count.meta({ description: 'Rows that match a record that already has these values.' }),
        new: count.meta({ description: 'Records that would be created.' }),
        updated: count.meta({ description: 'Records that would change.' }),
        deleted: count.meta({ description: 'Records that `mirror` would delete.' }),
        errors: count.meta({ description: 'Problems found in the file. The same number as `errors_total`.' }),
      })
      .meta({ description: 'What the import would do, counted.' }),
    errors: z.array(importError).max(IMPORT_ERRORS_LISTED).meta({
      description: `The problems found, in file order, at most ${IMPORT_ERRORS_LISTED.toLocaleString('en-US')}; \`errors_total\` is the exact number.`,
    }),
    errors_total: count.meta({ description: 'The exact number of problems found.' }),
    mirror_scope: z.enum(['collection', 'filter', 'robot']).nullable().meta({
      description:
        'Where `mirror` would delete records: `collection` is every record of the collection, which the preview should say prominently; `filter` and `robot` are the scope that was sent. Null when the mode is not `mirror`.',
    }),
    warnings: z.array(z.enum(['plan_limit'])).meta({
      description: '`plan_limit`: importing the file would take the organization over a limit of its plan, so the import itself would be refused.',
    }),
    token: z.string().min(1).nullable().meta({
      description: 'Stands for exactly this import: send it as `confirm` to carry it out. Null while the file has errors.',
    }),
  })
  .meta({ description: 'The preview of an import: what it would do, the problems that stop it and the token that confirms it.' })
export type CollectionImportPreview = z.infer<typeof collectionImportPreview>

export const collectionImportResult = z
  .object({
    created: count.meta({ description: 'Records created.' }),
    updated: count.meta({ description: 'Records changed.' }),
    deleted: count.meta({ description: 'Records deleted by `mirror`.' }),
    unchanged: count.meta({ description: 'Rows that matched a record that already had these values.' }),
  })
  .meta({ description: 'What an import did.' })
export type CollectionImportResult = z.infer<typeof collectionImportResult>

/**
 * The query string of an export. The filter, search and sort are those of the
 * record list, so a file contains what the list showed.
 */
export const collectionExportQuery = z
  .object({
    format: z.enum(['csv', 'json']).meta({ description: '`csv`: UTF-8 text with a header row. `json`: an array of objects.' }),
    // The same four parameters, in the same words, as the record list they narrow down.
    ...collectionRecordListQuery.pick({ filter: true, search: true, sort: true, robot: true }).shape,
    fields: z
      .string()
      .min(1)
      .meta({ description: 'The fields to export by key, separated by commas, in the order given. Default: all fields, in the order of the schema.' })
      .optional(),
    references: z
      .string()
      .min(1)
      .meta({
        description:
          'How reference fields are written: `id` (the default) or the key of a unique field of the target collection, such as `name`, so that the file can be imported again.',
      })
      .optional(),
    system: z
      .enum(['true', 'false'])
      .meta({
        description:
          '`true` adds the system fields `id`, `created_at`, `created_by`, `updated_at`, `updated_by` and `revision`, and `robot_id` in a collection that belongs to robots. Default `false`.',
      })
      .optional(),
  })
  .strict()
export type CollectionExportQuery = z.infer<typeof collectionExportQuery>
