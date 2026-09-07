# Security policy

## Reporting a vulnerability

Email **security@fleetless.dev**. Please do not open a public GitHub issue for
a security report.

Include what you found, the schema or artifact it concerns, and — if you have
one — a value that the schema accepts and should not, or rejects and should
not. A minimal reproduction against a published version of this package is the
most useful thing you can send.

We acknowledge every report within **3 working days** and follow up with
either a fix or a written plan within **30 days**. If a report leads to a
released fix, we credit you by name unless you ask us not to.

## What is in scope

This repository is a schema library. It defines the wire shapes of the
Fleetless API and the bridge–cloud protocol as zod schemas, and exports them
as JSON Schema and OpenAPI documents under `artifacts/`.

**A wrong schema is a security report.** If a schema accepts a value that
should never reach a server — an identifier that escapes its own grammar, a
bound that is missing, a union that admits a shape the API does not expect, a
field that a validator lets through unchecked — that is a vulnerability in
this package, even though nothing here executes it. The same is true of a
generated artifact that disagrees with the zod schema it came from, because
non-TypeScript consumers validate against the artifact and never see the zod.

So, in scope:

- the zod schemas in `src/`;
- the JSON Schema and OpenAPI artifacts in `artifacts/`, including any
  disagreement between an artifact and its source schema;
- the build and export tooling in `scripts/`;
- the published npm package `@fleetless/contracts` and its contents.

## What is not in scope

**The Fleetless cloud is not in this repository.** A server that fails to
enforce a schema, an authentication or authorisation flaw, a rate limit, a
data leak from an API endpoint — none of those live here, and none of them can
be fixed by a change to this package. Report them to the same address; say
which service you were looking at, and we will route it. What we cannot do is
treat this repository's issue tracker as the place where they are tracked.

Also out of scope here: the Fleetless console, the bridge, the SDK, the
documentation site, and any deployment of Fleetless operated by someone else.

## Supported versions

The latest published minor of `@fleetless/contracts` receives fixes. Older
minors do not; a security fix is released as a new patch on the current minor,
and consumers pin exact versions, so upgrading is the remedy.
