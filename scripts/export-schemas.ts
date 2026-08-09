/**
 * Exports every wire schema as JSON Schema into artifacts/schema/.
 *
 * The bridge (Python) validates frames against these files with `jsonschema`
 * — no codegen step in W0. A test guards that the committed artifacts match
 * a fresh export, so the artifacts can never silently go stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  bridgeHello,
  cloudHelloOk,
  cloudHelloError,
  datapointFrame,
  bridgeState,
} from '../src/protocol.js'
import { apiError } from '../src/errors.js'

export const exportedSchemas = {
  'bridge-hello': bridgeHello,
  'cloud-hello-ok': cloudHelloOk,
  'cloud-hello-error': cloudHelloError,
  'datapoint-frame': datapointFrame,
  'bridge-state': bridgeState,
  'api-error': apiError,
} as const

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const dir = join(import.meta.dirname, '..', 'artifacts', 'schema')
  mkdirSync(dir, { recursive: true })
  for (const [name, schema] of Object.entries(exportedSchemas)) {
    writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n')
    console.log(`wrote ${name}.schema.json`)
  }
}
