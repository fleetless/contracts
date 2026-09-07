# Contributing to `@fleetless/contracts`

This package is the single source of wire truth for Fleetless: every shape the
API accepts or returns, and every message the robot-side bridge exchanges with
the cloud, is written here once as a zod schema and exported as JSON Schema and
OpenAPI for consumers that are not TypeScript.

That makes a change here a cross-repository change. A schema is not a detail of
one program; it is the agreement between several.

## Setup

Node 22 and pnpm (through corepack):

```sh
nvm use 22
corepack enable
pnpm install
```

There are no private dependencies. `pnpm install` works from a clean checkout
with nothing but a network connection to the npm registry.

## The checks

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over `src/`, then again over `test/` with its own project. Both halves, always — the root project is `src`-only and says nothing about test files. |
| `pnpm test` | The vitest suite. No network, no server. |
| `pnpm build` | `tsc` into `dist/`. |
| `pnpm artifacts` | Regenerates `artifacts/` from the zod schemas. |
| `pnpm run test:pack` | Packs the tarball and asserts what is and is not inside it. |

To run one test file, use `pnpm vitest run test/<name>.test.ts`. Do **not**
use `pnpm test -- <pattern>`: it does not filter, it runs the whole suite, and
the exit code you read is the suite's.

## Changing a schema

1. Edit the zod schema in `src/`.
2. Run `pnpm artifacts`. This regenerates `artifacts/`, which is **committed**.
   A test fails if the committed artifacts are stale, and so does CI.
3. Run `pnpm typecheck && pnpm test`.
4. Commit the schema change and the regenerated artifacts together. A commit
   that changes one without the other is a commit that publishes a lie to every
   consumer validating against the artifact.

Every source file carries the SPDX header `// SPDX-License-Identifier:
Apache-2.0` as its first line. A test asserts this over the whole set, so a new
file without one fails the suite.

## Pull requests

**Pull requests are welcome on GitHub**, at
<https://github.com/fleetless/contracts>. Open an issue first for anything that
changes an existing shape, so we can say what else has to move with it.

**CI runs on GitLab.** This repository is mirrored from an internal GitLab
instance, which is where the pipeline that verifies and publishes it lives. You
will not see a check run on your GitHub pull request; a maintainer runs the
same checks, and the result comes back as a review comment. Run `pnpm
typecheck && pnpm test && pnpm artifacts` yourself before you open the pull
request and you will have seen everything CI would tell you.

## The CLA

The first pull request you open will ask you to sign a Contributor Licence
Agreement. It grants Dehne Robotik GmbH the right to license your contribution
under terms other than Apache-2.0 in future — that is the whole of what it is
for, and it is why the project can relicense its own code later without having
to find every past contributor. It does not take your copyright away and it
does not stop you from using your own contribution however you like.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`. A change that
alters an existing wire shape is a breaking change; say so with a `!` and a
`BREAKING CHANGE:` footer, because it decides the next version number.

Everything in this repository is written in **English** — code, comments,
commit messages, documentation.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

