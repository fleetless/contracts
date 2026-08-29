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
  'invite_expired',
  'invite_used',
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
   * It stays an answer to a *write* an authenticated admin made — signing up,
   * inviting or creating — never to a login. `identity_conflict` is the
   * login-side neighbour, and it deliberately says less.
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
   * **It loses its producer when D1's `users` replaces `end_users` — it has
   * not lost it yet.** At the time of writing the cloud still emits it from
   * five sites (`auth.ts`, `routes/end-users.ts`, `ws/realtime.ts`, and twice
   * in `routes/client-auth.ts`), all reading `end_users.status === 'blocked'`.
   * D1's `users` has no `status` column and nothing in the redesign
   * reinstates one — removing a user's assignments is what withdraws access
   * there — so those five sites go with the old tables in the cloud task.
   *
   * Kept either way, like `mcp_disabled`, because the reserved shape is the
   * point. Written in the tense that is true today rather than in the one the
   * plan expects to become true: a comment that declares a producer gone
   * before it is gone sends the next reader to `grep` and find the opposite,
   * which is the failure `mcp_disabled`'s own comment was written to fix.
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
  // codes only" and then listed two whose only producer is `/oauth/register`,
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
  // `fleetless_code` inside an RFC envelope at `/oauth/register`, and as an
  // ordinary `apiError` code at the developer-facing management routes.
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
   * A federated identity asserts an email that already belongs to an
   * integrated user, and the conditions for linking them are not both met
   * (see `idpConfig.link_verified_emails`). Deliberately not `email_taken`:
   * that one answers a registration attempt, this one answers a *login* that
   * cannot safely be told which account it nearly reached.
   */
  'identity_conflict',
  /**
   * **A federated login that got as far as an identity and found no route into
   * this app** — and nothing admits them unasked, so federation here is a
   * login mechanism rather than a signup path.
   *
   * Two shapes reach it, and the name is about the outcome rather than about
   * which one:
   *
   *   1. No existing user matches at all.
   *   2. One matches **and was approved to link** (`link_verified_emails` and
   *      `email_verified` both true) but holds no assignment for *this* app,
   *      and nothing provisions them either.
   *
   * **The admitting policy this comment used to name is gone** (2026-08-29,
   * D6): `selfRegistration` was deleted with the per-app pools. Its successor
   * is the group provider's `jit_enabled`/`jit_grants` (D3), which lands in
   * the oidc-federation plan. Until it does, case 2's second half reads
   * *"and nothing provisions them"* simply because nothing does.
   *
   * The second was found by Nimbus-W7b while giving these codes their
   * producers, and the first version of this comment did not cover it — it
   * described case 1 as though it were the definition. **Widened rather than
   * given a code of its own**: to the caller both are one remedy, *ask
   * somebody to grant you access to this app*, and a code that splits an
   * outcome the caller cannot act on differently is a distinction paid for and
   * never used. `identity_conflict` stays separate precisely because its
   * remedy is different — *sign in the way you signed up*.
   */
  'identity_not_provisioned',
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
   * The app's `mcp_enabled` switch is off. The endpoint itself answers `404`
   * and says nothing further: whether an app exists but has MCP switched off
   * is not something an unauthenticated caller gets to learn.
   *
   * **Nothing produces this code today, and the sentence that used to stand
   * here named a route that explicitly refuses to** (Momus-W9). It said
   * *"the tool preview in particular"* — while `cloud/src/routes/apps.ts:286`
   * says the opposite, with its reasoning: *"Does not require `mcp_enabled` …
   * The switch only gates the live endpoint (N9), never this management-side
   * read."* A `grep` over `cloud/src` finds `mcp_disabled` in exactly one
   * place: a comment.
   *
   * Kept rather than removed, because the reserved shape is the point — but
   * **named as unproduced instead of attributed to a route that declines it.**
   * This is DEF-039's form (an enum member with no producer), and the variant
   * that costs more: a wrong producer sends the next reader to read code that
   * says the opposite of the doc, and one of the two has to be wrong.
   *
   * `tool_not_available` below has no producer either — `grep` finds it
   * nowhere in `cloud/src`. Same standing, same reason for keeping it.
   */
  'mcp_disabled',
  /**
   * A slug that exists, and no tool for it — because the role does not grant
   * it, or because it produces none (see `MCP_OMISSION_REASONS`).
   *
   * **Deliberately one code for both**, on the same reasoning that widened
   * `identity_not_provisioned` in W7b: to a developer holding the console,
   * `omitted[]` carries the distinction with its reason attached, so a second
   * code would split an outcome nobody acts on differently. To anyone else the
   * two must be indistinguishable anyway — §3.3.
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
  /**
   * **The Org Admins group cannot be deleted** (D1: exactly one per org,
   * renamable, never deletable). 409 on `DELETE /api/org/groups/:id`.
   *
   * Not `forbidden`, which would say *you may not* and invite an owner to go
   * looking for the tier that would let them: no tier does, and no future one
   * will. The console can render "this group is the org's admin group" from
   * `is_org_admins` without asking, so this code exists for the caller that
   * did not look first.
   *
   * **Scope, stated because the neighbouring case is unresolved:** this code
   * is about `is_org_admins` and nothing else. Whether a group that still has
   * members or apps may be deleted — refuse, or cascade — is the cloud's
   * decision in the routes task; if it refuses, that refusal needs its own
   * code rather than this one widened to cover an outcome with a different
   * remedy.
   */
  'group_not_deletable',
  /**
   * **A group that still has members or apps.** 409 on
   * `DELETE /api/org/groups/:id`, and the house precedent is `robot_in_use` /
   * `credential_in_use`: a refusal that names the *state* blocking the delete,
   * so the caller knows the remedy is to empty the group first — move the
   * users, re-link or delete the apps.
   *
   * Deliberately separate from `group_not_deletable`, which is about the Org
   * Admins group and can **never** be satisfied. This one clears the moment
   * the last member and the last app leave, and the two remedies have nothing
   * in common; one code for both would tell an owner to go looking for a way
   * to empty a group that no amount of emptying will let them delete.
   *
   * Registered now, ahead of its producer, so the routes task does not need a
   * second contracts commit and re-pin for one string. **That makes it
   * unproduced until then** — the same standing as `mcp_disabled`, said out
   * loud for the same reason.
   */
  'group_in_use',
  // 2026-08-29 — oidc-federation (D3/D4).
  /**
   * **The target is in a state that refuses the operation** — not the caller's
   * rights, not the target's existence, but *what the target currently is*.
   * 409.
   *
   * It is the home for three refusals identity-core left riding a `400
   * validation_error` with a `rule` string — `org_admins_group`,
   * `not_in_org_admins_group`, `group_mismatch` — none of which is a
   * malformed-input problem: the body is well-formed and names a real target
   * whose *state* is the obstacle. Attaching a group OIDC provider to the Org
   * Admins group is the D3 case (that group never carries a provider); the
   * other two are the state checks around impersonation and group membership.
   * A `400` said "you sent something invalid" for a request that was nothing
   * of the kind, and a bare `rule` string on the validation envelope is not a
   * code a consumer can switch on.
   *
   * Deliberately not `forbidden` (which is silent about existence and about
   * the target) and not `tier_required` (which is about the caller's own
   * rank): a caller reaching this has the rights and named a real thing — the
   * obstacle is the target's state, and the remedy is to change that state or
   * pick a different target, neither of which a silence would reveal.
   *
   * **The cloud maps the three `rule` strings to this code in the
   * oidc-federation routes task; registered here ahead of that producer, so
   * that task needs no second contracts commit and re-pin. That makes it
   * unproduced until then** — the same standing as `group_in_use`, said out
   * loud for the same reason.
   */
  'target_state_conflict',
  // 2026-08-29 — central-mcp (D5).
  /**
   * **MCP access is gated off for this caller.** The central MCP server
   * (`mcp.fleetless.dev`) decides access from the group flag `mcp_enabled`
   * crossed with the per-user override `mcp_access` (`default | allowed |
   * denied`): `denied` beats a group that is on, `allowed` beats a group
   * that is off, `default` follows the group. When the answer is "no", this
   * is the refusal — enforced at token issue **and** on every request, so a
   * revocation bites at the next call, not the next refresh (D5).
   *
   * Deliberately its own code, not `forbidden`: `forbidden` is silent about
   * existence and is the app-role refusal REST already speaks; this one is
   * about a caller's *own* MCP entitlement, which the caller can act on
   * (ask an admin to flip the flag or the override). Not `tier_required`
   * either — that is about owner/developer rank, an orthogonal axis.
   *
   * **The cloud produces it in the gating task (central-mcp Task 4);
   * registered here ahead of that producer so the task needs no second
   * contracts commit and re-pin. That makes it unproduced until then** — the
   * same standing as `group_in_use` and `target_state_conflict`, said out
   * loud for the same reason.
   */
  'mcp_access_denied',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
