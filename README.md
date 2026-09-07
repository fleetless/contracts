# `@fleetless/contracts`

The wire contracts for [Fleetless](https://fleetless.dev): every shape the
Fleetless API accepts or returns, and every message a robot's bridge exchanges
with the cloud, written once as [zod](https://zod.dev) schemas and exported as
JSON Schema and OpenAPI.

Fleetless turns a ROS 2 robot into a REST and realtime API. A developer
configures which topics, services, actions and cameras a robot exposes; client
apps consume those over HTTP and WebSocket. This package is the definition of
what goes over that wire — it is the same file the server validates with, so a
client built against it cannot disagree with the server about a field name, a
bound or an error code.

```sh
npm i @fleetless/contracts
```

## TypeScript

Import the schemas and the types inferred from them:

```ts
import { robotListResponse, ERROR_CODES } from '@fleetless/contracts'
import type { RobotListResponse, ErrorCode } from '@fleetless/contracts'

const robots: RobotListResponse = robotListResponse.parse(await res.json())
```

Everything is exported from the package root. There is no deep import for the
TypeScript surface.

Most application developers do not need this package directly:
[`@fleetless/sdk`](https://www.npmjs.com/package/@fleetless/sdk) is the client
library, and it already speaks these shapes. Reach for `@fleetless/contracts`
when you are writing something the SDK does not cover — a server-side
integration, your own client, or a validator in another language.

## JSON Schema and OpenAPI

Consumers that are not TypeScript read the generated documents under
`artifacts/`, which ship inside the published package and are importable by
path:

```ts
import routes from '@fleetless/contracts/artifacts/routes.json' with { type: 'json' }
import openapi from '@fleetless/contracts/artifacts/openapi.json' with { type: 'json' }
```

| Path | What it is |
|---|---|
| `artifacts/openapi.json` | The OpenAPI 3.1 description of the REST API, generated from the route manifest and the schemas. |
| `artifacts/routes.json` | Every route with its request and response schema names, and the notes that explain each one. |
| `artifacts/schema/*.json` | One JSON Schema per wire shape, named after the shape, rendered as **a receiver validates an incoming document**. |
| `artifacts/schema-outgoing/*.json` | Twelve of those same shapes rendered again as **a sender must produce them** — the frames a robot's bridge sends to the cloud. |

The two schema directories are the same shapes in zod's two rendering modes,
and the difference matters if you are writing a bridge.

`artifacts/schema/` is *input* mode: what a receiver accepts. Fleetless
receivers strip unknown keys rather than refusing them, so these documents omit
`additionalProperties: false`, and a field with a default is not marked
required.

`artifacts/schema-outgoing/` is *output* mode, for the twelve frames a bridge
**sends**. There a relaxed schema points the wrong way: a misspelled key in an
outgoing frame would pass an input-mode check and then be silently dropped by
the server. Validate what you send against `schema-outgoing/`, and what you
receive against `schema/`.

The artifacts are generated and committed rather than produced at install time
because a consumer in another language needs them without running a TypeScript
build.

## Versioning

Semantic versioning over the wire shapes. A change that makes a previously
valid message invalid — a new required field, a narrowed bound, a removed
enum member — is a **major**. Adding an optional field, a new enum member a
client may ignore, or a description is a minor or a patch.

Pin an exact version. These shapes describe a running server, and "compatible
with the server you are talking to" is not something a range can express.

**The one dependency, `zod`, is deliberately a range and not a pin.** zod is a
peer in everything but name: a consumer that imports both this package and zod
must get one copy, or a schema from here fails an `instanceof` check against
their own. An exact pin here forces a second copy on anyone whose lockfile
resolves a different patch. The range floor is the version these schemas are
built, tested and exported against, and a zod major is a major here too.

## Documentation

The API reference at
[docs.fleetless.dev/reference/api](https://docs.fleetless.dev/reference/api) is
generated from these artifacts and is the place to read what a field means.
This package is the place to read what it *is*.

## Reporting a security issue

Email **security@fleetless.dev**. Please do not open a public issue for a
security report.

**A wrong schema is a security report.** If a schema here accepts a value that
should never reach a server — an identifier that escapes its own grammar, a
missing bound, a union that admits a shape the API does not expect — that is a
vulnerability in this package, even though nothing in it executes anything. So
is a generated artifact that disagrees with the zod schema it came from, because
consumers that are not TypeScript validate against the artifact and never see
the zod.

`SECURITY.md` ships inside the published package and has the full policy: what
is in scope, what is not, and the response times we hold ourselves to.

## Contributing

`CONTRIBUTING.md` ships inside the published package and has the setup, the
checks and the pull request process. In short: `pnpm install`, then `pnpm
typecheck && pnpm test`; every schema change regenerates `artifacts/` with
`pnpm artifacts` and commits it in the same commit.

## Licence

[Apache-2.0](LICENSE). Copyright 2026 Dehne Robotik GmbH.
