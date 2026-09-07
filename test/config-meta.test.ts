// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

/**
 * Every field the format documents must carry a hover text.
 *
 * A configuration editor renders `description` from the exported JSON Schema, so
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
 * So this walker enters `properties`, `additionalProperties` (`<slug>`),
 * `items` (`[]`), and every branch of `oneOf` / `anyOf` / `allOf` (`#0`, `#1`,
 * …). Measured 2026-09-02: the export inlines everything, no `$ref`, so the
 * walk terminates; it reaches 96 properties, 16 of them inside a union branch.
 *
 * **What it cannot see.** It does not enter `patternProperties`,
 * `prefixItems`, `not` or `if` — none of which today's export contains, so the
 * four paths above are exhaustive *for this document* and adding handling for
 * the others now would guard nothing. It also walks past `propertyNames`,
 * which the export does contain (10 occurrences, measured 2026-09-02); that
 * one is safe to skip by construction rather than by absence — it constrains
 * a key against the slug pattern and can never hold a `properties` map, so
 * there is no described-or-not field beneath it. Introducing one to the format — a zod
 * tuple exports as `prefixItems`, which is the plausible one — means teaching
 * this walker about it in the same change. It would otherwise walk past the
 * new field **silently**, which is the exact failure this test exists to close,
 * one level out.
 *
 * The `items` recursion is a live path but asserts nothing today: all three
 * arrays in the format are `enum[]` holding scalars, so it reaches 0
 * properties. It is here for the first array of objects the format grows.
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
  ['an alert condition', ['datapoints', 'alerts', 'condition']],
  ['an action', ['actions']],
  ['a service', ['services']],
  ['a publisher', ['publishers']],
  ['a parameter', ['actions', 'parameters']],
  ['a camera', ['cameras']]
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
   * The list above says what someone remembered. This says what is true.
   *
   * `NODES` cannot catch what nobody added to it, and `nodeAt` cannot enter a
   * union at all — so this is the only assertion that reaches a branch leaf
   * such as `cameras.<slug>.source#3.device`.
   *
   * Written and run in Task 1's fix round on 2026-09-02, where it listed **89**
   * undescribed paths, 16 of them inside `oneOf` branches; it was then skipped
   * because the rest of the wave had yet to describe the document. Unskipped in
   * Task 6, where it was also seen to go red twice on purpose — once on a plain
   * field (`datapoints.<slug>.numeric.unit`) and once on a branch leaf
   * (`cameras.<slug>.source#3.device`) — so that "green" here is a measurement
   * and not an instrument that cannot fail.
   */
  it('leaves no field of the document without a hover text', () => {
    expect(undescribed(schema)).toEqual([])
  })
})

/**
 * `cameras.<slug>.source` is the one place in the format where the hover has
 * work to do beyond documentation.
 *
 * A four-branch union exports as `oneOf`, and the yaml-language-server's
 * message for a failing `oneOf` names no branch — typically "matches multiple
 * schemas", pinned to the `source:` line rather than to the field that is
 * wrong. The branch descriptions are what a developer reads instead, so this
 * asserts one on **every branch** as well as on every field of every branch.
 *
 * `NODES` cannot cover this: `nodeAt` follows `properties`, a union has none,
 * and the exhaustive walker above stays skipped until Task 6.
 */
describe('every camera source branch carries a hover text', () => {
  it('describes each branch and each of its fields', () => {
    const source = nodeAt(['cameras']).properties.source
    const branches = source.oneOf ?? source.anyOf
    expect(Array.isArray(branches), 'cameraSource no longer exports as a union').toBe(true)
    expect(branches.length).toBe(4)
    for (const branch of branches) {
      const kind = branch.properties?.kind?.const ?? '(unknown kind)'
      expect(typeof branch.description, `branch ${kind} has no description`).toBe('string')
      for (const [key, value] of Object.entries<Record<string, any>>(branch.properties ?? {})) {
        expect(typeof value.description, `branch ${kind} → ${key} has no description`).toBe('string')
      }
    }
  })
})

/**
 * A `description:` field is the one position in the format where the developer
 * has to write prose, and the editor offering nothing there is the state item 3
 * describes: every sibling of `datapoints.<slug>.description` offered an
 * example and it did not, so the silent scalar positions included three
 * `description`s that simply lacked an `examples`.
 *
 * The reason this is a walk and not a list of three: a `description` added to a
 * sixth section later is the fourth instance of the same omission, and a list
 * would not know about it. The count is asserted so the walk cannot come back
 * empty and pass vacuously — the `.every()`-over-nothing failure this project
 * keeps finding.
 *
 * **The example is not free to be invented**, and that rule is enforced by
 * reading rather than by a test: every one of these values is the sentence the
 * corresponding snippet body already inserts at the same position, verbatim.
 * Two answers to one question is the drift three consecutive reviews in this
 * wave caught. `config-zod-messages.test.ts` asserts each example parses
 * against its own field; that the wording matches the snippet is the review's.
 */
describe('every description field offers an example', () => {
  /** Every property named `description`, as dotted paths, with its node. */
  function descriptions(node: Record<string, any>, path = '', out = new Map<string, any>()) {
    for (const [key, value] of Object.entries<Record<string, any>>(node.properties ?? {})) {
      if (key === 'description') out.set(`${path}.${key}`, value)
      descriptions(value, `${path}.${key}`, out)
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object')
      descriptions(node.additionalProperties, `${path}.<slug>`, out)
    if (node.items && typeof node.items === 'object') descriptions(node.items, `${path}[]`, out)
    for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const)
      (node[keyword] ?? []).forEach((branch: any, i: number) => descriptions(branch, `${path}#${i}`, out))
    return out
  }

  const found = descriptions(schema)

  it('found the description fields the format has', () => {
    // Five exposure kinds, plus a parameter's — which is one node reaching the
    // three sections that carry `parameters:`, so it is counted three times.
    expect(found.size).toBe(8)
  })

  it('leaves none of them without one', () => {
    const silent = [...found.entries()]
      .filter(([, node]) => !Array.isArray(node.examples) || node.examples.length === 0)
      .map(([path]) => path)
    expect(silent, `a description field offering nothing at: ${silent.join(', ')}`).toEqual([])
  })
})
