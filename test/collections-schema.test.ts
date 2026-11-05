// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLLECTION_LIMITS,
  collectionsAccessChange,
  collectionsDraftResponse,
  collectionsEffect,
  collectionsIssue,
  collectionsPublishRequest,
  collectionsPublishResponse,
  collectionsPurgePreview,
  collectionsPurgeRequest,
  collectionsPurgeResponse,
  collectionsRestorePreview,
  collectionsRestorePreviewQuery,
  collectionsRestoreRequest,
  collectionsRestoreResponse,
  collectionsSchemaPreview,
  collectionsVersionResponse,
  collectionsVersionSummary,
  collectionsVersionsResponse,
  putCollectionsDraftRequest,
} from '../src/index.js'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ACTOR = { kind: 'developer', id: '9b2c1d34-5e6f-4a7b-8c9d-0e1f2a3b4c5d', label: 'ada@example.com' }
const AT = '2026-11-04T10:00:00.000Z'
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** One example of each kind of effect, as the cloud lists them. */
const EFFECTS: Record<string, Record<string, unknown>> = {
  collection_removed: { kind: 'collection_removed', collection: 'logbook', records: 12 },
  collection_recreated: { kind: 'collection_recreated', collection: 'chargers', records: 3, from: 'global', to: 'per_robot' },
  records_created: { kind: 'records_created', collection: 'robot_settings', count: 3 },
  field_removed: { kind: 'field_removed', collection: 'robot_settings', field: 'dock_pose', values: 1 },
  defaults_filled: { kind: 'defaults_filled', collection: 'components', field: 'status', records: 40 },
  values_converted: { kind: 'values_converted', collection: 'components', field: 'position_m', converted: 4900, discarded: 15 },
  values_discarded: { kind: 'values_discarded', collection: 'components', field: 'type', reason: 'option_removed', values: 2 },
  unique_discarded: {
    kind: 'unique_discarded',
    collection: 'components',
    field: 'code',
    total: 2,
    records: [{ id: ID, display: 'Quadrupole 1 (Q1)', value: 'Q1' }],
  },
  required_left_empty: { kind: 'required_left_empty', collection: 'components', field: 'serial', records: 12 },
  references_cleared: { kind: 'references_cleared', collection: 'components', field: 'location', values: 5 },
}

const DOCUMENT = {
  format: 1,
  collections: { logbook: { binding: 'per_robot', fields: { text: { type: 'long_text', required: true } } } },
}
const SOURCE = 'format: 1\ncollections:\n  logbook:\n    binding: per_robot\n    fields:\n      text: { type: long_text, required: true }\n'

const accessChange = { collection: 'logbook', action: 'update', from: 'operate', to: null }
const issue = { path: 'collections.logbook.access.read', code: 'unknown_role', message: 'The role "wartung" does not exist.', severity: 'warning' }

const preview = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  from_version: 3,
  to_version: 4,
  valid: true,
  issues: [],
  effects: [EFFECTS.field_removed],
  access_changes: [accessChange],
  source_sha256: SHA,
  token: 'v1.abc',
  ...over,
})

const published = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 4,
  published_at: AT,
  effects: [EFFECTS.field_removed],
  issues: [issue],
  ...over,
})

const versionSummary = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 4,
  published_at: AT,
  published_by: ACTOR,
  effect_counts: { field_removed: 1, records_created: 3 },
  restored_from: null,
  restore_with_data: true,
  with_data: false,
  reverted_totals: null,
  ...over,
})

const restorePreview = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  with_data: true,
  data_possible: true,
  data_reason: 'ok',
  touched: ['components'],
  selected: ['components'],
  reverted: [{ collection: 'components', changes: 37, records_back: 12, records_deleted: 3 }],
  robots_gone: 1,
  effects: [EFFECTS.values_discarded],
  access_changes: [],
  issues: [],
  token: 'v1.def',
  ...over,
})

