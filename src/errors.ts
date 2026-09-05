import { z } from 'zod'

/**
 * The one error shape of the REST and realtime APIs (spec §11.5): a stable
 * machine-readable code plus a human message; validation errors name the
 * field and the violated rule in `details`.
 */
export const apiError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})
export type ApiError = z.infer<typeof apiError>

/**
 * One violated §4.4 rule. `details` on the envelope stays `unknown` — codes
 * are an open set, so their payloads cannot all be enumerated — but the
 * payload of `parameter_invalid` **is** pinned here, because otherwise every
 * consumer guesses: the cloud emits one shape, the SDK sniffs for two, the
 * console renders a third, and each is right in its own tests.
 *
 * `field` is the **flat key exactly as the caller sent it** — the same string
 * as the `parameterSpec.name` it violated. That is the entire justification
 * for the flat parameter form: a refusal has to name something the caller can
 * find in what they typed, and a console can attach the error to that one
 * input rather than to the form.
 */
export const parameterViolation = z.object({
  field: z.string().min(1),
  /** Which rule failed — `min`, `max`, `enum`, `pattern`, `required`, `undeclared`. */
  rule: z.string().min(1),
  message: z.string().min(1),
})
export type ParameterViolation = z.infer<typeof parameterViolation>

/**
 * The `details` of a `parameter_invalid` refusal. Always at least one
 * violation: a refusal that names none would leave the caller with nothing to
 * fix. All violations are reported at once, not just the first — a caller
 * fixing parameters one round-trip at a time is a caller who gives up.
 */
export const parameterInvalidDetails = z.object({
  violations: z.array(parameterViolation).min(1),
})
export type ParameterInvalidDetails = z.infer<typeof parameterInvalidDetails>

/**
 * The codes in use as of W2. The wire deliberately allows any string — this
 * list is the shared vocabulary, not a closed set, so a new refusal never
 * needs a contracts release before it can be reported honestly.
 */
