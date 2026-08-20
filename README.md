# @fleetless/contracts

The single source of wire truth for Fleetless: the bridge-cloud protocol,
API schemas and error codes as zod schemas, exported as JSON Schema
artifacts for non-TypeScript consumers (the bridge validates against
`artifacts/schema/` with Python `jsonschema`).

Run: `pnpm install && pnpm build`. Test: `pnpm test`.
Regenerate artifacts after schema changes: `pnpm artifacts` (a test fails if
the committed artifacts are stale).

**Every other repo pins this one by commit sha.** Changing a schema is a
cross-repo change: bump the sha in each consumer's `package.json` **and** the
matching key under `allowBuilds` in its `pnpm-workspace.yaml` — pnpm matches
the exact git specifier, and both must move together or install fails with
`GIT_DEP_PREPARE_NOT_ALLOWED`. The bridge does not consume this package; it
vendors schema copies under `bridge/test/contracts/schema/`, which must be
re-vendored on every schema change.
