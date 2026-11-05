// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  collectionEvent,
  collectionSubscribe,
  collectionSubscribeError,
  collectionUnsubscribe,
  collectionsSchemaPublished,
} from '../src/index.js'

const ROBOT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const RECORD_ID = '9b2c1d34-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const AT = '2026-11-04T10:00:00.000Z'

const actor = { kind: 'app_user', id: RECORD_ID, label: 'ada@example.com' }
const record = {
  id: RECORD_ID,
  robot_id: ROBOT,
  created_at: AT,
  created_by: actor,
  updated_at: AT,
  updated_by: actor,
  revision: 2,
  display: 'Gate 3 jammed',
  values: { text: 'Gate 3 jammed', category: 'fault' },
}

const subscribe = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'collection_subscribe',
  request_id: 'logbook-1',
  collection: 'logbook',
  ...over,
})

describe('collection_subscribe', () => {
  it('names a request and a collection, and nothing else is needed', () => {
    expect(collectionSubscribe.safeParse(subscribe()).success).toBe(true)
  })

  it('may be limited to a robot and to a filter', () => {
    const parsed = collectionSubscribe.safeParse(subscribe({ robot_id: ROBOT, filter: { category: { eq: 'fault' } } }))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.filter).toEqual({ category: { eq: 'fault' } })
  })

  it('refuses keys it does not know', () => {
    expect(collectionSubscribe.safeParse(subscribe({ since: 0 })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ search: 'jam' })).success).toBe(false)
  })

  it('needs the frame type to be exactly this one', () => {
    expect(collectionSubscribe.safeParse(subscribe({ type: 'subscribe' })).success).toBe(false)
    expect(collectionSubscribe.safeParse({ request_id: 'a', collection: 'logbook' }).success).toBe(false)
  })

  it('takes a request id of one to sixty-four characters', () => {
    expect(collectionSubscribe.safeParse(subscribe({ request_id: 'x'.repeat(64) })).success).toBe(true)
    expect(collectionSubscribe.safeParse(subscribe({ request_id: 'x'.repeat(65) })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ request_id: '' })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ request_id: 7 })).success).toBe(false)
    const { request_id: _gone, ...without } = subscribe()
    expect(collectionSubscribe.safeParse(without).success).toBe(false)
  })

  it('takes a collection key and refuses anything that is not one', () => {
    expect(collectionSubscribe.safeParse(subscribe({ collection: 'robot_settings' })).success).toBe(true)
    for (const bad of ['Logbook', 'log book', '1logbook', '', 'x'.repeat(64)]) {
      expect(collectionSubscribe.safeParse(subscribe({ collection: bad })).success, bad).toBe(false)
    }
  })

  it('takes a uuid for the robot and an object for the filter', () => {
    expect(collectionSubscribe.safeParse(subscribe({ robot_id: 'gate-bot' })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ filter: '{"category":{"eq":"fault"}}' })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ filter: [] })).success).toBe(false)
    expect(collectionSubscribe.safeParse(subscribe({ filter: null })).success).toBe(false)
  })

  it('names the app with a uuid, for the connection that has none of its own', () => {
    const APP = '0e0a56b6-8a38-4e53-8c30-0d3f1f3c2a10'
    const parsed = collectionSubscribe.safeParse(subscribe({ app_id: APP }))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.app_id).toBe(APP)
    // Optional: the token of an app user or a server key already names the app.
    expect(collectionSubscribe.safeParse(subscribe()).success).toBe(true)
    for (const bad of ['', 'warehouse', 5, null]) expect(collectionSubscribe.safeParse(subscribe({ app_id: bad })).success, String(bad)).toBe(false)
  })

  it('says who needs app_id, and which answers a wrong one gets', () => {
    const description: string = collectionSubscribe.shape.app_id.unwrap().meta()?.description ?? ''
    expect(description).toMatch(/Required on the connection of a developer/)
    expect(description).toMatch(/app user or a server key/)
    expect(description).toMatch(/validation_error/)
    expect(description).toMatch(/collection_not_found/)
  })

  it('states the real frame limit and what a larger frame does, not that every filter fits', () => {
    const description: string = collectionSubscribe.shape.filter.unwrap().meta()?.description ?? ''
    expect(description).toMatch(/at most 16,384 bytes/)
    expect(description).toMatch(/1009/)
    expect(description).not.toMatch(/fits the longest filter/)
  })

  it('fits a filter of fifty conditions in sixteen kilobytes', () => {
    const filter = { and: Array.from({ length: 50 }, (_, i) => ({ [`field_${i}`]: { eq: `value ${i}` } })) }
    const frame = subscribe({ robot_id: ROBOT, filter })
    expect(collectionSubscribe.safeParse(frame).success).toBe(true)
    expect(JSON.stringify(frame).length).toBeLessThan(16_384)
  })
})

describe('collection_unsubscribe', () => {
  it('names the subscription to end', () => {
    expect(collectionUnsubscribe.safeParse({ type: 'collection_unsubscribe', request_id: 'logbook-1' }).success).toBe(true)
  })

  it('refuses anything else', () => {
    expect(collectionUnsubscribe.safeParse({ type: 'collection_unsubscribe', request_id: 'logbook-1', collection: 'logbook' }).success).toBe(false)
    expect(collectionUnsubscribe.safeParse({ type: 'collection_unsubscribe' }).success).toBe(false)
    expect(collectionUnsubscribe.safeParse({ type: 'collection_unsubscribe', request_id: '' }).success).toBe(false)
    expect(collectionUnsubscribe.safeParse({ type: 'collection_unsubscribe', request_id: 'x'.repeat(65) }).success).toBe(false)
    expect(collectionUnsubscribe.safeParse({ type: 'unsubscribe', request_id: 'logbook-1' }).success).toBe(false)
  })
})

