// SPDX-License-Identifier: Apache-2.0
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import {
  COLLECTION_JSON_TEMPLATES,
  COLLECTION_RESERVED_KEYS,
  collectionsAccessWarnings,
  collectionsDocument,
  collectionsDocumentIssues,
  collectionsIssue,
  type CollectionsDocument,
  type CollectionsIssue,
} from '../src/index.js'

/** A document as an author writes it, parsed the way the cloud parses it. */
const doc = (collections: Record<string, unknown>): CollectionsDocument => collectionsDocument.parse({ format: 1, collections })

/** One collection called `things` with the given fields. */
const things = (fields: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
  doc({ things: { binding: 'global', access: { read: 'viewer' }, ...rest, fields } })

const ajv = new Ajv2020({ strict: false })
const validateJsonSchema = (schema: unknown): string | null => {
  try {
    ajv.compile(schema as object)
    return null
  } catch (error) {
    return (error as Error).message
  }
}
const validateJsonValue = (schema: unknown, value: unknown): string | null => {
  const validate = ajv.compile(schema as object)
  return validate(value) ? null : ajv.errorsText(validate.errors)
}
const checkers = { validateJsonSchema, validateJsonValue }

const withCode = (issues: CollectionsIssue[], code: string) => issues.filter((issue) => issue.code === code)
const errors = (issues: CollectionsIssue[]) => issues.filter((issue) => issue.severity === 'error')

/** The example collections of the format: every binding, every access shape. */
const exampleDocument = () =>
  doc({
    locations: {
      binding: 'global',
      display: '{{name}}',
      fields: { name: { type: 'text', required: true, unique: true, searchable: true, max_length: 80 } },
    },
    chargers: {
      binding: 'global',
      display: '{{name}} ({{location.name}})',
      fields: {
        name: { type: 'text', required: true },
        location: { type: 'reference', to: 'locations', on_delete: 'prevent', required: true },
      },
    },
    components: {
      binding: 'global',
      display: '{{name}} ({{code}})',
      access: { read: ['observe', 'operate', 'admin'], create: 'admin', update: 'admin', delete: 'admin' },
      fields: {
        code: { type: 'text', required: true, unique: true },
        name: { type: 'text', required: true },
        type: { type: 'select', options: [{ value: 'quadrupole', label: 'Quadrupole' }, { value: 'bpm' }] },
        location: { type: 'reference', to: 'locations' },
        approach: { type: 'json', schema: 'pose2d', default: { x: 0, y: 0, yaw: 0, frame_id: 'map' } },
      },
    },
    robot_settings: {
      binding: 'one_per_robot',
      display: '{{robot.name}}',
      access: { read: ['observe', 'operate', 'admin'], update: 'admin' },
      fields: {
        location: { type: 'reference', to: 'locations', on_delete: 'clear' },
        max_linear_speed: { type: 'number', min: 0, max: 1.5, required: true, default: 0.8 },
      },
    },
    logbook: {
      binding: 'per_robot',
      display: '{{created_at}}',
      access: { read: ['observe', 'operate', 'admin'], create: ['operate', 'admin'], update: { all: 'admin' }, delete: { all: 'admin' } },
      fields: {
        text: { type: 'long_text', required: true, searchable: true },
        category: { type: 'select', options: [{ value: 'note' }, { value: 'fault' }], default: 'note' },
      },
    },
  })

describe('a valid document', () => {
  it('has no error and no warning issues', () => {
    const issues = collectionsDocumentIssues(exampleDocument(), checkers)
    expect(errors(issues)).toEqual([])
    expect(issues.filter((issue) => issue.severity === 'warning')).toEqual([])
  })

  it('names the collections that no role can read as information', () => {
    const issues = collectionsDocumentIssues(exampleDocument(), checkers)
    expect(issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path}`)).toEqual([
      'info no_role_has_access collections.locations.access.read',
      'info no_role_has_access collections.chargers.access.read',
    ])
  })

  it('has no issues at all for an empty document', () => {
    expect(collectionsDocumentIssues(doc({}))).toEqual([])
  })

  it('gives every issue a path, a code, a sentence and a severity', () => {
    const broken = things({ id: { type: 'boolean', unique: true } })
    const issues = collectionsDocumentIssues(broken)
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) expect(collectionsIssue.safeParse(issue).success, JSON.stringify(issue)).toBe(true)
    expect(collectionsIssue.safeParse({ path: '', code: 'x', message: 'x', severity: 'error' }).success).toBe(false)
    expect(collectionsIssue.safeParse({ path: 'a', code: 'x', message: 'x', severity: 'fatal' }).success).toBe(false)
  })
})

describe('counts', () => {
  const collectionOf = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { binding: 'global', access: { read: 'viewer' }, fields: {} }]))
  const fieldsOf = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: 'boolean' }]))

  it('51 collections → too_many_collections', () => {
    const issues = collectionsDocumentIssues(doc(collectionOf(51)))
    expect(withCode(issues, 'too_many_collections')).toMatchObject([{ path: 'collections', severity: 'error' }])
  })

  it('50 collections are fine', () => {
    expect(withCode(collectionsDocumentIssues(doc(collectionOf(50))), 'too_many_collections')).toEqual([])
  })

  it('101 fields → too_many_fields', () => {
    const issues = collectionsDocumentIssues(things(fieldsOf(101)))
    expect(withCode(issues, 'too_many_fields')).toMatchObject([{ path: 'collections.things.fields', severity: 'error' }])
  })

  it('100 fields are fine', () => {
    expect(withCode(collectionsDocumentIssues(things(fieldsOf(100))), 'too_many_fields')).toEqual([])
  })

  it('names the collection that has too many fields, and only that one', () => {
    const issues = collectionsDocumentIssues(
      doc({
        small: { binding: 'global', fields: fieldsOf(3) },
        large: { binding: 'global', fields: fieldsOf(101) },
      }),
    )
    expect(withCode(issues, 'too_many_fields').map((issue) => issue.path)).toEqual(['collections.large.fields'])
  })
})

describe('reserved_key', () => {
  it.each(COLLECTION_RESERVED_KEYS)('a field called %s is an error at that field', (key) => {
    const issues = collectionsDocumentIssues(things({ [key]: { type: 'boolean' } }))
    expect(withCode(issues, 'reserved_key')).toMatchObject([{ path: `collections.things.fields.${key}`, severity: 'error' }])
  })

  it('a field called identifier or robots is fine', () => {
    expect(withCode(collectionsDocumentIssues(things({ identifier: { type: 'text' }, robots: { type: 'text' } })), 'reserved_key')).toEqual([])
  })

  it('a collection called after a reserved key is fine', () => {
    const issues = collectionsDocumentIssues(doc({ id: { binding: 'global', fields: {} }, robot: { binding: 'global', fields: {} } }))
    expect(withCode(issues, 'reserved_key')).toEqual([])
  })
})

describe('references', () => {
  const target = (binding: string) => ({ binding, fields: { name: { type: 'text' } } })
  const pair = (from: string, to: string) =>
    doc({ a: { binding: from, fields: { link: { type: 'reference', to: 'b' } } }, b: target(to) })

  it('a reference to a collection that is not in the document → unknown_reference_target', () => {
    const issues = collectionsDocumentIssues(things({ link: { type: 'reference', to: 'nowhere' } }))
    expect(withCode(issues, 'unknown_reference_target')).toMatchObject([
      { path: 'collections.things.fields.link.to', severity: 'error' },
    ])
  })

  it('a reference to a collection of the document is fine, also to itself', () => {
    expect(withCode(collectionsDocumentIssues(pair('global', 'global')), 'unknown_reference_target')).toEqual([])
    const self = things({ parent: { type: 'reference', to: 'things' } })
    expect(withCode(collectionsDocumentIssues(self), 'unknown_reference_target')).toEqual([])
  })

  it.each([
    ['global', 'per_robot'],
    ['global', 'one_per_robot'],
  ])('a %s collection pointing at a %s one → robot_reference_from_global', (from, to) => {
    const issues = collectionsDocumentIssues(pair(from, to))
    expect(withCode(issues, 'robot_reference_from_global')).toMatchObject([
      { path: 'collections.a.fields.link.to', severity: 'error' },
    ])
  })

  it.each([
    ['global', 'global'],
    ['per_robot', 'global'],
    ['one_per_robot', 'global'],
    ['per_robot', 'per_robot'],
    ['per_robot', 'one_per_robot'],
    ['one_per_robot', 'per_robot'],
    ['one_per_robot', 'one_per_robot'],
  ])('a %s collection pointing at a %s one is allowed', (from, to) => {
    expect(withCode(collectionsDocumentIssues(pair(from, to)), 'robot_reference_from_global')).toEqual([])
  })

  it('an unknown target is not also reported as a robot reference', () => {
    const issues = collectionsDocumentIssues(things({ link: { type: 'reference', to: 'nowhere' } }))
    expect(withCode(issues, 'robot_reference_from_global')).toEqual([])
  })
})

describe('json fields', () => {
  it('a template that does not exist → unknown_template', () => {
    const issues = collectionsDocumentIssues(things({ pose: { type: 'json', schema: 'pose3d' } }))
    expect(withCode(issues, 'unknown_template')).toMatchObject([{ path: 'collections.things.fields.pose.schema', severity: 'error' }])
  })

  it.each(Object.keys(COLLECTION_JSON_TEMPLATES))('the template %s is known', (name) => {
    expect(withCode(collectionsDocumentIssues(things({ pose: { type: 'json', schema: name } })), 'unknown_template')).toEqual([])
  })

  it('a name such as toString is not a template', () => {
    const issues = collectionsDocumentIssues(things({ pose: { type: 'json', schema: 'toString' } }))
    expect(withCode(issues, 'unknown_template')).toHaveLength(1)
  })

  it('an inline schema the validator refuses → invalid_json_schema', () => {
    const issues = collectionsDocumentIssues(things({ data: { type: 'json', schema: { type: 'nonsense' } } }), checkers)
    expect(withCode(issues, 'invalid_json_schema')).toMatchObject([{ path: 'collections.things.fields.data.schema', severity: 'error' }])
  })

  it('an inline schema the validator accepts is fine', () => {
    const issues = collectionsDocumentIssues(things({ data: { type: 'json', schema: { type: 'object', required: ['a'] } } }), checkers)
    expect(withCode(issues, 'invalid_json_schema')).toEqual([])
  })

  it('without a validator an inline schema is not judged', () => {
    const issues = collectionsDocumentIssues(things({ data: { type: 'json', schema: { type: 'nonsense' } } }))
    expect(withCode(issues, 'invalid_json_schema')).toEqual([])
  })

  it('hands the inline schema to the validator once, and never a template name', () => {
    const validate = vi.fn(() => null)
    collectionsDocumentIssues(
      things({ a: { type: 'json', schema: { type: 'object' } }, b: { type: 'json', schema: 'pose2d' }, c: { type: 'json' } }),
      { validateJsonSchema: validate },
    )
    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledWith({ type: 'object' })
  })
})

describe('invalid_pattern', () => {
  const issuesFor = (pattern: string) =>
    withCode(collectionsDocumentIssues(things({ code: { type: 'text', pattern } })), 'invalid_pattern')

  it.each([
    ['an unclosed group', '('],
    ['an unclosed class', '[a-'],
    ['a bad quantifier', '*a'],
    ['a lookahead', 'a(?=b)'],
    ['a negative lookahead', 'a(?!b)'],
    ['a lookbehind', '(?<=a)b'],
    ['a negative lookbehind', '(?<!a)b'],
    ['a backreference', '(a)\\1'],
    ['a backreference after other groups', '(a)(b)\\2'],
    ['a named backreference', '(?<n>a)\\k<n>'],
    ['an inline flag group that is not supported', '(?i)abc'],
  ])('%s is an error at the pattern', (_name, pattern) => {
    expect(issuesFor(pattern)).toMatchObject([{ path: 'collections.things.fields.code.pattern', severity: 'error' }])
  })

  it.each([
    ['an anchored class', '^[A-Z]{2}-\\d+$'],
    ['alternatives', 'one|two'],
    ['a lazy quantifier', 'a.*?b'],
    ['a named group without a reference to it', '(?<year>\\d{4})'],
    ['a non-capturing group', '(?:ab)+'],
    ['lookahead characters inside a class', '[(?=]'],
    ['lookbehind characters inside a class', '[(?<!]x'],
    ['an escaped opening parenthesis', '\\(?=a'],
    ['an escaped backslash before a digit', 'a\\\\1'],
    ['a NUL escape', 'a\\0'],
    ['unicode property classes', '^\\p{L}+$'],
    ['a literal closing bracket in a class after an escape', '[\\]]+'],
  ])('%s is fine', (_name, pattern) => {
    expect(issuesFor(pattern)).toEqual([])
  })

  it('says what is wrong for a lookahead', () => {
    expect(issuesFor('a(?=b)')[0]!.message).toMatch(/lookahead/i)
    expect(issuesFor('(a)\\1')[0]!.message).toMatch(/backreference/i)
    expect(issuesFor('(?<=a)b')[0]!.message).toMatch(/lookbehind/i)
  })

  it('reports one issue per pattern', () => {
    expect(issuesFor('(?=a)(?!b)')).toHaveLength(1)
  })

  describe('with a matchPattern', () => {
    // The built-in engine accepts 'B' for '^B' and refuses 'A'; the matcher below says the opposite.
    const withDefault = (extra: Record<string, unknown>) => things({ code: { type: 'text', pattern: '^B', ...extra } })

    it('judges a default with it, as a write is judged', () => {
      const document = withDefault({ default: 'A' })
      expect(withCode(collectionsDocumentIssues(document), 'invalid_default')).toHaveLength(1)
      expect(withCode(collectionsDocumentIssues(document, { matchPattern: () => true }), 'invalid_default')).toEqual([])
      expect(withCode(collectionsDocumentIssues(withDefault({ default: 'B' }), { matchPattern: () => false }), 'invalid_default')).toHaveLength(1)
    })

    it('still refuses a pattern it cannot read, whatever the matcher says', () => {
      const document = things({ code: { type: 'text', pattern: 'a(?=b)' } })
      expect(withCode(collectionsDocumentIssues(document, { matchPattern: () => true }), 'invalid_pattern')).toHaveLength(1)
    })

    describe('that refuses a pattern JavaScript compiles', () => {
      // An RE2 engine caps a repeat count at 1,000; the JavaScript engine does not.
      const repeat = '^a{1,2000}$'
      const refusing = (pattern: string): boolean => {
        if (pattern.includes('{1,2000}')) throw new Error('invalid repetition size: {1,2000}')
        return true
      }

      it('is a pattern problem at publish, found by asking the matcher once with an empty value', () => {
        const document = things({ code: { type: 'text', pattern: repeat } })
        // With no matcher the only engine is JavaScript, which compiles it.
        expect(withCode(collectionsDocumentIssues(document), 'invalid_pattern')).toEqual([])
        const matchPattern = vi.fn(refusing)
        const found = withCode(collectionsDocumentIssues(document, { matchPattern }), 'invalid_pattern')
        expect(found).toMatchObject([{ path: 'collections.things.fields.code.pattern', severity: 'error' }])
        expect(found[0]!.message).toContain('invalid repetition size')
        expect(matchPattern).toHaveBeenCalledTimes(1)
        expect(matchPattern).toHaveBeenCalledWith(repeat, '')
      })

      it('is reported once, as itself, also for a field with a default', () => {
        const issues = collectionsDocumentIssues(things({ code: { type: 'text', pattern: repeat, default: 'aaa' } }), { matchPattern: refusing })
        expect(withCode(issues, 'invalid_pattern')).toHaveLength(1)
        expect(withCode(issues, 'invalid_default')).toEqual([])
      })

      it('is not asked about a pattern JavaScript already refused', () => {
        const matchPattern = vi.fn(() => true)
        collectionsDocumentIssues(things({ code: { type: 'text', pattern: 'a(?=b)' } }), { matchPattern })
        expect(matchPattern).not.toHaveBeenCalled()
      })

      it('is not asked when there is no pattern', () => {
        const matchPattern = vi.fn(() => true)
        collectionsDocumentIssues(things({ code: { type: 'text' }, other: { type: 'number' } }), { matchPattern })
        expect(matchPattern).not.toHaveBeenCalled()
      })

      it('leaves a pattern the matcher accepts alone, whether or not it matches an empty value', () => {
        const document = things({ code: { type: 'text', pattern: '^B' } })
        expect(withCode(collectionsDocumentIssues(document, { matchPattern: () => false }), 'invalid_pattern')).toEqual([])
        expect(withCode(collectionsDocumentIssues(document, { matchPattern: () => true }), 'invalid_pattern')).toEqual([])
      })

      it('cuts a very long message of the engine', () => {
        const [found] = withCode(
          collectionsDocumentIssues(things({ code: { type: 'text', pattern: repeat } }), {
            matchPattern: () => {
              throw new Error('x'.repeat(100_000))
            },
          }),
          'invalid_pattern',
        )
        expect(found!.message.length).toBeLessThan(400)
      })

      it('also when the thrown value is not an Error', () => {
        const [found] = withCode(
          collectionsDocumentIssues(things({ code: { type: 'text', pattern: repeat } }), {
            matchPattern: () => {
              throw 'refused'
            },
          }),
          'invalid_pattern',
        )
        expect(found!.message).toContain('refused')
      })
    })
  })

  it('does not look at patterns of other types', () => {
    // `pattern` is a text option; the schema refuses it elsewhere.
    expect(withCode(collectionsDocumentIssues(things({ code: { type: 'text' } })), 'invalid_pattern')).toEqual([])
  })
})

describe('display templates', () => {
  const place = (display: string, binding = 'global') =>
    doc({
      locations: { binding: 'global', fields: { name: { type: 'text' } } },
      things: {
        binding,
        display,
        access: { read: 'viewer' },
        fields: { name: { type: 'text' }, location: { type: 'reference', to: 'locations' }, count: { type: 'number' } },
      },
    })

  it.each([['{{name'], ['{{a.b.c}}'], ['{{}}'], ['{{Name}}']])('%s → display_template_invalid', (display) => {
    const issues = collectionsDocumentIssues(place(display))
    expect(withCode(issues, 'display_template_invalid')).toMatchObject([{ path: 'collections.things.display', severity: 'error' }])
    expect(withCode(issues, 'display_placeholder_unresolved')).toEqual([])
  })

  it.each([
    ['{{name}}', 'global'],
    ['{{ name }} / {{count}}', 'global'],
    ['{{id}} {{created_at}} {{created_by}} {{updated_at}} {{updated_by}} {{revision}}', 'global'],
    ['{{location}}', 'global'],
    ['{{robot_id}}', 'per_robot'],
    ['{{robot_id}}', 'one_per_robot'],
    ['{{robot.name}}', 'per_robot'],
    ['{{robot.name}}', 'one_per_robot'],
    ['Site: {{location.name}}', 'global'],
    ['{{location.id}} {{location.created_at}}', 'global'],
    ['plain text', 'global'],
  ])('%s resolves on a %s collection', (display, binding) => {
    const issues = collectionsDocumentIssues(place(display, binding))
    expect(withCode(issues, 'display_template_invalid')).toEqual([])
    expect(withCode(issues, 'display_placeholder_unresolved')).toEqual([])
  })

  it.each([
    ['{{missing}}', 'global'],
    ['{{robot.name}}', 'global'],
    ['{{robot_id}}', 'global'],
    ['{{robot.id}}', 'per_robot'],
    ['{{location.missing}}', 'global'],
    ['{{name.length}}', 'global'],
    ['{{count.x}}', 'global'],
    ['{{missing.name}}', 'global'],
    ['{{location.location}}', 'global'],
  ])('%s does not resolve on a %s collection', (display, binding) => {
    const issues = collectionsDocumentIssues(place(display, binding))
    expect(withCode(issues, 'display_placeholder_unresolved')).toMatchObject([
      { path: 'collections.things.display', severity: 'error' },
    ])
  })

  it('{{robot.name}} on a global collection is unresolved and says why', () => {
    const [issue] = withCode(collectionsDocumentIssues(place('{{robot.name}}')), 'display_placeholder_unresolved')
    expect(issue!.message).toContain('{{robot.name}}')
    expect(issue!.message).toMatch(/robot/)
  })

  it('a display of {{location.name}} resolves through a reference field', () => {
    expect(withCode(collectionsDocumentIssues(place('{{location.name}}')), 'display_placeholder_unresolved')).toEqual([])
  })

  it('a hop through a robot-bound target may name robot_id, one through a global target may not', () => {
    const bound = doc({
      sites: { binding: 'per_robot', fields: { name: { type: 'text' } } },
      visits: { binding: 'per_robot', display: '{{site.robot_id}}', fields: { site: { type: 'reference', to: 'sites' } } },
    })
    expect(withCode(collectionsDocumentIssues(bound), 'display_placeholder_unresolved')).toEqual([])
    const global = doc({
      sites: { binding: 'global', fields: { name: { type: 'text' } } },
      visits: { binding: 'global', display: '{{site.robot_id}}', fields: { site: { type: 'reference', to: 'sites' } } },
    })
    expect(withCode(collectionsDocumentIssues(global), 'display_placeholder_unresolved')).toHaveLength(1)
  })

  it('reports each unresolved placeholder', () => {
    const issues = withCode(collectionsDocumentIssues(place('{{one}} {{name}} {{two}}')), 'display_placeholder_unresolved')
    expect(issues.map((issue) => issue.message.includes('{{one}}') || issue.message.includes('{{two}}'))).toEqual([true, true])
  })

  it('reports a placeholder that is used many times once, however it is spelled', () => {
    const display = `${'{{nope}} '.repeat(1000)}{{ nope }} {{other}} {{nope}}`
    const issues = withCode(collectionsDocumentIssues(place(display)), 'display_placeholder_unresolved')
    expect(issues).toHaveLength(2)
    expect(issues[0]!.message).toContain('{{nope}}')
    expect(issues[1]!.message).toContain('{{other}}')
  })

  it('reports the same unresolved placeholder once for each collection that uses it', () => {
    const document = doc({
      one: { binding: 'global', display: '{{nope}} {{nope}}', fields: { name: { type: 'text' } } },
      two: { binding: 'global', display: '{{nope}}', fields: { name: { type: 'text' } } },
    })
    const issues = withCode(collectionsDocumentIssues(document), 'display_placeholder_unresolved')
    expect(issues.map((issue) => issue.path)).toEqual(['collections.one.display', 'collections.two.display'])
  })

  describe('that has very many different unresolved placeholders', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => `{{nope_${i}}}`).join(' ')
    const listed = (display: string) => withCode(collectionsDocumentIssues(place(display)), 'display_placeholder_unresolved')

    it('lists twenty whole, with nothing said about more', () => {
      const issues = listed(many(20))
      expect(issues).toHaveLength(20)
      for (const issue of issues) expect(issue.message).not.toMatch(/more placeholder/)
    })

    it('says in the last of twenty how many more there are', () => {
      const issues = listed(many(25))
      expect(issues).toHaveLength(20)
      expect(issues[19]!.message).toContain('{{nope_19}}')
      expect(issues[19]!.message).toContain('5 more placeholders do not resolve either.')
      for (const issue of issues.slice(0, 19)) expect(issue.message).not.toMatch(/more placeholder/)
    })

    it('says "1 more placeholder does" for one over', () => {
      const issues = listed(many(21))
      expect(issues).toHaveLength(20)
      expect(issues[19]!.message).toContain('1 more placeholder does not resolve either.')
    })

    it('counts the same placeholder used again as one, as before', () => {
      const display = `${many(20)} ${'{{nope_0}} '.repeat(500)}{{extra}}`
      const issues = listed(display)
      expect(issues).toHaveLength(20)
      expect(issues[19]!.message).toContain('1 more placeholder does not resolve either.')
    })

    it('limits each collection by itself', () => {
      const document = doc({
        one: { binding: 'global', display: many(30), fields: { name: { type: 'text' } } },
        two: { binding: 'global', display: many(22), fields: { name: { type: 'text' } } },
      })
      const issues = withCode(collectionsDocumentIssues(document), 'display_placeholder_unresolved')
      const of = (collection: string) => issues.filter((issue) => issue.path === `collections.${collection}.display`)
      expect(of('one')).toHaveLength(20)
      expect(of('two')).toHaveLength(20)
      expect(of('one')[19]!.message).toContain('10 more placeholders do not resolve either.')
      expect(of('two')[19]!.message).toContain('2 more placeholders do not resolve either.')
    })

    it('keeps the answer small however many there are', () => {
      const issues = collectionsDocumentIssues(place(many(60_000)))
      const unresolved = withCode(issues, 'display_placeholder_unresolved')
      expect(unresolved).toHaveLength(20)
      expect(unresolved[19]!.message).toContain('59980 more placeholders do not resolve either.')
      expect(JSON.stringify(issues).length).toBeLessThan(10_000)
    })
  })

  it('cuts a long placeholder at 80 characters in its message', () => {
    const padded = `{{${' '.repeat(10_000)}nope${' '.repeat(10_000)}}}`
    const [issue] = withCode(collectionsDocumentIssues(place(padded)), 'display_placeholder_unresolved')
    expect(issue!.message.length).toBeLessThan(400)
    expect(issue!.message).toContain('…')
    expect(issue!.message).not.toContain(' '.repeat(81))
  })

  it('does not repeat a broken reference target as an unresolved placeholder', () => {
    const issues = collectionsDocumentIssues(
      things({ link: { type: 'reference', to: 'nowhere' } }, { display: '{{link.name}}' }),
    )
    expect(withCode(issues, 'unknown_reference_target')).toHaveLength(1)
    expect(withCode(issues, 'display_placeholder_unresolved')).toEqual([])
  })
})

describe('select fields', () => {
  it('two options with the same value → duplicate_option at the second', () => {
    const issues = collectionsDocumentIssues(things({ kind: { type: 'select', options: [{ value: 'a' }, { value: 'b' }, { value: 'a', label: 'Again' }] } }))
    expect(withCode(issues, 'duplicate_option')).toMatchObject([
      { path: 'collections.things.fields.kind.options.2.value', severity: 'error' },
    ])
  })

  it('options that differ only in their labels or in case are not duplicates', () => {
    const issues = collectionsDocumentIssues(
      things({ kind: { type: 'select', options: [{ value: 'a', label: 'Same' }, { value: 'A', label: 'Same' }] } }),
    )
    expect(withCode(issues, 'duplicate_option')).toEqual([])
  })

  it('reports each repeat', () => {
    const issues = collectionsDocumentIssues(things({ kind: { type: 'select', options: [{ value: 'a' }, { value: 'a' }, { value: 'a' }] } }))
    expect(withCode(issues, 'duplicate_option').map((issue) => issue.path)).toEqual([
      'collections.things.fields.kind.options.1.value',
      'collections.things.fields.kind.options.2.value',
    ])
  })
})

describe('invalid_default', () => {
  const defaultIssues = (field: Record<string, unknown>, options: Parameters<typeof collectionsDocumentIssues>[1] = checkers) =>
    withCode(collectionsDocumentIssues(things({ f: field }), options), 'invalid_default')

  it.each([
    ['a default of x on a number field', { type: 'number', default: 'x' }],
    ['a number default below min', { type: 'number', min: 1, default: 0 }],
    ['a fractional default on an integer field', { type: 'number', integer: true, default: 0.5 }],
    ['a text default past max_length', { type: 'text', max_length: 3, default: 'abcd' }],
    ['a text default that misses the pattern', { type: 'text', pattern: '^\\d+$', default: 'abc' }],
    ['a text default with a line break', { type: 'text', default: 'a\nb' }],
    ['a select default that is not an option', { type: 'select', options: [{ value: 'a' }], default: 'b' }],
    ['a multiple select default with a duplicate', { type: 'select', multiple: true, options: [{ value: 'a' }], default: ['a', 'a'] }],
    ['a boolean default of "true"', { type: 'boolean', default: 'true' }],
    ['a date that is not a day', { type: 'date', default: '2026-02-30' }],
    ['a datetime without a zone', { type: 'datetime', default: '2026-11-04T10:00:00' }],
    ['a reference default that is not an id', { type: 'reference', to: 'things', default: 'first' }],
    ['a default of null, which clears and is not a value', { type: 'text', default: null }],
    ['a default on a json field that breaks its template', { type: 'json', schema: 'pose2d', default: { x: 1 } }],
    ['a default on a json field that breaks its inline schema', { type: 'json', schema: { type: 'array' }, default: {} }],
  ])('%s → invalid_default at the default', (_name, field) => {
    expect(defaultIssues(field)).toMatchObject([{ path: 'collections.things.fields.f.default', severity: 'error' }])
  })

  it.each([
    ['text', { type: 'text', default: 'abc' }],
    ['text with a pattern', { type: 'text', pattern: '^\\d+$', default: '123' }],
    ['long_text', { type: 'long_text', default: 'a\nb' }],
    ['number', { type: 'number', min: 0, max: 1, default: 0.5 }],
    ['an integer number', { type: 'number', integer: true, default: 2 }],
    ['boolean', { type: 'boolean', default: false }],
    ['select', { type: 'select', options: [{ value: 'a' }], default: 'a' }],
    ['multiple select', { type: 'select', multiple: true, options: [{ value: 'a' }, { value: 'b' }], default: ['a', 'b'] }],
    ['date', { type: 'date', default: '2026-02-28' }],
    ['datetime', { type: 'datetime', default: '2026-11-04T10:00:00Z' }],
    ['json without a schema', { type: 'json', default: { anything: [1] } }],
    ['json with a template', { type: 'json', schema: 'pose2d', default: { x: 0, y: 0, yaw: 0, frame_id: 'map' } }],
    ['json with an inline schema', { type: 'json', schema: { type: 'array' }, default: [] }],
    ['no default at all', { type: 'text' }],
  ])('a valid default on %s is fine', (_name, field) => {
    expect(defaultIssues(field)).toEqual([])
  })

  it('a default of x on a number field says what is wrong', () => {
    expect(defaultIssues({ type: 'number', default: 'x' })[0]!.message).toMatch(/number/i)
  })

  it('a default on a json field with a template is checked through validateJsonValue', () => {
    const validate = vi.fn(() => 'rejected by the validator')
    const issues = collectionsDocumentIssues(things({ f: { type: 'json', schema: 'pose2d', default: { x: 1 } } }), { validateJsonValue: validate })
    expect(validate).toHaveBeenCalledWith(COLLECTION_JSON_TEMPLATES.pose2d, { x: 1 })
    expect(withCode(issues, 'invalid_default')).toMatchObject([{ message: expect.stringContaining('rejected by the validator') }])
  })

  it('without a validator a json default is not judged against its schema', () => {
    expect(defaultIssues({ type: 'json', schema: 'pose2d', default: { x: 1 } }, {})).toEqual([])
  })

  it('does not judge a default against a field that is broken in another way', () => {
    // The pattern, the template and the schema are each reported once, as themselves.
    const brokenPattern = collectionsDocumentIssues(things({ f: { type: 'text', pattern: '(', default: 'abc' } }), checkers)
    expect(withCode(brokenPattern, 'invalid_pattern')).toHaveLength(1)
    expect(withCode(brokenPattern, 'invalid_default')).toEqual([])
    const brokenTemplate = collectionsDocumentIssues(things({ f: { type: 'json', schema: 'pose3d', default: {} } }), checkers)
    expect(withCode(brokenTemplate, 'unknown_template')).toHaveLength(1)
    expect(withCode(brokenTemplate, 'invalid_default')).toEqual([])
    const brokenSchema = collectionsDocumentIssues(things({ f: { type: 'json', schema: { type: 'nonsense' }, default: {} } }), checkers)
    expect(withCode(brokenSchema, 'invalid_json_schema')).toHaveLength(1)
    expect(withCode(brokenSchema, 'invalid_default')).toEqual([])
  })

  it('still judges a default against the rest of a field whose pattern is broken', () => {
    const issues = collectionsDocumentIssues(things({ f: { type: 'text', pattern: '(', max_length: 2, default: 'abc' } }))
    expect(withCode(issues, 'invalid_default')).toHaveLength(1)
  })
})

describe('a default with a NUL character', () => {
  it('is an invalid default, since no write could store it', () => {
    const issues = collectionsDocumentIssues(things({ note: { type: 'text', default: 'a\u0000b' } }))
    expect(withCode(issues, 'invalid_default')).toMatchObject([{ path: 'collections.things.fields.note.default', severity: 'error' }])
    expect(withCode(issues, 'invalid_default')[0]!.message).toContain('NUL')
  })
})

describe('a default with half of a surrogate pair', () => {
  it('is an invalid default, since no write could store it', () => {
    for (const bad of ['a\ud800b', '\udc00', 'abc\ud83d']) {
      const issues = collectionsDocumentIssues(things({ note: { type: 'text', default: bad } }))
      expect(withCode(issues, 'invalid_default'), JSON.stringify(bad)).toMatchObject([
        { path: 'collections.things.fields.note.default', severity: 'error' },
      ])
    }
  })

  it('but a whole pair is a fine default', () => {
    expect(withCode(collectionsDocumentIssues(things({ note: { type: 'text', default: 'ok \u{1F600}' } })), 'invalid_default')).toEqual([])
  })
})

describe('required_without_default', () => {
  const one = (field: Record<string, unknown>, binding = 'one_per_robot') =>
    withCode(
      collectionsDocumentIssues(doc({ settings: { binding, access: { read: 'viewer' }, fields: { speed: field } } })),
      'required_without_default',
    )

  it('a required field without a default on a one_per_robot collection is an error', () => {
    expect(one({ type: 'number', required: true })).toMatchObject([
      { path: 'collections.settings.fields.speed.required', severity: 'error' },
    ])
  })

  it('a default makes it fine, also a falsy one', () => {
    expect(one({ type: 'number', required: true, default: 0.8 })).toEqual([])
    expect(one({ type: 'number', required: true, default: 0 })).toEqual([])
    expect(one({ type: 'boolean', required: true, default: false })).toEqual([])
  })

  it('an optional field needs no default', () => {
    expect(one({ type: 'number' })).toEqual([])
    expect(one({ type: 'number', required: false })).toEqual([])
  })

  it('other bindings may require a field without a default', () => {
    expect(one({ type: 'number', required: true }, 'global')).toEqual([])
    expect(one({ type: 'number', required: true }, 'per_robot')).toEqual([])
  })
})

describe('unique_not_allowed', () => {
  const uniqueIssues = (field: Record<string, unknown>) =>
    withCode(collectionsDocumentIssues(things({ f: field })), 'unique_not_allowed')

  it.each([
    ['boolean', { type: 'boolean', unique: true }],
    ['json', { type: 'json', unique: true }],
    ['boolean with collection', { type: 'boolean', unique: 'collection' }],
    ['json with collection', { type: 'json', unique: 'collection' }],
  ])('unique on %s is an error at unique', (_name, field) => {
    expect(uniqueIssues(field)).toMatchObject([{ path: 'collections.things.fields.f.unique', severity: 'error' }])
  })

  it.each([
    ['text', { type: 'text', unique: true }],
    ['long_text', { type: 'long_text', unique: true }],
    ['number', { type: 'number', unique: true }],
    ['select', { type: 'select', options: [{ value: 'a' }], unique: true }],
    ['date', { type: 'date', unique: true }],
    ['datetime', { type: 'datetime', unique: true }],
    ['reference', { type: 'reference', to: 'things', unique: true }],
    ['boolean with unique false', { type: 'boolean', unique: false }],
    ['json without unique', { type: 'json' }],
  ])('%s is fine', (_name, field) => {
    expect(uniqueIssues(field)).toEqual([])
  })

  it('unique: collection on a global collection is accepted', () => {
    const issues = collectionsDocumentIssues(things({ code: { type: 'text', unique: 'collection' } }))
    expect(errors(issues)).toEqual([])
    expect(issues).toEqual([])
  })
})

describe('access', () => {
  it('a one_per_robot collection with access.create yields access_ignored', () => {
    const issues = collectionsDocumentIssues(
      doc({ settings: { binding: 'one_per_robot', access: { read: 'viewer', create: 'admin' }, fields: {} } }),
    )
    expect(issues).toEqual([
      expect.objectContaining({ code: 'access_ignored', path: 'collections.settings.access.create', severity: 'warning' }),
    ])
  })

  it('access.delete is ignored too, and each key is its own warning', () => {
    const issues = collectionsDocumentIssues(
      doc({ settings: { binding: 'one_per_robot', access: { read: 'viewer', create: 'admin', delete: { all: 'admin' } }, fields: {} } }),
    )
    expect(withCode(issues, 'access_ignored').map((issue) => issue.path)).toEqual([
      'collections.settings.access.create',
      'collections.settings.access.delete',
    ])
  })

  it('read and update are not ignored on one_per_robot', () => {
    const issues = collectionsDocumentIssues(
      doc({ settings: { binding: 'one_per_robot', access: { read: 'viewer', update: { own: 'admin' } }, fields: {} } }),
    )
    expect(issues).toEqual([])
  })

  it('other bindings keep create and delete', () => {
    for (const binding of ['global', 'per_robot']) {
      const issues = collectionsDocumentIssues(
        doc({ logs: { binding, access: { read: 'viewer', create: 'admin', delete: 'admin' }, fields: {} } }),
      )
      expect(withCode(issues, 'access_ignored'), binding).toEqual([])
    }
  })

  it('a collection without access yields one info no_role_has_access', () => {
    const issues = collectionsDocumentIssues(doc({ logs: { binding: 'global', fields: {} } }))
    expect(issues).toEqual([
      expect.objectContaining({ code: 'no_role_has_access', path: 'collections.logs.access.read', severity: 'info' }),
    ])
  })

  it('a collection whose access names no reader yields the same information', () => {
    for (const access of [{ create: 'admin' }, { read: [] }, {}, { update: { all: 'admin' } }]) {
      const issues = collectionsDocumentIssues(doc({ logs: { binding: 'global', access, fields: {} } }))
      expect(withCode(issues, 'no_role_has_access'), JSON.stringify(access)).toHaveLength(1)
    }
  })

  it('a collection with a reader yields nothing', () => {
    for (const read of ['viewer', ['viewer'], ['viewer', 'admin']]) {
      const issues = collectionsDocumentIssues(doc({ logs: { binding: 'global', access: { read }, fields: {} } }))
      expect(issues, JSON.stringify(read)).toEqual([])
    }
  })
})

describe('collectionsAccessWarnings', () => {
  const roles = new Set(['admin', 'operate'])

  it('names wartung once for update:{all: wartung, own: wartung}', () => {
    const document = doc({
      logs: { binding: 'global', access: { read: 'admin', update: { all: 'wartung', own: 'wartung' } }, fields: {} },
    })
    const warnings = collectionsAccessWarnings(document, roles)
    expect(warnings).toEqual([
      {
        path: 'collections.logs.access.update',
        code: 'unknown_role',
        message: expect.stringContaining('wartung'),
        severity: 'warning',
      },
    ])
  })

  it('has nothing to say when every role exists', () => {
    const document = doc({
      logs: {
        binding: 'global',
        access: { read: ['admin', 'operate'], create: 'operate', update: { all: 'admin', own: ['operate'] }, delete: 'admin' },
        fields: {},
      },
    })
    expect(collectionsAccessWarnings(document, roles)).toEqual([])
  })

  it('has nothing to say about a collection without access', () => {
    expect(collectionsAccessWarnings(doc({ logs: { binding: 'global', fields: {} } }), roles)).toEqual([])
    expect(collectionsAccessWarnings(doc({}), new Set())).toEqual([])
  })

  it('gives one warning for each action, collection and unknown role key', () => {
    const document = doc({
      logs: { binding: 'global', access: { read: ['ghost', 'admin', 'ghost', 'spirit'], create: 'ghost', delete: { all: ['ghost'], own: 'spirit' } }, fields: {} },
      notes: { binding: 'per_robot', access: { read: 'ghost' }, fields: {} },
    })
    expect(collectionsAccessWarnings(document, roles).map((w) => `${w.path} ${w.message.match(/"([^"]+)"/)?.[1]}`)).toEqual([
      'collections.logs.access.read ghost',
      'collections.logs.access.read spirit',
      'collections.logs.access.create ghost',
      'collections.logs.access.delete ghost',
      'collections.logs.access.delete spirit',
      'collections.notes.access.read ghost',
    ])
  })

  it('treats every role as unknown when the app has none', () => {
    const document = doc({ logs: { binding: 'global', access: { read: 'admin' }, fields: {} } })
    expect(collectionsAccessWarnings(document, new Set())).toHaveLength(1)
  })

  it('compares role keys exactly', () => {
    const document = doc({ logs: { binding: 'global', access: { read: 'Admin' }, fields: {} } })
    expect(collectionsAccessWarnings(document, roles)).toHaveLength(1)
  })
})

describe('the issues of one broken document', () => {
  it('lists every problem with its own path, in document order', () => {
    const broken = doc({
      sites: {
        binding: 'global',
        display: '{{title}}',
        fields: {
          id: { type: 'text' },
          name: { type: 'text', pattern: '(?=a)', unique: true },
          flag: { type: 'boolean', unique: true },
        },
      },
      visits: {
        binding: 'one_per_robot',
        access: { read: 'viewer', create: 'admin' },
        fields: {
          site: { type: 'reference', to: 'ghosts', required: true },
          level: { type: 'number', default: 'high' },
        },
      },
    })
    const issues = collectionsDocumentIssues(broken, checkers)
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'reserved_key collections.sites.fields.id',
      'invalid_pattern collections.sites.fields.name.pattern',
      'unique_not_allowed collections.sites.fields.flag.unique',
      'display_placeholder_unresolved collections.sites.display',
      'no_role_has_access collections.sites.access.read',
      'unknown_reference_target collections.visits.fields.site.to',
      'required_without_default collections.visits.fields.site.required',
      'invalid_default collections.visits.fields.level.default',
      'access_ignored collections.visits.access.create',
    ])
  })
})
