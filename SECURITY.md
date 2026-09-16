# Security policy

## Reporting a vulnerability

Email **security@fleetless.dev**. Do not open a public GitHub issue for a
security report.

Tell us what you found and which schema or artifact it concerns. If you have
one, include a value the schema wrongly accepts or wrongly rejects. A minimal
reproduction against a published version of this package is the most useful
thing you can send.

We acknowledge every report within **3 working days** and follow up with a fix
or a written plan within **30 days**. A released fix credits you by name
unless you ask us not to.

## What is in scope

This repository is a schema library: it defines the wire shapes of the
Fleetless API and the bridge–cloud protocol as zod schemas, and exports them
as JSON Schema and OpenAPI documents under `artifacts/`.

**A wrong schema is a security report.** A schema that accepts a value that
should never reach a server — an identifier escaping its own grammar, a
missing bound, a union admitting a shape the API does not expect, a field a
validator lets through unchecked — is a vulnerability in this package, even
though nothing here executes it. So is a generated artifact that disagrees
with the zod schema it came from: non-TypeScript consumers validate against
the artifact and never see the zod.

So, in scope:

- the zod schemas in `src/`;
- the JSON Schema and OpenAPI artifacts in `artifacts/`, including any
  disagreement between an artifact and its source schema;
- the build and export tooling in `scripts/`;
- the published npm package `@fleetless/contracts` and its contents.

## What is not in scope

**The Fleetless cloud is not in this repository.** A server that fails to
enforce a schema, an authentication or authorisation flaw, a rate limit, a
data leak from an API endpoint — none of that lives here, and none of it can
be fixed by a change to this package. Report it to the same address, say
which service you were looking at, and we will route it. This repository's
issue tracker is not where they get tracked.

Also out of scope here: the Fleetless console, the bridge, the SDK, the
documentation site, and any deployment of Fleetless operated by someone else.

## Supported versions

The latest published minor of `@fleetless/contracts` gets fixes. Older minors
don't — a security fix is released as a new patch on the current minor, and
since consumers pin exact versions, upgrading is the remedy.
