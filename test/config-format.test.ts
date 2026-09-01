import { describe, expect, it } from 'vitest'
import { slug, RESERVED_SLUGS } from '../src/index.js'

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
