import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>

/** A node by the path a value takes through the document; `<slug>` steps into a map. */
function nodeAt(path: string[]): Record<string, any> {
  let here: Record<string, any> = schema
  for (const step of path) {
    const next = step === '<slug>' ? here.additionalProperties : here.properties?.[step]
    if (!next || typeof next !== 'object') throw new Error(`no node at ${path.join('.')} (stopped at "${step}")`)
    here = next
  }
  return here
}

/**
 * The six sections. A developer who writes `cameras:` and presses ⏎ has asked
 * what goes there, and before this wave the editor answered with words scraped
 * out of their own document.
 */
const SECTIONS = ['messages', 'datapoints', 'actions', 'services', 'publishers', 'cameras']

describe('every section offers a whole entry', () => {
  for (const section of SECTIONS) {
    it(section, () => {
      const snippets = nodeAt([section]).defaultSnippets
      expect(Array.isArray(snippets), `${section} carries no defaultSnippets`).toBe(true)
      expect(snippets.length).toBeGreaterThan(0)
      for (const snippet of snippets) {
        expect(typeof snippet.label, `${section} snippet has no label`).toBe('string')
        expect(snippet.label.trim().length).toBeGreaterThan(0)
        expect(snippet.body, `${section} snippet has no body`).toBeTypeOf('object')
      }
    })
  }

  /**
   * The snippet must be writable as it stands. A body that does not validate is
   * a body that inserts a document the format then refuses — which is worse
   * than offering nothing, because the developer trusts it.
   *
   * Placeholders are stripped first: `${1:front}` is snippet syntax, not a
   * value. A placeholder with a default becomes its default; a bare `$1`
   * becomes an empty string, which several fields legitimately refuse — so a
   * snippet whose body needs a value must supply one as a default.
   *
   * `\$` is stripped last, and it is the reason this walk is not a plain
   * placeholder substitution. The format's own parameter syntax is `${name}`,
   * which the snippet engine reads as a variable it cannot resolve and
   * **deletes** — measured against monaco-editor 0.52.2's own `SnippetParser`:
   * `x: ${speed}` inserts `x: `, `x: \${speed}` inserts `x: ${speed}`.
   *
   * ## What this test decides, and what it cannot
   *
   * It decides that a body's **values as authored** are values the format
   * accepts. It does **not** decide that the document the editor inserts is
   * one the format accepts, and a green here is not evidence of that. Three
   * ways the two come apart, all live:
   *
   * - `fill()` undoes snippet syntax and **not YAML quoting**. The numeric
   *   datapoint's `unit` is authored `'"%"'` — quotes included, deliberately,
   *   because a bare `%` is a YAML directive indicator that breaks the insert
   *   — so this test checks a **three-character** string while the editor
   *   inserts `unit: "%"` and the document ends up holding `%`. Both spellings
   *   satisfy `z.string().max(32)`, which is the only reason this passes.
   *   Narrow that field and this test would go red on the value the editor
   *   really produces, or green on one it cannot.
   * - A body scalar whose text YAML refuses unquoted passes here and breaks
   *   the insert. This walk sees an object; the editor writes text first, and
   *   yaml-language-server emits body strings **verbatim**, quoting nothing.
   * - Nothing here sees what the console does to the schema on the way. It
   *   maps the export before handing it to monaco-yaml, and a body is an
   *   ordinary object to a walk that does not know what `defaultSnippets` is.
   *
   * Reproducing any of that here would mean a second model of somebody else's
   * pipeline, and a pipeline model that skips a stage does not say "I cannot
   * tell" — it says OK. So it is not modelled here. The check that sees all
   * three is the round trip in `console/test/monaco-yaml-config.test.ts`,
   * which asserts over the **actual options object** handed to monaco-yaml:
   * every `defaultSnippets` body in it inserts a document `robotConfigDoc`
   * accepts. That is where a claim about the insert belongs; this file's claim
   * stops at the values.
   */
  it('is authored from values the format accepts', () => {
    const fill = (node: unknown): unknown => {
      if (typeof node === 'string') {
        return node
          .replace(/\$\{\d+:([^}]*)\}/g, '$1')
          .replace(/\$\d+/g, '')
          .replace(/\\\$/g, '$')
      }
      if (Array.isArray(node)) return node.map(fill)
      if (node && typeof node === 'object') {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [String(fill(k)), fill(v)]))
      }
      return node
    }
    for (const section of SECTIONS) {
      for (const snippet of nodeAt([section]).defaultSnippets) {
        const doc = { fleetless: 1, [section]: fill(snippet.body) }
        const parsed = robotConfigDoc.safeParse(doc)
        expect(parsed.success, `${section} snippet "${snippet.label}" does not parse: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
      }
    }
  })
})
