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

/**
 * ## The guarantee is a walk, not a table
 *
 * Every `describe` above asserts a hand-written table, and a table catches only
 * what somebody remembered. This wave has already paid for that once: the
 * 135-position sweep the design is built on generated a value probe from each
 * of a node's **keys**, so it never asked what a map entry offers, and it
 * reported a number that sounded exhaustive. The eight silent positions found
 * when somebody finally asked are the `describe` directly above this one.
 *
 * So the guarantee is a walk over the exported schema. `config-meta.test.ts`
 * carries the same lesson for descriptions, in the comment above its
 * `undescribed` walker.
 *
 * ### What counts as a position a skeleton belongs at
 *
 * A node needs `defaultSnippets` iff a value position can land on it — it is
 * reached as the **value of a key** or as a **map entry** — *and* what may be
 * written there is a mapping: an object with `properties`, a map
 * (`additionalProperties` is an object), or a union all of whose branches are
 * such. That is what the developer cannot guess and the editor otherwise
 * answers with words scraped out of their own document.
 *
 * Three things the definition deliberately excludes, each from a measurement:
 *
 * - **A scalar union is not such a node.** `condition.fire_at` is
 *   `number | string | boolean` and a parameter's `default` is the same union.
 *   The language service already offers `true`/`false` at those positions —
 *   measured — so a walker that lists them is implemented wrongly, and the
 *   walker is what to fix, not the schema.
 * - **A union counts as covered when every branch carries a skeleton.**
 *   `cameras.<slug>.source` has nothing on the union node and one snippet on
 *   each of its four branches, which is deliberate: a label cannot then drift
 *   from the branch it describes. A walker that looks only at the union node
 *   calls the wave's headline fix uncovered.
 * - **An array item is not a value position.** `parameters.<slug>.enum` is the
 *   only array in the format and its items are scalars; the walk descends
 *   through it to keep the tree complete and classifies nothing there.
 *
 * ### The nodes whose schema constrains nothing
 *
 * Five value positions export as annotation only — a `description` and nothing
 * else. They are the one zod schema the format reuses for message bodies, and
 * they accept arbitrary content, so the editor is as silent there as at any
 * object node. Four of them get no skeleton because there is nothing to offer;
 * the fifth, `messages.<slug>`, gained one in this wave. They are the same zod
 * schema, so the list below is **audited by the walk rather than copied from
 * the source**: the walk states which five positions are schema-free, and this
 * file states which of them may stay silent. A sixth appearing anywhere in the
 * format goes red and asks for the decision to be made rather than inherited.
 */