describe('collectionsEffect', () => {
  it('has the ten kinds, no more', () => {
    expect(Object.keys(EFFECTS)).toHaveLength(10)
    const shape = collectionsEffect as unknown as { options: { shape: { kind: { value: string } } }[] }
    expect(shape.options.map((o) => o.shape.kind.value).sort()).toEqual(Object.keys(EFFECTS).sort())
  })

  it('says how long the history of a removed or re-created collection stays', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/schema/collections-effect.schema.json', import.meta.url), 'utf8'))
    const members: { properties: { kind: { const: string } }; description?: string }[] = artifact.oneOf ?? artifact.anyOf
    for (const kind of ['collection_removed', 'collection_recreated']) {
      expect(members.find((m) => m.properties.kind.const === kind)!.description, kind).toMatch(/90 days after the publish or restore/)
    }
  })

  it.each(Object.entries(EFFECTS))('%s parses its example', (_kind, example) => {
    expect(collectionsEffect.safeParse(example).success).toBe(true)
  })

  it.each(Object.entries(EFFECTS))('%s rejects an unknown extra key', (_kind, example) => {
    expect(collectionsEffect.safeParse({ ...example, note: 'x' }).success).toBe(false)
  })

  it.each(Object.entries(EFFECTS))('%s needs every one of its keys', (_kind, example) => {
    for (const key of Object.keys(example)) {
      const { [key]: _removed, ...without } = example
      expect(collectionsEffect.safeParse(without).success, `without ${key}`).toBe(false)
    }
  })

  it('refuses a kind it does not know and a field of another kind', () => {
    expect(collectionsEffect.safeParse({ kind: 'collection_renamed', collection: 'a', records: 1 }).success).toBe(false)
    expect(collectionsEffect.safeParse({ ...EFFECTS.collection_removed, field: 'text' }).success).toBe(false)
    expect(collectionsEffect.safeParse({ collection: 'logbook', records: 1 }).success).toBe(false)
  })

  it('refuses a count that is negative or fractional', () => {
    expect(collectionsEffect.safeParse({ ...EFFECTS.collection_removed, records: -1 }).success).toBe(false)
    expect(collectionsEffect.safeParse({ ...EFFECTS.collection_removed, records: 1.5 }).success).toBe(false)
    expect(collectionsEffect.safeParse({ ...EFFECTS.values_converted, discarded: 0 }).success).toBe(true)
  })

  it('refuses a collection or field that is not a key', () => {
    expect(collectionsEffect.safeParse({ ...EFFECTS.field_removed, collection: 'Robot Settings' }).success).toBe(false)
    expect(collectionsEffect.safeParse({ ...EFFECTS.field_removed, field: 'dock pose' }).success).toBe(false)
  })

  it('knows the three reasons for discarded values only', () => {
    for (const reason of ['reference_target_changed', 'option_removed', 'constraint']) {
      expect(collectionsEffect.safeParse({ ...EFFECTS.values_discarded, reason }).success, reason).toBe(true)
    }
    expect(collectionsEffect.safeParse({ ...EFFECTS.values_discarded, reason: 'because' }).success).toBe(false)
  })

  it('names the bindings of a re-created collection', () => {
    expect(collectionsEffect.safeParse({ ...EFFECTS.collection_recreated, to: 'one_per_robot' }).success).toBe(true)
    expect(collectionsEffect.safeParse({ ...EFFECTS.collection_recreated, to: 'per_app' }).success).toBe(false)
  })

  describe('unique_discarded', () => {
    const records = (entry: Record<string, unknown>) => ({ ...EFFECTS.unique_discarded, records: [entry] })

    it('needs id, display and value in every listed record', () => {
      expect(collectionsEffect.safeParse(records({ id: ID, display: 'Q1', value: 'Q1' })).success).toBe(true)
      expect(collectionsEffect.safeParse(records({ display: 'Q1', value: 'Q1' })).success).toBe(false)
      expect(collectionsEffect.safeParse(records({ id: ID, value: 'Q1' })).success).toBe(false)
      expect(collectionsEffect.safeParse(records({ id: ID, display: 'Q1' })).success).toBe(false)
    })

    it('refuses an unknown key in a listed record and an id that is not a uuid', () => {
      expect(collectionsEffect.safeParse(records({ id: ID, display: 'Q1', value: 'Q1', robot: 'x' })).success).toBe(false)
      expect(collectionsEffect.safeParse(records({ id: 'one', display: 'Q1', value: 'Q1' })).success).toBe(false)
    })

    it('lets the value be any kind a unique field holds', () => {
      for (const value of ['Q1', 12.5, ['a', 'b'], null]) {
        expect(collectionsEffect.safeParse(records({ id: ID, display: 'x', value })).success, JSON.stringify(value)).toBe(true)
      }
    })

    it('lists at most 1,000 records, however large the total is', () => {
      const many = (count: number) => Array.from({ length: count }, () => ({ id: ID, display: 'x', value: 'y' }))
      expect(collectionsEffect.safeParse({ ...EFFECTS.unique_discarded, total: 5000, records: many(1000) }).success).toBe(true)
      expect(collectionsEffect.safeParse({ ...EFFECTS.unique_discarded, total: 5000, records: many(1001) }).success).toBe(false)
    })
  })
})