describe('collection_event', () => {
  const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'collection_event',
    request_id: 'logbook-1',
    event: 'created',
    id: RECORD_ID,
    record,
    ...over,
  })

  it.each(['created', 'updated', 'deleted', 'removed', 'entered'])('carries a record with %s', (name) => {
    const parsed = collectionEvent.safeParse(event({ event: name }))
    expect(parsed.success, name).toBe(true)
    expect(parsed.data?.record?.values).toEqual(record.values)
  })

  it('may leave out the record, for a record the subscriber may no longer read', () => {
    const { record: _record, ...bare } = event({ event: 'removed' })
    expect(collectionEvent.safeParse(bare).success).toBe(true)
  })

  it('refuses an event that is not one of the five', () => {
    for (const name of ['restored', 'change', 'CREATED', '']) {
      expect(collectionEvent.safeParse(event({ event: name })).success, name).toBe(false)
    }
  })

  it('needs the id of the record, as a uuid', () => {
    const { id: _id, ...without } = event()
    expect(collectionEvent.safeParse(without).success).toBe(false)
    expect(collectionEvent.safeParse(event({ id: 'r1' })).success).toBe(false)
  })

  it('refuses keys it does not know', () => {
    expect(collectionEvent.safeParse(event({ before: record })).success).toBe(false)
    expect(collectionEvent.safeParse(event({ seq: 4 })).success).toBe(false)
  })

  it('checks the record it carries', () => {
    expect(collectionEvent.safeParse(event({ record: { ...record, revision: 0 } })).success).toBe(false)
    expect(collectionEvent.safeParse(event({ record: { ...record, values: 'Gate 3' } })).success).toBe(false)
    expect(collectionEvent.safeParse(event({ record: null })).success).toBe(false)
  })

  it('names the subscription it belongs to', () => {
    expect(collectionEvent.safeParse(event({ request_id: '' })).success).toBe(false)
    const { request_id: _gone, ...without } = event()
    expect(collectionEvent.safeParse(without).success).toBe(false)
  })
})

describe('collection_subscribe_error', () => {
  const failure = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'collection_subscribe_error',
    request_id: 'logbook-1',
    code: 'collection_not_found',
    message: 'No collection has the key "logbook".',
    ...over,
  })

  it('answers a refusal with a code and a message', () => {
    expect(collectionSubscribeError.safeParse(failure()).success).toBe(true)
  })

  // The codes of a refused subscribe and of one that ends while it runs, and `unauthorized` for a subscribe sent before `auth`.
  it.each([
    'collection_not_found',
    'forbidden',
    'robot_not_attached',
    'validation_error',
    'collection_removed',
    'internal_error',
    'unauthorized',
  ])('can carry %s', (code) => {
    expect(collectionSubscribeError.safeParse(failure({ code })).success).toBe(true)
  })

  it('says in the published schema that a subscribe before auth is answered with `unauthorized`', () => {
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/schema/collection-subscribe-error.schema.json', import.meta.url), 'utf8'))
    expect(artifact.properties.code.description).toMatch(/unauthorized/)
  })

  it('echoes a request id that was itself the problem', () => {
    // A subscribe refused for its request id has to be answerable.
    expect(collectionSubscribeError.safeParse(failure({ request_id: 'x'.repeat(200), code: 'validation_error' })).success).toBe(true)
    expect(collectionSubscribeError.safeParse(failure({ request_id: '' })).success).toBe(true)
  })

  it('needs a code and a message that say something', () => {
    expect(collectionSubscribeError.safeParse(failure({ code: '' })).success).toBe(false)
    expect(collectionSubscribeError.safeParse(failure({ message: '' })).success).toBe(false)
    const { code: _code, ...without } = failure()
    expect(collectionSubscribeError.safeParse(without).success).toBe(false)
  })

  it('refuses keys it does not know', () => {
    expect(collectionSubscribeError.safeParse(failure({ details: {} })).success).toBe(false)
  })
})

describe('collections_schema_published', () => {
  it('names the version that is in force', () => {
    expect(collectionsSchemaPublished.safeParse({ type: 'collections_schema_published', version: 4 }).success).toBe(true)
  })

  it('refuses what is not a version number', () => {
    for (const version of [0, -1, 1.5, '4', null]) {
      expect(collectionsSchemaPublished.safeParse({ type: 'collections_schema_published', version }).success, String(version)).toBe(false)
    }
    expect(collectionsSchemaPublished.safeParse({ type: 'collections_schema_published' }).success).toBe(false)
  })

  it('refuses keys it does not know', () => {
    expect(collectionsSchemaPublished.safeParse({ type: 'collections_schema_published', version: 4, collections: ['logbook'] }).success).toBe(false)
  })
})

describe('the published schemas of the frames', () => {
  const dir = new URL('../artifacts/schema/', import.meta.url)

  it.each(['collection-subscribe', 'collection-unsubscribe', 'collection-event', 'collection-subscribe-error', 'collections-schema-published'])(
    '%s has an artifact',
    (name) => {
      expect(existsSync(new URL(`${name}.schema.json`, dir))).toBe(true)
    },
  )
})
