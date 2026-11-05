// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import type { RobotConfigDoc, ValidationIssue } from './config.js'
import type { ExposureSection } from './config-issues.js'

/**
 * Roles and the rights they resolve to — the part that has to be one piece of
 * code for every layer that asks.
 *
 * A role is a key in the organization. Which role may use which capability of
 * a robot is written in that robot's `fleetless.yaml` (`role` on an entry,
 * `access.rules`, `access.assets`, `access.job_history`) and falls back to a
 * default per kind that the organization sets. The cloud answers "may this
 * caller do that?" from these functions, the console editor answers "what
 * does this document say about roles?" from the same ones, and an assistant
 * can read the same sentences back — a second implementation would be a
 * second account of who may do what, which is the one thing that must not
 * drift.
 *
 * **A leaf module on purpose.** It imports only types from `config.ts` and
 * `config-issues.ts`, so `config.ts` can import the zod parts below (`roleRef`)
 * without a cycle. Nothing here parses a document; every function takes one
 * the caller has already validated, or `null` for none.
 *
 * **Lenient by construction.** A role key that names no role is never an
 * error: it grants nothing, and `roleIssues` says so as a warning. Inheritance
 * through a missing parent lapses; the role's other parents still count.
 */

/* ------------------------------------------------------------- role keys */

/** A role key: lower-case, letter-initial, letters, digits and underscores, at most 63 characters. */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

export const ROLE_KEY_RULE = 'A role key is lower-case: it starts with a letter and continues with letters, digits and underscores, up to 63 characters in all — `operate`, `night_shift`. A capital, a dash, a dot, a space or a leading digit is refused.'

/** The most roles one organization holds, and the most keys a single `role` list names. */
export const MAX_ORG_ROLES = 50

/** The longest display name of a role. */
export const ROLE_NAME_MAX = 60

/**
 * One role key. The sentence is both what the parser says and the
 * `patternErrorMessage` of the exported JSON Schema: one rule, one wording.
 */
export const roleKey = z.string()
  .regex(ROLE_KEY_PATTERN, ROLE_KEY_RULE)
  .meta({ patternErrorMessage: ROLE_KEY_RULE })
export type RoleKey = z.infer<typeof roleKey>

/**
 * The value of a `role` in `fleetless.yaml`: one key, or a list of keys when
 * several roles qualify. A list is non-empty — an empty one would say "nobody",
 * which is what leaving the role out of every rule and default already does.
 */
export const roleRef = z.union(
  [
    roleKey,
    z.array(roleKey)
      .min(1, 'A list of roles names at least one role.')
      .max(MAX_ORG_ROLES, `A list of roles names at most ${MAX_ORG_ROLES} roles.`),
  ],
  {
    error: (issue) => (issue.code === 'invalid_union'
      ? 'A role is one key, `operate`, or a list of keys, `[operate, admin]`.'
      : undefined),
  },
).meta({
  defaultSnippets: [
    {
      label: 'one role',
      description: 'The role that may use this; a role that inherits from it may too.',
      body: '${1:operate}',
    },
    {
      label: 'any of several roles',
      description: 'A list of roles; holding one of them, or inheriting from one, is enough.',
      body: ['${1:operate}', '${2:admin}'],
    },
  ],
})

/* ----------------------------------------------------------------- kinds */

/**
 * The kinds of access a default or a lock can name. `read` covers datapoints
 * and cameras, `invoke` services and actions, `publish` publishers (driving);
 * `assets` and `job_history` belong to the robot as a whole.
 */
export const ACCESS_KINDS = ['read', 'invoke', 'publish', 'assets', 'job_history'] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]
export const accessKind = z.enum(ACCESS_KINDS)