describe('collectionsAccessChange', () => {
  it('accepts a change from and to anything, null standing for nobody', () => {
    expect(collectionsAccessChange.safeParse(accessChange).success).toBe(true)
    expect(collectionsAccessChange.safeParse({ ...accessChange, from: null, to: ['operate', 'admin'] }).success).toBe(true)
    expect(collectionsAccessChange.safeParse({ ...accessChange, from: { all: 'admin', own: 'operate' }, to: 'admin' }).success).toBe(true)
  })

  it('needs both sides, a known action and a collection key', () => {
    const { from: _from, ...withoutFrom } = accessChange
    expect(collectionsAccessChange.safeParse(withoutFrom).success).toBe(false)
    expect(collectionsAccessChange.safeParse({ ...accessChange, action: 'list' }).success).toBe(false)
    expect(collectionsAccessChange.safeParse({ ...accessChange, collection: 'Log' }).success).toBe(false)
    for (const action of ['read', 'create', 'update', 'delete']) {
      expect(collectionsAccessChange.safeParse({ ...accessChange, action }).success, action).toBe(true)
    }
  })
})

describe('collectionsSchemaPreview', () => {
  it('accepts a preview with effects and the token that confirms them', () => {
    expect(collectionsSchemaPreview.safeParse(preview()).success).toBe(true)
  })

  it('lets a preview with effects: [] carry token: null', () => {
    expect(collectionsSchemaPreview.safeParse(preview({ effects: [], token: null })).success).toBe(true)
  })

  it('needs the token key, null when there is nothing to confirm', () => {
    const { token: _token, ...without } = preview()
    expect(collectionsSchemaPreview.safeParse(without).success).toBe(false)
  })

  it('names the draft it is for by the SHA-256 of its text, also when there is no token to carry it', () => {
    const { source_sha256: _hash, ...without } = preview({ effects: [], token: null })
    expect(collectionsSchemaPreview.safeParse(without).success).toBe(false)
    expect(collectionsSchemaPreview.safeParse(preview({ effects: [], token: null, source_sha256: 'abc' })).success).toBe(false)
    // What a preview names is what a publish may send back.
    const { source_sha256 } = collectionsSchemaPreview.parse(preview({ effects: [], token: null }))
    expect(collectionsPublishRequest.safeParse({ source_sha256 }).success).toBe(true)
  })

  it('accepts a first publish (no version yet) and an invalid draft with its issues', () => {
    expect(collectionsSchemaPreview.safeParse(preview({ from_version: null, to_version: 1, effects: [], token: null })).success).toBe(true)
    expect(
      collectionsSchemaPreview.safeParse(
        preview({ valid: false, effects: [], access_changes: [], token: null, issues: [{ ...issue, severity: 'error', code: 'unknown_reference_target' }] }),
      ).success,
    ).toBe(true)
  })

  it('refuses version 0 and an effect it does not know', () => {
    expect(collectionsSchemaPreview.safeParse(preview({ to_version: 0 })).success).toBe(false)
    expect(collectionsSchemaPreview.safeParse(preview({ effects: [{ kind: 'wiped', collection: 'a' }] })).success).toBe(false)
  })

  it('carries findings as collectionsIssue does', () => {
    expect(collectionsIssue.safeParse(issue).success).toBe(true)
    expect(collectionsSchemaPreview.safeParse(preview({ issues: [{ path: 'x' }] })).success).toBe(false)
  })
})

