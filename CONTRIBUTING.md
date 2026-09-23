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
request. `release.yml` (the **Release** button) calls that same file on the
commit it publishes, so a release is never checked by a different pipeline
than a push.

**Your pull request is verified, a fork's included** — the same file, the
same suite. The first run by a first-time contributor waits for a maintainer
to press approve on it; that is a button on your run, not a setting anybody
has to change, so checks sitting idle for a while are the queue and not a
failure. The run reads code and reaches nothing else: it is granted
`contents: read`, no secret is exposed to it, and publishing lives in a
workflow only a maintainer's own **Run workflow** press can trigger.

Run `pnpm typecheck && pnpm build && pnpm test && node --test
'.github/release/*.test.mjs' && pnpm artifacts && pnpm run test:pack`
yourself first and you've seen everything `verify` will tell you.
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

**Release is a button**, not a tag you push. Press **Run workflow** on
`release` (the Actions tab), on `main`. The version comes from the
Conventional Commits since the last tag; a release PR turns
`CHANGELOG.md`'s `## [Unreleased]` into that version, dated, and sets it in
`package.json` — the same two things `scripts/verify-version-tag.mjs` always
checked, now written by the release PR instead of by hand. That PR merges
itself once the required `verify` check passes; the merge commit is tagged,
`verify.yml` runs again on it and packs the tarball, and `publish` ships
exactly that tarball.

A person still writes the `## [Unreleased]` entries — in the feature's own
pull request, as the change goes in — because the release only renames that
heading to a version; it never writes prose. An empty `## [Unreleased]`
refuses the release outright, before any branch or commit exists.

For a pre-release — a branch elsewhere that must pin this change before it
is final — check `prerelease` among the workflow's inputs: it publishes
`X.Y.Z-next.N` under the `next` dist-tag, from any branch, with no tag, no
release PR and no changelog entry.

`publish` carries no npm token. It authenticates by **trusted publishing**:
GitHub mints a short-lived credential for the job, npm checks it against the
trusted publisher configured on npmjs.com for this repository and this
workflow filename, and npm generates the provenance attestation itself —
`npm audit signatures` verifies it against this commit and this run. Renaming
`release.yml` breaks publishing until the publisher is updated on npmjs.com.
The job refuses a missing credential by name, rather than failing on an opaque
error from deep inside `npm publish`. There is no repository secret to add and
no `.npmrc` anywhere.

**If the publish job goes red after `npm publish` already ran, run Release
again.** It sees that npm already has the version and does not publish
twice — npm refuses to republish a version, and a second attempt would only
read like a broken run. The rerun continues from there: it waits for the
registry to serve it, then finishes. Check `npm view
@fleetless/contracts@<version>` first if you want to see for yourself before
pressing anything.

Creating or deleting a `v*` tag is restricted — the organisation ruleset
`release-tags` allows only admins and the release App, which is how the
workflow tags a release without a maintainer pushing one by hand. An admin
can still remove a bad tag; ask one if you are not. What removing it does
*not* undo is a publish: the tag is retractable, the npm version is not —
and Release computes the next version from the newest tag, so deleting one
changes what a later run proposes.
