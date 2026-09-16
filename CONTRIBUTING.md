# Contributing to `@fleetless/contracts`

This package is Fleetless's single source of wire truth. Every shape the API
accepts or returns, every message the robot-side bridge exchanges with the
cloud — written once as a zod schema, exported as JSON Schema and OpenAPI for
consumers that don't speak TypeScript.

A change here is a cross-repository change: a schema isn't one program's
detail, it's the agreement between several.

## Setup

Node 22 and pnpm (through corepack):

```sh
nvm use 22
corepack enable
pnpm install
```

No private dependencies — a clean checkout and a network connection to npm
are all `pnpm install` needs.

## The checks

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over `src/`, then again over `test/` with its own project. Both halves, always — the root project is `src`-only and says nothing about test files. |
| `pnpm test` | The vitest suite. No network, no server. |
| `pnpm build` | `tsc` into `dist/`. |
| `pnpm artifacts` | Regenerates `artifacts/` from the zod schemas. |
| `pnpm run test:pack` | Packs the tarball, asserts what is and is not inside it, then installs it into a scratch project and imports it for real. |

To run one test file, use `pnpm vitest run test/<name>.test.ts`. Do **not**
use `pnpm test -- <pattern>`: it does not filter, it runs the whole suite,
and the exit code you read is the suite's.

## Changing a schema

1. Edit the zod schema in `src/`.
2. Run `pnpm artifacts`. It regenerates `artifacts/`, which is
   **committed** — a stale artifact fails a test, and so does CI.
3. Run `pnpm typecheck && pnpm test`.
4. Commit the schema and the regenerated artifacts together — split them
   and you've published a lie to every consumer validating against the
   artifact.

Every source file's first line is the SPDX header
`// SPDX-License-Identifier: Apache-2.0`. A test asserts the whole set, and
the directory list comes from the repository rather than a written-down
list — a new top-level directory is swept in the day it's created.

The published files carry it too — `tsc` won't do that alone; declaration
emit drops a leading comment, so `scripts/stamp-dist.mjs` puts the header
back on every file in `dist/`, and `pnpm run test:pack` asserts the tarball's
own bytes.

**Nothing internal reaches the published bytes.** Doc comments in `src/` are
carried into `dist/*.js` and `dist/*.d.ts` by `tsc`, and every
`.meta({ description })` is copied into the JSON Schema and OpenAPI
artifacts — so a comment written for the people who build this is a comment
an editor shows to somebody who installed it. Write a description as what a
field means to a caller, never as how the behaviour was found, on which
machine, or under which internal ticket. `test/published-prose.test.ts`
greps the built output and fails on German prose, an internal ticket id, a
developer machine path or a first-name attribution.

## Pull requests

**Pull requests are welcome on GitHub**, at
<https://github.com/fleetless/contracts>. Changing an existing shape? Open
an issue first — so we can say what else has to move with it.

**CI runs on GitHub Actions**, in this repository
(`.github/workflows/verify.yml`) — the suite, on every push and every pull
request. `release.yml` publishes on a release tag and calls that same file
first, so a release is never checked by a different pipeline than a push.

**Your pull request is verified, a fork's included** — the same file, the
same suite. The first run by a first-time contributor waits for a maintainer
to press approve on it; that is a button on your run, not a setting anybody
has to change, so checks sitting idle for a while are the queue and not a
failure. The run reads code and reaches nothing else: it is granted
`contents: read`, no secret is exposed to it, and publishing lives in a
workflow only a tag can trigger.

Run `pnpm typecheck && pnpm build && pnpm test && pnpm artifacts && pnpm run
test:pack` yourself first and you've seen everything `verify` will tell you.
Mind `pnpm artifacts`: `artifacts/` is generated *and* committed, and CI
fails if regenerating it changes a file — so commit whatever it writes
together with the schema you changed. That is the single most common reason
a first pull
request here goes red.

## The CLA

The first pull request you open asks you to sign a Contributor Licence
Agreement. It grants Dehne Robotik GmbH the right to license your
contribution under terms other than Apache-2.0 later — that's the whole of
it, and how the project can relicense without hunting down every past
contributor. It does not take your copyright away and it does not stop you
from using your own contribution however you like.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`. Altering an
existing wire shape is a breaking change — say so with a `!` and a
`BREAKING CHANGE:` footer; it decides the next version number.

Everything in this repository is written in **English** — code, comments,
commit messages, documentation.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).


## Releasing (maintainers)

The `publish` workflow job publishes, and `npm publish` from a working tree
is refused by a `prepublishOnly` script — the rule has a mechanism rather
than only a sentence. (`publish` is unaffected: it publishes the tarball
`verify` packed, and npm runs no prepare lifecycle for a tarball argument.)

1. Update `CHANGELOG.md` and set the new version in `package.json`. **CI
   checks both** (`scripts/verify-version-tag.mjs`): `package.json` must
   equal the tag without its `v`, and `CHANGELOG.md` needs a dated heading
   reading exactly `## [X.Y.Z] — YYYY-MM-DD`. `CHANGELOG.md` ships inside
   the tarball — skip an entry and you've documented the wrong version to
   every consumer, and npm won't take a version back.

   The same script refuses a release tag that would move npm's `latest`
   backwards — a backported `v1.0.1` published while `latest` is `2.0.0`
   would make `npm i @fleetless/contracts`, the command the README gives
   outsiders, install a package a major version behind.
2. Commit, push, and let the `verify` job go green on the branch (the
   Actions tab).
3. Tag `vX.Y.Z` (or `vX.Y.Z-beta.N` for a pre-release, which publishes to
   the `next` dist-tag) and push the tag. The tag run's `verify` job runs
   again and then `publish`.

`publish` carries no npm token. It authenticates by **trusted publishing**:
GitHub mints a short-lived credential for the job, npm checks it against the
trusted publisher configured on npmjs.com for this repository and this
workflow filename, and npm generates the provenance attestation itself —
`npm audit signatures` verifies it against this commit and this run. Renaming
`release.yml` breaks publishing until the publisher is updated on npmjs.com.
The job refuses a missing credential by name, rather than failing on an opaque
error from deep inside `npm publish`. There is no repository secret to add and
no `.npmrc` anywhere.

**If the publish job goes red after `npm publish` already ran, do not press
retry.** npm refuses to republish a version — the resulting 403 reads like
a broken run, not like a release that already happened. Check `npm view
@fleetless/contracts@<version>` first.

Removing a bad tag is an ordinary git operation here — nothing configures
tag protection, so `git tag -d vX.Y.Z` locally and `git push origin
:refs/tags/vX.Y.Z` remotely both just work. What that does *not* undo is a
publish: the tag is retractable, the npm version is not.
