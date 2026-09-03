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

/**
 * A snippet body with its snippet syntax undone, so that the values it was
 * authored from can be judged against the format.
 *
 * **One helper, used by every assertion in this file.** There were three
 * copies of this walk and they had already diverged — two of them had lost the
 * `\$` un-escape — which is how the next fix lands in one copy and the other
 * two keep saying OK.
 *
 * Four syntaxes are undone, and each one is a way a green here would otherwise
 * mean nothing:
 *
 * - `${1:front}` — a placeholder with a default becomes its default.
 * - `$1` — a bare placeholder becomes the **empty string**, which several
 *   fields legitimately refuse; a snippet whose body needs a value must
 *   therefore supply one as a default.
 * - `${1|a,b|}` — a **choice** becomes its first option, because that is what
 *   the editor inserts for a developer who tabs past it. Measured against
 *   monaco-editor 0.52.2's own `SnippetParser`: it parses the body's
 *   `${2|sensor_msgs/msg/Image,sensor_msgs/msg/CompressedImage|}` into a
 *   placeholder carrying both options, and `toString()` — the text on the
 *   buffer before anyone chooses — is `sensor_msgs/msg/Image`.
 * - `\$` is undone **last**, and it is the reason this is a walk rather than a
 *   plain placeholder substitution. The format's own parameter syntax is
 *   `${name}`, which the snippet engine reads as a variable it cannot resolve
 *   and **deletes** — measured against the same `SnippetParser`: `x: ${speed}`
 *   inserts `x: `, `x: \${speed}` inserts `x: ${speed}`.
 */
