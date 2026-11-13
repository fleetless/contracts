// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { cloudConfig, robotConfigDoc, schemaIssues, FLEETLESS_FORMAT_VERSION } from '../src/index.js'

/**
 * With any `live.encoder` but `software` the bridge sends H.264, which takes
 * no odd width or height. The document refuses such a camera where it is
 * written, one issue per odd key, rather than leaving it to a black picture.
 */

const HARDWARE = ['auto', 'nvenc', 'vaapi', 'v4l2'] as const

const camera = (width: unknown, height: unknown, source: object = { kind: 'v4l2', device: '/dev/video0' }) => ({
  source, width, height, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5,
})

const doc = (cameras: Record<string, unknown>, live?: object) => ({
  fleetless: FLEETLESS_FORMAT_VERSION,
  cameras,
  ...(live === undefined ? {} : { live }),
})

const widthMessage = (encoder: string, n: number) =>
  `With live.encoder: ${encoder} the bridge sends H.264, which takes no odd width: set an even width instead of ${n}, or live.encoder: software.`
const heightMessage = (encoder: string, n: number) =>
  `With live.encoder: ${encoder} the bridge sends H.264, which takes no odd height: set an even height instead of ${n}, or live.encoder: software.`

const issuesOf = (value: unknown) => {
  const result = robotConfigDoc.safeParse(value)
  return result.success ? [] : result.error.issues
}

