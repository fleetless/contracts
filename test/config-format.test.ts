import { describe, expect, it } from 'vitest'
import { slug, RESERVED_SLUGS, parameterSpec, parameterType } from '../src/index.js'

describe('name grammar', () => {
  it('accepts lowercase words joined by single underscores', () => {
    for (const ok of ['battery_soc', 'dock', 'linear_speed', 'stop_twist', 'cam1']) {
      expect(slug.safeParse(ok).success, ok).toBe(true)
    }
  })

  it('refuses dashes, capitals, doubled and edge underscores, and a leading digit', () => {
    for (const bad of ['battery-soc', 'Battery', 'battery__soc', '_soc', 'dock_', '1st_cam', 'a']) {
      expect(slug.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('reserves three built-in slugs, spelled with underscores', () => {
    expect(RESERVED_SLUGS).toEqual(['bridge_state', 'robot_details', 'bridge_pressure'])
  })
})

describe('parameter', () => {
  it('requires a type from the closed ROS 2 list', () => {
    expect(parameterType.safeParse('float64').success).toBe(true)
    expect(parameterType.safeParse('double').success).toBe(false)
    expect(parameterSpec.safeParse({ min_value: 0 }).success).toBe(false)
  })

  it('allows min_value and max_value on numbers, and refuses regex there', () => {
    expect(parameterSpec.safeParse({ type: 'float64', min_value: -0.5, max_value: 0.5 }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float64', regex: '^a' }).success).toBe(false)
  })

  it('refuses an enum on a float, because equality on floating point is unreliable', () => {
    expect(parameterSpec.safeParse({ type: 'int32', enum: [1, 2] }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'float64', enum: [1.5] }).success).toBe(false)
  })

  it('allows enum and regex on strings, and refuses min_value there', () => {
    expect(parameterSpec.safeParse({ type: 'string', enum: ['idle'], regex: '^i' }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'string', min_value: 1 }).success).toBe(false)
  })

  it('gives bool no constraints at all', () => {
    expect(parameterSpec.safeParse({ type: 'bool' }).success).toBe(true)
    expect(parameterSpec.safeParse({ type: 'bool', enum: [true] }).success).toBe(false)
  })

  it('has no `required` field — absence of `default` is what makes it required', () => {
    const parsed = parameterSpec.parse({ type: 'float64' })
    expect('required' in parsed).toBe(false)
    expect(parsed.default).toBeUndefined()
  })

  it('refuses reversed bounds', () => {
    expect(parameterSpec.safeParse({ type: 'int32', min_value: 5, max_value: 1 }).success).toBe(false)
  })
})