describe('every value position a skeleton belongs at carries one', () => {
  type Node = Record<string, any>

  /**
   * The keys a JSON Schema node may carry that say nothing about what values
   * are legal. A node holding only these constrains nothing: anything at all,
   * an object included, may be written where it stands.
   */
  const ANNOTATION_ONLY = new Set([
    '$comment', 'default', 'defaultSnippets', 'deprecated', 'description',
    'examples', 'markdownDescription', 'readOnly', 'title', 'writeOnly',
  ])

  function branchesOf(node: Node): Node[] | null {
    const branches = node.oneOf ?? node.anyOf
    return Array.isArray(branches) && branches.length > 0 ? branches : null
  }

  /** An object, a map, or a union all of whose branches are one of those. */
  function holdsAMapping(node: Node): boolean {
    if (node.properties && typeof node.properties === 'object') return true
    if (node.additionalProperties && typeof node.additionalProperties === 'object') return true
    const branches = branchesOf(node)
    return branches ? branches.every(holdsAMapping) : false
  }

  function constrainsNothing(node: Node): boolean {
    return Object.keys(node).every((key) => ANNOTATION_ONLY.has(key))
  }

  /**
   * A union carries its skeletons on its branches, and that is the placement
   * this wave chose, so it counts as covered when **every** branch carries one.
   * `every` over a list that cannot be empty: `branchesOf` returns null for an
   * empty array, so this cannot pass by vacuity.
   */
  function carriesSkeleton(node: Node): boolean {
    if (Array.isArray(node.defaultSnippets) && node.defaultSnippets.length > 0) return true
    const branches = branchesOf(node)
    return branches ? branches.every(carriesSkeleton) : false
  }

  /** `source` becomes `source(rtsp)`: a branch is the same position, read one way. */
  function intoBranch(path: string[], branch: Node, index: number): string[] {
    const kind = branch.properties?.kind?.const ?? String(index)
    return [...path.slice(0, -1), `${path[path.length - 1] ?? ''}(${kind})`]
  }

  /**
   * Every value position in the exported schema, sorted into exactly three
   * buckets. The third exists so that nothing can fall out of the walk
   * unclassified: a node that is neither a mapping nor annotation-only is
   * asserted below to be a scalar, so a fourth shape appearing in the format
   * is a failure rather than a silence.
   */
  function walk() {
    const mappings: string[] = []
    const uncovered: string[] = []
    const schemaFree: string[] = []
    const scalars: Array<{ path: string, node: Node }> = []

    function visit(node: Node, path: string[], atValuePosition: boolean): void {
      if (!node || typeof node !== 'object') return
      if (atValuePosition) {
        const where = path.join('.')
        if (holdsAMapping(node)) {
          mappings.push(where)
          if (!carriesSkeleton(node)) uncovered.push(where)
        } else if (constrainsNothing(node)) {
          schemaFree.push(where)
        } else {
          scalars.push({ path: where, node })
        }
      }
      if (node.properties && typeof node.properties === 'object') {
        for (const [key, child] of Object.entries(node.properties)) visit(child as Node, [...path, key], true)
      }
      // A map entry is a value position; missing that is what the sweep did.
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        visit(node.additionalProperties, [...path, '<slug>'], true)
      }
      // An array item is not one — descend, but classify nothing.
      if (node.items && typeof node.items === 'object') visit(node.items, [...path, '[]'], false)
      const branches = branchesOf(node)
      if (branches) branches.forEach((branch, i) => visit(branch, intoBranch(path, branch, i), false))
    }

    visit(schema, [], false)
    return { mappings, uncovered, schemaFree, scalars }
  }

  /**
   * The positions this wave measured, written out rather than counted, so that
   * the number below falls out of a list somebody can read and disagree with.
   *
   * The brief for this task said 17, a constant written before the map-entry
   * task existed. It is not patched to whatever the walker printed — that is
   * the shape where a number gets edited until it passes — it is replaced by
   * the enumeration the walker is checked against, in which a disagreement
   * names the position rather than the difference between two integers.
   *
   * Three of these are reached by no hand-written row anywhere in this file —
   * `services` and `publishers` parameter entries, and the mjpeg branch's
   * `credentials`. They are covered because the zod node is authored once and
   * the export inlines it at every position, which is the argument for a walk
   * in one line: a table names the positions its author thought of, and the
   * schema has more of them than that.
   */
  const EXPECTED: string[] = [
    // The six sections — a developer who writes `cameras:` and presses ⏎.
    'messages',
    'datapoints',
    'actions',
    'services',
    'publishers',
    'cameras',
    // The nested objects, one or two levels further in.
    'datapoints.<slug>.numeric',
    'datapoints.<slug>.retention',
    'datapoints.<slug>.chart',
    'datapoints.<slug>.alerts',
    'datapoints.<slug>.alerts.<slug>.condition',
    'actions.<slug>.parameters',
    'services.<slug>.parameters',
    'publishers.<slug>.parameters',
    'publishers.<slug>.failsafe',
    // The camera source union and the credentials block inside two of its
    // branches. `source` is the complaint the whole feature came out of.
    'cameras.<slug>.source',
    'cameras.<slug>.source(rtsp).credentials',
    'cameras.<slug>.source(mjpeg).credentials',
    // The map entries — the value position of a second entry added by hand,
    // which the sweep never asked about. `messages.<slug>` is a map entry too
    // and is missing from this list on purpose: its schema holds no mapping, so
    // it is audited among the schema-free positions below rather than here.
    'datapoints.<slug>',
    'datapoints.<slug>.alerts.<slug>',
    'actions.<slug>',
    'actions.<slug>.parameters.<slug>',
    'services.<slug>',
    'services.<slug>.parameters.<slug>',
    'publishers.<slug>',
    'publishers.<slug>.parameters.<slug>',
    'cameras.<slug>',
  ]

  /**
   * The schema-free positions that stay silent, deliberately. A message body is
   * whatever the ROS type at the other end accepts, so there is no skeleton to
   * write; `messages.<slug>`, the same zod schema, is silent about **content**
   * too but its snippet offers the *shape* of a named reusable message, which
   * is a thing the format does define.
   */
  const SILENT_BY_DESIGN: string[] = [
    'actions.<slug>.message',
    'services.<slug>.message',
    'publishers.<slug>.message',
    'publishers.<slug>.failsafe.message',
  ]

  it('every position that can hold a mapping offers a skeleton', () => {
    const { uncovered } = walk()
    expect(uncovered, `no skeleton is offered at:\n  ${uncovered.join('\n  ')}`).toEqual([])
  })

  /**
   * The count is asserted through the enumeration, not beside it. A bare
   * `toBe(27)` is a number that gets edited until it passes; a set comparison
   * says *which* position appeared or disappeared, and the two honest answers
   * to a disagreement — the walker is wrong, or the schema changed — are told
   * apart by reading the two lists it prints.
   */
  it('the walk reaches exactly the positions this wave measured', () => {
    const { mappings } = walk()
    expect([...mappings].sort()).toEqual([...EXPECTED].sort())
    expect(mappings.length, 'the count follows the list above; it is not a constant to edit').toBe(EXPECTED.length)
  })

  /**
   * The definition's stated trap, given its own row. A walker that reads "or a
   * union" without "all of whose branches hold a mapping" lists these four, and
   * would have four snippets written for positions the language service already
   * answers.
   */
  it('a scalar union is not such a position', () => {
    const { mappings } = walk()
    for (const scalarUnion of [
      'datapoints.<slug>.alerts.<slug>.condition.fire_at',
      'actions.<slug>.parameters.<slug>.default',
      'services.<slug>.parameters.<slug>.default',
      'publishers.<slug>.parameters.<slug>.default',
    ]) {
      expect(mappings, `${scalarUnion} is a scalar union and needs no skeleton`).not.toContain(scalarUnion)
    }
  })

  /**
   * The exclusion list, audited. An exclusion naming a path the walk never
   * reaches hides nothing and looks like it does — so the assertion is that the
   * walk's own schema-free set is **exactly** the four plus `messages.<slug>`,
   * in both directions. A `message` node that gains a shape leaves the set and
   * arrives in `EXPECTED`; a new schema-free position arrives here. Either way
   * a decision is demanded rather than inherited.
   */
  it('the schema-free positions are exactly the four excluded, plus the shared message', () => {
    const { schemaFree } = walk()
    // Reachability first, so that a mistyped or retired path says so in its own
    // words rather than arriving as one line of a set difference.
    for (const excluded of SILENT_BY_DESIGN) {
      expect(schemaFree, `${excluded} is excluded from a walk that never reaches it`).toContain(excluded)
    }
    expect([...schemaFree].sort()).toEqual([...SILENT_BY_DESIGN, 'messages.<slug>'].sort())
  })

  /**
   * And the one that is not excluded really does carry what its exclusion was
   * traded for. Without this, dropping `messages.<slug>`'s snippet would move it
   * onto no list at all: it is not in `EXPECTED` — its schema holds no mapping —
   * so the walk would keep saying every position is covered.
   */
  it('the schema-free entry that is not excluded carries a skeleton', () => {
    expect(SILENT_BY_DESIGN, 'messages.<slug> is excluded and asserted to carry a skeleton at once').not.toContain('messages.<slug>')
    const snippets = nodeAt(['messages', '<slug>']).defaultSnippets
    expect(Array.isArray(snippets), 'messages.<slug> lost the skeleton its exclusion was traded for').toBe(true)
    expect(snippets.length).toBeGreaterThan(0)
  })

  /**
   * The walk's third bucket, checked rather than trusted. Everything it did not
   * call a mapping or annotation-only has to be a value with a stated type, or
   * the classification has a hole and positions are dropping through it
   * silently — which is the failure this whole describe exists to end.
   */
  it('nothing falls out of the walk unclassified', () => {
    const { scalars } = walk()
    expect(scalars.length).toBeGreaterThan(0)
    const unclassified = scalars
      .filter(({ node }) => node.type === undefined && node.enum === undefined && node.const === undefined && !branchesOf(node))
      .map(({ path }) => path)
    expect(unclassified, `neither a mapping, an annotation-only node, nor a typed value:\n  ${unclassified.join('\n  ')}`).toEqual([])
  })
})
