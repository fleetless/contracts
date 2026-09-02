import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

/**
 * Every field the format documents must carry a hover text.
 *
 * The editor (FL-004) renders `description` from the exported JSON Schema, so
 * a field without one is a field a developer hovers and learns nothing from.
 * This test is the wave's own guarantee: a new field added later without a
 * description fails here rather than shipping a blank tooltip.
 *
 * `NODES` grows one entry per task. A node listed here is a node whose every
 * property must be described.
 */
const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>

/**
 * A section is a map keyed by slug: it exports as
 * `{ type, propertyNames, additionalProperties }` with **no `properties`**.
 * The interesting node is the value schema inside it, so stepping into
 * `datapoints` must land on the datapoint, not on the map around it.
 * Measured on 2026-09-02: `z.toJSONSchema(robotConfigDoc)` inlines
 * everything — no `$defs`, no `$ref` — so a plain walk is enough.
 */
function unwrap(node: Record<string, any>): Record<string, any> {
  let here = node
  while (here.properties === undefined
    && here.additionalProperties
    && typeof here.additionalProperties === 'object') {
    here = here.additionalProperties
  }
  return here
}

/** Walk to a named node by the path a value takes through the document. */
function nodeAt(path: string[]): Record<string, any> {
  let here = unwrap(schema)
  for (const step of path) {
    const next = here.properties?.[step]
    if (next === undefined) throw new Error(`no schema node at ${path.join('.')} (stopped at "${step}")`)
    here = unwrap(next)
  }
  return here
}

/** Node label → the path that reaches it from the document root. */
const NODES: Array<[string, string[]]> = [
  ['the document root', []]
]

describe('every documented field carries a hover text', () => {
  for (const [label, path] of NODES) {
    it(label, () => {
      const node = nodeAt(path)
      const properties = node.properties ?? {}
      expect(Object.keys(properties).length).toBeGreaterThan(0)
      for (const [key, value] of Object.entries<Record<string, any>>(properties)) {
        expect(typeof value.description, `${label} → ${key} has no description`).toBe('string')
        expect(value.description.trim().length, `${label} → ${key} has an empty description`).toBeGreaterThan(0)
      }
    })
  }
})
