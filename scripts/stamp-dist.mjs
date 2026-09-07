// SPDX-License-Identifier: Apache-2.0
/**
 * Puts the SPDX header on every file in `dist/`.
 *
 * `src/` carries it on line one of every file and a test asserts that over the
 * whole set — but `src/` is not what anybody outside this project receives.
 * `dist/` is, and `tsc` does not carry the line through: declaration emit drops
 * a leading `//` comment entirely, and for a file whose first statement is
 * elided it disappears from the `.js` too. Measured on the 1.0.0 tarball: 22 of
 * the 40 published files had no licence line, every `.d.ts` among them.
 *
 * A per-file marker is the whole point of the SPDX convention. A reader who
 * copies `dist/oauth.d.ts` into their own tree, or runs a licence scanner over
 * `node_modules`, sees the file and not the repository — and the repository is
 * not something they can consult in the general case.
 *
 * Run from `build` and from `prepare`, so `npm pack` (which runs `prepare`)
 * stamps the tarball it is about to make. `verify-pack.mjs` then asserts the
 * header over every `dist/` entry IN the tarball, which is the assertion that
 * cannot be satisfied by a stale local `dist/`.
 *
 * What makes it fail: nothing — it is idempotent and stamps what is missing.
 * The assertion is in `verify-pack.mjs`; this is the thing being asserted.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = '// SPDX-License-Identifier: Apache-2.0'
const dist = fileURLToPath(new URL('../dist', import.meta.url))

let stamped = 0
let already = 0
for (const entry of readdirSync(dist, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue
  if (!/\.(js|mjs|cjs|d\.ts|d\.mts|d\.cts)$/.test(entry.name)) continue
  const path = join(entry.parentPath ?? dist, entry.name)
  const text = readFileSync(path, 'utf8')
  if (text.startsWith(`${HEADER}\n`)) { already += 1; continue }
  writeFileSync(path, `${HEADER}\n${text}`)
  stamped += 1
}

if (stamped + already === 0) {
  console.error('FATAL: dist/ holds no emitted JavaScript or declarations — did tsc run?')
  process.exit(1)
}
// stderr, not stdout. This runs from `prepare`, and `npm pack --json` reads
// npm's own stdout — a line printed there lands inside the JSON that
// `verify-pack.mjs` parses and takes the pack step down with a syntax error
// about the header message.
console.error(`SPDX header: ${stamped} stamped, ${already} already carried it`)