export const ERROR_CODES = [
  // W1
  'not_found',
  'validation_error',
  'bad_request',
  'unknown_datapoint',
  'invalid_token',
  'protocol_mismatch',
  'invalid_frame',
  // W2 — configuration
  'duplicate_slug',
  'reserved_slug',
  /**
   * `POST /api/robots/:id/config/rename-slug`'s `from` names nothing in the
   * draft — distinct from `unknown_datapoint`, which is a read against a
   * *published* config; a rename only ever inspects the draft.
   */
  'unknown_slug',
  'unknown_field_path',
  'unknown_type',
  'unknown_topic',
  'invalid_rate',
  'invalid_range',
  'config_conflict',
  // W2 — reading
  'no_data',
  // W2 — talking to the robot
  'robot_offline',
  'bridge_timeout',
  // W3 — identity and rights. `forbidden` is deliberately the answer both
  // for "your role does not grant this" and for "there is no such slug":
  // roles are the only filter (§3.3), and a caller must not be able to map
  // the configuration of an app they have no rights in.
  'unauthorized',
  'forbidden',
  'invalid_credentials',
  'token_expired',
  'token_revoked',
  /* `invite_expired` and `invite_used` were removed on 2026-09-05, by the same
   * reasoning that removed `not_a_member` and with the same evidence: a `grep`
   * across contracts, cloud, sdk, console and bridge found their own entries
   * here and one test asserting those entries existed. Nothing has ever emitted
   * either.
   *
   * They were written for `POST /api/client/invitations/accept`, to tell an
   * expired invitation from an already-accepted one. That route answers `410
   * token_spent` to both, and to an unknown token and a revoked one as well —
   * see that code's own entry for why. Keeping two codes for a distinction the
   * wire deliberately refuses to make is the third failure mode in this
   * project's list: a documented refusal no caller can receive, which a reader
   * would reasonably branch on. */
  /**
   * The address is already taken — **globally, across every org** (Andre,
   * 2026-08-29).
   *
   * The 2026-08-29 redesign first made `users.email` unique *per org* (D1), so
   * this code briefly meant only *this org already has this address*. That was
   * reversed the same day: email is **globally unique** again, one address is
   * exactly one account in exactly one org, and this code means *somebody,
   * somewhere already has this address* — the pre-redesign meaning the code's
   * name always implied. There is no per-org reading of it any more.
   *
   * It stays an answer to a *write* an authenticated caller made — signing up,
   * inviting or creating — never to a login, which may not say whether an
   * address exists. The app-user surface has the same split: creating a user
   * through the developer-authenticated route may answer `email_taken`, while
   * `POST /api/client/register` answers `202` either way. On an app user the
   * code means *this app already has this address*, since app-user email is
   * unique per app rather than globally.
   */
  'email_taken',
  'identifier_taken',
  'weak_password',
  /* `not_a_member` was removed on 2026-08-29. It had no producer anywhere in
   * this repository or in the cloud (`grep` found exactly two hits: its own
   * entry here and a test asserting the entry existed), and its vocabulary was
   * the deleted model's — "member" of an app's pool, in a platform whose
   * membership is now a group and whose access is an assignment. A code that
   * nothing emits and whose noun no longer exists is the third failure mode in
   * this project's list: a guard written against a state no producer reports.
   * The refusals that do the work are `forbidden` (silent about existence) and
   * `tier_required` (about the caller's own tier). */
  /**
   * The account itself is blocked — distinct from `forbidden` on purpose: it
   * tells the account holder something about *their own* account, and reveals
   * nothing about any other principal or about what exists.
   *
   * **It has now lost its producer, as this comment predicted it would.** The
   * paragraph here used to say "it loses its producer when D1's `users`
   * replaces `end_users` — it has not lost it yet", and named the five sites
   * that still emitted it, all reading `end_users.status === 'blocked'`. D1
   * landed. `users` has no `status` column, nothing reinstates one, and
   * removing a user's assignments is what withdraws access instead — so those
   * five sites went with the old tables.
   *
   * What is left in the cloud is a *shape* with no input: `TokenRefusalReason`
   * still admits `'blocked'` and `sendTokenRefusal` still has an arm for it
   * (`auth.ts`), as does `ws/realtime.ts` — but no site anywhere constructs
   * `reason: 'blocked'`, so neither arm is reachable. Verified by grep in
   * FL-007, after `routes.ts` listed this code on the dual-auth guard and a
   * review asked what produces it. Nothing does.
   *
   * Kept, like `mcp_disabled` and for the same reason: the reserved shape is
   * the point, and a code removed from the vocabulary is a code the next
   * producer re-invents differently. But **do not list it as a refusal of any
   * route** — that would document an answer no caller can receive.
   *
   * The tense discipline this comment was written under still stands: it now
   * says the producer is gone because the producer is gone, not because a plan
   * expects it to be.
   */
  'account_blocked',
  // W4 — the command path.
  /** One job per action slug (§11.3); the refusal carries what is running. */
  'busy',
  /** A parameter failed its §4.4 rule; details name the field and the rule. */
  'parameter_invalid',
  /** The bridge could not account for this job after a restart (§6.1). */
  'job_lost',
  /** Another user holds this publisher and has not been quiet long enough (§6.4). */
  'publisher_busy',
  /** A well-formed realtime frame this server does not know — the socket stays open. */
  'unknown_command',
  /**
   * The slug exists and is granted, but has nothing to observe — a publisher
   * has no job and no stream. Distinct from `unknown_datapoint` on purpose:
   * answering "no such slug" about one the caller was granted is a lie, and
   * it sends them looking for a configuration mistake that is not there.
   */
  'not_subscribable',
  // W5 — cameras.
  /** The robot is connected but this camera is not publishing (§10). */
  'camera_offline',
  /**
   * Nothing has been captured yet. An answer, not a failure: a camera
   * configured a moment ago has no frame, and serving an older one from a
   * different camera — or none, silently — would both be worse.
   */
  'no_snapshot_yet',
  /** Live cannot start: no media server, no token, or the bridge refused. */
  'live_unavailable',
  /**
   * The slug exists and is granted, but is not the kind this verb addresses —
   * subscribing to a datapoint with an action helper, calling a service
   * helper on an action. Answering instead of falling silent is the point:
   * silence is also what an idle slug looks like, so it tells the caller
   * nothing.
   */
  'wrong_kind',
  // W6 — retention and history.
  /**
   * The slug exists and is granted, but is configured live-only, so there is
   * no history to return. An empty array would be indistinguishable from a
   * recorded datapoint that happens to have no samples in the range, and the
   * two need completely different actions from the developer: one is "turn
   * recording on", the other is "look at a different window".
   */
  'not_recorded',
  /**
   * `min`/`max`/`avg` was asked of a value that is not a number, and no
   * numeric `field` was named. Refusing beats coercing: an average of
   * booleans or strings is a number that means nothing, and it would be
   * charted as confidently as a real one.
   */
  'not_aggregatable',
  /**
   * An org quota (§12.4) is exhausted. The message names **which** one —
   * "quota exceeded" without saying which is a dead end for whoever has to
   * act on it. Recording stops; live values keep flowing, because a storage
   * limit is not a reason to take a robot away from its operator.
   */
  'quota_exceeded',
  /**
   * A named credential cannot be deleted because cameras still reference it.
   * Refusing beats deleting: a shared credential typically serves several
   * cameras across several robots, so a blind rotation is exactly how one of
   * them silently stops working — on a robot the developer had forgotten
   * about. The details carry `used_by`, so the answer names what to fix
   * rather than only what went wrong.
   */
  'credential_in_use',
  /**
   * An action goal was never accepted — no server answered within the
   * bridge's patience (W5, from W4's review). Distinct from `failed`, which
   * means the robot tried: nothing tried here. It exists so a slug whose ROS
   * server is absent cannot stay wedged forever with the platform reporting
   * a machine as busy doing something it never started.
   */
  'goal_timeout',
  // W6a — deletion.
  /**
   * A robot cannot be deleted while a live session is open. Refusing beats
   * deleting for the same reason `credential_in_use` does: the session
   * belongs to somebody who is watching right now, and taking it away
   * without a word is indistinguishable from a crash. `?force=true` says
   * "yes, I know" — the caller has to say it, rather than the platform
   * deciding for them.
   */
  'robot_in_use',
  /**
   * A deletion destroyed some of a robot and then failed. The robot still
   * exists and is **not intact**; retrying the delete is the way out.
   *
   * It exists because the alternative was a generic `internal_error`, which
   * says "nothing happened" — and a caller who reads that goes looking for a
   * transient glitch. W6a's review measured the state it hides: configuration,
   * drafts, types and 300 000 rows gone, the robot still listed, and no audit
   * event. A failure that cannot be told apart from a no-op is how that state
   * stayed invisible.
   */
  'robot_deletion_partial',
  // W6b — addressing.
  /**
   * The bridge will not queue another job: its queue is full.
   *
   * The queue was **unbounded**, which is not the same as generous — it is a
   * robot that accepts a thousand goals it will never reach, reports every
   * one of them as queued, and runs out of memory rather than saying no. A
   * bound turns that into an answer the caller can act on, which is the whole
   * of the difference.
   *
   * It rides on **`job.error.details`** as `jobQueueFullDetails`, not on an
   * `apiError` envelope — and that distinction is load-bearing. A full queue
   * is discovered by the *bridge*, after the cloud has already answered the
   * invoke with a minted job, so it can never be the refusal of the call. It
   * reaches the caller as the job's terminal failure.
   *
   * The numbers ride with it for the reason `publisher_busy` carries
   * `retry_after_ms`: a refusal that names a state and no action leaves the
   * caller to busy-loop, on a platform with no rate limiting until W8.
   */
  'job_queue_full',
  /**
   * An id in the path or body is not a uuid at all.
   *
   * **Path and query only.** A malformed uuid in a *body* is caught by the
   * body schema first and answers `validation_error` — the same mistake under
   * two codes, split by where the id sat. Stated here rather than promised
   * away: a consumer branching on `invalid_uuid` must not expect it for a
   * body field (Momus, W6b review). Unifying them is a W7 question, because
   * it means refusing before schema validation on every route that takes one.
   *
   * Distinct from `not_found`, which was the answer for both and made a
   * **typo indistinguishable from a deletion**. A developer whose client
   * concatenated a template variable wrong got a clean `404` and went looking
   * for a robot they had never lost. It says nothing about existence — it is
   * refused before any lookup — so it leaks nothing that `not_found` did not.
   */
  'invalid_uuid',
  // W6c — identity, and the limit that has to exist before it.
  /**
   * Too many attempts. The details carry `retry_after_ms`, for the reason
   * `publisher_busy` carries it: a refusal that names a state and no action
   * leaves the caller to busy-loop, which on *this* code is the attack.
   *
   * It must be answerable **before** any password verification. A limiter that
   * refuses after argon2 has run has not removed the denial of service, it has
   * only added a message to it — and that is invisible to every test that
   * checks the status code, which is why the gate measures the *cost* of a
   * refusal and not merely its shape.
   */
  'rate_limited',
  /**
   * The caller's **tier** is insufficient — an org Member reaching for what
   * only an Owner may do. Distinct from `forbidden`, which stays deliberately
   * silent about existence (§3.3): this one says nothing about the target
   * either, only about the caller's own role, which they can already read.
   *
   * Without it, "ask an owner to do this" and "you have the wrong id" are the
   * same answer, and only one of them is worth acting on.
   */
  'tier_required',
  /**
   * A password reset or invitation token has been spent, or has expired.
   * Deliberately one code for both: distinguishing them tells a stranger
   * whether a token ever existed, and the recovery is identical either way —
   * ask for a new link.
   */
  'token_spent',
  // W7 — the command path, still.
  /**
   * A **service call** was dispatched and never returned. Distinct from
   * `goal_timeout`, which means an action goal was never *accepted* — nothing
   * tried there; here the robot was asked and stopped answering.
   *
   * It exists because the bridge previously bounded a hung service with
   * nothing at all: `_invoke_service` took no patience, so the caller got
   * `bridge_timeout` from the cloud while the job stayed `running` forever on
   * both sides and the slug was busy for good (register row 2n, and 2e for the
   * cloud half). Rosie-W7 established that rclpy's
   * `Client.remove_pending_request` can abandon the future cheaply, so unlike
   * the action path this one can guarantee the callback never fires late.
   */
  'service_timeout',
  // W7 — the asset store.
  /**
   * A URDF references a mesh the store does not have. Distinct from
   * `not_found` on the URDF itself: the URDF is present and readable, and the
   * thing to fix is a sync that came back incomplete, not a missing robot.
   *
   * It exists because the alternative is a renderer drawing a robot with
   * missing limbs and no explanation — a failure that surfaces far from its
   * cause, in somebody else's application.
   */
  'asset_missing',
  /**
   * The asset exceeds the per-file ceiling. Carries `assetTooLargeDetails`
   * with both numbers, for the reason `job_queue_full` carries both: the limit
   * alone does not tell the caller how far over they are, and the size alone
   * cannot be read without the limit.
   */
  'asset_too_large',
  // W7b — the hosted authorization server.
  //
  // **This comment was wrong in its first form and a teammate followed it
  // faithfully into a conformance bug.** It said these were "management-side
  // codes only" and then listed two whose only producer is the dynamic client
  // registration endpoint,
  // which is an OAuth endpoint. Read literally — correctly — that instructs
  // you to answer a *standard* client with an `apiError` body it cannot parse.
  //
  // The rule is unchanged and the placement of these two was the error: the
  // OAuth endpoints answer in RFC 6749's own error shape, always, including
  // their policy refusals. The Fleetless reason rides along in
  // `oauthError.fleetless_code`, so `error` stays what a standard client reads
  // and the distinction between "not opted in" and "ceiling full" survives.
  //
  // These codes therefore appear in BOTH places by design: as the value of
  // `fleetless_code` inside an RFC envelope at the registration endpoint
  // (`/mcp/oauth/register` today), and as an ordinary `apiError` code at the
  // developer-facing management routes.
  //
  // Every code below has a producer landing in this same wave. W6b's lesson:
  // an enum value with no producer is precisely the defect that wave was
  // cataloguing, and a teammate was right to refuse to add one.
  /**
   * The app has not opted in to dynamic client registration. A normal app has
   * no reason to accept self-registering clients, so the flag is off by
   * default and this is the answer — distinct from `forbidden`, because it
   * tells the *developer* something actionable about their own app rather
   * than telling a stranger what exists.
   */
  'dynamic_registration_disabled',
  /**
   * The per-app ceiling on dynamically-registered clients is reached. Carries
   * both numbers for the same reason `asset_too_large` does.
   */
  'client_limit_reached',
  /**
   * The developer's IdP could not be reached or its discovery document could
   * not be read. Distinct from `server_error` on purpose — the fault is in a
   * system Fleetless does not run, and the developer is the only one who can
   * fix it.
   */
  'idp_unavailable',
  // W7c — the MCP server, and a THIRD dialect on the same process.
  //
  // The correction above is about two dialects; there are now three, and the
  // MCP endpoint speaks the one that is neither. **Inside the protocol** —
  // once a request is a JSON-RPC message — `/mcp/<app>` answers **JSON-RPC
  // errors**, never `apiError` and never `oauthError`. An MCP client is a
  // general-purpose implementation of somebody else's specification, and a
  // body it cannot parse is indistinguishable from a broken server.
  //
  // **This claim was wider than the code in W7c's first version, and Momus-W7c
  // caught it in the same comment block whose opening sentence is about a
  // previous comment here misleading somebody.** The five refusals that happen
  // *before* a bearer token is read — unknown app or MCP off (`404`), no or
  // bad token (`401`), foreign `Origin` (`403`), `GET`/`DELETE` (`405`),
  // malformed body (`400`) — are plain HTTP and answer `apiError`, exactly as
  // every other route does. That is deliberate and it is safe: what a
  // conforming MCP client reads at that layer is the RFC 6750
  // `WWW-Authenticate` **header**, which is correct and present, not the body.
  //
  // So the rule is about the JSON-RPC layer, and the transport layer below it
  // is ordinary Fastify. Stating it as "never `apiError` anywhere" was the
  // kind of tidy sentence that is easier to remember than the truth — and
  // this file has now produced two of those about itself.
  //
  // So the two codes below appear at the **management** routes only — the
  // console asking about an app or a role. Nothing in `/mcp/<app>` produces
  // them, and if one ever seems to belong there, the answer is a JSON-RPC
  // error whose message says the same thing.
  /**
   * **This app does not serve an MCP endpoint** — `appAuthConfig.mcp_enabled`
   * is off. `403` from the app's whole OAuth surface, not merely from its tool
   * calls, and re-read on every request rather than cached off a token, so
   * turning it off bites at the next call.
   *
   * **It has had a switch, lost it, and has one again, which is why the
   * history is worth keeping.** It was reserved for a per-app `mcp_enabled`
   * flag; the central-MCP cut deleted the per-app `/mcp/<identifier>` endpoint
   * that flag gated, and 2026-08-29 removed the field itself from `app`, so
   * the code stood for a year with nothing able to produce it. The
   * app-user-auth design brings the per-app endpoint back (D7) with the switch
   * on `appAuthConfig` rather than on `app`, and this is its refusal again.
   *
   * The lesson that survives is about the year in between: an enum member with
   * no producer is not harmless, because a reader arriving at it takes it for
   * a live refusal. Say which it is, and say when it changes.
   *
   * **It has one producer already, one train early**: `POST /mcp` answers it to
   * an `mcp_session` token whose subject is an app user, because the central
   * endpoint serves the team only. No client can hold such a token yet — only
   * a test mints one — and the per-app train adds the
   * `appAuthConfig.mcp_enabled` gate this comment describes.
   *
   * `tool_not_available` below still has no producer — `grep` finds it nowhere
   * in `cloud/src`. Named as unproduced, for the same reason.
   */
  'mcp_disabled',
  /**
   * A tool the caller cannot use on this robot — because the role grants
   * neither the slug it needs nor the capability behind it.
   *
   * **Deliberately one code for both**: to a developer holding the console,
   * the role's datasheet (`mcpRobotDatasheet`) already lists every exposure
   * the role does grant, so a second code would split an outcome nobody acts
   * on differently. To anyone else the two must be indistinguishable anyway —
   * §3.3.
   */
  'tool_not_available',
  // W9 — capabilities.
  /**
   * An app-wide **capability** the caller's role does not grant — today
   * `assets` (`GET /api/robots/:id/assets` and the URDF/by-id byte routes)
   * and `action_history` (`GET /api/robots/:id/jobs/history`). The message
   * names which one.
   *
   * **Distinct from `forbidden`, and the distinction is the point.**
   * `forbidden` is deliberately silent about existence, because roles are the
   * only filter and a slug the caller cannot use must be indistinguishable
   * from a slug that is not there (§3.3). A capability is not a slug: it is a
   * switch in the console that the developer owns, and the caller reaching
   * this refusal has already been proven to reach the robot. Answering
   * `forbidden` there tells a developer only that they may not — not which
   * toggle to flip — and a promise the console makes is exactly what these
   * capabilities have historically failed to keep.
   *
   * Both gates answered differently for one wave: `assets` said `forbidden`,
   * the newer `action_history` said this. One decision with two codes makes a
   * client branch on which route it called, so `assets` was moved here.
   */
  'capability_required',
  // 2026-08-29 — org-central identity (D1/D2).
  /**
   * **An org must keep at least one Owner**, so the last one is neither
   * deletable nor demotable. 409, on both `DELETE /api/org/users/:id` and
   * `PATCH /api/org/users/:id/tier`.
   *
   * **It was already being emitted before it was registered here** — the cloud
   * has answered `last_owner` from `org-members.ts` since W3a, and
   * `identity.ts`'s own doc comment named it, but `sendError` takes a bare
   * `string` and nothing ever compared the two lists. So a consumer switching
   * exhaustively over `ERROR_CODES` could not handle a code the server
   * actually sends. Registered as part of carrying the rule onto the new
   * tiers, and named as the pre-existing gap it was rather than as a new code.
   *
   * Deliberately not `forbidden` or `tier_required`: an Owner reaching this
   * has every permission the act needs. The refusal is about the org's
   * remaining state, and the remedy — promote somebody first — is nothing the
   * caller could infer from a silence about existence.
   */
  'last_owner',
  // 2026-08-29 — oidc-federation (D3/D4).
  /**
   * **The target is in a state that refuses the operation** — not the caller's
   * rights, not the target's existence, but *what the target currently is*.
   * 409.
   *
   * It exists because refusals of this shape were riding a `400
   * validation_error` with a `rule` string: the body is well-formed and names a
   * real target whose *state* is the obstacle. A `400` said "you sent something
   * invalid" for a request that was nothing of the kind, and a bare `rule`
   * string on the validation envelope is not a code a consumer can switch on.
   *
   * Its producers in the two-space model are the ones about an app or an
   * account rather than about a caller: `send_mail: true` on an app that has
   * configured no `invite_url` (the `details` name the field), and a password
   * change on an app user who has no password at all — an OIDC-only account,
   * where the session is live and it is the target's state that refuses.
   *
   * **A tier change aimed at somebody who is not a Fleetless user of this org
   * was listed here and stopped being a producer at the cut.** That refusal
   * had one implementation, the Org Admins membership check; without it `PUT
   * /api/org/users/:id/tier` scopes through `scopedUser` and answers `404
   * not_found`. Left in place, the sentence documented a 409 no caller could
   * receive.
   *
   * Deliberately not `forbidden` (which is silent about existence and about
   * the target) and not `tier_required` (which is about the caller's own
   * rank): a caller reaching this has the rights and named a real thing — the
   * obstacle is the target's state, and the remedy is to change that state or
   * pick a different target, neither of which a silence would reveal.
   *
   */
  'target_state_conflict',
  // 2026-09-04 — the public site (closed beta).
  /**
   * `403` from `POST /api/auth/signup` and the portal's sign-up pages while
   * `SIGNUP_MODE=closed`. Not `forbidden`: nothing about the caller is
   * refused, the door is closed for everyone. The message names the
   * waiting list. Produced by cloud `routes/auth.ts` and
   * `routes/console-oauth.ts` in the same release.
   */
  'signup_closed',

  // FL-007 (route manifest): emitted by the cloud, catalogued late.
  //
  // Every one of the five below has had a live producer for some time; what
  // they never had was an entry here. **Each was confirmed by grepping the
  // cloud for its own string before being written down** — the producer named
  // in each comment is a file that was read, not one that was assumed.
  //
  // The type checker is *not* what surfaced them, and that is worth saying.
  // `RouteEntry.errors` is typed `ErrorCode[]`, so it refuses a code an entry
  // *names* — but only one of these five (`wrong_browser`) is named by any entry
  // in the commit that added them. The other four would have stayed
  // uncatalogued had nobody gone looking. The difference matters to whoever adds
  // the sixth: neither the type nor a pass over the route entries is a census of
  // what the cloud actually sends.
  //
  // They are listed in one block, with their producer named, rather than filed
  // among the waves that introduced them — the honest record is *when this list
  // learned about them*, not when the cloud started sending them.
  /**
   * `409` from the configuration routes: the draft parses as YAML but its root
   * is not a mapping — a list, a scalar, or an empty document. Distinct from
   * `validation_error`, which is about a field inside a document that *is* one.
   * Produced by `cloud/src/routes/config.ts`.
   */
  'draft_not_a_document',
  /**
   * `500`. The cloud's own last-resort answer when a handler throws something
   * it has no mapping for, and the code the realtime socket sends for the same
   * state. It says nothing about the request, deliberately: a caller cannot act
   * on it beyond retrying, and the detail belongs in the server's log rather
   * than in a body a stranger receives. Produced by `cloud/src/server.ts`'s
   * error handler and `cloud/src/ws/realtime.ts`.
   */
  'internal_error',
  /**
   * `422` from `POST /api/robots/:id/jobs/:slug/cancel`: the job exists and the
   * caller may address it, but it is in a state that has nothing left to
   * cancel — already settled, or of a kind that does not support cancellation.
   * Produced by `cloud/src/commands.ts` and mapped in
   * `cloud/src/routes/commands.ts`.
   */
  'not_cancellable',
  /**
   * `415`. The request carried a body in a media type the route does not read.
   * It is the cloud-wide answer from the content-type parser, not one route's:
   * a caller reaching it never got as far as validation, which is why this is
   * not a `validation_error`. Produced by `cloud/src/server.ts`.
   */
  'unsupported_media_type',
  /**
   * `401` from the multi-step browser flows — console sign-up, and the MCP
   * consent screen. The step being finished was started in a *different*
   * browser: the per-interaction proof cookie is missing or does not match the
   * hash recorded on the interaction row.
   *
   * **The impersonation interstitial it also named is deleted** with the rest
   * of the app OAuth flow (2026-09-05, D1/D2). That page is where this defence
   * was found missing on a GET rather than a POST — three times over, on three
   * different screens — which is the reason worth carrying forward: the check
   * belongs on every verb that *renders* the step, not only on the one that
   * completes it.
   *
   * Deliberately not `invalid_token` or `unauthorized`: nothing about the
   * caller's credential is being refused, and the remedy is specific and
   * actionable — start the flow again in this browser. Produced by
   * `cloud/src/routes/console-oauth.ts` and `cloud/src/routes/mcp-oauth.ts`.
   */
  'wrong_browser',
  /**
   * `422` from `PUT /api/robots/:id/config/draft`: the text the author sent is
   * not YAML at all. The parser's own message travels in `details`.
   *
   * **Catalogued in the same round as the two below it were found, and by the
   * same means: reading the producer.** Both this and `unstorable_yaml` have
   * been on the wire since the config editor shipped, as route-local string
   * literals inside a perfectly ordinary `apiError` envelope — which is exactly
   * why nothing noticed. The envelope validates; only the *code* was absent
   * from the one list a client can match against, so a caller branching on
   * `ERROR_CODES` fell through to its unknown-error arm for the single most
   * common refusal the editor produces. That is this file's own "documented
   * absence" failure, on the codes list itself. Produced by
   * `cloud/src/routes/config.ts`.
   */
  'invalid_yaml',
  /**
   * `422` from the same route, for the other half: the text *is* YAML and
   * cannot be stored — an anchor cycle, or anything else that parses into a
   * value with no JSON representation.
   *
   * Two codes rather than one, because the two say different things to whoever
   * typed the text: the first means "this is not YAML", the second means "this
   * is YAML I cannot keep". Produced by `cloud/src/routes/config.ts`.
   */
  'unstorable_yaml',

  // 2026-09-05 — app-user auth (two identity spaces, the JSON client API).
  //
  // **What is honest here and what is not, in one place.** The client auth
  // family answers `202` for `register`, `resend-verification` and
  // `password/reset` whether or not the address exists, and answers one
  // `invalid_credentials` for a wrong password, a `blocked` account and an
  // unverified one. The codes below are the exceptions, and each is an
  // exception for the same reason: it describes the **app's policy or
  // configuration**, which the developer set and which reveals nothing about
  // whether a particular person has an account.
  /**
   * `403` from `POST /api/client/register`: this app has `self_registration`
   * off, so nobody may create an account without an invitation. Not
   * `forbidden` — nothing about the caller is refused, the door is closed for
   * everyone — and honest for the reason above: a stranger learns the app's
   * policy, not who is in it. Also the reason an unknown federated identity is
   * turned away at an OIDC callback, where it travels as
   * `clientOidcErrorCode` rather than as an `apiError`: one switch, one
   * decision, whichever door somebody arrives at.
   */
  'registration_closed',
  /**
   * `403` from `POST /api/client/register`: the address is outside the app's
   * `allowed_domains`. Same standing as `registration_closed` — it is about
   * the domain the caller typed, which they already know, and about a list the
   * developer configured. **An invitation always bypasses it**, so this is
   * never the answer to accepting one.
   */
  'domain_not_allowed',
  /**
   * The address has not been confirmed, and something that is not a login
   * needs it to have been.
   *
   * **Never the answer to `POST /api/client/login`**, which refuses a
   * `pending_verification` account with the same `invalid_credentials` a wrong
   * password gets — that is the whole of the enumeration discipline, and a
   * code that leaked the distinction there would undo it. Its producer is the
   * federated path: an identity provider that asserts an address without
   * `email_verified` never produces or links an account, and the app is told
   * why so it can say "confirm your address with your provider first".
   */
  'email_unverified',
  /**
   * `403`: the request's `Origin` is not one of the app's `allowed_origins`.
   * The same list is the CORS allow-list and the OIDC `redirect_uri` check, so
   * this is the refusal for both — a browser sees a failed preflight, and a
   * start request naming an unlisted redirect target sees this code with no
   * redirect, because until the target is confirmed there is nowhere trusted
   * to bounce a browser to.
   */
  'origin_not_allowed',
  /**
   * `422` from the mail-template PUT and preview: the Liquid template does not
   * render. `details` is a `mailTemplateProblemDetails` naming **which of the
   * three parts** failed and the renderer's own message — an error that did not
   * say which part leaves the developer re-reading all three.
   *
   * Liquid runs in strict mode, so an unknown variable is one of these rather
   * than an empty string in a mail somebody already received. A template that
   * renders at save time and fails at send time falls back to the Fleetless
   * default and writes an audit event; nothing on the wire can promise that a
   * template which rendered once will render for every recipient.
   */
  'template_invalid',
  /**
   * The named OIDC provider exists on this app and is turned off. Distinct
   * from `not_found`, which is what an unknown slug gets: `enabled` is a
   * switch the developer flipped, and a disabled provider keeps its row and
   * its linked identities, so telling the two apart is what lets a developer's
   * page say "that button is temporarily off" rather than "that provider was
   * deleted". It reaches an app user as a `clientOidcErrorCode` of the same
   * name, redirected to the app rather than rendered here.
   */
  'provider_disabled',
  /**
   * `422`: the provider's own configuration cannot complete a sign-in, and
   * only the **developer** can fix it. Discovery answered something that is
   * not an OIDC discovery document, the issuer in it disagrees with the
   * configured one, or one of the three endpoints it publishes
   * (`authorization_endpoint`, `token_endpoint`, `jwks_uri`) is not an http(s)
   * URL. Every one of those is decided by the discovery step, which is what
   * lets `POST`/`PATCH` refuse the provider at the form.
   *
   * **Two failures that sound like this one and are not**, listed because an
   * earlier draft of this text claimed them: a JWKS carrying no key that can
   * verify the token reaches the app as `claims_incomplete`, and a client
   * secret the token endpoint rejects reaches it as `exchange_failed`. Both are
   * decided in the middle of a sign-in, against a document that was fine when
   * the provider was stored, so neither can be a create-time refusal — and
   * naming them here sent a developer looking up a code their logs would never
   * show. The `reason` behind `claims_incomplete` is in the cloud's log.
   *
   * Distinct from `idp_unavailable`, which is the same fault line drawn one
   * step earlier: there the provider could not be **reached**, and retrying may
   * work; here it answered and the answer was unusable, so retrying will do
   * the same thing until somebody changes the configuration. Collapsing the
   * two would tell a developer to wait when the fix is theirs to make.
   *
   * Distinct from `validation_error` for the same reason `invalid_redirect_uri`
   * is: the shape of what the developer typed was fine, and what failed is a
   * fact about a remote system that no request-body check could have caught.
   * `POST` and `PATCH` on `/api/apps/:id/oidc-providers` run discovery before
   * storing a row, so the refusal arrives while the developer is looking at
   * the form rather than at an app user's failed sign-in a week later.
   *
   * It reaches an app user as a `clientOidcErrorCode` of the same name,
   * redirected to the app rather than rendered here.
   */
  'provider_misconfigured',
  /**
   * A redirect URI that is not usable: malformed, or an origin the app has not
   * listed. Refused **flat, with no redirect** — sending a browser to an
   * unconfirmed target is the attack this check exists to prevent, so an
   * open-redirect attempt cannot be reported by redirecting.
   *
   * It was a `validation_error` with rule `invalid_redirect_uri` on the deleted
   * app-level OAuth client routes. Promoted to a code of its own because a
   * bare `rule` string on the validation envelope is not something a consumer
   * can switch on, and this is a refusal a developer's own login page has to
   * branch on.
   */
  'invalid_redirect_uri',
  /**
   * `410`: an interaction is past its window. OIDC interactions live ten
   * minutes, the one-time code sixty seconds, and an MCP interaction ten
   * minutes.
   *
   * Deliberately **not** `token_spent`, and the difference is what the value
   * IS rather than how many states the answer covers. `token_spent` is the one
   * answer to a mailed credential that does not work; this is the one answer to
   * an interaction that is no longer live. **The MCP interaction routes collapse
   * unknown, expired, already-decided and not-this-surface into this single
   * code**, exactly as `token_spent` collapses its four — an id nobody holds
   * must not be distinguishable from one that ran out, or a caller who did not
   * start the flow learns whether somebody else's sign-in is in progress. What
   * survives the collapse is the word: an app's page can say "that took too
   * long, start again" rather than "that link is invalid", which is the right
   * advice for the state a person is actually in.
   */
  'interaction_expired',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
