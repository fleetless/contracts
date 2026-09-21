# Changelog

All notable changes to `@fleetless/contracts` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html) over
the wire shapes.

## [Unreleased]

### Added

- **A robot's own asset store.** `ROBOT_ASSET_STORE_BYTES` (1 GB) is what every robot gets, in `constants.json` too, so the bridge reads the same number the cloud enforces. `assetStoreRefusedDetails` carries `store_bytes`, `used_bytes` and `size_bytes` behind the `409 quota_exceeded` an upload with no room left answers, and rides on a `refused` entry in `assetFailure.details`. `assetListResponse` gains `store { bytes, used_bytes }`, so the page that lists a robot's assets can say how full it is without asking a second endpoint about the organisation.
- **Two robot-detail routes.** `POST /api/robots/:id/token/rotate` (Owner tier, `201`, `robotTokenRotateResponse`) mints a new bridge token and stops the socket speaking on the old one; `CLOSE_TOKEN_ROTATED` (4005) is the code it closes with, distinct from `CLOSE_ROBOT_DELETED` because the robot very much still exists. `PUT /api/robots/:id/urdf/joint-state` (`jointStatePutRequest`/`jointStatePutResponse`) chooses the whole-message `sensor_msgs/msg/JointState` datapoint that moves the URDF's joints, or clears it; `assetListResponse.joint_state_slug` reads it back.

### Changed

- **Protocol 3 — the bridge decides its own low-bandwidth mode.** `cloudPing` carries `latency_ms` and `lag_ms`; the bridge sends `link_mode`; `bridge_state` gains `low_bandwidth`. `fleetless.yaml` gains an optional top-level `low_bandwidth` section and a per-datapoint `low_bandwidth: keep`; `LOW_BANDWIDTH_DEFAULTS` ships in `constants.json`. `datapointFrame` gains an optional `backfill` flag, so a replayed sample carrying its original capture time is not read as lag on the link. Protocol 2 is deprecated as of this release and served until 2026-12-20.

### Removed

- **The per-file upload ceiling, and the organisation's storage dial.** `ASSET_UPLOAD_MAX_BYTES`, `assetTooLargeDetails`, the error code `asset_too_large` and the `assetFailureKind` member `too_large` are gone: nothing is refused for its own size any more, only for the robot's store. `orgQuotas.max_asset_storage_bytes` and its usage twin go with them — a robot has 1 GB; the organisation dial is gone.
- **`assetKind` member `other`.** No producer ever sent it. The bridge classifies what it uploads and has only `urdf`, `mesh` and `texture` to choose from, so `other` was a slot for a file nobody had that every consumer still had to branch on.
- **`bridge_pressure`.** The datapoint, `bridgePressure`, `PRESSURE_SLUG` and the reserved slug are gone; an app that read it reads `bridge_state.low_bandwidth` instead. This is the break that makes this release a major.

## [1.3.0] — 2026-09-21

### Added

- **A protocol version window.** `PROTOCOL_VERSIONS` lists every protocol version with the bridge that introduced it and the date it was deprecated; `PROTOCOL_SUNSET_DAYS` (90) says how long a deprecated version is still served; `LATEST_BRIDGE_VERSION` names the newest bridge package. `protocolStatus()` and `minimumProtocolVersion()` answer for a date. All four reach `constants.json` for the bridge. `cloudHelloOk` may now carry `protocol { status, sunset_at }` and `bridge { latest_version }`. `robotListItem` gains `protocol_status`; `robotDetailResponse` gains `protocol_version` and `protocol`. All three are optional in this release, so a response from an older cloud still parses; a consumer reads their absence as `current`. Protocol 2 stays current; nothing previously valid becomes invalid.

## [1.2.0] — 2026-09-18

### Added

- **The MCP token request has its refresh grant back.** `oauthTokenRequest` is a discriminated union again: `oauthCodeTokenRequest` (unchanged) or the new `oauthRefreshTokenRequest` — `grant_type: refresh_token`, `refresh_token`, a required `client_id` and an optional RFC 8707 `resource`. Both MCP authorization servers answer it from cloud 0.20.0: every exchange issues a refresh token, every refresh rotates it, and it lives ninety days from its last use. The registration, token-response and metadata descriptions and the four route notes stop promising there is no refresh grant. Nothing previously valid becomes invalid.

## [1.1.0] — 2026-09-17

### Added

- **Two discovery routes for app users**, the REST twins of the MCP tools every session starts from: `GET /api/client/robots` lists the robots the caller reaches (`clientRobotListResponse`, new), and `GET /api/robots/:id/datasheet` answers the same `mcpRobotDatasheet` that `robot_describe` does — every granted slug with its kind, unit, decimals and parameter JSON Schema, plus the `action_history` and `assets` capabilities. No existing wire shape changes.

## [1.0.6] — 2026-09-16

- Published from GitHub Actions by npm trusted publishing: no publish token exists anywhere, and every version from this one on carries a provenance attestation linking it to the commit and the run that built it. `npm audit signatures` checks it.

