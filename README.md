# @fleetless/contracts

The single source of wire truth for Fleetless: the bridge-cloud protocol,
API schemas and error codes as zod schemas, exported as JSON Schema
artifacts for non-TypeScript consumers (the bridge validates against
`artifacts/schema/` with Python `jsonschema`).

Run: `pnpm install && pnpm build`. Test: `pnpm test`.
Regenerate artifacts after schema changes: `pnpm artifacts` (a test fails if
the committed artifacts are stale). Contracts are written only by the team
lead (spec §20).
