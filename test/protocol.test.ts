import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROTOCOL_VERSION,
  bridgeHello,
  datapointFrame,
  bridgeState,
  apiError,
  slug,
} from '../src/index.js'
import { exportedSchemas } from '../scripts/export-schemas.js'
import { z } from 'zod'

describe('contracts v1', () => {
  it('accepts a well-formed hello and rejects a token-less one', () => {
    expect(
      bridgeHello.safeParse({
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        token: 'frt_x',
        bridge_version: '1.0.0',
      }).success,
    ).toBe(true)
    expect(
      bridgeHello.safeParse({
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        bridge_version: '1.0.0',
      }).success,
    ).toBe(false)
  })

  it('stamps every datapoint with timestamp_ms', () => {
    expect(
      datapointFrame.safeParse({
        type: 'datapoint',
        slug: 'battery',
        value: 87.5,
        timestamp_ms: 1754800000000,
      }).success,
    ).toBe(true)
    expect(
      datapointFrame.safeParse({ type: 'datapoint', slug: 'battery', value: 87.5 }).success,
    ).toBe(false)
  })

  it('slugs are lowercase, dash-separated, letter-initial', () => {
    for (const good of ['battery', 'front-cam', 'bridge-state', 'ab']) {
      expect(slug.safeParse(good).success).toBe(true)
    }
    for (const bad of ['Battery', '1st', '-x', 'a', 'a_b', 'a b', 'foo-', 'a--b']) {
      expect(slug.safeParse(bad).success).toBe(false)
    }
  })

  it('bridge-state carries online flag and nullable latency', () => {
    expect(bridgeState.safeParse({ online: true, latency_ms: 42 }).success).toBe(true)
    expect(bridgeState.safeParse({ online: false, latency_ms: null }).success).toBe(true)
    expect(bridgeState.safeParse({ online: false }).success).toBe(false)
  })

  it('api errors carry stable code + message', () => {
    expect(
      apiError.safeParse({ code: 'robot_offline', message: 'The robot is offline.' }).success,
    ).toBe(true)
    expect(apiError.safeParse({ message: 'nope' }).success).toBe(false)
  })
})

describe('schema artifacts', () => {
  it('artifacts on disk match a fresh export (staleness guard)', () => {
    const dir = join(import.meta.dirname, '..', 'artifacts', 'schema')
    const onDisk = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith('.schema.json'))
        .map((f) => [f.replace('.schema.json', ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]),
    )
    const fresh = Object.fromEntries(
      Object.entries(exportedSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
    )
    expect(onDisk).toEqual(fresh)
  })
})
