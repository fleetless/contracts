// SPDX-License-Identifier: Apache-2.0
/**
 * Prove that a change to the schemas added ONLY `description` and `examples`.
 *
 * This wave is additive by claim; this script is what turns the claim into a
 * measurement. It regenerates nothing — run `pnpm artifacts` first — and
 * compares every artifact in the working tree against **the branch point**
 * with both keys stripped recursively. Anything else that moved is a schema
 * change made by accident.
 *
 * **The branch point, not HEAD.** Against HEAD this check goes vacuous the
 * moment a task commits: the tree and HEAD agree, nothing differs, and it
 * reports success having compared a change to itself. Against the branch
 * point it stays cumulative for the whole wave and cannot be made trivially
 * green by committing first.
 *
 * Exits 1 and names every file whose shape differs, every file that is new,
 * and every file that existed at the branch point and is gone.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const files = globSync('artifacts/**/*.json').sort()
if (files.length === 0) {
  console.error('no artifacts found — run from contracts/ after `pnpm artifacts`')
  process.exit(1)
}

/** The commit this wave branched from. Every comparison is against it. */
const BASE = execFileSync('git', ['merge-base', 'main', 'HEAD'], { encoding: 'utf8' }).trim()

/**
 * The keywords whose value is a map keyed by **names the format chose**,
 * rather than by JSON Schema keywords. Inside one of these maps, `description`
 * is a field of the format and not an annotation.
 */
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions'])

/**
 * Drop `description` and `examples` where they are JSON Schema **keywords**,
 * and only there, so that what is left is the shape.
 *
 * The distinction is not pedantic: `description` is also a real field of this
 * format (`serviceDescription`, `parameterDescription`), and it appears eight
 * times in `robot-config-doc.schema.json` as a property *name*. A strip by key
 * name at every depth deletes those eight nodes as well, and the guard then
 * cannot see `datapoints[].description` change its `maxLength`, change its
 * type, or disappear — measured, all three came back "0 changed shapes". That
 * blind spot sits exactly on the surface this wave hangs `.meta()` on.
 *
 * `keysAreNames` is true while walking the *inside* of a `properties` map,
 * where every key is a field name and every value is a schema node again.
 */
function strip(value, keysAreNames = false) {
  if (Array.isArray(value)) return value.map((entry) => strip(entry, false))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, inner] of Object.entries(value)) {
    if (!keysAreNames && (key === 'description' || key === 'examples')) continue
    out[key] = strip(inner, !keysAreNames && NAME_MAPS.has(key))
  }
  return out
}

let failures = 0

/**
 * A file that existed at the branch point and is gone now never enters the
 * loop below, which walks the working tree. Unregistering a schema from the
 * export is precisely the contract-surface change this guard exists for, so it
 * is checked from the other direction.
 */
const atBase = execFileSync('git', ['ls-tree', '-r', '--name-only', BASE, '--', 'artifacts'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('.json'))
const inTree = new Set(files)
for (const file of atBase) {
  if (!inTree.has(file)) {
    console.error(`DELETED: ${file} — an artifact present at the branch point is gone`)
    failures += 1
  }
}

for (const file of files) {
  let head
  try {
    head = execFileSync('git', ['show', `${BASE}:${file}`], { encoding: 'utf8' })
  } catch {
    console.error(`NEW FILE: ${file} — this wave adds no schema, so a new artifact is a mistake`)
    failures += 1
    continue
  }
  const before = JSON.stringify(strip(JSON.parse(head)))
  const after = JSON.stringify(strip(JSON.parse(readFileSync(file, 'utf8'))))
  if (before !== after) {
    console.error(`SHAPE CHANGED: ${file}`)
    failures += 1
  }
}

console.log(`${files.length} artifacts in the tree, ${atBase.length} at ${BASE.slice(0, 7)}, ${failures} not additive`)
process.exit(failures === 0 ? 0 : 1)
