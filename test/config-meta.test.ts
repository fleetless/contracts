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

/**
 * Every property anywhere in the document that carries no usable
 * `description`, as dotted paths.
 *
 * `nodeAt` follows `properties` and nothing else, and **a union has no
 * `properties`**: `cameras.<slug>.source` is a four-branch `oneOf` holding
 * twelve leaves, and `parameters.<slug>.default` and `.enum` are `anyOf`s.
 * A `.meta()` on the wrapper alone would leave all of those blank while every
 * entry in `NODES` stayed green — the instrument would be unable to enter the
 * state it exists to detect.
 *
 * So this walker enters everything the format can express: `properties`,
 * `additionalProperties` (`<slug>`), `items` (`[]`), and every branch of
 * `oneOf` / `anyOf` / `allOf` (`#0`, `#1`, …). Measured 2026-09-02: the export
 * inlines everything, no `$ref`, so the walk terminates.
 */
function undescribed(node: Record<string, any>, path = ''): string[] {
  const under = (part: string) => (path === '' ? part.replace(/^\./, '') : `${path}${part}`)
  const described = (value: Record<string, any>) =>
    typeof value.description === 'string' && value.description.trim().length > 0

  const missing: string[] = []
  for (const [key, value] of Object.entries<Record<string, any>>(node.properties ?? {})) {
    const here = under(`.${key}`)
    if (!described(value)) missing.push(here)
    missing.push(...undescribed(value, here))
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object')
    missing.push(...undescribed(node.additionalProperties, under('.<slug>')))
  if (node.items && typeof node.items === 'object')
    missing.push(...undescribed(node.items, under('[]')))
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches: Array<Record<string, any>> = node[keyword] ?? []
    branches.forEach((branch, i) => missing.push(...undescribed(branch, under(`#${i}`))))
  }
  return missing
}

/** Node label → the path that reaches it from the document root. */
const NODES: Array<[string, string[]]> = [
  ['the document root', []],
  ['a datapoint', ['datapoints']],
  ['datapoint.numeric', ['datapoints', 'numeric']],
  ['datapoint.retention', ['datapoints', 'retention']],
  ['datapoint.chart', ['datapoints', 'chart']],
  ['a datapoint alert', ['datapoints', 'alerts']],
  ['an alert condition', ['datapoints', 'alerts', 'condition']]
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

  /**
   * Skipped until Task 6 of this wave, when the document is complete: tasks
   * 2–5 have yet to describe the rest of the format, so this is red by
   * construction until they land. **Unskip it in Task 6** — it is the only
   * assertion that covers a union branch, and `NODES` cannot replace it.
   *
   * Run once unskipped on 2026-09-02 before being skipped, so that "skipped"
   * is not indistinguishable from "cannot fail": it listed **89** paths,
   * 16 of them inside `oneOf` branches that `nodeAt` cannot reach at all —
   * `cameras.<slug>.source#0.topic`, `cameras.<slug>.source#1.credentials.password`,
   * `cameras.<slug>.source#3.device`.
   */
  it.skip('leaves no field of the document without a hover text', () => {
    expect(undescribed(schema)).toEqual([])
  })
})