/** The kinds an entry of `fleetless.yaml` has, and the only ones a rule can filter by. */
export const ENTRY_KINDS = ['read', 'invoke', 'publish'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

/* ------------------------------------------------------------------ seed */

/** What a new organization starts with. Roles are ordinary rows from then on. */
export const SEED_ROLES: readonly { key: string; name: string; inherits: readonly string[] }[] = [
  { key: 'observe', name: 'Observe', inherits: [] },
  { key: 'operate', name: 'Operate', inherits: ['observe'] },
  { key: 'admin', name: 'Admin', inherits: ['operate'] },
]

/** The defaults a new organization starts with: who holds each kind when a robot's document says nothing. */
export const SEED_DEFAULTS: Record<AccessKind, readonly string[]> = {
  read: ['observe'],
  invoke: ['operate'],
  publish: ['operate'],
  assets: ['observe'],
  job_history: ['operate'],
}

/* -------------------------------------------------------------- the graph */

/** One role as the resolver needs it. `inherits` may name keys that are no role; those lapse. */
export interface RoleNode {
  name: string
  inherits: readonly string[]
}

/** The roles of one organization, by key. */
export type RoleGraph = ReadonlyMap<string, RoleNode>

/** The organization's default per kind. A missing kind, or an empty list, means nobody holds it. */
export type RoleDefaults = Partial<Record<AccessKind, readonly string[]>>

/**
 * The key and every role it inherits from, transitively. Parents that are no
 * role are skipped, and so is whatever only they would have led to. `[]` for a
 * key that is no role. A cycle in the graph ends the walk; each key appears once.
 */
export function roleClosure(graph: RoleGraph, key: string): string[] {
  if (!graph.has(key)) return []
  const out = [key]
  const seen = new Set(out)
  for (let i = 0; i < out.length; i += 1) {
    for (const parent of graph.get(out[i]!)!.inherits) {
      if (graph.has(parent) && !seen.has(parent)) {
        seen.add(parent)
        out.push(parent)
      }
    }
  }
  return out
}

/**
 * Whether the held role meets a requirement: it, or any role it inherits from,
 * is named. `via` is the required key that was met when that is not the held
 * role itself, so a caller can say "admin, through operate": `null` when the
 * held role is named, otherwise the nearest required ancestor, in the order
 * `roleClosure` walks (the parents of the held role first, and in the order it
 * lists them), whatever the order of `required`. `unknown` lists the required
 * keys that are no role — they were skipped, not failed.
 *
 * A held role that is unknown or `null`, and an empty requirement, never
 * satisfy: nobody holds what nobody was given.
 */
export function roleSatisfies(
  graph: RoleGraph,
  held: string | null,
  required: readonly string[],
): { satisfied: boolean; via: string | null; unknown: string[] } {
  const unknown = [...new Set(required.filter((key) => !graph.has(key)))]
  if (held === null || required.length === 0) return { satisfied: false, via: null, unknown }
  const wanted = new Set(required)
  const met = roleClosure(graph, held).find((key) => wanted.has(key))
  if (met === undefined) return { satisfied: false, via: null, unknown }
  return { satisfied: true, via: met === held ? null : met, unknown }
}

/**
 * The cycle that giving `key` these parents would create, as `[key, …, key]`,
 * or `null`. The graph is taken as it is with that one edit applied, so it
 * answers for a role that does not exist yet as well. Cycles that do not pass
 * through `key` are not its doing and are ignored.
 */
export function findCycle(graph: RoleGraph, key: string, inherits: readonly string[]): string[] | null {
  const parentsOf = (node: string): readonly string[] => (node === key ? inherits : graph.get(node)?.inherits ?? [])
  const path = [key]
  const dead = new Set<string>()
  const visit = (node: string): string[] | null => {
    for (const parent of parentsOf(node)) {
      if (parent === key) return [...path, key]
      if (dead.has(parent) || path.includes(parent)) continue
      path.push(parent)
      const found = visit(parent)
      if (found !== null) return found
      path.pop()
      dead.add(parent)
    }
    return null
  }
  return visit(key)
}

/* ----------------------------------------------------------- exposures */

/** The kind of access an entry of each section needs. Declared as a record so a sixth section cannot be forgotten. */
const ENTRY_KIND_OF: Record<ExposureSection, EntryKind> = {
  datapoints: 'read',
  actions: 'invoke',
  services: 'invoke',
  publishers: 'publish',
  cameras: 'read',
}

const SECTIONS = Object.keys(ENTRY_KIND_OF) as ExposureSection[]

/** `read` for datapoints and cameras, `invoke` for services and actions, `publish` for publishers. */
export function entryKindOf(section: ExposureSection): EntryKind {
  return ENTRY_KIND_OF[section]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The ROS name an entry is matched by: the `topic` of a datapoint or a
 * publisher, the `ros_name` of a service or an action, the `source.topic` of a
 * camera whose source is a ROS topic. `null` for every other camera — an
 * address on the network or a device is not a ROS name, so no rule can fit it.
 */
export function rosNameOf(section: ExposureSection, entry: unknown): string | null {
  const record = asRecord(entry)
  if (record === null) return null
  switch (section) {
    case 'datapoints':
    case 'publishers':
      return asString(record.topic)
    case 'services':
    case 'actions':
      return asString(record.ros_name)
    case 'cameras': {
      const source = asRecord(record.source)
      return source !== null && source.kind === 'ros' ? asString(source.topic) : null
    }
  }
}

/** Whether one name segment fits a pattern segment: `*` stands for any run of characters, none included. */
function segmentMatches(pattern: string, segment: string): boolean {
  if (pattern === '*') return segment.length > 0
  let p = 0
  let s = 0
  let star = -1
  let mark = 0
  while (s < segment.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p
      p += 1
      mark = s
    } else if (p < pattern.length && pattern[p] === segment[s]) {
      p += 1
      s += 1
    } else if (star !== -1) {
      p = star + 1
      mark += 1
      s = mark
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1
  return p === pattern.length
}

/**
 * Whether an absolute match pattern fits an absolute ROS name. A segment of
 * `*` is any one segment; a segment of `**` is any number of segments, none
 * included, so `/arm/**` fits `/arm` as well as `/arm/home`; `*` inside a
 * segment (`/joint_*`) stands for any characters of that segment. Anything
 * relative, with an empty segment or with a trailing slash fits nothing.
 */
export function matchRosGlob(pattern: string, rosName: string): boolean {
  if (!pattern.startsWith('/') || !rosName.startsWith('/')) return false
  const parts = pattern.slice(1).split('/')
  const names = rosName.slice(1).split('/')
  if (parts.includes('') || names.includes('')) return false
  // fits[i][j]: parts[i..] fit names[j..]. Filled from the end, so `**` costs a scan, not a branch per attempt.
  const fits: boolean[][] = Array.from({ length: parts.length + 1 }, () => new Array<boolean>(names.length + 1).fill(false))
  fits[parts.length]![names.length] = true
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    for (let j = names.length; j >= 0; j -= 1) {
      if (parts[i] === '**') {
        fits[i]![j] = fits[i + 1]![j]! || (j < names.length && fits[i]![j + 1]!)
      } else {
        fits[i]![j] = j < names.length && segmentMatches(parts[i]!, names[j]!) && fits[i + 1]![j + 1]!
      }
    }
  }
  return fits[0]![0]!
}

/** Whether an `access.rules` rule applies to an entry of this kind and ROS name: its `kinds` include the kind when it names any, and its glob fits. */
function ruleFits(rule: { match: string; kinds?: readonly EntryKind[] }, kind: EntryKind, rosName: string): boolean {
  return (rule.kinds === undefined || rule.kinds.includes(kind)) && matchRosGlob(rule.match, rosName)
}

/** One exposed entry of a document, as the rights resolver sees it. Built-in datapoints are not listed. */
export interface ExposureRef {
  slug: string
  section: ExposureSection
  kind: EntryKind
  rosName: string | null
}

type EntryLike = { role?: string | readonly string[] }

/** The entries of one section, in document order. A prototype key is never an entry. */
function entriesOf(doc: RobotConfigDoc, section: ExposureSection): Array<[string, EntryLike]> {
  const table = asRecord(doc[section])
  return table === null ? [] : Object.entries(table).map(([slug, entry]): [string, EntryLike] => [slug, (asRecord(entry) ?? {}) as EntryLike])
}

/** Every exposed entry of the document, section by section in the order of `EXPOSURE_SECTIONS`. `[]` for no document. */
export function listExposures(doc: RobotConfigDoc | null): ExposureRef[] {
  if (doc === null) return []
  return SECTIONS.flatMap((section) =>
    entriesOf(doc, section).map(([slug, entry]) => ({
      slug,
      section,
      kind: ENTRY_KIND_OF[section],
      rosName: rosNameOf(section, entry),
    })),
  )
}

/* --------------------------------------------------------- requirements */

/** Where a requirement came from. `index` is the rule's position in `access.rules`, counted from zero. */
export type RequirementSource =
  | { kind: 'entry' }
  | { kind: 'rule'; index: number; match: string }
  | { kind: 'robot' }
  | { kind: 'org_default' }

/** Who may use something: any role that holds, or inherits, one of `roles`. */
export interface Requirement {
  roles: string[]
  source: RequirementSource
}

/** What a requirement is asked about: an exposed entry by its slug, or a capability of the robot as a whole. */
export type RightsTarget = { slug: string } | { capability: 'assets' | 'job_history' }

const keysOf = (value: string | readonly string[]): string[] => (typeof value === 'string' ? [value] : [...value])

/**
 * What a robot's published document, with the organization's defaults, asks of
 * a caller for one target.
 *
 * For an entry: its own `role`, else the first `access.rules` rule that fits
 * (by ROS name, and by kind when the rule names kinds), else the default of its
 * kind. For `assets` and `job_history`: `access.<capability>` of the document,
 * else the default. A kind with no default asks for nobody (`roles: []`).
 *
 * `null` when the document has no entry of that slug — including no document
 * at all, which has no entries. A capability always has a requirement.
 */
export function requirementOf(
  doc: RobotConfigDoc | null,
  defaults: RoleDefaults,
  target: RightsTarget,
): Requirement | null {
  if ('capability' in target) {
    const own = doc?.access?.[target.capability]
    return own !== undefined
      ? { roles: keysOf(own), source: { kind: 'robot' } }
      : { roles: [...(defaults[target.capability] ?? [])], source: { kind: 'org_default' } }
  }
  if (doc === null) return null
  for (const section of SECTIONS) {
    const found = entriesOf(doc, section).find(([slug]) => slug === target.slug)
    if (found === undefined) continue
    const [, entry] = found
    if (entry.role !== undefined) return { roles: keysOf(entry.role), source: { kind: 'entry' } }
    const kind = ENTRY_KIND_OF[section]
    const rosName = rosNameOf(section, entry)
    const rules = doc.access?.rules ?? []
    if (rosName !== null) {
      for (const [index, rule] of rules.entries()) {
        if (ruleFits(rule, kind, rosName)) {
          return { roles: keysOf(rule.role), source: { kind: 'rule', index, match: rule.match } }
        }
      }
    }
    return { roles: [...(defaults[kind] ?? [])], source: { kind: 'org_default' } }
  }
  return null
}

/* ------------------------------------------------------------- warnings */

/**
 * One role key a document names, and where. `path` is the field in the form
 * `formatPath` writes: `services.arm_home.role`, `access.rules[1].role`,
 * `access.assets`. A list gives one reference per key, each at its own index —
 * `services.arm_home.role[1]` — so a reader can point at the key itself.
 * `slug` is the entry for a reference on an entry, `null` otherwise.
 */
export interface RoleRef {
  key: string
  path: string
  slug: string | null
}

/** Every role key the document names: on entries, in rules, and on `access.assets` and `access.job_history`. */
export function collectRoleRefs(doc: RobotConfigDoc | null): RoleRef[] {
  if (doc === null) return []
  const refs: RoleRef[] = []
  const add = (value: string | readonly string[] | undefined, path: string, slug: string | null) => {
    if (value === undefined) return
    if (typeof value === 'string') refs.push({ key: value, path, slug })
    else value.forEach((key, i) => refs.push({ key, path: `${path}[${i}]`, slug }))
  }
  for (const section of SECTIONS) {
    for (const [slug, entry] of entriesOf(doc, section)) add(entry.role, `${section}.${slug}.role`, slug)
  }
  doc.access?.rules?.forEach((rule, i) => add(rule.role, `access.rules[${i}].role`, null))
  add(doc.access?.assets, 'access.assets', null)
  add(doc.access?.job_history, 'access.job_history', null)
  return refs
}

/** What a reference belongs to, for a sentence: the entry, the rule, or the robot-level key. */
const subjectOf = (path: string): string => {
  const onField = path.replace(/\.role(?:\[\d+\])?$/, '')
  return onField !== path ? onField : path.replace(/\[\d+\]$/, '')
}

/**
 * The warnings a document earns against the organization's roles. Never an
 * error: both are published as they are, and the sentences are the ones the
 * cloud answers and the editor shows.
 *
 * - `unknown_role`: a key that is no role of the organization. It grants
 *   nothing, and neither does inheritance through it.
 * - `rule_matches_nothing`: an `access.rules` rule that fits no exposed entry
 *   of this document, so it changes nothing. A rule's `kinds` are honoured,
 *   and an entry without a ROS name — a camera that is not a ROS topic — is
 *   never matched. The built-in datapoints are not entries.
 */
export function roleIssues(doc: RobotConfigDoc | null, graph: RoleGraph): ValidationIssue[] {
  if (doc === null) return []
  const issues: ValidationIssue[] = []
  for (const ref of collectRoleRefs(doc)) {
    if (graph.has(ref.key)) continue
    issues.push({
      path: ref.path,
      slug: ref.slug,
      code: 'unknown_role',
      message: `${subjectOf(ref.path)} names \`${ref.key}\`, which is no role of this organization.`,
      severity: 'warning',
    })
  }
  const exposures = listExposures(doc)
  for (const [index, rule] of (doc.access?.rules ?? []).entries()) {
    const fits = exposures.some((exposure) => exposure.rosName !== null && ruleFits(rule, exposure.kind, exposure.rosName))
    if (fits) continue
    issues.push({
      path: `access.rules[${index}].match`,
      slug: null,
      code: 'rule_matches_nothing',
      message: `Rule ${index + 1} matches nothing, so it changes nothing.`,
      severity: 'warning',
    })
  }
  return issues
}
