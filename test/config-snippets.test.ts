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
   * `x: ${speed}` inserts `x: `, `x: \${speed}` inserts `x: ${speed}`. So every
   * format placeholder in a body is written escaped, and what this test parses
   * is therefore what the editor actually inserts rather than what the body
   * literally holds.
   *
   * **What this test still cannot see, stated rather than implied away.** It
   * walks the body as an object; the editor writes it out as YAML text first,
   * and a body string is emitted with no quoting of any kind. A scalar that
   * YAML refuses unquoted — `%` is the one in this file, a directive
   * indicator — therefore breaks the insert while passing here, because the
   * object never became text. That gap was closed once by measurement
   * (rendering every body through yaml-language-server's own
   * `stringifyObject`, monaco's `SnippetParser` and a real YAML parser); it is
   * not closed by this file, which would need both of those as dependencies.
   */
  it('inserts a document the format accepts', () => {
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
