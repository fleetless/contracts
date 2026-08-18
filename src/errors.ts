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
  'email_taken',
  'identifier_taken',
  'weak_password',
  'not_a_member',
  /**
   * The account itself is blocked — distinct from `forbidden` on purpose: it
   * tells the account holder something about *their own* account, and reveals
   * nothing about any other principal or about what exists.
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
   * this app** — and the app's IdP config has no `default_role_id`, so
   * federation here is a login mechanism rather than a signup path.
   *
   * Two shapes reach it, and the name is about the outcome rather than about
   * which one:
   *
   *   1. No existing end user matches at all.
   *   2. One matches **and was approved to link** (`link_verified_emails` and
   *      `email_verified` both true) but holds no membership in *this* app,
   *      and none may be created.
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
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
