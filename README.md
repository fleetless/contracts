# @fleetless/contracts

[![npm version](https://img.shields.io/npm/v/@fleetless/contracts)](https://www.npmjs.com/package/@fleetless/contracts)
[![license Apache-2.0](https://img.shields.io/npm/l/@fleetless/contracts)](LICENSE)

**Every shape the Fleetless API accepts or returns, and every frame a robot's
bridge exchanges with the cloud.** Written once as [zod](https://zod.dev)
schemas, shipped as JSON Schema and OpenAPI.

[Fleetless](https://fleetless.dev) turns a ROS 2 robot into a hosted REST and
realtime API. This package is the definition of what crosses that wire, and
it is the same file the server validates with. A client built against it
cannot disagree with the server about a field name, a bound or an error code.

## 🎯 Who this is for

Most app developers do not need this package.
[`@fleetless/sdk`](https://www.npmjs.com/package/@fleetless/sdk) is the client
library and already speaks these shapes. Reach for `@fleetless/contracts` when
you are building what the SDK does not cover: a server-side integration, a
client in another language, or a bridge of your own.

## 📦 What is in the box

| Path | What it is |
|---|---|
| `dist/` | The zod schemas, their inferred types and the error codes, exported from the package root. |
| `artifacts/openapi.json` | The OpenAPI 3.1 description of the REST API. |
| `artifacts/routes.json` | Every route with its request and response schema names, and the notes that explain each one. |
| `artifacts/schema/*.json` | One JSON Schema per wire shape, as **a receiver validates an incoming document**. |
| `artifacts/schema-outgoing/*.json` | The twelve frames a bridge **sends**, as the sender must produce them. |

## 🚀 Getting started

```sh
npm i @fleetless/contracts
```

TypeScript imports the schemas and the types inferred from them, all from the
package root:

```ts
import { robotListResponse, ERROR_CODES } from '@fleetless/contracts'
import type { RobotListResponse, ErrorCode } from '@fleetless/contracts'

const robots: RobotListResponse = robotListResponse.parse(await res.json())
```

Everything else imports the generated documents by path, no TypeScript
required:

```ts
import routes from '@fleetless/contracts/artifacts/routes.json' with { type: 'json' }
import openapi from '@fleetless/contracts/artifacts/openapi.json' with { type: 'json' }
```

Two compatibility axes: the package version follows semver over the wire
shapes, and `zod` is a range rather than a pin because a schema from here must
be an instance of the one copy of zod in your tree.

## ↔️ Two schema directories, and which one you want

`artifacts/schema/` is what a receiver accepts. Fleetless receivers strip
unknown keys rather than refuse them, so these documents omit
`additionalProperties: false`, and a field with a default is not required.

`artifacts/schema-outgoing/` is what a sender must produce, for the twelve
frames a bridge sends to the cloud. Checked against the relaxed schema, a
misspelled key in an outgoing frame passes and is then silently dropped by the
server, which is a bug nobody reports because nothing fails.

So: validate what you **receive** against `schema/`, and what you **send**
against `schema-outgoing/`. If you are writing a bridge, this paragraph is the
one to remember.

## 🔢 Versioning

Semantic versioning over the wire shapes. A change that makes a previously
valid message invalid — a new required field, a narrowed bound, a removed enum
member — is a major. A new optional field, a new enum member a client may
ignore, or a better description is a minor or a patch.

Pin an exact version. These shapes describe a running server, and "compatible
with the server you are talking to" is not something a range can express.

## 📚 Documentation

The API reference at
[docs.fleetless.dev/reference/api](https://docs.fleetless.dev/reference/api)
is generated from these artifacts. Read it for what a field *means*; this
package is for what it *is*. [CHANGELOG.md](CHANGELOG.md) lists what moved in
each version.

## 🔒 Reporting a security issue

Email **security@fleetless.dev** rather than opening a public issue. A wrong
schema is a security report: a bound that is missing, an identifier that
escapes its own grammar, or a generated artifact that disagrees with the zod
it came from. [SECURITY.md](SECURITY.md) has the full policy.

## 🤝 Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the checks and the pull
request process. In short: `pnpm install`, then `pnpm typecheck && pnpm test`,
and every schema change regenerates `artifacts/` with `pnpm artifacts` in the
same commit.

## 📜 Licence

[Apache-2.0](LICENSE). Copyright 2026 Dehne Robotik GmbH.
