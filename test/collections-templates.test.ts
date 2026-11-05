// SPDX-License-Identifier: Apache-2.0
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  COLLECTION_JSON_TEMPLATES,
  collectionJsonTemplateName,
  parseDisplayTemplate,
  type CollectionJsonTemplateName,
} from '../src/index.js'

// Strict mode: a template that used an unknown keyword or a draft-07 spelling would not compile.
const ajv = new Ajv2020({ strict: true })
const validate = (name: CollectionJsonTemplateName, value: unknown): boolean => ajv.compile(COLLECTION_JSON_TEMPLATES[name])(value) as boolean

const examples: Record<CollectionJsonTemplateName, Record<string, unknown>> = {
  pose2d: { x: 1.5, y: -2, yaw: 0.3, frame_id: 'map' },
  point2d: { x: 0, y: 4.25, frame_id: 'map' },
  polygon2d: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], frame_id: 'map' },
  range1d: { from: 0, to: 10.5 },
}

const names = collectionJsonTemplateName.options

describe('the JSON templates', () => {
  it('are exactly pose2d, point2d, polygon2d and range1d', () => {
    expect([...names].sort()).toEqual(['point2d', 'polygon2d', 'pose2d', 'range1d'])
    expect(Object.keys(COLLECTION_JSON_TEMPLATES).sort()).toEqual([...names].sort())
  })

  it.each(names)('%s accepts its example and rejects a missing frame_id', (name) => {
    expect(validate(name, examples[name])).toBe(true)
    // `range1d` has no frame; it loses `to` instead.
    const dropped = name === 'range1d' ? 'to' : 'frame_id'
    const { [dropped]: _gone, ...rest } = examples[name]
    expect(validate(name, rest), `${name} without ${dropped}`).toBe(false)
  })

  it.each(names)('%s needs every property it lists and nothing else', (name) => {
    const schema = COLLECTION_JSON_TEMPLATES[name] as { type: string; properties: object; required: string[]; additionalProperties: boolean }
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
  })

  it('polygon2d needs three points', () => {
    const polygon = examples.polygon2d as { points: unknown[]; frame_id: string }
    expect(validate('polygon2d', { ...polygon, points: polygon.points.slice(0, 2) })).toBe(false)
    expect(validate('polygon2d', { ...polygon, points: [] })).toBe(false)
    expect(validate('polygon2d', { ...polygon, points: [...polygon.points, { x: 2, y: 2 }] })).toBe(true)
  })

  it('templates forbid extra properties', () => {
    for (const name of names) {
      expect(validate(name, { ...examples[name], extra: 1 }), name).toBe(false)
    }
    const polygon = examples.polygon2d as { points: object[]; frame_id: string }
    expect(validate('polygon2d', { ...polygon, points: [{ x: 0, y: 0, z: 1 }, ...polygon.points.slice(1)] })).toBe(false)
  })

  it('want numbers for coordinates and a string for the frame', () => {
    expect(validate('pose2d', { ...examples.pose2d, x: '1' })).toBe(false)
    expect(validate('pose2d', { ...examples.pose2d, yaw: null })).toBe(false)
    expect(validate('point2d', { ...examples.point2d, frame_id: 3 })).toBe(false)
    expect(validate('range1d', { from: 0, to: '5' })).toBe(false)
  })

  it('refuse values that are not objects', () => {
    for (const name of names) {
      for (const value of [null, 3, 'pose', [], [examples[name]]]) expect(validate(name, value), `${name} ${JSON.stringify(value)}`).toBe(false)
    }
  })

  it('cannot be changed by a consumer', () => {
    const pose = COLLECTION_JSON_TEMPLATES.pose2d as { required: string[]; properties: Record<string, unknown> }
    expect(Object.isFrozen(COLLECTION_JSON_TEMPLATES)).toBe(true)
    expect(Object.isFrozen(pose)).toBe(true)
    expect(Object.isFrozen(pose.required)).toBe(true)
    expect(Object.isFrozen(pose.properties.x)).toBe(true)
  })
})

describe('parseDisplayTemplate', () => {
  const ok = (template: string) => {
    const result = parseDisplayTemplate(template)
    if (!result.ok) throw new Error(`expected ${JSON.stringify(template)} to parse: ${result.message}`)
    return result.placeholders
  }
  const message = (template: string) => {
    const result = parseDisplayTemplate(template)
    if (result.ok) throw new Error(`expected ${JSON.stringify(template)} to be refused`)
    return result.message
  }

  it('finds a field placeholder and a reference hop', () => {
    expect(ok('{{name}}')).toEqual([{ raw: '{{name}}', path: ['name'] }])
    expect(ok('{{name}} ({{location.name}})')).toEqual([
      { raw: '{{name}}', path: ['name'] },
      { raw: '{{location.name}}', path: ['location', 'name'] },
    ])
  })

  it('allows spaces inside the braces, and keeps the placeholder as written', () => {
    expect(ok('{{ name }}')).toEqual([{ raw: '{{ name }}', path: ['name'] }])
    expect(ok('{{  location.name}}')).toEqual([{ raw: '{{  location.name}}', path: ['location', 'name'] }])
  })

  it('accepts text without placeholders, an empty template and lone braces', () => {
    expect(ok('Charger')).toEqual([])
    expect(ok('')).toEqual([])
    expect(ok('{ not a placeholder } and }} stray')).toEqual([])
  })

  it('finds the same placeholder twice, in order', () => {
    expect(ok('{{a}}-{{b}}-{{a}}').map((p) => p.path[0])).toEqual(['a', 'b', 'a'])
  })

  it('refuses more than two segments', () => {
    expect(message('{{a.b.c}}')).toContain('{{a.b.c}}')
  })

  it('refuses an unclosed {{', () => {
    expect(message('{{name')).toContain('{{')
    expect(message('{{name}} and {{other')).toMatch(/position 14/)
  })

  it('refuses an empty placeholder and one with something other than keys', () => {
    for (const template of ['{{}}', '{{ }}', '{{.}}', '{{a.}}', '{{.a}}', '{{A}}', '{{1a}}', '{{a-b}}', '{{a b}}', '{{ a . b }}', '{{{a}}}']) {
      const result = parseDisplayTemplate(template)
      expect(result.ok, template).toBe(false)
    }
  })

  it('says which placeholder is wrong when there are several', () => {
    expect(message('{{good}} {{bad-one}}')).toContain('{{bad-one}}')
  })
})
