// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { robotConfigDoc, liveSection, LIVE_DEFAULTS, LIVE_BOUNDS, FLEETLESS_FORMAT_VERSION } from '../src/index.js'

const DOC = { fleetless: FLEETLESS_FORMAT_VERSION, datapoints: { battery: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage' } } }

const artifact = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', name), 'utf8'))

describe('the live section', () => {
  it('is optional, and so is each of its keys', () => {
    expect(robotConfigDoc.safeParse(DOC).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, live: {} }).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, live: { max_packet_bytes: 1200 } }).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, live: { encoder: 'nvenc' } }).success).toBe(true)
    expect(robotConfigDoc.safeParse({ ...DOC, live: { max_packet_bytes: 1200, encoder: 'auto' } }).success).toBe(true)
  })

  it('accepts the bounds and what lies between them', () => {
    for (const bytes of [576, 1200, 1350]) {
      expect(liveSection.safeParse({ max_packet_bytes: bytes }).success, String(bytes)).toBe(true)
    }
  })

  it('refuses a value outside the bounds, a fraction and a string', () => {
    for (const bytes of [575, 1351, 1356, 1400, 1200.5, '1200', true, null]) {
      expect(liveSection.safeParse({ max_packet_bytes: bytes }).success, String(bytes)).toBe(false)
      // And the whole document refuses it too, not only the section on its own.
      expect(robotConfigDoc.safeParse({ ...DOC, live: { max_packet_bytes: bytes } }).success, String(bytes)).toBe(false)
    }
  })

  it('refuses an unknown key, so a typo is not a setting that silently does nothing', () => {
    const refused = robotConfigDoc.safeParse({ ...DOC, live: { max_packet_byte: 1200 } })
    expect(refused.success).toBe(false)
    expect(refused.success === false && refused.error.issues[0]!.code).toBe('unrecognized_keys')
    expect(refused.success === false && refused.error.issues[0]!.path).toEqual(['live'])
  })

  it('refuses a section that is not a mapping', () => {
    expect(robotConfigDoc.safeParse({ ...DOC, live: 1200 }).success).toBe(false)
    expect(robotConfigDoc.safeParse({ ...DOC, live: null }).success).toBe(false)
  })

  it('ships the default to constants.json for the bridge, inside its own bounds', () => {
    expect(artifact('constants.json').LIVE_DEFAULTS).toEqual(LIVE_DEFAULTS)
    expect(LIVE_DEFAULTS).toEqual({ max_packet_bytes: 1200, encoder: 'software' })
    expect(liveSection.safeParse(LIVE_DEFAULTS).success).toBe(true)
  })

  it('ships the bounds to constants.json too, and the schema states the same numbers', () => {
    expect(artifact('constants.json').LIVE_BOUNDS).toEqual(LIVE_BOUNDS)
    expect(LIVE_BOUNDS).toEqual({
      max_packet_bytes: { min: 576, max: 1350 },
      encoder: { values: ['software', 'auto', 'nvenc', 'vaapi', 'v4l2'] },
    })
    const published = artifact('schema/robot-config-doc.schema.json').properties.live.properties.max_packet_bytes
    expect({ min: published.minimum, max: published.maximum }).toEqual(LIVE_BOUNDS.max_packet_bytes)
  })

  it('publishes the bounds in the schema the editor and the bridge read', () => {
    const live = artifact('schema/robot-config-doc.schema.json').properties.live
    expect(live.additionalProperties).toBe(false)
    expect(live.properties.max_packet_bytes).toMatchObject({ type: 'integer', minimum: 576, maximum: 1350 })
    expect(live.required ?? []).toEqual([])
    // The frame the bridge receives carries the same document.
    const framed = artifact('schema/cloud-config.schema.json').properties.doc.properties.live
    expect(framed.properties.max_packet_bytes).toMatchObject({ minimum: 576, maximum: 1350 })
  })

  it('takes the five encoders and no other', () => {
    for (const encoder of ['software', 'auto', 'nvenc', 'vaapi', 'v4l2']) {
      expect(liveSection.safeParse({ encoder }).success, encoder).toBe(true)
      expect(robotConfigDoc.safeParse({ ...DOC, live: { encoder } }).success, encoder).toBe(true)
    }
    for (const encoder of ['hardware', 'x264', 'NVENC', 'nvenc ', '', 'none', 0, true, null, ['nvenc']]) {
      expect(liveSection.safeParse({ encoder }).success, JSON.stringify(encoder)).toBe(false)
      expect(robotConfigDoc.safeParse({ ...DOC, live: { encoder } }).success, JSON.stringify(encoder)).toBe(false)
    }
  })

  it('defaults the encoder to software, a value of its own enum', () => {
    expect(LIVE_DEFAULTS.encoder).toBe('software')
    expect(artifact('constants.json').LIVE_DEFAULTS.encoder).toBe('software')
    expect(LIVE_BOUNDS.encoder.values).toContain(LIVE_DEFAULTS.encoder)
  })

  it('ships the encoder values to constants.json, the same list the schema states', () => {
    const published = artifact('schema/robot-config-doc.schema.json').properties.live.properties.encoder
    expect(published.enum).toEqual([...LIVE_BOUNDS.encoder.values])
    expect(artifact('constants.json').LIVE_BOUNDS.encoder).toEqual({ values: published.enum })
    // The frame the bridge receives carries the same enum.
    const framed = artifact('schema/cloud-config.schema.json').properties.doc.properties.live.properties.encoder
    expect(framed.enum).toEqual(published.enum)
  })

  it('describes every encoder value, in the order of the enum', () => {
    const published = artifact('schema/robot-config-doc.schema.json').properties.live.properties.encoder
    expect(published.enumDescriptions).toHaveLength(published.enum.length)
    // Each sentence is about its own value: the hardware ones name their element.
    const by = Object.fromEntries(published.enum.map((v: string, i: number) => [v, published.enumDescriptions[i]]))
    expect(by.software).toContain('CPU')
    expect(by.auto).toContain('`nvenc`, then `vaapi`, then `v4l2`')
    expect(by.nvenc).toContain('nvv4l2h264enc')
    expect(by.vaapi).toContain('vah264enc')
    expect(by.v4l2).toContain('v4l2h264enc')
    expect(published.description).toContain('`live.encoder`')
  })
})
