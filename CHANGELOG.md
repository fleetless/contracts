# Changelog

All notable changes to `@fleetless/contracts` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html) over
the wire shapes. A pull request that changes what a consumer sees adds its
entry under `## [Unreleased]`; the release renames that heading to the
version.

## [Unreleased]

### Added

- **`file_too_large`** (`413`): one asset file is larger than
  `ASSET_FILE_MAX_BYTES` (one gigabyte, every plan, the URDF included).
  `details` is `fileTooLargeDetails`: `max_bytes` and `size_bytes`, the
  announced size or, when none (or a false one) was announced, the bytes that
  arrived; `null` only when the body limit stopped the upload.
  `ASSET_FILE_MAX_BYTES` is in `constants.json`. `plan_limit` and
  `quota_exceeded` on an asset upload now mean only that the store is full.

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
