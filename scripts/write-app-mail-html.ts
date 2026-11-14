// SPDX-License-Identifier: Apache-2.0
/**
 * **Writes `src/app-mail-html.ts` from the cloud's printer**
 * (fleetless/fleetless#1155). One pipe:
 *
 *     pnpm --dir <cloud> exec tsx scripts/print-app-mail-defaults.ts \
 *       | pnpm exec tsx scripts/write-app-mail-html.ts \
 *           --cloud-branch <branch> --cloud-commit <sha>
 *
 * stdin is the printer's JSON, `{"invite": "<html>", "verify": "…", "reset": "…",
 * "login_code": "…"}`. It goes into the file unchanged, after a header that
 * names the cloud script, branch and commit it came from. Branch and commit
 * are arguments because stdin carries neither, and a header that guessed
 * them would name a source nobody can find again.
 *
 * Refused before anything is written: input that is not JSON, a key set that
 * is not exactly the four kinds, a value that is not a non-empty string or is
 * longer than `putAppMailTemplateRequest` takes. The file is then either the
 * old one or a complete new one.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mailTemplateKind, putAppMailTemplateRequest } from '../src/app-users.js'

const OUT = fileURLToPath(new URL('../src/app-mail-html.ts', import.meta.url))
const SCRIPT = 'scripts/print-app-mail-defaults.ts'

function fail(message: string): never {
  process.stderr.write(`write-app-mail-html: ${message}\n`)
  process.exit(1)
}

function arg(name: string): string {
  const at = process.argv.indexOf(name)
  const value = at === -1 ? undefined : process.argv[at + 1]
  if (!value || value.startsWith('--')) fail(`${name} is required`)
  return value
}

const branch = arg('--cloud-branch')
const commit = arg('--cloud-commit')
if (!/^[0-9a-f]{7,40}$/.test(commit)) fail(`--cloud-commit is not a commit: ${commit}`)

const raw = readFileSync(0, 'utf8')
let parsed: unknown
try {
  parsed = JSON.parse(raw)
} catch {
  fail('stdin is not JSON')
}
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('stdin is not a JSON object')

const keys = Object.keys(parsed).sort()
const kinds = [...mailTemplateKind.options].sort()
if (keys.join() !== kinds.join()) fail(`keys are ${keys.join(', ')}; expected ${kinds.join(', ')}`)

for (const [kind, html] of Object.entries(parsed)) {
  if (typeof html !== 'string' || html.length === 0) fail(`${kind} is not a non-empty string`)
  const probe = { subject: 'probe', text: 'probe', html }
  if (!putAppMailTemplateRequest.safeParse(probe).success) fail(`${kind} is outside the bounds of putAppMailTemplateRequest`)
}

const body = raw.endsWith('\n') ? raw : `${raw}\n`

writeFileSync(OUT, `// SPDX-License-Identifier: Apache-2.0
/**
 * **Generated. Do not edit by hand.**
 *
 * The default HTML of the four app mails, as the cloud's
 * \`${SCRIPT}\` prints it on cloud branch
 * \`${branch}\`,
 * commit ${commit}.
 * Written by \`scripts/write-app-mail-html.ts\`, which says how to regenerate
 * it.
 *
 * Each value is a Liquid template: the cloud's mail layout for the app frame,
 * with Liquid where the values go. A hand edit here is caught by the cloud
 * test that renders each default and compares it with the layout's own
 * output (\`test/app-mail-defaults.test.ts\`). \`DEFAULT_MAIL_TEMPLATES\` in
 * \`app-users.ts\` carries these as its \`html\`.
 */
import type { MailTemplateKind } from './app-users.js'

export const DEFAULT_MAIL_HTML: Record<MailTemplateKind, string> = ${body}`)

process.stdout.write(`write-app-mail-html: wrote src/app-mail-html.ts from ${branch} ${commit}\n`)