- **The README is a lobby now.** Who the package is for, what is in the box, the two schema directories and which one to validate against, versioning, and links into docs.fleetless.dev. No wire shape changes.
- The prose guard treats a path into the company-site repository the way it treats every other sibling repository's path. No wire shape changes.

## [1.0.5] — 2026-09-07

The guard was rebuilt around the set of bytes that become public rather than
around three directory names, and it found 190 things the old shape could not
see. **No wire shape changes**: two `notes` sentences are repaired and nothing
else in `artifacts/` moves.

### Fixed

- **Two sentences an earlier sweep broke, in the published API reference.**
  `POST /mcp/:appIdentifier` ended "one answer for two states, which is one
  answer for two states", a tautology left behind when a clause was removed;
  `GET /api/robots/:id/jobs/history` read "`history` is a syntactically valid
  slug and The router matches a static segment first", a mid-sentence capital
  left behind when a product name was replaced. Both are in `routes.json` and
  `openapi.json`, so both were in every client generated from 1.0.4 and on the
  public reference page.
- **Six internal schedule references on exported schemas**, in `alerts.ts`,
  `config.ts`, `config-issues.ts`, `errors.ts` and `identity.ts`. They ship in
  the declarations, so an editor showed them on hover to anyone who installed
  the package. A private repository path in an `errors.ts` comment went with
  them.
- **`test/` and `scripts/` were outside the guard entirely**, and both mirror
  in full. 160 further references swept: internal decision labels, schedule
  labels, citations of two repositories that stay private and of the
  maintainer-only files, the reference robot's name in two fixtures, and
  internal task ids.

### Changed

- **The scanned set is computed, not named.** It is the union of what `npm
  pack` reports, what `git ls-files` reports and a walk of every directory in
  `files`. A file in none of the three is out of scope; a file in any of them
  is scanned. The predecessor named `src`, `dist`, `artifacts` and five
  markdown files, which left `package.json`, `.gitlab-ci.yml`, the tsconfigs
  and both other trees unswept.
- **Only the German scan strips anything**, and only URLs and single-token code
  spans. Stripping links and backticks before every class made the shipped
  documents blind to an internal hostname inside a markdown link.
- **Eighteen detectors, each carrying its own fixtures.** Suffixed decision
  labels (`D3a` never matched), bare review codenames, schedule labels in the
  three spellings this codebase writes, dotfile and bare two-segment paths into
  a sibling repository, task ids and CI pipeline numbers. A floor over the
  count makes deleting a detector red.
- **`scripts/verify-pack.mjs`** now reads the *packed* manifest rather than the
  one on disk, checks every dependency section rather than `dependencies`
  alone, runs the marker detectors over that manifest, asserts each published
  file declares exactly **one** SPDX identifier rather than reading its first
  line, and verifies that every relative link in every shipped document
  resolves inside the tarball.

### Added

- **`scripts/verify-commit-messages.mjs`**, wired into the verify job. A commit
  message is public the moment it is pushed, and this history mirrors.

## [1.0.4] — 2026-09-07

Two things a grep over the published 1.0.3 tarball found that the guard was not
looking for. **No wire shape changes**; `artifacts/` is byte-identical to 1.0.3.

### Fixed

- **A published `dist/` comment cited a maintainer-only file** and two internal server
  symbols by name. Rewritten to say what the rule is rather than where it is
  written down.
- **The markdown this package ships was outside the guard.** `README.md`,
  `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` are
  published bytes like any other, and nothing was scanning them. They are now
  swept for every marker class — with the stance classes deliberately exempt,
  because those documents are legitimately *about* this repository and a guard
  that reddened on "this repository is a schema library" would be demanding they
  stop addressing their reader.
- **A new marker class**: a reference to a file only the maintainers have.

## [1.0.3] — 2026-09-07

The second half of 1.0.2's sweep. **No wire shape changes**: every file under
`artifacts/schema-outgoing/` is byte-identical to 1.0.2, as are 226 of the 227
files under `artifacts/schema/` — the one that moves carries a reworded
`scopes` description. What changes is who the prose is addressed to.

### Fixed

- **Descriptions and comments that spoke inward.** 1.0.2 removed the markers — a
  ticket id, a robot's hostname, a German paragraph — and left the stance. Text
  that named an internal decision label (`D2`, `D7`), pointed at a source file in
  another repository, said "this project" or
  "this repository", cited a document a reader does not have, or explained how
  somebody discovered the behaviour rather than what the behaviour is. All of it
  is rewritten for a reader who has only this package: 13 descriptions and every
  affected doc comment across all 20 modules.
- **The guard now covers that half too.** `test/published-prose.test.ts` gained
  five patterns — an internal decision label, a path into another repository, a
  reference to this project, a reference to a document the reader does not have,
  and how-it-was-found prose — each with fixtures asserting both what it must
  catch and what it must leave alone, because "caught by the body schema" and
  "the row is found by token hash" are ordinary English and a detector that
  reddens on them is one somebody deletes.
- **The German detector no longer trips on a URL.** A path segment is not prose,
  and `von`, `bei`, `nach` and `wie` are all ordinary path segments. URLs are
  removed before that scan; a fixture asserts a URL alone stays green and that
  one beside German prose still goes red.

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
