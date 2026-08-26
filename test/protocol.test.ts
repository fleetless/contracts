import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROTOCOL_VERSION,
  bridgeHello,
  datapointFrame,
  bridgeState,
  bridgePressure,
  PRESSURE_SLUG,
  apiError,
  slug,
} from '../src/index.js'
import { exportedSchemas, schemaIo, BRIDGE_SENT_SCHEMAS } from '../scripts/export-schemas.js'
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

  it('bridge-pressure accepts a full sample and rejects an unknown tier or a negative link rate', () => {
    const TIER = { sent: 10, bytes: 2048, drops: 0, high_water: 3 }
    const FULL = {
      link: { rate_bps: 12_500, snapshot_max_bytes: 65_536 },
      tiers: { '0': TIER, '1': TIER, '2': TIER, '3': TIER, '4': TIER, '5': TIER },
      video: {
        active_streams: 1,
        bitrate_sum_kbps: 800,
        uplink_kbps: 2000,
        override_kbps: null,
        video_budget_kbps: 1500,
        reserve_kbps: 500,
      },
    }
    expect(bridgePressure.safeParse(FULL).success).toBe(true)

    // a missing tier key reads as zeros — the schema does not require all six
    const { '3': _dropped, ...partialTiers } = FULL.tiers
    expect(bridgePressure.safeParse({ ...FULL, tiers: partialTiers }).success).toBe(true)
    expect(bridgePressure.safeParse({ ...FULL, tiers: {} }).success).toBe(true)

    // an unknown tier key is refused, not silently accepted
    expect(
      bridgePressure.safeParse({ ...FULL, tiers: { ...FULL.tiers, '7': TIER } }).success,
    ).toBe(false)

    // link.rate_bps is nonnegative (nullable, but never negative)
    expect(
      bridgePressure.safeParse({ ...FULL, link: { ...FULL.link, rate_bps: -1 } }).success,
    ).toBe(false)
    expect(
      bridgePressure.safeParse({ ...FULL, link: { ...FULL.link, rate_bps: null } }).success,
    ).toBe(true)
  })

  it('PRESSURE_SLUG names the reserved slug bridge-pressure rides on', () => {
    expect(PRESSURE_SLUG).toBe('bridge-pressure')
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
    // **Regenerate through the same classification the export uses.** This
    // test is the only thing stopping the artifacts going stale, and calling
    // `toJSONSchema` with default options here would compare a fresh *output*
    // render against files written per-schema — permanently red, and red for
    // a reason that has nothing to do with staleness.
    const fresh = Object.fromEntries(
      Object.entries(exportedSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: schemaIo(name) })]),
    )
    expect(onDisk).toEqual(fresh)
  })

  /**
   * **The never-registered guard.** `pnpm artifacts` reporting no diff
   * cannot distinguish "already current" from "the schema was never
   * registered for export" — a schema defined in `protocol.ts` but left out
   * of `exportedSchemas` produces no artifact and no failing test either,
   * because there is nothing on disk to compare it against. So this checks
   * the thing the staleness guard above cannot: that `bridge-pressure` is
   * actually a key of `exportedSchemas`, and that the file it produces
   * exists and carries the schema's own shape, not an empty stand-in.
   */
  it('bridge-pressure is registered for export and produces a real artifact', () => {
    expect(Object.keys(exportedSchemas)).toContain('bridge-pressure')
    const path = join(import.meta.dirname, '..', 'artifacts', 'schema', 'bridge-pressure.schema.json')
    const contents = readFileSync(path, 'utf8')
    expect(contents).toContain('bitrate_sum_kbps')
  })

  /**
   * The same guard for the outgoing set. Without it the harness artifacts
   * could drift silently — which is exactly the class they exist to catch,
   * one level up.
   */
  it('outgoing artifacts on disk match a fresh output-mode export', () => {
    const dir = join(import.meta.dirname, '..', 'artifacts', 'schema-outgoing')
    const onDisk = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith('.schema.json'))
        .map((f) => [f.replace('.schema.json', ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]),
    )
    const fresh = Object.fromEntries(
      BRIDGE_SENT_SCHEMAS.map((name) => [name, z.toJSONSchema(exportedSchemas[name as keyof typeof exportedSchemas], { io: 'output' })]),
    )
    expect(onDisk).toEqual(fresh)
  })

  /**
   * **The property that makes the set worth having**, asserted rather than
   * assumed: every outgoing schema refuses unknown keys. If a future zod or a
   * future classification quietly stopped emitting `additionalProperties`,
   * the files would still exist, still match a fresh export, and check
   * nothing — a guard whose success and whose no-op look identical.
   */
  it('every outgoing schema refuses unknown keys', () => {
    for (const name of BRIDGE_SENT_SCHEMAS) {
      const rendered = z.toJSONSchema(exportedSchemas[name as keyof typeof exportedSchemas], { io: 'output' }) as Record<string, unknown>
      expect(rendered.additionalProperties, `${name} must refuse unknown keys`).toBe(false)
    }
  })
})
