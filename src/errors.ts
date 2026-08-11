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
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
