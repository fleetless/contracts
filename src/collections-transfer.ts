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
 * and imports. Without `confirm`, the import route answers `200` with the
 * preview, as the preview route does, and imports nothing. With a `confirm`
 * that is not the token of the preview of exactly this import, because the
 * data changed in between so that the counts differ, or the token belongs to
 * another import, the answer is `409 confirmation_required` with the current
 * preview in `details.preview`. A file with errors answers its preview, with
 * `token: null`, whatever `confirm` says.
 *
 * The token stands for the file, the mapping, the references, the key, the
 * mode, the scope, `robot_id` and the counts, and for the records the import
 * would match, with their revisions, and the ones a mirror would delete. It is
 * not single-use: sending the confirmation of a keyless import again creates
 * its rows again, so a client that did not hear the answer to a first attempt
 * looks at the collection before it repeats one.
 *
 * **Every import goes through the same checks as single writes** (field
 * values, uniqueness, required fields, references, plan limits), and its
 * rows are written as revisions with the reason `import`.
 */

/** The most errors a preview lists; `errors_total` stays exact. */
const IMPORT_ERRORS_LISTED = 1000

const count = z.number().int().min(0)

const confirm = z
  .string()
  .min(1)
  .meta({
    description:
      'The `token` of the preview of exactly this import. Without it the import route answers the preview and imports nothing. A token that is not the one of the current preview, because the data moved on or it belongs to another import, is answered `409 confirmation_required` with the current preview in `details.preview`. A file with errors is never imported: its preview comes back with `token: null`, whatever `confirm` says.',
  })

/** What a mapping can send a column to: a field, the robot of the record, or nowhere. */
const mappingTarget = collectionKey.or(z.literal('')).meta({
  description: 'The key of the field the column is imported into, the literal `robot`, or an empty string to leave the column out.',
})

/**
 * The scope of a `mirror` import: the part of the collection in which records
 * that are missing from the file are deleted. A mirror without a scope covers
 * the whole collection.
 *
 * `{}` is not a scope: the cloud refuses it (`400 validation_error`, field
 * `scope`, rule `empty`), and so a scope on an import that is not a `mirror`
 * (rule `needs_mirror`). JSON Schema cannot express either rule, so the
 * artifact describes `scope` as an object with two optional keys.
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
      'Limits which records `mirror` may delete: those matching a filter, or those of one robot. Name exactly one of them: an empty `scope` is `400 validation_error` (rule `empty`), and so is a `scope` on an import that is not a `mirror` (rule `needs_mirror`). Without a scope the whole collection is mirrored, every robot\'s records included. `robot_id` of the request does not narrow a mirror; use `scope.robot_id`.',
  })

/**
 * An import, as a preview request and as the confirming request: the same body,
 * with `confirm` added the second time.
 *
 * `mode: 'mirror'` needs `key`, because records are matched to the file by it.
 * That is a rule across two fields, which JSON Schema cannot express, so the
 * published artifact describes both as independent and the cloud is the only
 * place that refuses the combination with a `400 validation_error`. It
 * refuses, in the same way, `key` and `mirror` on a `one_per_robot`
 * collection (rule `one_per_robot_is_automatic`) and a `robot_id` sent together
 * with a `robot` column in the file (rule `robot_column_present`).
 */
export const collectionImportRequest = z
  .object({
    format: z.enum(['csv', 'json']).meta({
      description:
        '`csv`: UTF-8 text with a header row, as in RFC 4180; a `json` field is written as JSON text in its cell. `json`: an array of objects, one per record.',
    }),
    content: z.string().max(COLLECTION_LIMITS.importBytes).meta({
      description: `The file as text, at most ${COLLECTION_LIMITS.importBytes.toLocaleString('en-US')} characters and as many bytes of UTF-8, and ${COLLECTION_LIMITS.importRows.toLocaleString('en-US')} rows (\`400 validation_error\`, rule \`too_large\` or \`too_many_rows\`; the latter is raised as soon as the 50,001st row is read, so it does not say how many there are). A byte order mark at the start of a JSON file is ignored.`,
    }),
    mapping: z.record(z.string(), mappingTarget).meta({
      description:
        'Where each column of the file goes, by the column name in the header (for JSON, the property name). A column that is not listed is imported into the field with the same key. A column named after a system field (`id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `revision`, `robot_id`) is left out unless it is mapped.',
    }).optional(),
    references: z.record(collectionKey, collectionKey).meta({
      description:
        'For each reference field, by its key: the unique field of the target collection that the values in its column identify, for example `name`. A reference field that is not listed takes record ids.',
    }).optional(),
    key: collectionKey.meta({
      description:
        'A unique field that matches rows to existing records: a row whose value is found updates that record, the rest create records. Without a key every row creates a record. A collection with one record per robot is only updated, matched by robot, takes no key and no mirror, and two rows for one robot are an error.',
    }).optional(),
    mode: z.enum(['upsert', 'mirror']).meta({
      description:
        '`upsert` (the default) creates and updates records. `mirror` also deletes the records of `scope` that are not in the file, and needs `key`. A mirror deletes at most 50,000 records, a file without rows is refused, and a deletion that a `prevent` reference blocks fails the whole import.',
    }).optional(),
    scope: importScope.optional(),
    robot_id: z.uuid().meta({
      description:
        'The robot every row belongs to, in a collection that belongs to robots, when the file has no `robot` column; sent together with a `robot` column it is refused (rule `robot_column_present`). It says which robot the rows are for and does not narrow a `mirror`: that is `scope.robot_id`.',
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
      description:
        'The row the problem is in, counted from 1 over the records of the file, so the header of a CSV is not counted. 0 marks a problem with the file as a whole, and a deletion of a `mirror` that a `prevent` reference blocks (the column is then the key column and the value the key of the record).',
    }),
    column: z
      .string()
      .max(COLLECTION_LIMITS.importErrorText)
      .meta({ description: 'The column as named in the file. Empty when the problem is not about one column. Cut to 200 characters, an ellipsis included.' }),
    value: z
      .string()
      .max(COLLECTION_LIMITS.importErrorText)
      .meta({ description: 'The value as found in the file, cut to 200 characters with an ellipsis (`…`) at the end when it was longer.' }),
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
      description:
        'Stands for exactly this import: send it as `confirm` to carry it out. Null while the file has errors. It is not single-use; see the note on the import routes.',
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
 *
 * The columns, in order: `robot` (the robot's name) first in a collection that
 * belongs to robots, then the fields, then with `system=true` the system
 * fields. A CSV cell, or a robot name, whose text starts with apostrophes and
 * then `=`, `+`, `-` or `@` (white space before one counts) gets one more
 * apostrophe, so that a spreadsheet does not read it as a formula; an import
 * takes exactly one off again, so an exported file imports to the same values.
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
          'How reference fields are written: `id` (the default) or the key of a unique field of the target collection, such as `name`, so that the file can be imported again. A reference field in the file whose target collection has no such unique field is `400 validation_error` (field `references`, rule `not_unique`); with no reference field among the columns the value is ignored.',
      })
      .optional(),
    system: z
      .enum(['true', 'false'])
      .meta({
        description:
          '`true` adds the system fields after the fields: `robot_id` in a collection that belongs to robots, then `id`, `created_at`, `created_by`, `updated_at`, `updated_by` and `revision`. `created_by` and `updated_by` are the actors\' labels. Default `false`.',
      })
      .optional(),
  })
  .strict()
export type CollectionExportQuery = z.infer<typeof collectionExportQuery>
