// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { COLLECTION_LIMITS, collectionBinding, collectionKey, collectionsDocument } from './collections.js'
import { collectionsIssue } from './collections-issues.js'
import { collectionActor } from './collections-records.js'

/**
 * The life of an app's schema on the wire: the draft a developer edits, the
 * preview of what publishing it would do to existing data, publish, the
 * versions that result, restoring one of them, and the owner's purge of old
 * history.
 *
 * **One confirmation flow runs through all of it.** A change that would alter
 * or remove data is never applied on the first request. The preview lists what
 * would happen (`effects`) and a `token` that stands for exactly that list; the
 * confirming request sends the token back as `confirm`. If the data changed in
 * between, so that the effects differ, the token no longer matches and the
 * answer is `409 confirmation_required` carrying the current preview, which the
 * caller confirms again. A request that would change nothing needs no token,
 * and its preview says so with `token: null`. Purge always needs one.
 */

const timestamp = z.iso.datetime()
const count = z.number().int().min(0)
const schemaVersion = z.number().int().min(1)

/** The most records a `unique_discarded` effect lists; `total` stays exact. */
const UNIQUE_DISCARDED_LISTED = 1000

const token = z.string().min(1)
const confirm = token.meta({
  description: 'The `token` of the preview of exactly this request. Needed when the preview lists effects; a missing or outdated token is answered with `confirmation_required` and the current preview.',
})

const collection = collectionKey.meta({ description: 'The key of the collection.' })
const field = collectionKey.meta({ description: 'The key of the field.' })

/**
 * One thing a publish or a restore does to data that already exists. Effects
 * that would change nothing are not listed, so an empty list means the change
 * touches no data. They are matched by key only: a renamed collection or field
 * is a removal plus an addition.
 */
export const collectionsEffect = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('collection_removed'),
        collection,
        records: count.meta({ description: 'Records deleted with the collection.' }),
      })
      .strict()
      .meta({ description: 'The collection is gone from the document, so its records are deleted.' }),
    z
      .object({
        kind: z.literal('collection_recreated'),
        collection,
        records: count.meta({ description: 'Records deleted by the re-creation.' }),
        from: collectionBinding,
        to: collectionBinding,
      })
      .strict()
      .meta({ description: 'The binding of the collection changed, which deletes its records and starts the collection again.' }),
    z
      .object({
        kind: z.literal('records_created'),
        collection,
        count: count.meta({ description: 'Records created, one for each robot attached to the app.' }),
      })
      .strict()
      .meta({ description: 'A collection with one record per robot got the records of the robots that have none.' }),
    z
      .object({
        kind: z.literal('field_removed'),
        collection,
        field,
        values: count.meta({ description: 'Values removed from records.' }),
      })
      .strict()
      .meta({ description: 'The field is gone from the document, so its values are removed from the records.' }),
    z
      .object({
        kind: z.literal('defaults_filled'),
        collection,
        field,
        records: count.meta({ description: 'Records that receive the default.' }),
      })
      .strict()
      .meta({ description: 'Records without a value get the default of a new or newly required field.' }),
    z
      .object({
        kind: z.literal('values_converted'),
        collection,
        field,
        converted: count.meta({ description: 'Values that became a value of the new type.' }),
        discarded: count.meta({ description: 'Values that could not be converted and were removed.' }),
      })
      .strict()
      .meta({ description: 'The type of the field changed: values are converted where the conversion rules allow it and removed where they do not.' }),
    z
      .object({
        kind: z.literal('values_discarded'),
        collection,
        field,
        reason: z.enum(['reference_target_changed', 'option_removed', 'constraint']).meta({
          description: '`reference_target_changed`: the field points at another collection now. `option_removed`: a select option is gone. `constraint`: a limit such as `max_length`, `pattern`, `min`, `max`, `integer` or the JSON schema now excludes the value.',
        }),
        values: count.meta({ description: 'Values removed from records.' }),
      })
      .strict()
      .meta({ description: 'Values that the changed field no longer accepts are removed.' }),
    z
      .object({
        kind: z.literal('unique_discarded'),
        collection,
        field,
        total: count.meta({ description: 'The exact number of values removed.' }),
        records: z
          .array(
            z
              .object({
                id: z.uuid(),
                display: z.string().meta({ description: 'The record\'s display text.' }),
                value: z.unknown().meta({ description: 'The value the record loses.' }),
              })
              .strict(),
          )
          .max(UNIQUE_DISCARDED_LISTED)
          .meta({ description: `The records that lose their value, at most ${UNIQUE_DISCARDED_LISTED}; \`total\` is the exact number.` }),
      })
      .strict()
      .meta({
        description:
          'The field became unique, or unique across a wider scope, and records share a value: the record created first keeps it and the others lose it.',
      }),
    z
      .object({
        kind: z.literal('required_left_empty'),
        collection,
        field,
        records: count.meta({ description: 'Records left without a value.' }),
      })
      .strict()
      .meta({ description: 'The field is required now and these records have no value and no default to fill in; they stay updatable in their other fields.' }),
    z
      .object({
        kind: z.literal('references_cleared'),
        collection,
        field,
        values: count.meta({ description: 'References removed.' }),
      })
      .strict()
      .meta({ description: 'References that pointed at records deleted by this change are cleared.' }),
  ])
  .meta({ description: 'One effect of a publish or restore on existing data. Effects that would change nothing are not listed.' })
