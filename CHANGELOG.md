# Changelog

All notable changes to `@fleetless/contracts` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html) over
the wire shapes. A pull request that changes what a consumer sees adds its
entry under `## [Unreleased]`; the release renames that heading to the
version.

## [Unreleased]

### Added

- **The `live` section of the configuration document**
  (fleetless/fleetless#1115). `robotConfigDoc.live` is optional and strict;
  its one key, `max_packet_bytes`, is an optional integer from 576 to 1350:
  the largest RTP packet the bridge sends, before SRTP, retransmissions
  included. 1350 is the ceiling because the bridge's SRTP library protects
  no packet above 1356 bytes. A key present overrides the bridge's ROS parameter
  `live.max_packet_bytes`. `liveSection` and the type `LiveSection` are
  exported.
- `LIVE_DEFAULTS` (`{ max_packet_bytes: 1200 }`), exported and written into
  `constants.json` for the bridge.

## [15.1.0] — 2026-11-12

### Added

- **Deletion journal: the waiting list** (fleetless/fleetless#1082). Two
  intent kinds under a new manifest scope `waitlist`, which has no
  organization:
  - `waitlist.retention`, a cutoff sweep with batch-only ids like
    `ops_global_event.retention`. Its `cutoff_at` is the instant the entries'
    event-based periods were evaluated; replay deletes exactly the frozen rows.
  - `waitlist.withdrawal`, one entry deleted on the person's request, named
    by `entry_id` (never the address), with no batch. Its manifest names
    exactly that entry's row and only deliveries addressed for it.
- `journalManifestRow`: the tables `waitlist`, `waitlist_invitations`,
  `waitlist_invitation_proofs` and `waitlist_consents` join the `uuid_row`
  table list, and two new members name the shared operator mail tables only
  for the waiting list: `waitlist_mail_effect` (`operator_effect_outbox`) and
  `waitlist_mail_delivery` (`operator_effect_mail_deliveries`). Both carry
  the effect's `source_action`, a closed enum of `waitlist_invite`,
  `waitlist_reinvite`, `waitlist_decline` and `waitlist_confirm`, so no
  manifest can name a billing or plan-change effect.
- `journalManifestBinding` refuses waiting-list rows and members outside the
  `waitlist` scope, and object entries inside it. In a `waitlist` manifest a
  delivery and its effect member agree on the source action, and a
  withdrawal names an effect only as the parent of one of its own
  deliveries. Replay deletes an effect only once it has no delivery left.

## [15.0.1] — 2026-11-12

### Fixed

- The description of `billingChangeResponse.charged` says `null` also means
  nothing was charged now (a change scheduled for the period's end, or an
  increase that cost nothing) or the change was charged through Lexware,
  where the charge is in `billing.charges` and there is no Fleetless invoice.
  The `charged` of an accepted change without payment says it is always
  `null`.
- The description of `intent.invoice_id` on a confirmed paid change says it
  names the charge or invoice created for that decision, and when the charge
  was issued through Lexware (`charged` is `null`) the matching
  `billing.charges[].id`; it is absent on a `paid_change` in any other state
  (carried over from fleetless/contracts#67). Descriptions only; the wire
  format does not change.
- The plan catalogue says `audit_export: true` for Basic and Plus, as the
  cloud already behaves: it exports the audit log on every plan.
  `requiredPlanFor('audit_export')` is now `basic`. A catalogue value only;
  the wire format does not change.

## [15.0.0] — 2026-11-06

### Added

- **App collections: structured records an app stores in the cloud.** A
  developer describes them in one document, `collectionsDocument`
  (`COLLECTIONS_FORMAT_VERSION` 1): up to 50 collections of up to 100 fields,
  each field a `collectionFieldType` with its own bounds, a `display` template,
  and an `access` rule per collection saying who may read and write.
  `collectionsDocumentIssues` judges a document and `collectionsAccessWarnings`
  names what its access rules allow; `checkCollectionValue` and
  `normalizeCollectionValue` judge and normalise one value the same way on
  every side, and `parseCollectionFilter` and `parseCollectionSort` read the
  filter and sort of a list request and report every problem with a JSON
  Pointer path. Four JSON templates (`pose2d`, `point2d`, `polygon2d`,
  `range1d`) are built in, and a field may carry an inline JSON Schema.
  `collections:` with nothing under it (YAML null) reads as no collections,
  the form of a template for a new app. A `json` value may nest arrays and
  objects 32 levels deep, and a `text` pattern is at most 1,000 characters;
  the cloud may also refuse a pattern as too complex.
- **Records.** A record travels as an envelope, `collectionRecord`: its system
  fields (id, robot, who and when, revision), the rendered display text and the
  required fields it is missing, with its own values under `values`. Writes
  send `values`, an optional robot and an optional expected revision, and a
  stale revision is answered `record_changed`. Lists take a filter, a search, a
  sort, `expand`, a page of 1 to 500 and a cursor, and reading one record
  takes the same `expand` (`collectionRecordGetQuery`); a page ends at 4 MiB
  of stored values, so only a `null` cursor says a list is at its end. The
  list of deleted records marks each record with `deleted_at` and
  `deleted_by`. Every change keeps a revision, `collectionRevision`, which the
  history route lists (in pages that end at 4 MiB as well) and the restore
  route can bring back. An actor is labelled by display name; an email
  address is shown only to a developer or a server key and to the person
  themselves.
- **Schema lifecycle.** Saving a draft, previewing it, publishing it, listing
  and restoring versions, and purging old history are separate steps. A change
  that would alter or remove data is previewed first: the preview lists its
  effects (ten kinds) and a token that stands for exactly that list, and the
  confirming request sends the token back as `confirm`; the preview also
  carries `source_sha256`, the hash of the draft it is for, which a publish can
  send back so that a draft saved again in between is not published unseen,
  also when there are no effects and so no token. A version can be restored
  together with its data for 90 days, and a version that a restore published
  says whether it put records back (`with_data`) and how many
  (`reverted_totals`).
- **Import and export.** An import is all or nothing and takes two requests, a
  preview that lists at most 1,000 errors with row, column, value and reason,
  and a confirmation with the preview's token; without a token the import
  route answers the preview, and a token that no longer holds is `409
  confirmation_required`. Modes are `upsert` and `mirror`, and a mirror's
  `scope` names a filter or a robot. The export query takes the filter, search
  and sort of a record list.
- **Realtime.** `collection_subscribe` and `collection_unsubscribe` open and
  close a subscription on the client socket, `collection_event` carries
  `created`, `updated`, `deleted`, `removed` and `entered` with the whole
  record, and `collection_subscribe_error` and `collections_schema_published`
  tell a client its subscription failed or its definitions changed. The cloud
  answers an accepted subscription with `collection_subscribed`
  (`collectionSubscribed`, carrying the `request_id`) once it is registered,
  also after a reconnect and a new subscribe, and every change from that frame
  on is delivered as an event: subscribe, wait for it, then list. There is no
  first snapshot. A developer connection names the app in `app_id`; a socket
  holds 50 subscriptions at most, and one that falls too far behind is closed
  with 1013.
- **Limits.** `COLLECTION_LIMITS` names every bound in one place: record size
  (1 MiB), text lengths, select options, filter depth and conditions, page
  sizes, import size (10 MB, 50,000 rows), pattern length, `json` nesting
  depth, the longest text an import error repeats and the write rates (600 a
  minute for an app, 120 for one acting user or key).
- **Routes and codes.** A new route section, App collections, with the
  developer routes under `/api/apps/:id/collections` and the same records,
  import and export for app users and server keys under
  `/api/client/collections`; only the two history purge routes need the Owner
  tier. New error codes `record_referenced`, `record_changed`,
  `collection_not_found`, `collection_removed`, `reference_invalid`,
  `required_missing` and `robot_not_attached`, with their details, and the
  audit actions listed as `COLLECTION_AUDIT_ACTIONS`. `confirmation_required`,
  which organization roles have used since 14.0.0, now also answers a
  publish, restore, purge or import that would change data. Its `details` is
  `{ preview }` here (`confirmationRequiredDetails`, the token in
  `details.preview.token`) and the rename preview itself for a role rename
  (the token in `details.confirm`), so a client that handles both looks for
  `details.preview` first.
- **Plan limits for collections.** `planLimitKey` gains `collection_records`
  and `collection_bytes`, counted per organization across its apps over
  current records only: 25,000 records and 1 GB on Basic, 250,000 and 10 GB on
  Plus, 1,000,000 and 50 GB on Pro, by contract on Enterprise. No add-on
  raises them. `GET /api/org/quotas` carries both as limits (`orgQuotas`,
  `null` when by contract) and as usage, with `collection_history_bytes`
  beside them for information (`orgQuotaUsageCounts`); a write or an import
  that adds data past a limit is `409 plan_limit` naming the key.
- **Collection rights of a role.** `roleCollectionRights` says per collection
  what a role may do: read, create, and update and delete on every record, on
  the role's own only (`own`), or not at all. The effective-rights answer
  (`GET /api/apps/:id/effective-rights`) lists one row per collection of the
  published schema in `collections`, an empty list without one.

### Changed

- **A role key can be written in an app's collections schema.** `referencePlace`
  gains the kind `collection_schema`: the `access` of a collection in the
  published schema or the draft of an app, with the app's id in `app_id`, the
  place in `path` (such as `collections.notes.access.update.own[1]`), `document`
  and, for the published schema, the `new_version` a rename with
  `update_references` would give it. It appears in the role list's `dangling`
  places and in the rename preview. The version such a rename appends is
  audited as `collection_schema.published` with `role_rename` in its details.
  **Breaking (major):** the enum of `kind`
  widens, so an exhaustive `switch` over it needs the new case and a validator
  built from the old artifacts refuses the new places.
- **A role rename can answer `429 rate_limited`.** `PATCH /api/org/roles/:key`
  lists `rate_limited` among its errors: a rename with `update_references` that
  has to rewrite the schema of an app whose collections are busy waits up to
  two seconds, then answers `429` with `retry_after_ms` and changes nothing.
  A schema text it cannot rewrite without losing it (an access rule that is an
  alias, say) refuses the rename with `400 validation_error` naming
  `update_references`, and changes nothing.
- **Deletion summaries count collections.** `appDeletionSummary` gains
  `collection_count` and `record_count`, and `robotDeletionSummary` gains
  `collection_records`, the records that go with the robot per app. All three
  are required fields of responses the server sends, like the other counts.
  A consumer that builds these objects itself (a test double, say) adds them.
- **Quota and effective-rights answers have new required fields.**
  `orgQuotas` gains `collection_records` and `collection_bytes`, and
  `effectiveRightsResponse` gains `collections`. A consumer that builds these
  answers itself adds them, as above; one that only reads them is unaffected.
- **Breaking (major):** `planLimits` requires `collection_records` and
  `collection_bytes`, like its other keys. That is the `limits` of `orgPlan`
  (`GET /api/org/plan`), of every plan catalogue entry and of
  `planChangeDecisionStatusResponse`, and the constant `PLANS`. A consumer
  that builds plan limits itself, or keeps a `Record<PlanLimitKey, ...>`,
  adds both keys, and a validator built from the old artifacts refuses the new
  answers. A consumer that embeds `orgPlan` or `planLimits` in a schema of its
  own (an admin or operator API, say) inherits the two required keys: its
  parsed type changes, every fixture or stored sample of a plan needs
  `collection_records` and `collection_bytes` (`null` is by contract), and a
  plan written before this release, without them, no longer parses. A list of
  limit keys written out by hand (an enum, or a table keyed by limit) does not
  widen with `planLimitKey` and gets the two keys added by hand. The enums that
  do follow it widen as well: `addonCatalogueEntry.raises`,
  `assetPlanLimitDetails.limit` and `planLimitDetails.limit` accept the two new
  keys. The last one is the `details.limit` of `409 plan_limit` for a
  collection write; no add-on raises the keys and an asset refusal never names
  them. An exhaustive `switch` over any of the three needs the two cases.
  `planOverrides` and the `overrides` of an admin plan change accept the two
  keys too, and a validator built from the older artifacts refuses a request
  that names them.

### Removed

- **Breaking (major):** The `robot_details` built-in. `robotDetailsDoc`,
  `putRobotDetailsRequest` and `putRobotDetailsResponse` (with their types and
  the three JSON Schema artifacts), the route `PUT /api/robots/:id/details`,
  and the reserved slug are gone: `RESERVED_SLUGS` is now `bridge_state`,
  `history`, `assets` and `job_history`, so `robot_details` is an ordinary slug
  that a configuration may use. The descriptions of `datapointDescriptor`,
  `datapointListResponse` and the configuration sections name `bridge_state`
  as the only built-in datapoint. Nothing was deprecated first. To move over,
  keep what a robot's details held in a collection with one record per robot
  (`binding: one_per_robot`) in the app's collections document, and read and
  write it with the collection routes; delete the calls of the removed route
  and the code that parsed the removed schemas.

## [14.0.0] — 2026-11-05

Per-app roles are replaced by organization roles. What follows is one major
release; every breaking item is named once, under Removed or Changed.

### Removed

- **Breaking (major):** The per-app role routes: `POST` and `GET
  /api/apps/:id/roles`, `PATCH` and `DELETE /api/apps/:id/roles/:roleId`,
  `PUT` and `GET /api/apps/:id/roles/:roleId/permissions`, and `GET
  /api/apps/:id/roles/:roleId/mcp-tools`. Roles belong to the organization
  from here on. What a role may use is no longer a matrix kept per app: it is
  written in each robot's `fleetless.yaml` (`role` on an entry, `access.rules`,
  `access.assets` and `access.job_history`) and in the organization's defaults
  (`PUT /api/org/roles/defaults`), and what an app takes away is its locks
  (`PUT /api/apps/:id/access`). To carry a per-app role over, create an
  organization role with the role's key, name the key where the matrix granted
  access, and give the app's users and invitations that key.
- **Breaking (major):** The shapes of those routes, with their types and JSON
  Schema artifacts: `role`, `roleListResponse`, `roleRenameRequest`,
  `roleDeleteQuery`, `roleInUseDetails`, `rolePermissions` and
  `mcpRolePreviewResponse`.
- **Breaking (major):** The error codes `role_name_taken`, `role_in_use` and
  `last_role`.
- **Breaking (major):** `appDeletionSummary.role_count`. Deleting an app
  deletes no role, so the preview counts five things, not six.

### Changed

- **Breaking (major):** `clientIdentity.role_id` is replaced by `role`, an
  object with the role's `key` and display `name`, or `null` when the caller
  has no role to name (a developer, a server key, an app user whose key is no
  role). It is part of the `GET /api/client/me` answer and of the realtime
  `auth_ok` frame. A consumer that read `role_id` reads `role.key` now.
- **Breaking (major):** `mcpCapabilities.action_history` is renamed
  `job_history`, without an alias. The capability names the same thing, the
  past jobs of a robot (`GET /api/robots/:id/jobs/history`), and now matches
  the `job_history` of the `fleetless.yaml` `access` section and of the
  organization defaults. It travels in the `capabilities` of
  `mcpRobotDatasheet` (`robots.describe` and `GET /api/robots/:id/datasheet`)
  and is what `capability_required` names beside `assets`. A datasheet
  without `job_history` no longer satisfies the schema, and a consumer that
  read `action_history` reads `job_history` now.
- **Breaking (major):** `app.default_role_id` is replaced by `default_role`,
  the role's key or `null` when the app has none, and `updateAppRequest` no
  longer takes `default_role_id`: a patch that names it is refused. The default
  role is set with `PUT /api/apps/:id/access`, together with the locks. A key
  that names no role is shown as stored and warns. The `robot_ids`
  description no longer says a role decides what an attached robot allows: that
  follows the robot's `fleetless.yaml` and the organization's defaults, less
  what the app locks.
- **Breaking (major):** app users and app invitations hold a role key.
  `role_id` is replaced by `role`, a role key, in `appUser`,
  `createAppUserRequest`, `patchAppUserRequest`, `createAppInvitationRequest`
  and `appInvitation` (so also `pendingAppInvitation`). `role` is optional in
  the three requests, and absent means the app's `default_role`; `appInvitation`
  requires it. `appUser.role` and `pendingAppInvitation.role` are nullable: an
  account, or a pending invitation whose app has no default role, left without a
  key lists with `role: null` and reaches nothing. A malformed key is refused; a
  key that names no role is accepted and grants nothing. `409
  target_state_conflict` now names `default_role` (rule `not_set`) where it
  named `default_role_id`, and a role of another app is no longer a `404`. A
  consumer that sent or read `role_id` sends and reads the role's key now.
- **Breaking (major):** locks follow a slug rename where role grants used to.
  `renameSlugResponse.rewritten_grants` is `rewritten_locks` and
  `slugUsageResponse.grant_count` is `lock_count`: the app locks that list the
  renamed slug now list the new name as well, in every app of the
  organization. A rename that would push a lock past the most slugs it can hold
  is refused with `409 target_state_conflict`, rule `lock_full`.
- **Breaking (major):** `publishConfigResponse` requires `warnings`: every
  warning of the published document, `[]` when it has none. An answer from a
  cloud that does not send it yet no longer satisfies the contract.
- **Breaking (major):** the slugs `assets` and `job_history` are reserved, like
  `bridge_state`, `robot_details` and `history`: `RESERVED_SLUGS` lists them,
  and a configured entry of either name is refused when the document is
  validated. They name the robot-level capabilities, so an exposure of the same
  name would have left the `name` of an `effectiveCapability` ambiguous.
- `POST /api/apps/:id/invitations/:invId/reissue` lists `target_state_conflict`:
  an invitation that holds no role key, in an app with no default role, is
  refused with it (rule `not_set`, field `default_role`) before the old link is
  revoked.
- The mail template variable `role.name` is the display name of the
  organization role the invitee is given.
- The journal kind `app_role.delete` is retired: no producer writes it any more,
  and it stays in the contract so that journals written before still parse and
  replay.

### Added

- Roles in `fleetless.yaml`. `role` — one role key, or a list of keys — is an
  optional field of every entry of `datapoints`, `actions`, `services`,
  `publishers` and `cameras`, and the new optional `access` section holds
  `rules` (each with a `match` glob over the entry's ROS name, optional
  `kinds` and a `role`) and the robot-level `assets` and `job_history`.
  `accessRule` and `accessSection` are exported. The bridge ignores both
  fields.
- The helpers that resolve them, from the package root: `roleKey`, `roleRef`,
  `accessKind`, `matchRosGlob`, `roleClosure`, `roleSatisfies`, `findCycle`,
  `listExposures`, `requirementOf`, `collectRoleRefs` and `roleIssues`, with
  `ROLE_KEY_PATTERN` and `ROLE_KEY_RULE` (the pattern a role key must match
  and the sentence that says so), `ACCESS_KINDS`, `ENTRY_KINDS`,
  `MAX_ORG_ROLES`, `ROLE_NAME_MAX`, `SEED_ROLES`, `SEED_DEFAULTS` and their
  types. `RoleRef` is the type of a `role` field, one key or a list of keys;
  `RoleRefUse`, the result of `collectRoleRefs`, is one place a document names
  a key. `roleIssues` yields the two warnings a document can earn,
  `unknown_role` and `rule_matches_nothing`.
- Organization roles on the wire. Six developer routes, none owner-only:
  `GET` and `POST /api/org/roles`, `PATCH` and `DELETE /api/org/roles/:key`,
  and `GET` and `PUT /api/org/roles/defaults`. The list answers each role with
  its counts and the keys that are written somewhere but are no role; a rename
  with `update_references` that has places to rewrite is two calls, the first
  answered with a preview and a `confirm` token, and one with none applies at
  once. The key `defaults` is reserved and is no role key. Shapes: `orgRole`,
  `orgRoleListResponse`, `danglingReference`, `referencePlace`,
  `createOrgRoleRequest`, `patchOrgRoleRequest`, `roleRenamePreview`,
  `roleDefaultsResponse` and `putRoleDefaultsRequest`, each with its type and
  JSON Schema artifact.
- The error codes `role_cycle` (`400`, `details` is `roleCycleDetails`),
  `role_key_taken` (`409`) and `confirmation_required` (`409`, `details` is
  the preview that carries the token to confirm with).
- The journal kind `org_role.delete`, recorded like `server_key.revoke`.
- App access and effective rights on the wire. `GET` and `PUT
  /api/apps/:id/access` read and replace what an app locks (`locked_kinds` for
  whole kinds of access, `locked` for single exposures of single robots) and
  the role its users get by default; the answer carries `warnings` for what is
  out of step. `GET /api/apps/:id/effective-rights` takes `role` or `user` and
  answers, per attached robot, every capability with whether it is granted,
  where its requirement came from, whether the robot is `reachable` at all and
  the datasheet an MCP session of that role would get. Developer routes, none
  owner-only. Shapes: `appAccess`, `appLock`, `accessWarning`,
  `appAccessResponse`, `effectiveRightsQuery`, `effectiveCapability`,
  `effectiveRobotRights` and `effectiveRightsResponse`.
  The lists of an access name each kind, slug and robot once, and are bounded;
  `MAX_LOCK_SLUGS` is the most slugs one lock can name.
- `revision` on the access of an app. `appAccessResponse` carries the revision
  of the stored access, and the `PUT /api/apps/:id/access` body may send back
  the one it was composed from: when the stored access has changed since (a
  write, a slug rename that extended a lock, a robot detached), the write is
  refused with `409 target_state_conflict`, rule `stale`, and nothing is
  written. Without a `revision` the body replaces what is stored, as before.

## [13.3.0] — 2026-11-05

### Added

- `configAuthor`: a console team member by display name (the local part of the
  email address when the member has none), never a full email address. The
  config draft carries `updated_by` and each published version `published_by`,
  both `configAuthor` or `null`: `null` when nobody has saved yet, when the
  cloud itself rewrote the draft, when the member has since been removed, or
  for rows older than the field. Both are optional on the wire: a consumer
  reads an absent field as unknown, and the cloud always sends it.
- `hostedLogoShape` (`square` or `wide`) and `appAuthConfig.hosted_logo_shape`,
  read-only and derived from the stored image: `wide` when the logo is more
  than one and a half times as wide as it is high, otherwise `square`, and
  `null` exactly when `hosted_logo_url` is `null`. The field is optional on the
  wire: a consumer reads an absent field as unknown, and the cloud always sends
  it.

### Changed

- `HOSTED_LOGO_MAX_BYTES` rises from 100 KB to 512 KB (`524_288`). The logo
  route's notes state the new limit.

### Removed

- The internal route `GET /mcp/welcome` (audience `internal`) is no longer listed: the MCP landing page
  moved to https://fleetless.dev/mcp/.

## [13.2.0] — 2026-11-05

### Changed

- Robot and app deletion, bridge-token rotation, server-key minting, rotation
  and revocation, and asset sync and clear no longer need the Owner tier. The
  eight routes (`DELETE /api/robots/:id`, `POST /api/robots/:id/token/rotate`,
  `DELETE /api/apps/:id`, `POST /api/apps/:id/server-keys`,
  `POST /api/apps/:id/server-keys/:keyId/rotate`,
  `DELETE /api/apps/:id/server-keys/:keyId`,
  `POST /api/robots/:id/assets/sync`, `DELETE /api/robots/:id/assets`) carry
  `ownerTier: false` and no longer list `tier_required`, so a developer is
  never answered with it. Statuses, schemas and the remaining errors are
  unchanged.

## [13.1.0] — 2026-11-03

### Added

- `retention_range` member of `journalManifestRow` for retention sweeps of
  `datapoint_series_samples` and `bridge_latency_buckets`. One row names an
  expired time range (`table`, `org_id`, `robot_id`, optional `series_id`,
  `from` inclusive, `cutoff` exclusive, `row_count` and a SHA-256
  `rows_digest` of the sorted row keys the range held when it was frozen)
  instead of one manifest row per deleted row. Replay deletes the rows of the
  range and none at or after its cutoff. `journalManifestBinding` accepts
  ranges only under `history.retention`, `history.slug_delete` and
  `latency.retention`, bound to the intent's organization, robot, series and
  cutoff, with no overlap inside one robot. The per-row `history_sample` and
  `latency_bucket` members stay valid for journals written before.

## [13.0.1] — 2026-11-03

### Fixed

- Corrected the `cancellation_document_url` and invoice PDF route descriptions:
  Cloud always returns `null` for cancellation document URLs and does not
  serve cancellation PDFs; cancellation documents are held in Lexware.
  `cancelled` and the wire schemas are unchanged.

## [13.0.0] — 2026-11-02

### Changed

- **Breaking (major):** C.4 billing decision snapshots require a `period.anchor`
  discriminator and nullable `future_price_replacement`. Existing periods keep
  their date fields under `existing_period`; first paid checkout can instead
  carry approved conditional timing under `on_first_successful_payment`, with
  no fixed dates and a cycle matching the selection. Paid/plan changes require
  existing periods. A replacement identifies the future agreement and its
  visible server-rendered statement.
- Owner acceptance history also recognizes `amendment` and `price_offer`.
  Declines remain outside that list.

### Added

- Strict organization Terms/price offer schemas, four authenticated routes,
  explicit acceptance/decline and recovery shapes, canonical string queries,
  and `legal_offer_unavailable`. H.3 snapshots and decisions have `dpa: null`.
- Strict first-checkpoint, registry-transition and registry-activation receipt
  bodies/envelopes for the private Cloud/Ops deletion journal, with matching
  JSON Schemas. Shape validation does not verify signatures or authorize restore.
- Strict v2 deletion-intent bodies/envelopes with 45 operation kinds, 48 closed
  identity branches and kind-bound protected-manifest references. Protected
  deletion manifests add seven scope arms, typed row and object memberships,
  frozen cutoff or explicit-set batches and exact candidate intent binding.
- Strict v2-activation and generation checkpoint bodies/envelopes and final
  drain seal. Zod validates successor, changed-generation and cutoff relations;
  JSON Schema consumers must enforce cross-field relations separately.
- Mixed v1/v2 journal export and closed mirror-attempt shapes, including
  unexpected delete markers and inventory failures, plus typed evidence refs,
  whole/scoped access proofs and signable replay-receipt envelopes. Failed scopes
  and incomplete mirror inventory remain reportable but cannot pass the gate.

These additive shapes have generated JSON Schemas. They do not verify original
signed bytes, protected readbacks, complete source coverage or live replay, and
do not activate C0, a producer or a restore gate.

## [12.1.0] — 2026-11-02

### Added

- `file_limit` on a `refused` asset sync failure carries the enforced per-file
  limit and known file size through Bridge progress and Cloud sync status.
  Store-full `details` stays separate; failure kinds are unchanged.

## [12.0.0] — 2026-11-02

### Changed

- **Breaking (major):** The public `GET /api/client/providers` response now
  requires `two_factor: off | optional | required`, the app's two-factor
  policy. It does not describe a person's enrollment state. Older responses
  without this field no longer satisfy the contract.

### Fixed

- Corrected the exported `Job.state` and `JobRun.state` descriptions of final
  `lost` causes, including terminal status without a recoverable result, and
  the `job_lost` fallback for a bridge loss frame without an explicit error.
  Wire shapes and error codes are unchanged.

## [11.0.0] — 2026-11-02

### Added

- `cancelled` invoice status, required nullable `cancellation_document_url` for
  historical Cloud invoices, and optional `kind=invoice|cancellation` on the
  owner-only invoice PDF route. Omitting `kind` still returns the original PDF.

### Fixed

- Corrected billing error and route notes for interrupted Mollie charges,
  `charge_in_progress`, and first-checkout reuse or `checkout_open` refusal.

## [10.1.0] — 2026-11-01

### Added

- Owner-only held-job recovery request and response for an audited physical-stop
  assertion (`operator_verified_stopped`), and optional cloud-observed
  `bridge_state.health_reason` for unanswered job queries. No bridge frame
  changes.

## [10.0.0] — 2026-11-01

### Added

- Owner-only C.4 display for eligible checkout and paid-change intents, and
  nonbinding `POST /api/org/plan/change/prepare` plus Owner decision lookup.
  The display carries a Cloud-issued, short-lived proof, immutable legal
  references, verified buyer/VAT details, and exact price and period values.
- `accepted_no_payment` intent variant for confirmed zero-charge changes.

### Changed

- **Breaking:** Checkout and billing-change starts are nonbinding drafts;
  `accept_terms` is deprecated and cannot confirm an order. Checkout and
  paid-change confirmation, and final `PUT /api/org/plan/change`, require
  `confirmation_proof`. The final Basic PUT alone accepts an optional
  cancellation reason of up to 500 input characters. The former direct
  `POST /api/billing/cancel` is rejected after the C.4 gate is active.
- **Breaking:** Billing-change and intent responses distinguish draft,
  payment-started, and accepted-without-payment results; an immediate
  accepted change is no longer returned by the start route.

## [9.1.0] — 2026-11-01

### Changed

- Defined `job_lost` on a final `lost` job for a terminal goal whose result
  remains unavailable after the bounded wait, or for a loss with no more
  specific cause; `error.message` distinguishes them. Pre-terminal action
  server disappearance remains `action_server_lost`, and a confirmed job
  unknown to the bridge remains `job_unknown_to_bridge`. The existing codes,
  public Job shape and wire schemas are unchanged.

## [9.0.0] — 2026-11-01

### Added

- Internal `POST /console/support/renew/fail` contract with a strict
  original-bearer/PKCE request and typed no-store refusal pairs. Cloud ends
  only a pending, current-generation flow within its 120-second proof window;
  a stale tab cannot end the winning support session. Console must first
  verify one-use signed Operator failure evidence bound to its browser flow;
  browser callback parameters alone cannot trigger the Cloud call. This
  prerequisite adds no field to the strict Cloud request.
- Owner-only `GET /api/org/legal/acceptances` and the additive
  `legalAcceptanceListQuery`, `legalAcceptanceVersionRow`, and
  `legalAcceptanceListResponse` schemas. Pages expose stored Terms and
  applicable DPA version references with an opaque cursor; Cloud enforces
  organization scope, Owner access, and cursor decoding.

### Changed

- MCP and REST reference descriptions name the bundled tool actions
  (`robots.list`, `robots.describe`, `camera.snapshot`, and others). Exported
  wire shapes and endpoint paths are unchanged.
- **Breaking:** `waitlistRequest` requires `consent_text_version` for the F.1
  wording shown by the form. `putAppAuthUrlsRequest` requires explicit
  `operator_info_url` and `privacy_policy_url` keys; `null` clears a link.
  `appAuthConfig` returns both nullable fields for legacy apps.
- The four default customer-app mails include the D.2 app-operator footer
  when both legal links are set. A missing link omits the whole footer for
  legacy security mail; the cloud owns the temporary reset and sign-in-code
  exception and gates new access flows.

### Added

- Separate versioned Terms and DPA reference schemas and initial `1.0`
  identifiers, dated `2026-11-01`, with permanent version URLs. A DPA reference
  is `null` only in an acceptance context where it does not apply.
- `WAITLIST_F1_TEXT_VERSION` (`F.1:1.0`) and the `app.operator_info_url` and
  `app.privacy_policy_url` mail-template variables.

## [8.2.0] — 2026-10-30

### Added

- Customer-confirmed controller register schemas and owner-only `GET` and `PUT /api/org/controller-register` routes. Optional privacy contact and EU representative can be explicitly cleared; register data never comes from billing.

## [8.1.0] — 2026-10-28

### Added

- Internal, additive shapes for Block D support sessions: `supportSessionInfo`,
  `supportTokenRequest`, `supportTokenResponse` and `authMeSupportResponse`
  (`authMeResponse` extended with an optional `support` block). New
  `audience: 'internal'` routes `POST /console/support/token` (exchanges an
  operator's one-time support grant for a console session scoped to one org,
  server to server only, RFC 6749 §5.2 `oauthError` refusals, sixty minutes,
  no refresh token) and `POST /api/auth/support/end` (ends the calling
  support session; any non-support token answers `403 forbidden`). New
  error codes `support_read_only` and `support_forbidden`. None of this is
  in the public developer reference: the public route entries and
  `authMeResponse` itself are unchanged.

## [8.0.0] — 2026-10-19

### Changed

- **Breaking:** `billingView` requires `issuer` (`cloud` or `lexware`) and
  `charges`. `charges` lists only due charges with issuer `lexware` —
  never a pre-cutover charge, a legacy payment or a late USD collection,
  which have no Lexware intent and stay in `invoices` or nowhere.
  `invoices` is now documented as the Cloud-issued invoices from before
  the cutover: read-only, and it never grows after it. New
  `POST /api/billing/charges/:id/pay` pays one due charge, the same body
  as `POST /api/billing/invoices/:id/pay`; that route now answers `404
  not_found` for a due charge's id after the cutover — it reads a
  historical open `FL-…` invoice only, same as
  `GET /api/billing/invoices/:id/pdf`. New `purchaseHoldReason` values
  (`lexware_contact_pending`, `lexware_contact_changed`,
  `issuer_cutover_in_progress`, `lexware_issuance_paused`) describe the
  Lexware-side integration holds during and after the cutover.

## [7.1.0] — 2026-10-19

### Added

- `GET /api/billing/documents`, `GET /api/billing/documents/:id` and
  `GET /api/billing/documents/:id/file`: a read-only view of the org's
  finalized Lexware billing documents (invoices, credit notes, down-payment
  invoices and bookkeeping vouchers), with the e-invoice profile (`NONE`,
  `EN16931`/ZUGFeRD, `XRechnung`) and the files each document offers. The
  list is complete or an error, never truncated. New error code
  `billing_documents_unavailable` for a Lexware answer this cloud cannot
  turn into a complete, trustworthy response.

## [7.0.0] — 2026-10-18

### Changed

- **Breaking:** new paid purchases require company billing details. Other EU
  countries require a VAT ID, non-EU purchases a Tax ID, and US purchases a
  two-letter state. Owner edits can update company name, address/state and Tax ID.
  Historical person payers and USD accounts/invoices remain readable.
- **Breaking:** `vatFor` consumes a definitive VIES verdict and confirmation
  identifier, returning `eligible`, `pending` or `refused`. Unavailable VIES or
  a missing identifier never authorizes reverse charge. Public VAT checks expose
  pending reasons without protected evidence; an unsettled account may have `vat: null`.
- **Breaking:** catalogue prices and new charge/quote helpers are EUR-only.
  USD amounts are read from historical snapshots, never recalculated as new prices.
- **Breaking:** checkout, paid changes, invoice payments and method changes require
  a stable `operation_key`. Their intent responses distinguish unpaid pending,
  eligible, refused and held states from `payment_started`. Hosted redirects live
  at `payment.checkout_url` only after a persisted payment exists. A paid change
  can carry its intent alongside the resulting billing view.

### Added

- Owner intent lookup by operation key or intent ID, and current-quote confirmation
  with quote revision and buyer fingerprint. Typed conflict details return the
  current intent for stale confirmations and identify conflicting key reuse.
- Explicit integration holds for legacy USD invoices, legacy payers and unresolved
  zero-amount mandate setup. Invoice-paying Apple Pay is a separate operation.
  These holds do not authorize a migration or a new provider payment.

## [6.5.0] — 2026-10-11

### Added

- The internal auth-portal route template `GET /waitlist-invite/:token`,
  unauthenticated and rate-limited, for waiting-list invitations to a new
  Basic organization. It describes the browser-proof redirect and invalid
  link handling without publishing recipient links or secret values.

### Changed

- Console signup route notes describe the invite-bound exception under
  `SIGNUP_MODE=closed`. Ordinary public signup remains closed; the existing
  signup auth/rate-limit metadata and team invitation routes are unchanged.

## [6.4.0] — 2026-10-09

### Changed

- **Final releases publish under the npm dist-tag `staging`;** `latest` moves
  when the release is promoted to production, and never backwards. `npm i
  @fleetless/contracts` therefore installs what runs in production. A release
  that is still being tested is installable by its version number or as
  `@fleetless/contracts@staging`. Pre-releases stay under `next`. No wire
  shape changes.

## [6.3.0] — 2026-10-05

### Added

- **Billing.** `src/billing.ts`: `EU_COUNTRIES`, `countryCode`,
  `currencyForCountry`, `normalizeVatId` and `viesCountry`; `vatFor`, who
  may pay and at which VAT rate (Germany 19 %, a company in another EU
  country with a VAT ID VIES confirms 0 % reverse charge, outside the EU
  0 %, everyone else refused with a named rule); the money functions in
  integer cents (`periodNetCents`, `periodDays`, `remainingDays`,
  `prorateCents`, `changeNetCents`, `chargeAmounts`, `checkoutQuote`); and
  the dunning schedule `BILLING_RETRY_DAYS` and `BILLING_LOCK_DAY`.
- **The billing read model and requests.** `billingView` (the account, the
  payment method on file, the `payment_method_options` a change may offer
  now, the last 24 invoices), `billingAccount`, `billingInvoice`,
  `paymentMethod`, `billingDetails` and `billingAddress`;
  the requests `checkoutRequest`, `vatIdCheckRequest`,
  `billingChangeRequest` (absolute counts, not deltas),
  `billingCancelRequest`, `billingDetailsUpdate` and
  `paymentMethodChangeRequest`; the answers `checkoutResponse`,
  `checkoutStatus`, `vatIdCheckResponse` and `billingChangeResponse`. Each
  has a JSON Schema in `artifacts/schema/`.
- **Card, PayPal and Apple Pay.** `paymentMethodKind`
  (`card | paypal | applepay`) is what `paymentMethodChangeRequest` names
  and what `paymentMethod` shows: `applepay` carries the card fields,
  because Mollie stores an Apple Pay mandate as a card mandate. A change
  to Apple Pay may be refused with `400 validation_error`, rule
  `applepay_needs_open_invoice`, where it can only be made while paying an
  open invoice; `payment_method_options` says which applies.
- **The VAT-ID hold and chargebacks** (descriptions only). A renewal held
  by the VAT ID is a due charge without an invoice number until it is
  paid: `dunning.invoice_id` names it, `failure` is `vat_id_invalid`, and
  `POST /api/billing/invoices/:id/pay` answers `409 target_state_conflict`,
  rule `vat_id_invalid`, while it is held. A charged-back payment is never
  recharged automatically: `next_retry_at` is `null`, `failure` is
  `charged_back`.
- **The `billing` route section**, twelve routes: `GET /api/billing`, the
  checkout and its status, the VAT-ID check, billing details, changes,
  the payment method, cancel and resume, an invoice's PDF and paying an
  open invoice, all owner-tier; and Mollie's webhook
  (`POST /api/billing/mollie/webhook`, internal, no auth).
- **`billing_unavailable`** (`503`): this cloud has no payment provider
  configured, so it takes no payments. Retrying does not help.
- **`payment_provider_unavailable`** (`502`): Mollie did not answer, or
  answered with an error; nothing was charged. `details` is
  `paymentProviderUnavailableDetails` (`provider`, Mollie's HTTP `status`
  or `null` for a timeout). Retrying may work.
- **`history_migrating`** (`409`): a slug rename refused while the robot's
  recorded history is being migrated to a new storage layout. Temporary;
  nothing is written, and the same request succeeds once the migration has
  finished. Listed on `POST /api/robots/:id/config/rename-slug`. A consumer
  that switches exhaustively over `ErrorCode` gains one case.

### Changed

- **`PATCH /api/admin/orgs/:id/plan`** lists `target_state_conflict`: rule
  `billed` when the org has a billing account and the change would touch
  its currency or period.
- The notes of **`PUT /api/org/plan/change`** and the admin route no longer
  say payment is missing; an upgrade of a billed org goes through the
  billing routes.
- `POST /api/robots/:id/config/rename-slug`: the summary and notes, and the
  `renameSlugRequest` doc comment, now say the history moves with the name
  without rewriting stored samples, and that samples sent under the old slug
  before the publish join the renamed history. No wire shape changed.

## [6.2.0] — 2026-10-04

### Added

- **`file_too_large`** (`413`): one asset file is larger than
  `ASSET_FILE_MAX_BYTES` (one gigabyte, every plan, the URDF included).
  `details` is `fileTooLargeDetails`: `max_bytes` and `size_bytes`, the
  announced size or, when none (or a false one) was announced, the bytes that
  arrived; `null` only when the body limit stopped the upload.
  `ASSET_FILE_MAX_BYTES` is in `constants.json`. `plan_limit` and
  `quota_exceeded` on an asset upload now mean only that the store is full.
- **`plan_limit` in `clientOidcErrorCode`.** A federated sign-in that would
  create an app user beyond the org's plan `app_users` limit now redirects
  with `?error=plan_limit`, so an app can tell that the plan is full.
  `quota_exceeded` keeps one meaning there: the `max_end_users` protection
  ceiling, which also covers orgs still on the beta. A consumer that switches
  exhaustively over `ClientOidcErrorCode` gains one case.

### Changed

- **`POST /api/bridge/assets`** lists `file_too_large` and `plan_limit` among
  its errors, and its notes describe the per-file limit instead of a bare
  `413`.

## [6.1.0] — 2026-10-03

### Added

- **The plan catalogue.** `src/plans.ts`: `planId` (`basic`, `plus`, `pro`,
  `enterprise`, cheapest first in `PLAN_ORDER`), and per plan in `PLANS` the
  limits (`planLimits`: `seats`, `robots`, `apps`, `app_users`,
  `live_video_ms_per_month`, `asset_bytes_per_robot`, `history_days`,
  `audit_days`; `null` means by contract), the feature flags
  (`planFeatures`), the prices in integer cents excluding VAT
  (`planPrices`: EUR and USD, monthly and yearly; `null` on request) and the
  support tier. `ADDONS` lists the Pro add-ons and the limit each raises.
  `usdCentsFromEurCents`, `yearlyEurCents` and `pricesFromEurMonth` state the
  price rule (USD = EUR × 1.15 up to the next whole dollar, yearly = twelve
  months less 15 %); `requiredPlanFor` and `nextPlanRaising` name the plan
  that unlocks a feature or lifts a limit.
- **The organization's plan.** `GET /api/org/plan` (`orgPlan`): the plan, its
  effective `limits` (the catalogue row raised by `addons` or an operator's
  `overrides`), `features`, fresh `usage` (`orgPlanUsage`), any
  `pending_change` (`pendingPlanChange`), an `orgLock` and, for an
  organization still on the beta, `switch`. `PUT /api/org/plan/change`
  (`planChangeRequest`, Owner tier) records the owner's move to a lower
  plan or a cancellation; everything not named in `keep` (`planChangeKeep`)
  is deleted when the change takes effect, never before: at
  `period_ends_at`, at once for an org that is locked, or at the switch
  date for an org still on the beta. `DELETE /api/org/plan/change` (Owner
  tier) withdraws one still pending.
- **The admin plan route.** `PATCH /api/admin/orgs/:id/plan`
  (`adminPlanChangeRequest`) lets the operator change an org's plan,
  add-ons, limit overrides (`planOverrides`), currency or billing period at
  once, never queued. A new `RouteAuth` value, `ops`: a bearer token the
  operator holds (`OPS_API_TOKEN`), reachable only on the cloud's private
  address — every public host answers `404` for `/api/admin/*`.
- **The plan errors.** `409 plan_limit` (`planLimitDetails`, or
  `assetPlanLimitDetails` for an asset-storage refusal), `403 plan_required`
  (`planRequiredDetails`) and `403 org_locked` (`orgLockedDetails`), answered
  before anything is written.
- **Two small additive changes that ride with the plan work.**
  `liveSessionEndReason` gains `plan_limit`: a live session ended because the
  org's monthly video limit was reached. `auditActor.kind` gains `fleetless`,
  for an event the platform recorded with no member behind it — the admin
  plan route, a queued change landing, a lock taking effect, the beta
  switch.

## [6.0.0] — 2026-10-02

### Added

- **App sign-in methods, two-factor policy, hosted pages and look.**
  `appAuthConfig` gains `sign_in_methods` (`appSignInMethods`: `password`
  and/or `email_code`, at least one; default password only), `two_factor`
  (`appTwoFactorPolicy`: `off`, `optional`, `required`; default `off`),
  `app_url` (`appHomeUrl`), `hosted_accent` (`hostedAccent`, `#rrggbb`
  lowercase), and the read-only `hosted_logo_url` and `hosted_pages`
  (`appHostedPages`) — the Fleetless-hosted page each unset URL falls back
  to. New slices `PUT /api/apps/:id/auth-config/sign-in`
  (`putAppAuthSignInRequest`) and `…/look` (`putAppAuthLookRequest`), and
  the logo as a raw PNG or SVG body at `PUT` and `DELETE
  /api/apps/:id/auth-config/logo` (`HOSTED_LOGO_TYPES`,
  `HOSTED_LOGO_MAX_BYTES`, 100 KB).
- **App-user two-factor state and reset.** `appUser.two_factor` (`enabled`,
  `enabled_at`, `recovery_codes_left`), and `DELETE
  /api/apps/:id/users/:userId/two-factor` resets it and ends the user's
  sessions.
- **Email-code sign-in for app users.** `POST /api/client/login/code`
  (`clientLoginCodeRequest`, a `202` decoy for every address) mails six
  digits valid ten minutes; `POST /api/client/login/code/verify`
  (`clientLoginCodeVerifyRequest`) spends them. The mail kind `login_code`
  joins `mailTemplateKind`, with its default template and the variables
  `code` and `expires_in_minutes`.
- **TOTP two-factor for app users.** `clientSignInResult`, the union of
  `sessionTokens` and `twoFactorChallenge`, is what every sign-in step
  answers. `POST /api/client/two-factor/verify`
  (`clientTwoFactorVerifyRequest`), `…/setup` (`clientTwoFactorSetupRequest`,
  answering `twoFactorSetupResponse`), `…/setup/confirm`
  (`clientTwoFactorSetupConfirmRequest`, answering
  `clientTwoFactorSetupConfirmResponse`: ten recovery codes and the
  session), and `DELETE /api/client/two-factor`
  (`clientTwoFactorDisableRequest`). Shared by both identity spaces:
  `loginCode`, `totpCode`, `recoveryCode` and `recoveryCodesList`.
- **Developer sign-in by emailed code and passkey, with second factors.**
  The portal steps for `/console/oauth` and `/mcp/oauth` —
  `developerSignInRoutes(prefix)`: code, second step, recovery code,
  passkey, and the setup when the org requires two-factor — and console
  sign-up by email, code (`POST /console/oauth/signup/code`) and
  organization. A developer manages their own passkeys, authenticator and
  recovery codes at `GET /api/auth/two-factor` (`developerTwoFactor`),
  `/api/auth/passkeys` (`webauthnOptionsResponse`, `createPasskeyRequest`,
  `createPasskeyResponse`, `renamePasskeyRequest`, `developerPasskey`),
  `/api/auth/totp` (`totpConfirmRequest`, `totpConfirmResponse`) and `POST
  /api/auth/recovery-codes` (`recoveryCodesResponse`).
- **An org can require two-factor.** `org.require_two_factor`, set by owners
  through `PATCH /api/org`; `fleetlessUser.two_factor` reports each member's
  factors, and `DELETE /api/org/users/:id/two-factor` lets an owner reset a
  member's.
- **The hosted app pages** under `/app/:appIdentifier` on the auth portal,
  nineteen internal HTML routes: the MCP sign-in, the two-factor steps, the
  invitation, reset, verification, forgot-password and sign-up pages, and
  the app's logo.
- **Error codes `invalid_code`** (details `invalidCodeDetails`:
  `attempts_left`) **and `method_not_allowed`.**

### Changed

- **Nothing is refused for a missing app URL.** An unset `invite_url`,
  `verify_url`, `reset_url` or `mcp_login_url` falls back to the hosted
  page: mailed invitations, self-registration, resets and MCP sign-in work
  before an app has pages of its own, and the per-app MCP authorize no
  longer answers `409 target_state_conflict` for a missing
  `mcp_login_url`.
- **Every app-user sign-in step answers `clientSignInResult`.** `POST
  /api/client/login`, `…/verify-email`, `…/password/reset/confirm` and
  `…/invitations/accept` answer a `twoFactorChallenge` instead of tokens
  when the person has an authenticator or the app requires one. `POST
  /api/client/oidc/exchange` still answers tokens: the identity provider
  owns that sign-in.
- **`clientRegisterRequest.password` and
  `clientAcceptInvitationRequest.password` are optional**: required while
  the app's password method is on, refused while it is off.
- **`mcp_login_url` moved from the `mcp` slice to the `urls` slice**, which
  also takes `app_url`; `putAppAuthMcpRequest` is `mcp_enabled` alone.
- `clientProviderListResponse` gains `sign_in_methods`, `clientIdentity`
  gains `two_factor_enabled`, `patchOrgRequest` takes `name` and
  `require_two_factor`, both optional and at least one, and
  `acceptTeamInviteRequest` takes an optional `display_name` and no
  password. The default invitation mail no longer asks the invitee to
  choose a password.
- **`appInvitation.accept_url` is never `null`**: an app with no
  `invite_url` gets the hosted invitation page's link.
- **`appMailTemplateListResponse.templates` holds up to four** (was three),
  with `login_code`.
- **The portal's identify step mails a sign-in code** (`POST
  /console/oauth/identify`, `POST /mcp/oauth/identify`) instead of handing
  back a password step, and answers the same for every address.
- **A password reset and a password change are refused with `403
  method_not_allowed`** while the app has the password method off — `POST
  /api/client/password/reset`, `…/password/reset/confirm`,
  `…/password/change` and the developer's `POST
  /api/apps/:id/users/:userId/reset-password`.

### Removed

- **The developer password; this is why the release is a major.** The
  schemas `developerLoginRequest`, `passwordResetRequest`,
  `passwordResetConfirm`, `signUpRequest` and `signUpResponse`, and the
  routes `POST /api/auth/signup`, `POST /api/auth/password/change`, `POST
  /api/auth/password/reset`, `POST /api/auth/password/reset/confirm`, `GET
  /reset-password`, `GET /reset-password/:token`, `POST
  /console/oauth/login` and `POST /mcp/oauth/login`. Fleetless users sign
  in by emailed code or passkey; the portal sign-up is the one way to
  create an organisation. `passwordChangeRequest` stays, for `POST
  /api/client/password/change`. The newly required fields above
  (`appUser.two_factor`, `org.require_two_factor`,
  `fleetlessUser.two_factor`, `clientIdentity.two_factor_enabled`,
  `clientProviderListResponse.sign_in_methods`) and the narrowed `mcp`
  slice break existing readers as well.

## [5.3.0] — 2026-10-02

### Added

- **`feedbackRequest` and `feedbackResponse`** (`FeedbackRequest`,
  `FeedbackResponse`) for the new `POST /api/feedback`: a developer's
  message to the people who build Fleetless, `{ kind, message, page }` with
  `kind` one of `FEEDBACK_KINDS` (`idea`, `problem`, `question`, `other`), a
  trimmed message of at most `FEEDBACK_MESSAGE_MAX` (5000) characters and
  the console path it was sent from. The route answers `202` with
  `{ id, mail }`: the message is stored before any mail is tried, so `mail`
  (`sent`, `failed`, `not_configured`) never means it was lost. Rate
  limited to 10 per developer per hour. Published as the artifacts
  `feedback-request` and `feedback-response`.
- **`jobActor.name`**: the person's display name when the job started,
  required and nullable — `null` for a server key, a person without a name
  and runs recorded before this version; show `label` then. `jobActor`
  stays non-strict, so a consumer on 5.2.0 strips the new key rather than
  refusing the run. Changes the artifacts `job-actor`, `job-run` and
  `job-run-list-response`.
- **`roleRenameRequest`, `roleDeleteQuery` and `roleInUseDetails`**
  (`RoleRenameRequest`, `RoleDeleteQuery`, `RoleInUseDetails`) for the new
  `PATCH` and `DELETE /api/apps/:id/roles/:roleId`: rename a role
  (`409 role_name_taken` on a clash), or delete it, moving its app users,
  pending invitations and default-role status to `move_to`. Without
  `move_to` a held role answers `409 role_in_use` with
  `{ users, invitations, is_default }`; the app's only role answers
  `409 last_role`. The three codes join `ERROR_CODES`. `role.builtin` no
  longer says built-in roles cannot be renamed or deleted, and the create
  route's note now states the 60-character limit `role.name` always had.
  Published as the artifacts `role-rename-request`, `role-delete-query`
  and `role-in-use-details`.
- **`auditQuery.target_id`**: only the events about one target — for a
  robot also those that name it in `details.robot_id`, so a robot's log
  includes what was started on it. A string, since target ids are not all
  uuids. `GET /api/audit/export` takes it too. Changes the artifact
  `audit-query`.

## [5.2.0] — 2026-09-30

### Added

- **A cancel can be limited to the bridge's own job.** `cancel`
  (`cloudCancel`) gains an optional `own_only: boolean`; absent means
  `false`, today's meaning. With `true` the bridge cancels the named job
  only if it started it itself: a `job_id` it does not hold — typically an
  `unknown` job — cancels nothing, where without the flag it cancels every
  external goal on the action. The cloud sets it on the cancels it sends on
  its own (a republish's reset and its resend at the next hello), so a
  republish never stops a goal Fleetless did not start; a user's cancel
  never sets it. `LATEST_BRIDGE_VERSION` is `6.1.0`, the first bridge that
  honours it. The protocol stays 5.

## [5.1.0] — 2026-09-30

### Added

- **`cancelRejectedDetails`** (`CancelRejectedDetails`): the `details` of a
  `cancel_rejected` refusal, `{ goals }` with at least one `{ job_id,
  goal_id, return_code }` — every goal the cancel reached, accepted ones
  included, with its `CancelGoal` return code (`CANCEL_RETURN_CODES`, or
  `null` when that goal's server did not answer). A consumer parses the
  refusal instead of reading its shape from prose. Published as the
  artifact `cancel-rejected-details`. The wire does not change: the cloud
  already sends this shape.

## [5.0.0] — 2026-09-30

### Added

- **Protocol 5: `unknown` jobs, external goals, and a hard cut of protocols 3
  and 4.** `PROTOCOL_VERSION` is 5 and the only version served: protocols 2,
  3 and 4 are unsupported from this release on, with no sunset window, and
  `PROTOCOL_VERSIONS` holds the single entry `{ version: 5, bridge_from:
  '6.0.0' }`; `LATEST_BRIDGE_VERSION` is `6.0.0`. `jobState` gains `unknown`,
  a non-terminal state for a job the cloud has lost sight of — its error
  `bridge_disconnected` or `bridge_timeout`, both of which used to settle the
  job `lost` — so `lost` is final and only ever follows a statement of the
  bridge. `job` gains a required `origin` (`jobOrigin`: `fleetless` or
  `external`), and `job_update` gains a required `origin` and `goal_id`
  (the ROS 2 goal id, `null` for a service job), because the bridge now
  reports every goal on a published action, including ones it did not send.
  New frames `job_query` (`cloudJobQuery`) and `job_status`
  (`bridgeJobStatus`, `bridgeJobStatusEntry`) let the cloud ask a connected
  bridge how specific jobs stand. New error codes: `bridge_too_old`, the
  `hello_error` for a bridge below protocol 5, naming bridge `6.0.0`; and
  `job_unknown_to_bridge`, the final `lost` reason when the bridge does not
  know a job and nothing it cannot attribute runs on the job's action.
- **A cancel is answered with each goal's `CancelGoal` return code.**
  `cancel` gains a required `request_id`; the bridge answers with the new
  frame `cancel_result` (`bridgeCancelResult`, `bridgeCancelResultEntry`):
  every goal the cancel reached, with its `job_id`, `goal_id` and
  `return_code` (`CANCEL_RETURN_CODES`, `null` when the server did not
  answer). A cancel naming a `job_id` the bridge does not hold cancels every
  external goal on the action, never one of the bridge's own jobs. New error
  code `cancel_rejected`: the server answered `ERROR_REJECTED`, and the
  caller is refused, not told the cancel succeeded. `reportedJobState`, every
  state but `unknown`, is what `job_update`, `job_status` entries and
  `hello.active_jobs` accept, so a bridge claiming `unknown` fails validation.
  `POST /api/robots/:id/jobs/:slug/cancel` lists the answers this adds:
  `409 cancel_rejected`, `504 bridge_timeout`, and `502` with the bridge's
  own code (`unknown_slug`, `action_server_lost`, `internal_error`).

### Removed

- **Protocols 2, 3 and 4, and an origin-less `job`; this is why the release
  is a major.** A bridge below `6.0.0` is refused at `hello`, and a `job` or
  `job_update` literal without `origin` (or a `job_update` without
  `goal_id`) no longer parses, nor does a `cancel` without `request_id`.

## [4.0.0] — 2026-09-29

### Added

- **Protocol 4: a job heartbeat, and a vanished action server ends its job.**
  Protocol bumped: bridges from `5.0.0`, and protocol 3 sunsets
  2026-12-28 (protocol 2 sunset 2026-12-21). The bridge now sends a
  `job_update` heartbeat every `JOB_HEARTBEAT_INTERVAL_MS` for every running
  job, and ends a job whose action server vanished `lost` with
  `action_server_lost` instead of leaving the cloud to guess; `job_lost`
  gains an optional `error` that can say the same. `JOB_HEARTBEAT_TIMEOUT_MS` bounds a protocol-4 job's
  silence once it has been heard from at all; `patience_ms` now bounds only
  the acceptance gap on such a job (unchanged for protocol 3, which sends no
  heartbeat). `JOB_OFFLINE_GRACE_MS` (five minutes) replaces the informal
  one-minute disconnect grace a job got before. `errors.ts` documents
  `action_server_lost` and every job error code already in use that had
  never been written down: `action_failed`, `goal_rejected`,
  `goal_send_failed`, `result_failed`, `goal_uncontrollable`,
  `bridge_disconnected`, `config_changed`.

## [3.0.0] — 2026-09-22

The protocol window carries over unchanged: `LATEST_BRIDGE_VERSION` is still `4.0.0`, and protocol 2 still sunsets 2026-12-21. Everything below is the REST surface.

### Added

- **Auth-config as three slices, not one document.** `putAppAuthRegistrationRequest` (`self_registration`, `allowed_domains`, `allowed_origins`), `putAppAuthUrlsRequest` (`invite_url`, `verify_url`, `reset_url`) and `putAppAuthMcpRequest` (`mcp_enabled`, `mcp_login_url`) are three `.strict()` replaces behind three new routes — `PUT /api/apps/:id/auth-config/registration`, `/urls` and `/mcp` — each merged server-side against the stored row, so a write to one slice can no longer clear a field it never showed. `GET /api/apps/:id/auth-config` is unchanged and still answers the whole document.
- **A deletion preview and a delete.** `appDeletionSummary` — six independent counts (`user_count`, `role_count`, `server_key_count`, `invitation_count`, `oidc_provider_count`, `mail_template_count`), deliberately not summed — is what `GET /api/apps/:id/deletion-preview` (`200`) answers and what the `app.deleted` audit event carries, computed by the same function so the confirmation dialog and the eventual receipt cannot quietly disagree. `DELETE /api/apps/:id` (Owner tier, `204`) runs the cascade: an app's users, roles, server keys, invitations, OIDC configuration and mail templates all go; its robots do not, since they belong to the org, not the app. **No `force` parameter** — unlike the robot deletion pair this is modelled on, an app has no open-session state to force past, and inventing one would be a guess wearing a guard's clothes.

### Removed

- **`putAppAuthConfigRequest` and `PUT /api/apps/:id/auth-config`.** Replaced by the three slice requests and routes above — `PUT /api/apps/:id/auth-config/registration`, `PUT /api/apps/:id/auth-config/urls` and `PUT /api/apps/:id/auth-config/mcp`. This is the break that makes this release a major: a caller still sending the old whole-document body finds no route left to send it to.

## [2.0.0] — 2026-09-22

### Added

- **A robot's own asset store.** `ROBOT_ASSET_STORE_BYTES` (1 GB) is what every robot gets, in `constants.json` too, so the bridge reads the same number the cloud enforces. `assetStoreRefusedDetails` carries `store_bytes`, `used_bytes` and `size_bytes` behind the `409 quota_exceeded` an upload with no room left answers, and rides on a `refused` entry in `assetFailure.details`. `assetListResponse` gains `store { bytes, used_bytes }`, so the page that lists a robot's assets can say how full it is without asking a second endpoint about the organisation.
- **A full store is never a dead end.** `DELETE /api/robots/:id/assets` (Owner tier, `200`, `assetsClearResponse { deleted, bytes_freed }`) removes every URDF, mesh and texture of a robot and resets its store to zero, refusing `409 busy` while a sync is running; the next sync fills it again, and the bridge's own availability report is untouched. It is the blunt third answer alongside the URDF upload's exemption from the store gate and reconcile freeing what a new URDF no longer references.
- **Two robot-detail routes.** `POST /api/robots/:id/token/rotate` (Owner tier, `201`, `robotTokenRotateResponse`) mints a new bridge token and stops the socket speaking on the old one; `CLOSE_TOKEN_ROTATED` (4005) is the code it closes with, distinct from `CLOSE_ROBOT_DELETED` because the robot very much still exists. `PUT /api/robots/:id/urdf/joint-state` (`jointStatePutRequest`/`jointStatePutResponse`) chooses the whole-message `sensor_msgs/msg/JointState` datapoint that moves the URDF's joints, or clears it; `assetListResponse.joint_state_slug` reads it back.
- **A sync says what the store holds, not only what the robot claimed.** `assetSyncStatus` gains the required pair `stored` and `announced`: how many of the announced files — the URDF and every mesh URI the description references — the cloud's store actually holds — counted once after the robot's terminal frame, and `null` until then — against how many the robot announced. `state` alone was the bridge's terminal frame, so a stack whose object store answered `500` to every upload still reported `succeeded`; the cloud counts after that frame now, and a `succeeded` sync over an empty store ends `failed` with an `upload_failed` entry naming what is not there.
- **`applyErrorKind` gains `low_bandwidth`.** A `low_bandwidth` section that does not resolve on the robot is reported under its own kind, slug `low_bandwidth`, instead of borrowing `datapoint` with slug `*`.

### Changed

- **Protocol 3 — the bridge decides its own low-bandwidth mode.** `cloudPing` carries `latency_ms` and `lag_ms`; the bridge sends `link_mode`; `bridge_state` gains `low_bandwidth`. `fleetless.yaml` gains an optional top-level `low_bandwidth` section and a per-datapoint `low_bandwidth: keep`; `LOW_BANDWIDTH_DEFAULTS` ships in `constants.json`. `datapointFrame` gains an optional `backfill` flag, so a replayed sample carrying its original capture time is not read as lag on the link. Protocol 2 is deprecated as of this release and served until 2026-12-21; its cloud adapter owes it two translations on the way in — it drops the pressure datapoints, and it rewrites an `asset_progress` failure of kind `too_large` (a kind protocol 3 no longer has) to `refused` with `details: null`.
- **Required, not merely present.** `assetListResponse.store`, `assetListResponse.joint_state_slug` and `bridgeState.low_bandwidth` are required keys now, not optional-by-absence; `cloudPing.latency_ms` and `cloudPing.lag_ms` are required (nullable) on protocol 3. `LATEST_BRIDGE_VERSION` is `4.0.0`. Deploy the cloud before any consumer pins `2.0.0` — a response from a 0.2x cloud no longer parses these shapes.

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