function fill(node: unknown): unknown {
  if (typeof node === 'string') {
    return node
      .replace(/\$\{\d+\|([^|}]*)\|\}/g, (_m, options: string) => options.split(',')[0]!)
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

/**
 * Every assertion in this file runs on `fill()`'s output, so a `fill()` that
 * quietly stops undoing one of the four syntaxes makes all of them green and
 * meaningless at once. It is the one thing here that has to be checked
 * directly rather than through what it feeds.
 */
describe('the snippet stripper undoes what the editor resolves', () => {
  it.each([
    ['a placeholder with a default', '${1:front}', 'front'],
    ['a bare placeholder', 'x$1', 'x'],
    ['a choice, which inserts its first option', '${1|tcp,udp|}', 'tcp'],
    ['a choice holding slashes', '${2|sensor_msgs/msg/Image,sensor_msgs/msg/CompressedImage|}', 'sensor_msgs/msg/Image'],
    ['an escaped parameter, which the editor inserts literally', '\\${speed}', '${speed}'],
    ['a URL built from two placeholders', 'rtsp://${1:host}/${2:stream1}', 'rtsp://host/stream1'],
  ])('%s', (_what, authored, inserted) => {
    expect(fill(authored)).toBe(inserted)
  })

  it('walks keys and nested values, not just top-level strings', () => {
    expect(fill({ '${1:front}': { a: ['$2', { b: '${3:deep}' }] } })).toEqual({ front: { a: ['', { b: 'deep' }] } })
  })
})

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
   * `fill()` above undoes the snippet syntax first; what that walk handles, and
   * why each part of it is load-bearing, is documented there.
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
   * - **A snippet syntax `fill()` does not undo passes straight through into
   *   `safeParse`, as literal text.** Choice placeholders were exactly this
   *   until the four camera sources needed one: no regex here matched
   *   `${1|a,b|}`, so a field with a pattern (`topic`, `url`, `device`) would
   *   have gone red on the raw syntax — noisily, and for the wrong reason —
   *   while any plain bounded string (`description`, `unit`, `username`) went
   *   **green on a value the editor can never insert**. That is the shape to
   *   watch for: this list grows by one every time the bodies learn a syntax
   *   the walk does not.
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
    for (const section of SECTIONS) {
      for (const snippet of nodeAt([section]).defaultSnippets) {
        const doc = { fleetless: 1, [section]: fill(snippet.body) }
        const parsed = robotConfigDoc.safeParse(doc)
        expect(parsed.success, `${section} snippet "${snippet.label}" does not parse: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
      }
    }
  })
})

/**
 * The four camera sources. `source:` is where this wave's complaint started: a
 * developer who has written `source:` and pressed ⏎ is standing in front of a
 * four-branch union, and the editor said nothing at all there.
 *
 * The snippets sit on the branches rather than on the union, so a label cannot
 * drift from the branch it describes and a fifth source cannot be added
 * without one — this test counts the branches and fails if it is.
 */
describe('every camera source offers its own skeleton', () => {
  const source = () => nodeAt(['cameras', '<slug>', 'source'])

  it('one snippet per branch, each labelled by its kind', () => {
    const branches = source().oneOf ?? source().anyOf
    expect(Array.isArray(branches), 'cameraSource no longer exports as a union').toBe(true)
    expect(branches.length).toBe(4)
    const kinds: string[] = []
    for (const branch of branches) {
      const kind = branch.properties?.kind?.const
      kinds.push(kind)
      expect(Array.isArray(branch.defaultSnippets), `branch ${kind} carries no defaultSnippets`).toBe(true)
      expect(branch.defaultSnippets.length).toBe(1)
      const [snippet] = branch.defaultSnippets
      // The label has to name the kind, or the four rows are indistinguishable
      // in a picker that shows nothing else.
      expect(snippet.label).toContain(kind)
      // The body must select its own branch, or picking "rtsp" writes something
      // the format then reads as a different source.
      expect(snippet.body.kind, `branch ${kind} snippet does not set kind`).toBe(kind)
    }
    expect(kinds).toEqual(['ros', 'rtsp', 'mjpeg', 'v4l2'])
  })

  it('each source snippet is a camera the format accepts', () => {
    const branches = source().oneOf ?? source().anyOf
    for (const branch of branches) {
      const body = fill(branch.defaultSnippets[0].body)
      const doc = {
        fleetless: 1,
        cameras: { front: { source: body, width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5 } }
      }
      const parsed = robotConfigDoc.safeParse(doc)
      expect(parsed.success, `${branch.properties.kind.const}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })

  it('credentials offers a skeleton too', () => {
    const rtsp = (source().oneOf ?? source().anyOf).find((b: any) => b.properties?.kind?.const === 'rtsp')
    expect(Array.isArray(rtsp.properties.credentials.defaultSnippets)).toBe(true)
    /**
     * And the block it offers is one the format accepts, in the position it is
     * offered from. `credentials` is the one node in this file whose snippet
     * the source-branch walk above never reaches — it is nested a level below
     * the branch body — so without this it would be the only snippet in the
     * wave whose values nothing judged.
     */
    const credentials = fill(rtsp.properties.credentials.defaultSnippets[0].body)
    const doc = {
      fleetless: 1,
      cameras: {
        front: {
          source: { kind: 'rtsp', url: 'rtsp://cam-1.plant.local/stream1', credentials },
          width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5,
        },
      },
    }
    const parsed = robotConfigDoc.safeParse(doc)
    expect(parsed.success, `credentials: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
  })
})

/**
 * The nested objects. Everything above is reached by writing a *section*; these
 * are reached one or two levels further in, where a developer has written
 * `numeric:`, `retention:`, `chart:`, `alerts:`, `condition:`, `parameters:` or
 * `failsafe:` and pressed ⏎.
 *
 * `parameters` appears three times in this table and is **one node**: actions,
 * services and publishers all carry `parameterMap`, whose single `.meta()`
 * inlines into all three positions. The last test in this file is what holds
 * that — three sections that each grew their own copy would be three snippets
 * that have to agree.
 */
describe('every nested object offers a skeleton', () => {
  /**
   * Each row carries the document that puts the body where it belongs. A
   * presence check alone would pass on a body the format refuses, and these
   * nodes are exactly where that is easy: `numeric`, `chart` and `alerts` need
   * a `field` on the datapoint, a `condition` needs an alert around it, and a
   * `failsafe` needs a publisher whose other required fields are all present.
   * A body judged in isolation never meets any of that.
   */
  const NESTED: Array<[string, string[], (body: unknown) => unknown]> = [
    ['numeric', ['datapoints', '<slug>', 'numeric'], (body) => datapointDoc({ numeric: body })],
    ['retention', ['datapoints', '<slug>', 'retention'], (body) => datapointDoc({ retention: body })],
    ['chart', ['datapoints', '<slug>', 'chart'], (body) => datapointDoc({ chart: body })],
    ['alerts', ['datapoints', '<slug>', 'alerts'], (body) => datapointDoc({ alerts: body })],
    [
      'an alert condition',
      ['datapoints', '<slug>', 'alerts', '<slug>', 'condition'],
      (body) => datapointDoc({ alerts: { low: { condition: body } } }),
    ],
    ['action parameters', ['actions', '<slug>', 'parameters'], (body) => ({
      fleetless: 1,
      actions: { navigate: { ros_name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose', parameters: body } },
    })],
    ['service parameters', ['services', '<slug>', 'parameters'], (body) => ({
      fleetless: 1,
      services: { reset: { ros_name: '/reset_odometry', type: 'std_srvs/srv/Trigger', parameters: body } },
    })],
    ['publisher parameters', ['publishers', '<slug>', 'parameters'], (body) => publisherDoc({ parameters: body })],
    ['failsafe', ['publishers', '<slug>', 'failsafe'], (body) => publisherDoc({ failsafe: body })],
  ]

  /** A datapoint with a `field`, which `numeric`, `chart` and `alerts` all require. */
  function datapointDoc(extra: Record<string, unknown>): unknown {
    return {
      fleetless: 1,
      datapoints: {
        battery: {
          topic: '/battery',
          type: 'sensor_msgs/msg/BatteryState',
          field: 'percentage',
          ...extra,
        },
      },
    }
  }

  /** A publisher with everything else it needs, so only the body under test decides. */
  function publisherDoc(extra: Record<string, unknown>): unknown {
    return {
      fleetless: 1,
      publishers: {
        drive: {
          topic: '/cmd_vel',
          type: 'geometry_msgs/msg/Twist',
          message: { linear: { x: 0 }, angular: { z: 0 } },
          failsafe: { timeout_ms: 500, message: { linear: { x: 0 }, angular: { z: 0 } } },
          quiet_timeout_ms: 2000,
          ...extra,
        },
      },
    }
  }

  for (const [label, path, wrap] of NESTED) {
    it(label, () => {
      const snippets = nodeAt(path).defaultSnippets
      expect(Array.isArray(snippets), `${label} carries no defaultSnippets`).toBe(true)
      expect(snippets.length).toBeGreaterThan(0)
      for (const snippet of snippets) {
        expect(typeof snippet.label, `${label} snippet has no label`).toBe('string')
        expect(snippet.label.trim().length).toBeGreaterThan(0)
        expect(snippet.body, `${label} snippet has no body`).toBeTypeOf('object')
        const parsed = robotConfigDoc.safeParse(wrap(fill(snippet.body)))
        expect(
          parsed.success,
          `${label} snippet "${snippet.label}" does not parse: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true)
      }
    })
  }

  /**
   * Asserted rather than believed. `parameterMap` carries one `.meta()` and the
   * export inlines it into all three sections, so today these are three copies
   * of one authored object. What this catches is the day somebody gives one
   * section a `parameters:` snippet of its own — at which point the three stop
   * agreeing and nothing else in this file would notice.
   *
   * **The whole `defaultSnippets` array, deep-compared, and not
   * `[0].label`.** The label version of this assertion was measured to stay
   * **green** on a divergent body under the same label — and reusing the label
   * is exactly what copying the existing node produces, which is how the
   * second copy gets written in the first place. It was also green on a second
   * snippet appended after a correct one. The label is what the author of this
   * test happened to look at; the **body** is what the developer receives, so
   * that is what has to agree. CLAUDE.md: a guard shaped like your own code,
   * rather than like what the consumer reads, covers a fraction of its
   * surface.
   */
  it('the three parameter maps are one node, not three copies', () => {
    const sections = ['actions', 'services', 'publishers']
    const snippets = sections.map((section) => JSON.stringify(nodeAt([section, '<slug>', 'parameters']).defaultSnippets))
    expect(
      new Set(snippets).size,
      `the three parameters snippets are not one object:\n${sections.map((s, i) => `  ${s}: ${snippets[i]}`).join('\n')}`,
    ).toBe(1)
  })
})