export type CollectionsEffect = z.infer<typeof collectionsEffect>

/** A change to who may do what, shown with a preview as information; it needs no confirmation. */
export const collectionsAccessChange = z
  .object({
    collection,
    action: z.enum(['read', 'create', 'update', 'delete']),
    from: z.unknown().meta({ description: 'The access before, as written in the document. `null` means nobody.' }),
    to: z.unknown().meta({ description: 'The access after, as written in the document. `null` means nobody.' }),
  })
  .meta({ description: 'A change of the roles that may do one thing with the records of a collection. Information only; it does not need confirming.' })
export type CollectionsAccessChange = z.infer<typeof collectionsAccessChange>

/** What publishing the draft would do. */
export const collectionsSchemaPreview = z
  .object({
    from_version: schemaVersion.nullable().meta({ description: 'The version that is published now. Null before the first publish.' }),
    to_version: schemaVersion.meta({ description: 'The number the new version would get.' }),
    valid: z.boolean().meta({ description: 'False when the draft has errors; it cannot be published and no effects are computed.' }),
    issues: z.array(collectionsIssue).meta({ description: 'Everything found in the draft: errors that block publishing, warnings and information.' }),
    effects: z.array(collectionsEffect).meta({ description: 'What would happen to existing data, computed against the data as it is now.' }),
    access_changes: z.array(collectionsAccessChange),
    token: z.string().nullable().meta({
      description: 'Stands for exactly this list of effects: send it as `confirm` when publishing. Null when there are no effects, since publishing then needs no confirmation.',
    }),
  })
  .meta({ description: 'The preview of publishing the draft: its problems, its effects on existing data and the token that confirms them.' })
export type CollectionsSchemaPreview = z.infer<typeof collectionsSchemaPreview>

/**
 * The draft. `source` is the text the developer edits: the saved draft, else
 * the text of the current version, else empty before anything was published.
 * `updated_at: null` says no draft is saved and the text is the version's.
 */
export const collectionsDraftResponse = z
  .object({
    source: z.string().meta({ description: 'The document as text. The saved draft; without one, the published version\'s text; before the first publish, empty.' }),
    doc: collectionsDocument.nullable().meta({ description: 'The document the source parses to. Null when the source is empty.' }),
    updated_at: timestamp.nullable().meta({ description: 'When the draft was saved. Null when no draft is saved.' }),
    updated_by: collectionActor.nullable().meta({ description: 'Who saved the draft. Null when no draft is saved.' }),
    issues: z.array(collectionsIssue).meta({ description: 'Warnings and information about the document. A draft is saved only when it has no errors.' }),
  })
  .meta({ description: 'The draft of the schema document, or the current version when there is no draft.' })
export type CollectionsDraftResponse = z.infer<typeof collectionsDraftResponse>