describe('a hardware encoder and a camera of odd size', () => {
  for (const encoder of HARDWARE) {
    it(`refuses an odd width with ${encoder}, at the width`, () => {
      const issues = issuesOf(doc({ front: camera(641, 480) }, { encoder }))
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ code: 'custom', path: ['cameras', 'front', 'width'], message: widthMessage(encoder, 641) })
    })

    it(`refuses an odd height with ${encoder}, at the height`, () => {
      const issues = issuesOf(doc({ front: camera(640, 481) }, { encoder }))
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ code: 'custom', path: ['cameras', 'front', 'height'], message: heightMessage(encoder, 481) })
    })

    it(`refuses both with ${encoder}, one issue per key`, () => {
      const issues = issuesOf(doc({ front: camera(641, 481) }, { encoder }))
      expect(issues.map((i) => i.path)).toEqual([['cameras', 'front', 'width'], ['cameras', 'front', 'height']])
      expect(issues.map((i) => i.message)).toEqual([widthMessage(encoder, 641), heightMessage(encoder, 481)])
    })

    it(`accepts even sizes with ${encoder}`, () => {
      expect(robotConfigDoc.safeParse(doc({ front: camera(640, 480), wide: camera(1920, 1080) }, { encoder })).success).toBe(true)
    })
  }

  it('accepts an odd size with software, as before', () => {
    expect(robotConfigDoc.safeParse(doc({ front: camera(641, 481) }, { encoder: 'software' })).success).toBe(true)
  })

  it('accepts an odd size without the key, and without the section', () => {
    // The ROS parameter may still name a hardware encoder; the bridge
    // refuses the live start then. The document cannot know.
    expect(robotConfigDoc.safeParse(doc({ front: camera(641, 481) }, {})).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc({ front: camera(641, 481) }, { max_packet_bytes: 1200 })).success).toBe(true)
    expect(robotConfigDoc.safeParse(doc({ front: camera(641, 481) })).success).toBe(true)
  })

  it('refuses a passthrough camera of odd size too: one rule, no exception', () => {
    const source = { kind: 'rtsp', url: 'rtsp://cam-1.plant.local/stream1', passthrough: true }
    const issues = issuesOf(doc({ door: camera(641, 480, source) }, { encoder: 'nvenc' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.path).toEqual(['cameras', 'door', 'width'])
    const height = issuesOf(doc({ door: camera(640, 481, source) }, { encoder: 'nvenc' }))
    expect(height).toHaveLength(1)
    expect(height[0]).toMatchObject({ path: ['cameras', 'door', 'height'], message: heightMessage('nvenc', 481) })
  })

  it('says it once for the one camera that is odd, not for its neighbours', () => {
    const issues = issuesOf(doc({ front: camera(1280, 720), rear: camera(640, 481) }, { encoder: 'auto' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.path).toEqual(['cameras', 'rear', 'height'])
  })

  it('reports beside the document\'s other refusals, not after they are fixed', () => {
    const value = { ...doc({ front: camera(641, 480) }, { encoder: 'vaapi' }), datapoints: { battery: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', fild: 'x' } } }
    const issues = issuesOf(value)
    expect(issues.map((i) => i.code).sort()).toEqual(['custom', 'unrecognized_keys'])
    expect(issues.find((i) => i.code === 'custom')!.path).toEqual(['cameras', 'front', 'width'])
  })

  it('adds nothing to a size that is already refused for itself', () => {
    for (const width of [7681, -1, '641', null]) {
      const issues = issuesOf(doc({ front: camera(width, 480) }, { encoder: 'nvenc' }))
      expect(issues, JSON.stringify(width)).toHaveLength(1)
      expect(issues[0]!.code, JSON.stringify(width)).not.toBe('custom')
      expect(issues[0]!.path).toEqual(['cameras', 'front', 'width'])
    }
  })

  /**
   * The one refusal the rule does not report beside. Zod treats a fraction on
   * an integer key as final and runs no `when` check after it, so the odd
   * size is reported once the fraction is fixed. Held here so that a zod
   * upgrade that changes it is noticed, in either direction.
   */
  it('waits for a fraction on an integer key anywhere in the document', () => {
    const rearFps = { ...camera(640, 480), fps: 7.5 }
    const issues = issuesOf(doc({ front: camera(641, 480), rear: rearFps }, { encoder: 'nvenc' }))
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_type', ['cameras', 'rear', 'fps']]])
    // The odd key's own fraction: that key's refusal alone, here as everywhere.
    const own = issuesOf(doc({ front: camera(641.5, 481) }, { encoder: 'nvenc' }))
    expect(own.map((i) => [i.code, i.path])).toEqual([['invalid_type', ['cameras', 'front', 'width']]])
    // With the fraction fixed, the finding arrives.
    const fixed = issuesOf(doc({ front: camera(641, 480), rear: { ...rearFps, fps: 7 } }, { encoder: 'nvenc' }))
    expect(fixed.map((i) => i.path)).toEqual([['cameras', 'front', 'width']])
  })

  it('lands inside the bridge frame at the camera\'s key under doc', () => {
    const result = cloudConfig.safeParse({ type: 'config', version: 3, doc: doc({ front: camera(641, 480) }, { encoder: 'v4l2' }) })
    expect(result.success).toBe(false)
    const issues = result.success ? [] : result.error.issues
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['doc', 'cameras', 'front', 'width'], message: widthMessage('v4l2', 641) })
  })

  it('adds nothing when the encoder itself is refused', () => {
    const issues = issuesOf(doc({ front: camera(641, 481) }, { encoder: 'nvidia' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.path).toEqual(['live', 'encoder'])
  })

  it('reads a malformed section or camera without throwing', () => {
    for (const cameras of [7, 'front', null, [camera(641, 481)], { front: null }, { front: 3 }, { front: { width: 641 } }]) {
      expect(() => robotConfigDoc.safeParse({ fleetless: FLEETLESS_FORMAT_VERSION, cameras, live: { encoder: 'nvenc' } }), JSON.stringify(cameras)).not.toThrow()
    }
    for (const live of [7, 'nvenc', null, ['nvenc']]) {
      expect(() => robotConfigDoc.safeParse(doc({ front: camera(641, 481) }, live as object)), JSON.stringify(live)).not.toThrow()
    }
  })

  it('reaches a validation issue with its path, its slug and the sentence', () => {
    const value = doc({ front: camera(641, 480) }, { encoder: 'nvenc' })
    const result = robotConfigDoc.safeParse(value)
    expect(result.success).toBe(false)
    expect(schemaIssues(value, result.success ? [] : result.error.issues)).toEqual([
      { path: 'cameras.front.width', slug: 'front', code: 'custom', message: widthMessage('nvenc', 641), severity: 'error' },
    ])
  })

  it('is not in the exported JSON Schema: a rule across two sections', () => {
    const ajv = new (Ajv2020 as any)({ strict: false })
    ;(addFormats as any)(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(new URL('../artifacts/schema/robot-config-doc.schema.json', import.meta.url), 'utf8')))
    expect(validate(doc({ front: camera(641, 481) }, { encoder: 'nvenc' }))).toBe(true)
  })
})

describe('the rule, said where the editor shows it', () => {
  const published = JSON.parse(readFileSync(new URL('../artifacts/schema/robot-config-doc.schema.json', import.meta.url), 'utf8'))
  const cameraProperties = published.properties.cameras.additionalProperties.properties
  const encoder = published.properties.live.properties.encoder

  it('in the descriptions of width and height', () => {
    expect(cameraProperties.width.description).toContain('With any `live.encoder` but `software` the width must be even')
    expect(cameraProperties.height.description).toContain('With any `live.encoder` but `software` the height must be even')
  })

  it('in the description of live.encoder, for every camera', () => {
    expect(encoder.description).toContain('every camera\'s `width` and `height` must be even, passthrough cameras included')
  })

  it('names the three vaapi elements in the order they are tried', () => {
    const vaapi: string = encoder.enumDescriptions[encoder.enum.indexOf('vaapi')]
    const order = ['`vah264enc`', '`vah264lpenc`', '`vaapih264enc`'].map((name) => vaapi.indexOf(name))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('in the frame the bridge receives, too', () => {
    const framed = JSON.parse(readFileSync(new URL('../artifacts/schema/cloud-config.schema.json', import.meta.url), 'utf8'))
    expect(framed.properties.doc.properties.cameras.additionalProperties.properties.width.description).toBe(cameraProperties.width.description)
  })
})
