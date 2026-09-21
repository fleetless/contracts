// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  LATEST_BRIDGE_VERSION,
  bridgeHello,
  cloudHelloOk,
  datapointFrame,
  bridgeState,
  bridgeLinkMode,
  cloudPing,
  sunsetOf,
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

  it('a datapoint frame may say it is backfill, and says nothing when it is live', () => {
    const FRAME = { type: 'datapoint', slug: 'battery', value: 87.5, timestamp_ms: 1754800000000 }
    expect(datapointFrame.safeParse({ ...FRAME, backfill: true }).success).toBe(true)
    expect(datapointFrame.safeParse({ ...FRAME, backfill: 'yes' }).success).toBe(false)
    // Absent is the live case, and every bridge below protocol 3 sends only
    // that — so a frame without the flag must keep parsing.
    expect(datapointFrame.safeParse(FRAME).success).toBe(true)
  })

  it('slugs are lowercase, underscore-separated, letter-initial', () => {
    for (const good of ['battery', 'front_cam', 'bridge_state', 'ab']) {
      expect(slug.safeParse(good).success).toBe(true)
    }
    for (const bad of ['Battery', '1st', '_x', 'a', 'a-b', 'a b', 'foo_', 'a__b']) {
      expect(slug.safeParse(bad).success).toBe(false)
    }
  })

  it('protocol 3 is current, protocol 2 is deprecated with a sunset', () => {
    expect(PROTOCOL_VERSION).toBe(3)
    const two = PROTOCOL_VERSIONS.find((e) => e.version === 2)!
    expect(two.deprecated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sunsetOf(two)).toBe('2026-12-20')
    expect(PROTOCOL_VERSIONS.find((e) => e.version === 3)).toEqual({ version: 3, bridge_from: '4.0.0', deprecated_at: null })
  })

  it('ping carries the round trip and the lag, both nullable', () => {
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1, latency_ms: 42, lag_ms: 1200 }).success).toBe(true)
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1, latency_ms: null, lag_ms: null }).success).toBe(true)
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1 }).success).toBe(false)
    expect(cloudPing.safeParse({ type: 'ping', ts_ms: 1, latency_ms: -1, lag_ms: null }).success).toBe(false)
  })

  it('link_mode names the state, a reason and the bridge time', () => {
    expect(bridgeLinkMode.safeParse({ type: 'link_mode', low_bandwidth: true, reason: 'lag', at_ms: 1754800000000 }).success).toBe(true)
    expect(bridgeLinkMode.safeParse({ type: 'link_mode', low_bandwidth: false, reason: 'recovered', at_ms: 1 }).success).toBe(true)
    expect(bridgeLinkMode.safeParse({ type: 'link_mode', low_bandwidth: true, reason: 'tired', at_ms: 1 }).success).toBe(false)
  })

  it('bridge-state carries online, latency and the low-bandwidth flag', () => {
    expect(bridgeState.safeParse({ online: true, latency_ms: 42, low_bandwidth: false }).success).toBe(true)
    expect(bridgeState.safeParse({ online: false, latency_ms: null, low_bandwidth: false }).success).toBe(true)
    expect(bridgeState.safeParse({ online: true, latency_ms: 42 }).success).toBe(false)
  })

  it('api errors carry stable code + message', () => {
    expect(
      apiError.safeParse({ code: 'robot_offline', message: 'The robot is offline.' }).success,
    ).toBe(true)
    expect(apiError.safeParse({ message: 'nope' }).success).toBe(false)
  })

  it('hello_ok may carry the protocol status and the latest bridge version, and still parses without them', () => {
    expect(cloudHelloOk.safeParse({ type: 'hello_ok', robot_id: '3f2b6f0e-9b0c-4d1e-8a2f-1c2d3e4f5a6b' }).success).toBe(true)
    expect(
      cloudHelloOk.safeParse({
        type: 'hello_ok',
        robot_id: '3f2b6f0e-9b0c-4d1e-8a2f-1c2d3e4f5a6b',
        protocol: { status: 'deprecated', sunset_at: '2026-12-20' },
        bridge: { latest_version: '3.2.0' },
      }).success,
    ).toBe(true)
    expect(
      cloudHelloOk.safeParse({
        type: 'hello_ok',
        robot_id: '3f2b6f0e-9b0c-4d1e-8a2f-1c2d3e4f5a6b',
        protocol: { status: 'unsupported', sunset_at: null },
      }).success,
    ).toBe(false)
  })

  it('exports the version window into constants.json for the bridge', () => {
    const constants = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(constants.PROTOCOL_VERSION).toBe(PROTOCOL_VERSION)
    expect(constants.PROTOCOL_SUNSET_DAYS).toBe(90)
    expect(constants.PROTOCOL_VERSIONS).toEqual(PROTOCOL_VERSIONS)
    expect(constants.LATEST_BRIDGE_VERSION).toBe(LATEST_BRIDGE_VERSION)
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
    // test is the only guard against stale artifacts; using default
    // `toJSONSchema` options here would compare a fresh *output* render
    // against per-schema files — permanently red, for a reason unrelated to
    // staleness.
    const fresh = Object.fromEntries(
      Object.entries(exportedSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: schemaIo(name) })]),
    )
    expect(onDisk).toEqual(fresh)
  })

  /**
   * **The never-registered guard.** `pnpm artifacts` reporting no diff
   * cannot tell "already current" from "never registered for export" — a
   * schema left out of `exportedSchemas` produces no artifact and no
   * failing test, since there is nothing on disk to compare. The other half
   * is the same blindness in reverse: the export never deletes, so a schema
   * that left the map keeps its artifact on disk forever.
   */
  it('bridge-link-mode is registered for export as a bridge-sent frame; bridge-pressure is gone', () => {
    expect(BRIDGE_SENT_SCHEMAS).toContain('bridge-link-mode')
    expect(Object.keys(exportedSchemas)).not.toContain('bridge-pressure')
    expect(existsSync(join(import.meta.dirname, '..', 'artifacts', 'schema', 'bridge-pressure.schema.json'))).toBe(false)
    expect(existsSync(join(import.meta.dirname, '..', 'artifacts', 'schema-outgoing', 'bridge-link-mode.schema.json'))).toBe(true)
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
   * assumed: every outgoing schema refuses unknown keys. If zod or the
   * classification silently stopped emitting `additionalProperties`, the
   * files would still exist and still match a fresh export — a guard whose
   * success and no-op look identical.
   */
  it('every outgoing schema refuses unknown keys', () => {
    for (const name of BRIDGE_SENT_SCHEMAS) {
      const rendered = z.toJSONSchema(exportedSchemas[name as keyof typeof exportedSchemas], { io: 'output' }) as Record<string, unknown>
      expect(rendered.additionalProperties, `${name} must refuse unknown keys`).toBe(false)
    }
  })
})