export const putCollectionsDraftRequest = z
  .object({
    source: z.string().max(COLLECTION_LIMITS.schemaSourceBytes).meta({
      description: `The whole document as YAML or JSON text, at most ${COLLECTION_LIMITS.schemaSourceBytes.toLocaleString('en-US')} characters. It replaces the draft and is refused with the problems found if it is not valid.`,
    }),
  })
  .strict()
  .meta({ description: 'Replaces the draft with a whole document.' })
export type PutCollectionsDraftRequest = z.infer<typeof putCollectionsDraftRequest>

export const collectionsPublishRequest = z
  .object({ confirm: confirm.optional() })
  .strict()
  .meta({ description: 'Publishes the draft. The body may be empty when the preview lists no effects; otherwise it carries the preview\'s token as `confirm`.' })
export type CollectionsPublishRequest = z.infer<typeof collectionsPublishRequest>

export const collectionsPublishResponse = z
  .object({
    version: schemaVersion,
    published_at: timestamp,
    effects: z.array(collectionsEffect).meta({ description: 'What the publish did to existing data.' }),
    issues: z.array(collectionsIssue).meta({ description: 'Warnings and information about the published document.' }),
  })
  .meta({ description: 'The version that was published and the effects it had.' })
export type CollectionsPublishResponse = z.infer<typeof collectionsPublishResponse>

/** One published version. */
export const collectionsVersionSummary = z
  .object({
    version: schemaVersion,
    published_at: timestamp,
    published_by: collectionActor,
    effect_counts: z.record(z.string(), count).meta({
      description: 'For each kind of effect the publish had, how many records or values it touched, by effect `kind`. Empty when it had none.',
    }),
    restored_from: schemaVersion.nullable().meta({ description: 'The version this one restored. Null for an ordinary publish.' }),
    restore_with_data: z.boolean().meta({
      description: `Whether restoring this version can also put records back: its restore point is at most ${COLLECTION_LIMITS.restoreDays} days old, has not been purged, and it is not the current version.`,
    }),
  })
  .meta({ description: 'A published version of the schema document.' })
export type CollectionsVersionSummary = z.infer<typeof collectionsVersionSummary>

export const collectionsVersionsResponse = z
  .object({
    current: schemaVersion.nullable().meta({ description: 'The version in force. Null before the first publish.' }),
    versions: z.array(collectionsVersionSummary).meta({ description: 'Newest first.' }),
  })
  .meta({ description: 'The published versions of the schema document.' })
export type CollectionsVersionsResponse = z.infer<typeof collectionsVersionsResponse>

export const collectionsVersionResponse = collectionsVersionSummary
  .extend({
    source: z.string().meta({ description: 'The document as it was published, as text.' }),
    doc: collectionsDocument,
  })
  .meta({ description: 'One published version with its document.' })
export type CollectionsVersionResponse = z.infer<typeof collectionsVersionResponse>

/**
 * What restoring a version would do. `with_data` is what the caller asked for
 * and the preview shows; `data_possible` and `data_reason` say whether data can
 * come back at all.
 */
export const collectionsRestorePreview = z
  .object({
    version: schemaVersion.meta({ description: 'The version that would be restored.' }),
    with_data: z.boolean().meta({ description: 'Whether this preview is for a restore that also puts records back.' }),
    data_possible: z.boolean().meta({ description: 'Whether records can be put back at all.' }),
    data_reason: z.enum(['ok', 'expired', 'purged', 'current_version']).meta({
      description: `\`ok\`: records can be put back. \`expired\`: the restore point is more than ${COLLECTION_LIMITS.restoreDays} days old. \`purged\`: an owner removed the history it needs. \`current_version\`: this version is already in force.`,
    }),
    touched: z.array(collection).meta({ description: 'The collections that differ between the current version and this one; only these can get records back.' }),
    selected: z.array(collection).meta({ description: 'The touched collections whose records would be put back. The caller may deselect some.' }),
    reverted: z
      .array(
        z
          .object({
            collection,
            changes: count.meta({ description: 'Changes made since the restore point that would be reverted.' }),
            records_back: count.meta({ description: 'Deleted records that would come back.' }),
            records_deleted: count.meta({ description: 'Records created since the restore point that would be deleted.' }),
          })
          .strict(),
      )
      .meta({ description: 'What putting the records back would do, per selected collection.' }),
    robots_gone: count.meta({ description: 'Records of robots that were deleted since cannot come back; this is how many.' }),
    effects: z.array(collectionsEffect).meta({ description: 'The ordinary effects of publishing this version\'s document.' }),
    access_changes: z.array(collectionsAccessChange),
    issues: z.array(collectionsIssue),
    token: z.string().nullable().meta({
      description: 'Stands for exactly what this restore would do: send it as `confirm`. Null when the restore changes no data and needs no confirmation.',
    }),
  })
  .meta({ description: 'The preview of restoring a version, with the token that confirms it.' })