describe('collectionsDraftResponse', () => {
  const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    source: SOURCE,
    doc: DOCUMENT,
    updated_at: AT,
    updated_by: ACTOR,
    issues: [],
    ...over,
  })

  it('accepts a saved draft', () => {
    expect(collectionsDraftResponse.safeParse(draft()).success).toBe(true)
  })

  it('accepts the current version\'s text when no draft is saved: updated_at and updated_by are null', () => {
    expect(collectionsDraftResponse.safeParse(draft({ updated_at: null, updated_by: null })).success).toBe(true)
  })

  it('accepts an empty source before the first publish, with no document', () => {
    expect(collectionsDraftResponse.safeParse(draft({ source: '', doc: null, updated_at: null, updated_by: null })).success).toBe(true)
  })

  it('refuses a document the format does not know', () => {
    expect(collectionsDraftResponse.safeParse(draft({ doc: { format: 2, collections: {} } })).success).toBe(false)
  })

  it('needs all five keys', () => {
    for (const key of ['source', 'doc', 'updated_at', 'updated_by', 'issues']) {
      const { [key]: _removed, ...without } = draft()
      expect(collectionsDraftResponse.safeParse(without).success, `without ${key}`).toBe(false)
    }
  })
})

describe('putCollectionsDraftRequest', () => {
  const accepted = (source: string) => putCollectionsDraftRequest.safeParse({ source }).success

  it('accepts a source of 1,000,000 bytes and refuses one more', () => {
    expect(COLLECTION_LIMITS.schemaSourceBytes).toBe(1_000_000)
    expect(accepted('x'.repeat(1_000_000))).toBe(true)
    expect(accepted('x'.repeat(1_000_001))).toBe(false)
  })

  it('counts bytes of UTF-8 and not characters', () => {
    // Two bytes for the accent: 999,998 + 2 is 1,000,000 bytes; one more letter makes 1,000,001 bytes in 1,000,000 characters.
    expect(accepted(`${'x'.repeat(999_998)}\u00e9`)).toBe(true)
    expect(accepted(`${'x'.repeat(999_999)}\u00e9`)).toBe(false)
    // Three bytes each: 333,333 characters are 999,999 bytes, 333,334 are 1,000,002.
    expect(accepted('\u20ac'.repeat(333_333))).toBe(true)
    expect(accepted('\u20ac'.repeat(333_334))).toBe(false)
    // Four bytes each, and two UTF-16 units: 250,000 emoji are exactly 1,000,000 bytes.
    expect(accepted('\u{1F600}'.repeat(250_000))).toBe(true)
    expect(accepted('\u{1F600}'.repeat(250_001))).toBe(false)
    expect(accepted(`${'\u{1F600}'.repeat(249_999)}xxxx`)).toBe(true)
    expect(accepted(`${'\u{1F600}'.repeat(249_999)}xxxxx`)).toBe(false)
  })

  it('counts the bytes an encoder writes, for every kind of character', () => {
    // 1,000,000 bytes of each, then one byte more in plain ASCII: each is the same size to a TextEncoder.
    const encoder = new TextEncoder()
    const samples = ['x', '\u00e9', '\u20ac', '\u{1F600}', '\ud800', '\udc00', 'a\ud83dz']
    for (const sample of samples) {
      const bytes = encoder.encode(sample).length
      const fits = Math.floor(1_000_000 / bytes)
      expect(accepted(sample.repeat(fits)), `${JSON.stringify(sample)} x ${fits}`).toBe(true)
      expect(accepted(sample.repeat(fits + 1)), `${JSON.stringify(sample)} x ${fits + 1}`).toBe(false)
    }
  })

  it('says bytes in its description', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/schema/put-collections-draft-request.schema.json', import.meta.url), 'utf8'))
    expect(artifact.properties.source.description).toContain('1,000,000 bytes of UTF-8')
  })

  it('needs a source and refuses other keys', () => {
    expect(putCollectionsDraftRequest.safeParse({}).success).toBe(false)
    expect(putCollectionsDraftRequest.safeParse({ source: SOURCE, doc: DOCUMENT }).success).toBe(false)
    expect(putCollectionsDraftRequest.safeParse({ source: 5 }).success).toBe(false)
  })
})

