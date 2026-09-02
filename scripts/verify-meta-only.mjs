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
 * Exits 1 and names every file whose shape differs.
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

/** Drop `description` and `examples` everywhere, so what is left is the shape. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'description' || key === 'examples') continue
    out[key] = strip(inner)
  }
  return out
}

let failures = 0
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

console.log(`${files.length} artifacts checked against ${BASE.slice(0, 7)}, ${failures} with a changed shape`)
process.exit(failures === 0 ? 0 : 1)