export type CollectionsRestorePreview = z.infer<typeof collectionsRestorePreview>

/** The query string of a restore preview. */
export const collectionsRestorePreviewQuery = z
  .object({
    data: z.enum(['true', 'false']).meta({ description: '`true` also puts records back to their state at the version\'s restore point. Default `false`.' }).optional(),
    collections: z
      .string()
      .min(1)
      .meta({ description: 'The touched collections to put records back in, separated by commas. Default: all of them.' })
      .optional(),
  })
  .strict()
export type CollectionsRestorePreviewQuery = z.infer<typeof collectionsRestorePreviewQuery>

export const collectionsRestoreRequest = z
  .object({
    data: z.boolean().meta({ description: 'Also put records back to their state at the restore point, in the touched collections. Default `false`.' }).optional(),
    collections: z
      .array(collectionKey)
      .max(COLLECTION_LIMITS.collections)
      .meta({ description: 'Limits putting records back to these touched collections. Default: all of them.' })
      .optional(),
    confirm: confirm.optional(),
  })
  .strict()
  .meta({ description: 'Restores a version. Send the `data` and `collections` of the preview together with its token as `confirm`.' })
export type CollectionsRestoreRequest = z.infer<typeof collectionsRestoreRequest>

export const collectionsRestoreResponse = collectionsPublishResponse
  .extend({ with_data: z.boolean().meta({ description: 'Whether records were put back as well.' }) })
  .meta({ description: 'The version that the restore published and what it did.' })
export type CollectionsRestoreResponse = z.infer<typeof collectionsRestoreResponse>

/** The owner's purge of old history. Always confirmed with a token. */
export const collectionsPurgeRequest = z
  .object({
    before: timestamp.meta({ description: 'Revisions older than this UTC time are removed. The current values of records stay.' }),
    collection: collectionKey.meta({ description: 'Purge only this collection. Default: the whole app.' }).optional(),
    confirm: confirm.optional(),
  })
  .strict()
  .meta({ description: 'Removes the history older than a date. The preview answers with a token; send it as `confirm` to purge.' })
export type CollectionsPurgeRequest = z.infer<typeof collectionsPurgeRequest>

export const collectionsPurgePreview = z
  .object({
    before: timestamp,
    collection: collectionKey.nullable().meta({ description: 'The collection the purge is limited to. Null for the whole app.' }),
    revisions: count.meta({ description: 'Revisions that would be removed.' }),
    bytes: count.meta({ description: 'Their size in bytes.' }),
    restore_points_lost: z.array(schemaVersion).meta({ description: 'Versions whose records can no longer be restored once the history is gone.' }),
    token: token.meta({ description: 'Stands for exactly this purge: send it as `confirm` to carry it out.' }),
  })
  .meta({ description: 'What a purge would remove, with the token that confirms it.' })
export type CollectionsPurgePreview = z.infer<typeof collectionsPurgePreview>

export const collectionsPurgeResponse = z
  .object({
    revisions: count.meta({ description: 'Revisions removed.' }),
    bytes: count.meta({ description: 'Their size in bytes.' }),
    purged_at: timestamp,
  })
  .meta({ description: 'What a purge removed.' })
export type CollectionsPurgeResponse = z.infer<typeof collectionsPurgeResponse>