describe('collectionsPublishRequest', () => {
  it('accepts {}, since a publish without effects needs no token', () => {
    expect(collectionsPublishRequest.safeParse({}).success).toBe(true)
  })

  it('accepts the token of a preview as confirm', () => {
    expect(collectionsPublishRequest.safeParse({ confirm: 'v1.abc' }).success).toBe(true)
  })

  it('accepts the hash of the draft that was looked at, with or without a token', () => {
    expect(collectionsPublishRequest.safeParse({ source_sha256: SHA }).success).toBe(true)
    expect(collectionsPublishRequest.safeParse({ confirm: 'v1.abc', source_sha256: SHA }).success).toBe(true)
    // Lowercase hex of a SHA-256, nothing else.
    for (const bad of ['', SHA.toUpperCase(), SHA.slice(1), `${SHA}0`, 'not a hash', 5]) {
      expect(collectionsPublishRequest.safeParse({ source_sha256: bad }).success, String(bad)).toBe(false)
    }
  })

  it('refuses an empty token, a token that is not text and other keys', () => {
    expect(collectionsPublishRequest.safeParse({ confirm: '' }).success).toBe(false)
    expect(collectionsPublishRequest.safeParse({ confirm: 1 }).success).toBe(false)
    expect(collectionsPublishRequest.safeParse({ token: 'v1.abc' }).success).toBe(false)
  })
})

describe('collectionsPublishResponse', () => {
  it('accepts the version, when it was published and what it did', () => {
    expect(collectionsPublishResponse.safeParse(published()).success).toBe(true)
    expect(collectionsPublishResponse.safeParse(published({ effects: [], issues: [] })).success).toBe(true)
  })

  it('needs every key and a real timestamp', () => {
    for (const key of ['version', 'published_at', 'effects', 'issues']) {
      const { [key]: _removed, ...without } = published()
      expect(collectionsPublishResponse.safeParse(without).success, `without ${key}`).toBe(false)
    }
    expect(collectionsPublishResponse.safeParse(published({ published_at: 'today' })).success).toBe(false)
  })
})