/**
 * The value position of a map **entry** — `battery: ▮` under `datapoints:`,
 * `front: ▮` under `cameras:`.
 *
 * The 135-position sweep that started this wave emitted a value probe for each
 * of a node's **keys**, and a map entry is not a key, so it never asked this
 * question anywhere. Measured in a browser on 2026-09-03, after three tasks of
 * this wave had already shipped: eight positions, every one silent — the same
 * shape as `source: ▮`, which is the complaint the whole feature came out of.
 *
 * A developer reaches these by writing the section, accepting its snippet, and
 * then adding a **second** entry by hand: the section snippet fires once, on
 * the empty section, and never again.
 */
describe('every map entry offers a whole entry', () => {
  /** A datapoint with a `field`, which `alerts` requires. */
  function datapointDoc(extra: Record<string, unknown>): unknown {
    return {
      fleetless: 1,
      datapoints: { battery: { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', field: 'percentage', ...extra } },
    }
  }

  /**
   * Each row carries the document that puts the entry where it belongs, for the
   * reason the nested table above does: an alert entry needs a datapoint with a
   * `field` around it, and a parameter entry needs an action around it. A body
   * judged in isolation never meets either.
   */
  const ENTRIES: Array<[string, string[], (body: unknown) => unknown]> = [
    ['a shared message', ['messages', '<slug>'], (body) => ({ fleetless: 1, messages: { drive: body } })],
    ['a datapoint', ['datapoints', '<slug>'], (body) => ({ fleetless: 1, datapoints: { battery: body } })],
    ['an action', ['actions', '<slug>'], (body) => ({ fleetless: 1, actions: { navigate: body } })],
    ['a service', ['services', '<slug>'], (body) => ({ fleetless: 1, services: { reset_odometry: body } })],
    ['a publisher', ['publishers', '<slug>'], (body) => ({ fleetless: 1, publishers: { drive: body } })],
    ['a camera', ['cameras', '<slug>'], (body) => ({ fleetless: 1, cameras: { front: body } })],
    ['an alert', ['datapoints', '<slug>', 'alerts', '<slug>'], (body) => datapointDoc({ alerts: { battery_low: body } })],
    ['a parameter', ['actions', '<slug>', 'parameters', '<slug>'], (body) => ({
      fleetless: 1,
      actions: { navigate: { ros_name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose', parameters: { speed: body } } },
    })],
  ]

  for (const [label, path, wrap] of ENTRIES) {
    it(label, () => {
      const snippets = nodeAt(path).defaultSnippets
      expect(Array.isArray(snippets), `${path.join('.')} carries no defaultSnippets`).toBe(true)
      expect(snippets.length).toBeGreaterThan(0)
      for (const snippet of snippets) {
        expect(typeof snippet.label, `${label} snippet has no label`).toBe('string')
        expect(snippet.label.trim().length).toBeGreaterThan(0)
        expect(snippet.body, `${label} snippet has no body`).toBeTypeOf('object')
        const parsed = robotConfigDoc.safeParse(wrap(fill(snippet.body)))
        expect(
          parsed.success,
          `${label} snippet "${snippet.label}" does not parse: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true)
      }
    })
  }

  /**
   * The two positions are one authored skeleton, asserted rather than believed.
   *
   * A section snippet is its entry snippet with the body under one slug key, so
   * a deep comparison of the two is what says the pair still comes from one
   * constant. Three reviews in this wave have caught the same drift: a second
   * copy of a skeleton inventing a value its sibling had already answered.
   *
   * **The whole snippet, not the body.** This assertion compared bodies alone
   * for one round, and that was measured to stay **green** when one position's
   * `label` and `description` were both replaced with `'DIVERGED …'` — two of
   * the three fields a developer reads in the suggest widget, unguarded by the
   * guard that exists to stop exactly this. It is the same shape as the
   * label-only identity test task 3's review rejected, one level over: assert
   * over what the consumer receives, which is the whole snippet.
   *
   * The whole array, index by index: an entry position that grew a second
   * snippet the section does not offer is the same divergence one step later.
   */
  const PAIRS: string[][] = [
    ['messages'],
    ['datapoints'],
    ['actions'],
    ['services'],
    ['publishers'],
    ['cameras'],
    ['datapoints', '<slug>', 'alerts'],
    ['actions', '<slug>', 'parameters'],
  ]

  it.each(PAIRS.map((path) => [path.join('.'), path] as const))(
    '%s: a section snippet and its entry snippet are one skeleton',
    (_name, sectionPath) => {
      const fromSection = nodeAt(sectionPath).defaultSnippets
      const fromEntry = nodeAt([...sectionPath, '<slug>']).defaultSnippets
      expect(fromEntry.length, 'the section and the entry offer a different number of skeletons').toBe(fromSection.length)
      fromSection.forEach((snippet: any, i: number) => {
        const keys = Object.keys(snippet.body)
        expect(keys.length, `the section body is not one slug key: ${JSON.stringify(keys)}`).toBe(1)
        expect(
          { ...snippet, body: snippet.body[keys[0]!] },
          `snippet ${i} has been edited apart from its entry`,
        ).toEqual(fromEntry[i])
      })
    },
  )

  /**
   * `messages.<slug>` is the one entry node whose `description` is not written
   * at the position it appears: `sharedMessageBody` is a `.meta()` clone of
   * `messageTemplate`, and the paragraph reaches it because **zod merges a
   * clone's metadata with its parent's** rather than replacing it. Measured
   * against zod 4.4.3, including the lazy half — a clone taken before the
   * parent was registered still sees the parent's entry afterwards.
   *
   * That is undocumented behaviour holding up a hover text, and nothing about
   * the shape changes if it stops: the node keeps its snippet, the body still
   * parses, and every other row in this file stays green while the description
   * is simply gone. So it is asserted, and against the `message:` position
   * rather than against a copy of the string — a copy would be the second
   * spelling the whole arrangement exists to avoid.
   *
   * The other seven entry nodes carry no `description` of their own and are not
   * asserted: their hover comes from the section above them, and giving each a
   * paragraph is a documentation decision this task did not make.
   */
  it('the shared-message entry keeps the description it inherits', () => {
    const entry = nodeAt(['messages', '<slug>'])
    expect(typeof entry.description, 'messages.<slug> lost the description it inherits from the template').toBe('string')
    expect(entry.description.trim().length).toBeGreaterThan(0)
    expect(entry.description, 'this node and the `message:` position no longer read one description').toBe(nodeAt(['actions', '<slug>', 'message']).description)
  })
})
