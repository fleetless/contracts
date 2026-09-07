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
| `pnpm run test:pack` | Packs the tarball, asserts what is and is not inside it, then installs it into a scratch project and imports it for real. |

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
Apache-2.0` as its first line. A test asserts this over the whole set — and the
directory list is derived from the repository rather than written down, so a new
top-level directory is swept the day it exists.

The published files carry it too, which `tsc` does not do on its own:
declaration emit drops a leading comment, so `scripts/stamp-dist.mjs` puts the
header back on every file in `dist/` and `pnpm run test:pack` asserts it over
the tarball's own bytes.

**Nothing internal reaches the published bytes.** Doc comments in `src/` are
carried into `dist/*.js` and `dist/*.d.ts` by `tsc`, and every
`.meta({ description })` is copied into the JSON Schema and OpenAPI artifacts —
so a comment written for the people who build this is a comment an editor shows
to somebody who installed it. Write a description as what a field means to a
caller, never as how the behaviour was found, on which machine, or under which
internal ticket. `test/published-prose.test.ts` greps the built output and fails
on German prose, an internal ticket id, a developer machine path or a
first-name attribution.

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


## Releasing (maintainers)

The pipeline publishes, and `npm publish` from a working tree is refused by a
`prepublishOnly` script — the rule has a mechanism rather than only a sentence.
(The pipeline is unaffected: it publishes the tarball `verify` packed, and npm
runs no prepare lifecycle for a tarball argument.)

1. Update `CHANGELOG.md` and set the new version in `package.json`. **CI checks
   both**, in `scripts/verify-version-tag.mjs`: `package.json` must equal the
   tag without its `v`, and `CHANGELOG.md` must carry a dated heading reading
   exactly `## [X.Y.Z] — YYYY-MM-DD`. `CHANGELOG.md` ships inside the tarball,
   so a forgotten entry documents the wrong version to every consumer and npm
   will not take a version back.

   The same script refuses a release tag that would move npm's `latest`
   backwards — a backported `v1.0.1` published while `latest` is `2.0.0` would
   make `npm i @fleetless/contracts`, the command the README gives outsiders,
   install a package a major version behind.
2. Commit, push, and let the `verify` job go green on the branch.
3. Tag `vX.Y.Z` (or `vX.Y.Z-beta.N` for a pre-release, which publishes to the
   `next` dist-tag) and push the tag. The tag pipeline runs `verify` again and
   then `publish`.

`publish` needs an `NPM_TOKEN` variable, protected and masked. Protected means
an unprotected ref receives an empty value rather than a missing one, so the
tag pattern must be protected too; the job names that case before it can fail
on it obliquely.

**If the publish job goes red after `npm publish` has run, do not press
retry.** npm refuses to republish a version, so a retry fails with a 403 that
reads like a broken pipeline rather than like a release that already happened.
Check `npm view @fleetless/contracts@<version>` first.