describe('versions', () => {
  it('accepts a version summary, current or restored from another', () => {
    expect(collectionsVersionSummary.safeParse(versionSummary()).success).toBe(true)
    expect(collectionsVersionSummary.safeParse(versionSummary({ restored_from: 2, restore_with_data: false })).success).toBe(true)
  })

  it('counts effects by kind and refuses a negative count', () => {
    expect(collectionsVersionSummary.safeParse(versionSummary({ effect_counts: {} })).success).toBe(true)
    expect(collectionsVersionSummary.safeParse(versionSummary({ effect_counts: { field_removed: -1 } })).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(versionSummary({ effect_counts: { field_removed: 1.5 } })).success).toBe(false)
  })

  it('needs restored_from and restore_with_data', () => {
    const { restored_from: _a, ...withoutFrom } = versionSummary()
    const { restore_with_data: _b, ...withoutData } = versionSummary()
    expect(collectionsVersionSummary.safeParse(withoutFrom).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(withoutData).success).toBe(false)
  })

  it('says whether a restore put records back and what came back, so that the history can tell', () => {
    const totals = { changes: 37, records_back: 12, records_deleted: 3, robots_gone: 1 }
    const restored = versionSummary({ restored_from: 2, with_data: true, reverted_totals: totals })
    expect(collectionsVersionSummary.parse(restored)).toMatchObject({ with_data: true, reverted_totals: totals })
    // A restore of the document alone and an ordinary publish put nothing back.
    expect(collectionsVersionSummary.safeParse(versionSummary({ restored_from: 2, with_data: false, reverted_totals: null })).success).toBe(true)
    // Both are always stated: an absent flag would read as "no".
    const { with_data: _a, ...withoutFlag } = versionSummary()
    const { reverted_totals: _b, ...withoutTotals } = versionSummary()
    expect(collectionsVersionSummary.safeParse(withoutFlag).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(withoutTotals).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(versionSummary({ with_data: 'yes' })).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(versionSummary({ reverted_totals: { ...totals, records_back: -1 } })).success).toBe(false)
    const { robots_gone: _c, ...partial } = totals
    expect(collectionsVersionSummary.safeParse(versionSummary({ reverted_totals: partial })).success).toBe(false)
    expect(collectionsVersionSummary.safeParse(versionSummary({ reverted_totals: { ...totals, extra: 1 } })).success).toBe(false)
  })

  it('wraps the versions with the current one, null before the first publish', () => {
    expect(collectionsVersionsResponse.safeParse({ current: 4, versions: [versionSummary(), versionSummary({ version: 3 })] }).success).toBe(true)
    expect(collectionsVersionsResponse.safeParse({ current: null, versions: [] }).success).toBe(true)
    expect(collectionsVersionsResponse.safeParse({ versions: [] }).success).toBe(false)
  })

  it('adds the source and the document to one version', () => {
    expect(collectionsVersionResponse.safeParse({ ...versionSummary(), source: SOURCE, doc: DOCUMENT }).success).toBe(true)
    expect(collectionsVersionResponse.safeParse({ ...versionSummary(), doc: DOCUMENT }).success).toBe(false)
    expect(collectionsVersionResponse.safeParse({ ...versionSummary(), source: SOURCE }).success).toBe(false)
    expect(collectionsVersionResponse.safeParse({ ...versionSummary(), source: SOURCE, doc: null }).success).toBe(false)
  })
})

describe('collectionsRestorePreview', () => {
  it('accepts a preview of a restore with data', () => {
    expect(collectionsRestorePreview.safeParse(restorePreview()).success).toBe(true)
  })

  it('knows why data cannot be restored: ok, expired, purged or the current version', () => {
    for (const data_reason of ['ok', 'expired', 'purged', 'current_version']) {
      expect(collectionsRestorePreview.safeParse(restorePreview({ data_reason })).success, data_reason).toBe(true)
    }
    for (const data_reason of ['too_old', 'none', '', null]) {
      expect(collectionsRestorePreview.safeParse(restorePreview({ data_reason })).success, String(data_reason)).toBe(false)
    }
  })

  it('accepts a document-only restore: no data, nothing reverted, and no token when there are no effects', () => {
    expect(
      collectionsRestorePreview.safeParse(
        restorePreview({ with_data: false, data_possible: false, data_reason: 'expired', touched: [], selected: [], reverted: [], robots_gone: 0, effects: [], token: null }),
      ).success,
    ).toBe(true)
  })

  it('counts what each collection gets back and loses', () => {
    expect(collectionsRestorePreview.safeParse(restorePreview({ reverted: [{ collection: 'components', changes: 1, records_back: 0 }] })).success).toBe(false)
    expect(collectionsRestorePreview.safeParse(restorePreview({ reverted: [{ collection: 'components', changes: -1, records_back: 0, records_deleted: 0 }] })).success).toBe(false)
    expect(
      collectionsRestorePreview.safeParse(restorePreview({ reverted: [{ collection: 'components', changes: 1, records_back: 0, records_deleted: 0, note: 'x' }] })).success,
    ).toBe(false)
  })

  it('needs every key', () => {
    for (const key of Object.keys(restorePreview())) {
      const { [key]: _removed, ...without } = restorePreview()
      expect(collectionsRestorePreview.safeParse(without).success, `without ${key}`).toBe(false)
    }
  })

  it('refuses a collection that is not a key in touched and selected', () => {
    expect(collectionsRestorePreview.safeParse(restorePreview({ touched: ['Components'] })).success).toBe(false)
    expect(collectionsRestorePreview.safeParse(restorePreview({ selected: [5] })).success).toBe(false)
  })
})

