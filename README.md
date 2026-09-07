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
| `artifacts/openapi.json` | The OpenAPI description of the REST API. |
| `artifacts/routes.json` | Every route with its request and response schema names. |
| `artifacts/schema/*.json` | One JSON Schema per wire shape, named after the shape. |
| `artifacts/schema-outgoing/*.json` | The messages the cloud sends to a bridge. |

The robot-side bridge validates against `artifacts/schema/` with Python's
`jsonschema`, which is why the artifacts are generated and committed rather
than produced at install time: a consumer in another language needs them
without running a TypeScript build.

## Versioning

Semantic versioning over the wire shapes. A change that makes a previously
valid message invalid — a new required field, a narrowed bound, a removed
enum member — is a **major**. Adding an optional field, a new enum member a
client may ignore, or a description is a minor or a patch.

Pin an exact version. These shapes describe a running server, and "compatible
with the server you are talking to" is not something a range can express.

## Documentation

The API reference at
[docs.fleetless.dev/reference/api](https://docs.fleetless.dev/reference/api) is
generated from these artifacts and is the place to read what a field means.
This package is the place to read what it *is*.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the checks and the pull
request process. [SECURITY.md](SECURITY.md) has the reporting address and what
counts as a security report here — a schema that lets a bad value through is
one, even though nothing in this package executes it.

## Licence

[Apache-2.0](LICENSE). Copyright 2026 Dehne Robotik GmbH.
