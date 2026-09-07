# Changelog

All notable changes to `@fleetless/contracts` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html) over
the wire shapes.

## [1.0.2] — 2026-09-07

A documentation and packaging release. (1.0.1 was tagged and never published:
its `verify` job went red on a licence-header guard that swept the pipeline's
own scratch file. The tag pattern is protected and cannot be moved, so the
release carries the next number. Nothing was ever served as 1.0.1.)

**No wire shape changes**, and nothing generated from a schema changes either — `artifacts/schema/` and
`artifacts/schema-outgoing/` are byte-identical to 1.0.0. What changes is what
the package says about itself.

### Fixed

- **The internal engineering prose is gone from the published bytes.** Doc
  comments in the source were written for the people who built this and `tsc`
  carries them into `dist/*.js` and `dist/*.d.ts`, so 1.0.0 shipped German
  paragraphs, a reference robot's workspace paths, measured mesh sizes and
  internal tracker ids to anyone who hovered a symbol in an editor. Every
  comment that ships has been rewritten for a reader who has only this package.
  A test now greps the built `dist/` and `artifacts/` for those markers and
  fails on a hit.
- **The `artifacts/` table in the README described `schema-outgoing/`
  backwards.** It said those files were the messages the cloud sends to a
  bridge. They are the opposite: the frames a bridge **sends**, rendered in
  output mode, and validating incoming cloud frames against them fails on every
  real frame. The table now says what each directory holds and why there are
  two.
- **The README claimed the robot-side bridge validates incoming frames against
  `artifacts/schema/` at runtime with Python's `jsonschema`.** It does not. The
  bridge does not depend on this package at all — it vendors its own copies —
  and only its test harness imports `jsonschema`. There is no runtime validation
  of incoming frames against these schemas.
- **The security reporting address was in nothing the package served.**
  `SECURITY.md` was not in `files`, and the README linked to it relatively.
  `SECURITY.md`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` now ship, and the
  address is written out in the README under its own heading rather than behind
  a link.
- **Twenty-two of the forty published files carried no SPDX header.**
  Declaration emit drops a leading `//` comment and two `.js` files had theirs
  elided, so more than half of what a licence scanner sees was unmarked. Every
  file in `dist/` now carries `// SPDX-License-Identifier: Apache-2.0`, and the
  pack check asserts it over the tarball's own bytes.
- **The CHANGELOG's account of 1.0.0 was wrong about which server it matched**
  — see the corrected note below.

### Changed

- `zod` moves from `^4.0.0` to `^4.4.3`. It stays a range on purpose, and the
  README now says why: zod is a peer in everything but name, and an exact pin
  forces a second copy on any consumer whose lockfile resolves a different
  patch. `^4.4.3` is the floor these schemas are built, tested and exported
  against, rather than a version nobody has run.
- `bugs` gains an email address, so a report has somewhere to go from the npm
  page.

## [1.0.0] — 2026-09-07

The first published version. Nothing about the shapes changes with it: they have
been the contract between the cloud, the console, the SDK and the robot-side
bridge for as long as those have existed. What changes is who can read them —
until now this package was resolvable only from a private git URL, so nobody
outside the project could build a Fleetless client from source.

**Corrected in 1.0.2:** this entry originally said these were "exactly the
shapes the Fleetless cloud serves at release 0.17.0". They are not. This package
tracks the cloud's `main` branch, not its releases, and 1.0.0 was cut from a
commit that already carried the MCP consent-withdrawal change — so the route
notes and the OpenAPI description for
`DELETE /api/client/mcp/grants/:clientId` and its developer twin state that
withdrawal ends a session at the client's very next call, which the deployed
0.17.0 does not do. On 0.17.0 a withdrawn client keeps working for the remaining
lifetime of its access token, up to fifteen minutes. **A shape or a note here may
precede the release that serves it**; check the platform's own release notes
before treating one as an operational control.

Consumers should pin an exact version. A range cannot express "compatible with
the server you are talking to", and that is the only compatibility question
these schemas answer. Any change that makes a previously valid message invalid
— a new required field, a narrowed bound, a removed enum member, a renamed
error code — is a **major** version, without exception and regardless of how
small it looks from inside the repository.

Published under Apache-2.0. The JSON Schema and OpenAPI artifacts ship in the
package under `artifacts/` and are importable by path, which is what a consumer
in another language needs.