describe('collectionsRestoreRequest', () => {
  it('accepts {} and every key', () => {
    expect(collectionsRestoreRequest.safeParse({}).success).toBe(true)
    expect(collectionsRestoreRequest.safeParse({ data: true, collections: ['components', 'chargers'], confirm: 'v1.def' }).success).toBe(true)
    expect(collectionsRestoreRequest.safeParse({ data: false }).success).toBe(true)
  })

  it('refuses unknown keys, a data that is not a boolean and collections that are not keys', () => {
    expect(collectionsRestoreRequest.safeParse({ with_data: true }).success).toBe(false)
    expect(collectionsRestoreRequest.safeParse({ data: 'true' }).success).toBe(false)
    expect(collectionsRestoreRequest.safeParse({ collections: ['Components'] }).success).toBe(false)
    expect(collectionsRestoreRequest.safeParse({ collections: 'components' }).success).toBe(false)
    expect(collectionsRestoreRequest.safeParse({ confirm: '' }).success).toBe(false)
  })

  it('names at most as many collections as a document can have', () => {
    const keys = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`)
    expect(collectionsRestoreRequest.safeParse({ collections: keys(COLLECTION_LIMITS.collections) }).success).toBe(true)
    expect(collectionsRestoreRequest.safeParse({ collections: keys(COLLECTION_LIMITS.collections + 1) }).success).toBe(false)
  })
})

describe('collectionsRestorePreviewQuery', () => {
  it('reads data as the word true or false and collections as a comma list', () => {
    expect(collectionsRestorePreviewQuery.safeParse({}).success).toBe(true)
    expect(collectionsRestorePreviewQuery.safeParse({ data: 'true', collections: 'components,chargers' }).success).toBe(true)
    expect(collectionsRestorePreviewQuery.safeParse({ data: 'false' }).success).toBe(true)
  })

  it('refuses another word for data, an empty list and other parameters', () => {
    for (const data of ['1', 'yes', true, 'TRUE']) {
      expect(collectionsRestorePreviewQuery.safeParse({ data }).success, String(data)).toBe(false)
    }
    expect(collectionsRestorePreviewQuery.safeParse({ collections: '' }).success).toBe(false)
    expect(collectionsRestorePreviewQuery.safeParse({ confirm: 'x' }).success).toBe(false)
  })
})

describe('collectionsRestoreResponse', () => {
  it('is the publish response plus whether data came back', () => {
    expect(collectionsRestoreResponse.safeParse({ ...published(), with_data: true }).success).toBe(true)
    expect(collectionsRestoreResponse.safeParse(published()).success).toBe(false)
    expect(collectionsRestoreResponse.safeParse({ ...published(), with_data: 'yes' }).success).toBe(false)
  })
})

describe('the purge shapes', () => {
  it('needs a datetime before', () => {
    expect(collectionsPurgeRequest.safeParse({ before: AT }).success).toBe(true)
    expect(collectionsPurgeRequest.safeParse({ before: '2026-08-01T00:00:00Z' }).success).toBe(true)
    expect(collectionsPurgeRequest.safeParse({}).success).toBe(false)
    for (const before of ['2026-08-01', 'yesterday', '', 1760000000000, null]) {
      expect(collectionsPurgeRequest.safeParse({ before }).success, JSON.stringify(before)).toBe(false)
    }
  })

  it('describes its token as one a purge always needs, and not as one for effects', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/schema/collections-purge-request.schema.json', import.meta.url), 'utf8'))
    const text: string = artifact.properties.confirm.description
    expect(text).toContain('always confirmed')
    expect(text).toContain('confirmation_required')
    expect(text).not.toMatch(/effects/)
    // A publish keeps its own wording.
    const publish = JSON.parse(readFileSync(new URL('../artifacts/schema/collections-publish-request.schema.json', import.meta.url), 'utf8'))
    expect(publish.properties.confirm.description).toContain('effects')
  })

  it('may name one collection and carry the confirming token', () => {
    expect(collectionsPurgeRequest.safeParse({ before: AT, collection: 'logbook', confirm: 'v1.ghi' }).success).toBe(true)
    expect(collectionsPurgeRequest.safeParse({ before: AT, collection: 'Logbook' }).success).toBe(false)
    expect(collectionsPurgeRequest.safeParse({ before: AT, confirm: '' }).success).toBe(false)
  })

  it('refuses unknown keys', () => {
    expect(collectionsPurgeRequest.safeParse({ before: AT, all: true }).success).toBe(false)
  })

  const purgePreview = (over: Record<string, unknown> = {}) => ({
    before: AT,
    collection: null,
    revisions: 12_000,
    bytes: 4_000_000,
    restore_points_lost: [2, 3],
    token: 'v1.ghi',
    ...over,
  })

  it('previews what goes, naming the restore points that stop working', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/schema/collections-purge-preview.schema.json', import.meta.url), 'utf8'))
    expect(artifact.properties.restore_points_lost.description).toMatch(/could be put back today and could not/)
    expect(collectionsPurgePreview.safeParse(purgePreview()).success).toBe(true)
    expect(collectionsPurgePreview.safeParse(purgePreview({ collection: 'logbook', restore_points_lost: [] })).success).toBe(true)
  })

  it('always carries a token: a purge is never confirmed without one', () => {
    expect(collectionsPurgePreview.safeParse(purgePreview({ token: null })).success).toBe(false)
    const { token: _token, ...without } = purgePreview()
    expect(collectionsPurgePreview.safeParse(without).success).toBe(false)
  })

  it('refuses a negative count and a restore point that is not a version', () => {
    expect(collectionsPurgePreview.safeParse(purgePreview({ revisions: -1 })).success).toBe(false)
    expect(collectionsPurgePreview.safeParse(purgePreview({ restore_points_lost: [0] })).success).toBe(false)
    expect(collectionsPurgePreview.safeParse(purgePreview({ restore_points_lost: ['v2'] })).success).toBe(false)
  })

  it('answers with what was removed and when', () => {
    expect(collectionsPurgeResponse.safeParse({ revisions: 12_000, bytes: 4_000_000, purged_at: AT }).success).toBe(true)
    expect(collectionsPurgeResponse.safeParse({ revisions: 12_000, bytes: 4_000_000 }).success).toBe(false)
    expect(collectionsPurgeResponse.safeParse({ revisions: 1.5, bytes: 0, purged_at: AT }).success).toBe(false)
  })
})

describe('the published schemas', () => {
  const dir = new URL('../artifacts/schema/', import.meta.url)

  it.each([
    'collections-issue',
    'collections-effect',
    'collections-access-change',
    'collections-schema-preview',
    'collections-draft-response',
    'put-collections-draft-request',
    'collections-publish-request',
    'collections-publish-response',
    'collections-version-summary',
    'collections-versions-response',
    'collections-version-response',
    'collections-restore-preview',
    'collections-restore-request',
    'collections-restore-response',
    'collections-restore-preview-query',
    'collections-purge-request',
    'collections-purge-preview',
    'collections-purge-response',
  ])('%s has an artifact', (name) => {
    expect(existsSync(new URL(`${name}.schema.json`, dir))).toBe(true)
  })

  it('the issue artifact is what the cloud and the console share', () => {
    const artifact = JSON.parse(readFileSync(new URL('collections-issue.schema.json', dir), 'utf8'))
    expect(Object.keys(artifact.properties).sort()).toEqual(['code', 'message', 'path', 'severity'])
    expect(artifact.properties.severity.enum).toEqual(['error', 'warning', 'info'])
  })

  it('the effect artifact lists the ten kinds', () => {
    const artifact = JSON.parse(readFileSync(new URL('collections-effect.schema.json', dir), 'utf8'))
    const kinds = artifact.oneOf.map((branch: { properties: { kind: { const: string } } }) => branch.properties.kind.const)
    expect(kinds.sort()).toEqual(Object.keys(EFFECTS).sort())
  })
})
