// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * The named JSON Schemas a `json` field can use as its `schema`, and the
 * parser of the `display` template a collection names its records with.
 *
 * Both are small enough to ship as data and code rather than as a service:
 * the cloud checks values against the templates, the console and the SDK may
 * one day recognise them (a map for a pose, a polygon editor), and an AI tool
 * writing a document reads them here.
 */

/** The names a `json` field accepts in `schema` besides an inline JSON Schema. */
export const collectionJsonTemplateName = z
  .enum(['pose2d', 'point2d', 'polygon2d', 'range1d'])
  .meta({ description: 'The name of a built-in JSON template: `pose2d`, `point2d`, `polygon2d` or `range1d`.' })
export type CollectionJsonTemplateName = z.infer<typeof collectionJsonTemplateName>

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

const metres = (what: string) => ({ type: 'number', description: `${what}, in metres.` })
const radians = (what: string) => ({ type: 'number', description: `${what}, in radians.` })
const frameId = { type: 'string', description: 'The name of the coordinate frame the numbers are given in.' }

/**
 * Plain JSON Schemas of the shapes robots exchange most often. Units are fixed:
 * metres and radians. Each template is a closed object with every property
 * required, so a value is either complete or refused; nothing in them needs
 * more than the core vocabulary, so any JSON Schema validator reads them
 * (they are valid for draft 2020-12 and for earlier drafts alike).
 *
 * The objects are frozen: they are shared by every caller in the process, and
 * a validator that cached one while a caller edited it would disagree with
 * itself.
 */
export const COLLECTION_JSON_TEMPLATES: Readonly<Record<CollectionJsonTemplateName, Readonly<Record<string, unknown>>>> = deepFreeze({
  pose2d: {
    type: 'object',
    description: 'A position and a heading in a plane.',
    properties: { x: metres('Position along the x axis'), y: metres('Position along the y axis'), yaw: radians('Heading around the vertical axis'), frame_id: frameId },
    required: ['x', 'y', 'yaw', 'frame_id'],
    additionalProperties: false,
  },
  point2d: {
    type: 'object',
    description: 'A position in a plane.',
    properties: { x: metres('Position along the x axis'), y: metres('Position along the y axis'), frame_id: frameId },
    required: ['x', 'y', 'frame_id'],
    additionalProperties: false,
  },
  polygon2d: {
    type: 'object',
    description: 'A closed outline in a plane, given by its corners in order.',
    properties: {
      points: {
        type: 'array',
        description: 'The corners, at least three.',
        minItems: 3,
        items: {
          type: 'object',
          properties: { x: metres('Position along the x axis'), y: metres('Position along the y axis') },
          required: ['x', 'y'],
          additionalProperties: false,
        },
      },
      frame_id: frameId,
    },
    required: ['points', 'frame_id'],
    additionalProperties: false,
  },
  range1d: {
    type: 'object',
    description: 'An interval along one axis.',
    properties: { from: metres('Start of the interval'), to: metres('End of the interval') },
    required: ['from', 'to'],
    additionalProperties: false,
  },
})

/** One `{{...}}` in a display template: the text as written, and the key path it names. */
export type DisplayPlaceholder = {
  /** The placeholder as it stands in the template, braces and inner spaces included. */
  raw: string
  /** The keys it names: one for a field, two for a field of a referenced record. */
  path: string[]
}

export type DisplayTemplateParse = { ok: true; placeholders: DisplayPlaceholder[] } | { ok: false; message: string }

const PLACEHOLDER_KEY = /^[a-z][a-z0-9_]{0,62}$/

/** A piece of the template for a message: a very long one is cut, so a message never repeats a megabyte back. */
const clip = (text: string): string => (text.length > 80 ? `${text.slice(0, 80)}…` : text)

/**
 * `text` without the spaces at both ends, in one pass over them. A pattern such
 * as `/^ +| +$/g` starts again at every space of a long run and takes time
 * quadratic in its length, which a template of a few hundred thousand spaces
 * turns into seconds.
 */
function trimSpaces(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && text[start] === ' ') start += 1
  while (end > start && text[end - 1] === ' ') end -= 1
  return text.slice(start, end)
}

/**
 * Reads the placeholders of a `display` template.
 *
 * A placeholder is `{{key}}` or `{{key.key}}`, with spaces allowed just inside
 * the braces; everything else in the template is plain text, lone braces
 * included. This only says whether the template is well formed and what it
 * names. Whether each name exists is the document's question, because it
 * depends on the collection's fields.
 */
export function parseDisplayTemplate(template: string): DisplayTemplateParse {
  const placeholders: DisplayPlaceholder[] = []
  let from = 0
  for (;;) {
    const open = template.indexOf('{{', from)
    if (open === -1) return { ok: true, placeholders }
    const close = template.indexOf('}}', open + 2)
    if (close === -1) {
      return { ok: false, message: `The "{{" at position ${open + 1} is never closed with "}}".` }
    }
    const raw = template.slice(open, close + 2)
    const inner = trimSpaces(template.slice(open + 2, close))
    const path = inner.split('.')
    if (path.length > 2) {
      return { ok: false, message: `${clip(raw)} names ${path.length} keys. A placeholder is {{field}} or {{reference.field}}; a display follows a reference one step only.` }
    }
    const bad = path.find((key) => !PLACEHOLDER_KEY.test(key))
    if (bad !== undefined) {
      const message =
        inner === ''
          ? `${clip(raw)} is empty. A placeholder names a field, like {{name}}.`
          : bad === ''
            ? `${clip(raw)} has an empty key next to a ".". A placeholder is {{field}} or {{reference.field}}.`
            : `${clip(raw)} is not a placeholder: "${clip(bad)}" is not a key. Keys are lowercase letters, digits and underscores, starting with a letter.`
      return { ok: false, message }
    }
    placeholders.push({ raw, path })
    from = close + 2
  }
}
