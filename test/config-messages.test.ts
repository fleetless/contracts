// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { robotConfigDoc } from '../src/config.js'

const schema = z.toJSONSchema(robotConfigDoc, { io: 'input' }) as Record<string, any>

/**
 * Every `pattern` and every `enum` the document holds, found without knowing
 * one JSON Schema keyword.
 *
 * This exists to check the walker below, not the schema. `collect` follows the
 * keywords somebody thought of — `properties`, `propertyNames`, `oneOf` and
 * four more — so a node reached by a keyword nobody listed (`$defs` behind a
 * `$ref`, a `prefixItems`, a `patternProperties`) is invisible to it, and a
 * count of 24 out of an unknown total looks exactly like a count of 24 out of
 * 24. This one descends into every object and array, so the two agreeing is
 * what makes the counts below mean "all of them".
 */
function countBlind(node: any, out = { patterns: 0, enums: 0 }) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.pattern === 'string') out.patterns += 1
  if (Array.isArray(node.enum)) out.enums += 1
  for (const value of Object.values(node)) countBlind(value, out)
  return out
}

/**
 * Every `pattern` and every `enum` anywhere in the document, as dotted paths.
 *
 * This walks rather than lists, for the reason `config-meta.test.ts` gives: a
 * list catches only what somebody remembered to add to it, and the nodes that
 * matter most here live inside a `oneOf` branch or under `propertyNames`,
 * which no hand-kept list has ever reached on its first try.
 */
function collect(node: any, path = '', out: { patterns: string[], enums: string[], nodes: Map<string, any> } = { patterns: [], enums: [], nodes: new Map() }) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.pattern === 'string') { out.patterns.push(path); out.nodes.set(path, node) }
  if (Array.isArray(node.enum)) { out.enums.push(path); out.nodes.set(path, node) }
  for (const [key, value] of Object.entries<any>(node.properties ?? {})) collect(value, `${path}.${key}`, out)
  if (node.additionalProperties && typeof node.additionalProperties === 'object') collect(node.additionalProperties, `${path}.<slug>`, out)
  if (node.propertyNames && typeof node.propertyNames === 'object') collect(node.propertyNames, `${path}{key}`, out)
  if (node.items && typeof node.items === 'object') collect(node.items, `${path}[]`, out)
  for (const kw of ['oneOf', 'anyOf', 'allOf']) (node[kw] ?? []).forEach((b: any, i: number) => collect(b, `${path}#${i}`, out))
  return out
}

const found = collect(schema)

/**
 * `patternErrorMessage` and `enumDescriptions` are read by whatever validates
 * against the exported JSON Schema, and by a person reading the artifact.
 *
 * In the console they were also the live pattern diagnostic for a while:
 * `useMonacoYaml.ts` still passes `validate: true`, so from task 7's artifacts
 * before the editor took that over, monaco-yaml showed these. Now the sentence a
 * developer sees comes from this schema's own parser and from the cloud, and
 * says the same thing. `src/config.ts` states the same beside the sentences,
 * so neither place reads as load-bearing on its own.
 *
 * **What this file cannot check.** Nothing here can tell a correct sentence
 * from a plausible wrong one — that is a reading, and the review does it. What
 * it can do is refuse the states where the sentences are structurally not
 * doing their job: missing, empty, identical to one another, or aligned to the
 * wrong value. The last of those is not tested at all but made
 * unrepresentable, in `src/config.ts`'s `describeValues`; the assertions below
 * are what catches the rest.
 */
describe('the format explains its own rules', () => {
  // The counts are the measurement of 2026-09-03. They are here so that a node
  // ADDED later without a sentence fails loudly rather than sliding under an
  // `.every()` over whatever is there.
  it('finds the patterns and enums this document has', () => {
    expect(found.patterns.length).toBe(24)
    expect(found.enums.length).toBe(6)
  })

  it('the keyword walker reached every one of them', () => {
    const blind = countBlind(schema)
    expect(blind.patterns, 'a pattern sits behind a keyword `collect` does not follow').toBe(found.patterns.length)
    expect(blind.enums, 'an enum sits behind a keyword `collect` does not follow').toBe(found.enums.length)
  })

  it('every pattern says its rule in words', () => {
    const missing = found.patterns.filter((p) => {
      const message = found.nodes.get(p).patternErrorMessage
      return typeof message !== 'string' || message.trim().length === 0
    })
    expect(missing, `no patternErrorMessage at: ${missing.join(', ')}`).toEqual([])
  })

  /**
   * Two checks, because they see different things and neither is the other's
   * weaker form.
   *
   * The **verbatim** one is exact and complete: the whole pattern, pasted
   * in. It is also the only thing it can see — a sentence that
   * quotes half the regex passes it, which is why it is not alone here.
   *
   * The **fragment** one is a heuristic and is written as one. It looks for
   * six substrings that occur in a regular expression and in no English
   * sentence about names, paths or URLs. It cannot prove a message is free of
   * regex; it catches the way this actually goes wrong, which is somebody
   * pasting a piece of the pattern in to be precise. If a legitimate sentence
   * ever needs one of these, remove that tell and say so here rather than
   * loosening both checks.
   *
   * Optional chaining on the verbatim check is deliberate. Without it an
   * absent message throws a `TypeError` naming nothing, and a run whose first
   * red is a TypeError sends the reader after the wrong cause — the assertion
   * above already names every node that is missing one.
   */
  const REGEX_TELLS = ['(?:', '[A-Za-z', '[a-z0-9', ']*', ']+', '\\/']

  it('no sentence quotes the regex back at the reader', () => {
    const quoting = found.patterns.filter((p) => {
      const node = found.nodes.get(p)
      return node.patternErrorMessage?.includes(node.pattern) === true
    })
    expect(quoting, `the pattern appears verbatim in its own message at: ${quoting.join(', ')}`).toEqual([])
  })

  it('no sentence pastes a fragment of the regex either', () => {
    const quoting = found.patterns.filter((p) => {
      const message: string = found.nodes.get(p).patternErrorMessage ?? ''
      return REGEX_TELLS.some((tell) => message.includes(tell))
    })
    expect(quoting, `regex syntax appears in the message at: ${quoting.join(', ')}`).toEqual([])
  })

  it('every enum value carries a description of its own', () => {
    const wrong = found.enums.filter((p) => {
      const node = found.nodes.get(p)
      if (!Array.isArray(node.enumDescriptions) || node.enumDescriptions.length !== node.enum.length) return true
      if (node.enumDescriptions.some((d: unknown) => typeof d !== 'string' || d.trim().length === 0)) return true
      // A failure mode in its own right: one paragraph repeated is
      // indistinguishable from no per-value documentation at all, and that is
      // exactly the state `enumDescriptions` was added to leave.
      return new Set(node.enumDescriptions).size !== node.enumDescriptions.length
    })
    expect(wrong, `enumDescriptions missing, empty, mis-sized or repeated at: ${wrong.join(', ')}`).toEqual([])
  })
})
