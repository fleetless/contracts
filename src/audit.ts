// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { wireSeqCursor, wireTimestampMs } from './common.js'

/**
/**
 * Audit. Every state-changing interaction is recorded and **every entry carries
 * its actor — never anonymous**. Reads are not audited.
 *
 * What is written: logins, failed logins, user management, configuration
 * publishes, bridge connect and disconnect. The log is filterable, exportable
 * as CSV, and kept for ninety days.
 */

/**
 * The kinds of actor the platform knows. `label` is what a human reads in the
 * log — an email, a key name, a robot name — so the console never has to
 * resolve four different id kinds to render a row.
 *
 * **`end_user` stays, for the rows already written.** The identity split
 * replaced the org's one user pool with Fleetless users and per-app app
 * users; new rows from an app user carry `app_user`. But an audit log must
 * never be rewritten, and stored rows still have `kind: end_user` — dropping
 * the member would fail their own schema. A log that can't be read back is
 * worse than one carrying a retired word.
 *
 * So the enum is deliberately **wider than what any producer emits**:
 * nothing writes `end_user` any more, and nothing should start again — said
 * here rather than left for a future search to infer.
 *
 * `developer` is a Fleetless user. It kept its name through both redesigns
 * because it was always right: the person who configures robots.
 */
export const auditActor = z.object({
  kind: z.enum(['developer', 'end_user', 'app_user', 'server_key', 'bridge']),
  id: z.uuid(),
  label: z.string().min(1).max(200),
})
export type AuditActor = z.infer<typeof auditActor>

export const auditEvent = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  at: z.iso.datetime(),
  /**
   * A monotonic counter, ascending in write order, unique across the log.
   *
   * `at` is not a total order. Two events written in the same millisecond —
   * a login and the config publish it enables, a cascade writing several
   * rows — sort against each other arbitrarily, and "arbitrarily" means
   * *differently on each query*. A reader paging through "newest first" can
   * therefore see one of them twice and the other not at all, which is the
   * one failure mode an audit log may not have: a record that is present and
   * invisible.
   *
   * It is also the only correct **cursor** for paging this log, for the same
   * reason: a cursor that is not unique either skips rows or repeats them at
   * every page boundary. Nothing else in this shape can carry one.
   *
   * Required, not optional: an event without a sequence cannot be ordered
   * against one that has it, and a log with two orderings has none.
   */
  seq: z.number().int().positive(),
  actor: auditActor,
  /** Stable dotted name, e.g. `app_user.login`, `config.published`. */
  action: z.string().min(1).max(80),
  /**
   * What the action was about, if anything — a robot, an app, a user. Free
   * of ids the console cannot resolve: carry the label with it.
   */
  target: z
    .object({
      kind: z.string().min(1).max(40),
      id: z.string().min(1),
      label: z.string().min(1).max(200),
    })
    .nullable(),
  /**
   * Action-specific extras.
   *
   * **Nothing redacts this.** There is no denylist, no allowlist and no pass
   * over what a call site puts here — the call site is responsible, and this
   * comment is where that responsibility is written down. Since the org event
   * stream, the same object also reaches every developer with the console
   * overview open, not only whoever later reads the audit log.
   *
   * So: never credentials, never tokens. That is a rule, not a guarantee the
   * schema enforces.
   */
  details: z.record(z.string(), z.unknown()).nullable(),
})
export type AuditEvent = z.infer<typeof auditEvent>

/**
 * **How this log is read.**
 *
 * **The cursor is `seq`, and no other field can be.** `at` is not a total
 * order: two events written in the same millisecond sort differently on every
 * query, so a cursor on `at` either skips rows or repeats them at each page
 * boundary — which for an audit log means an entry that is present and
 * invisible.
 *
 * `before_seq` rather than `after_seq`, because this log is read **newest
 * first**: the next page is older, not newer.
 */
/**
 * A unix-millisecond bound a Postgres `timestamptz` can actually hold.
 *
 * Years 1..9999: below that Postgres has no year zero, above it year 10000
 * needs the ISO extended-year form its bind path does not accept. Comfortably
 * wider than any instant this platform will legitimately be asked about, so
 * the bound costs nothing real and catches every value found to 500.
 *
 * @see wireTimestampMs — moved to `common.ts` when `jobRunQuery` needed the same bound.
 */
const auditTimestampMs = wireTimestampMs

export const auditQuery = z.object({
  /** Only events with a smaller `seq` — the next, older page. */
  before_seq: wireSeqCursor.optional(),
  /**
   * The same shape as `historyQuery.limit`: a union whose input branch
   * **is the wire**. A `z.coerce` cannot be published — zod renders the
   * coercion's result in either `io` direction, so the artifact would describe
   * a shape a query string can never carry.
   */
  limit: z
    .union([z.string().regex(/^\d{1,4}$/), z.number().int()])
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(500))
    .optional(),
  /** Exact action name, e.g. `config.published`. No prefix matching: a filter that matches more than it says is not one. */
  action: z.string().min(1).max(80).optional(),
  /**
   * Everything under a dotted prefix, e.g. `server_key.` for all three
   * server-key actions.
   *
   * **A separate parameter, not a widening of `action`.** The rule on
   * `action` above still stands; this is a different question with a name
   * that says which one it is. Setting both is refused, not resolved —
   * naming an exact action *and* a prefix is a caller mistake, not a
   * combination to guess the meaning of.
   *
   * **The published artifact cannot express that refusal**: a cross-field
   * `.refine()` has no JSON Schema rendering, so `audit-query.schema.json`
   * describes two independent optional strings and validates both-at-once
   * happily. The cloud is the only enforcement point — the same residual
   * `orgLatencyQuery` and `orgUsageQuery` already name.
   */
  action_prefix: z.string().min(1).max(80).optional(),
  /**
   * Only events by this actor.
   *
   * **`z.uuid()`, because the column is one.** A looser string type lets any
   * non-uuid value reach the database as a uuid parameter, where the cast
   * throws: `?actor_id=not-a-uuid` then answers **500 `internal_error`** rather
   * than refusing the value.
   *
   * Not an injection question — the query is parameterised either way. It is a
   * **500 where a 400 belongs**, and a 500 is the answer that explains nothing.
   */
  actor_id: z.uuid().optional(),
  /** Only events about this kind of target, e.g. `robot`. */
  target_kind: z.string().min(1).max(40).optional(),
  /**
   * Absolute bounds in unix milliseconds, **half-open `[from, to)`** — the
   * same rule the history shapes follow.
   *
   * **Bounded to years 1..9999.** `nonnegative()` alone admits instants a
   * timestamp column has no representation for, and the route answers 500
   * rather than refusing the value. `Number.isSafeInteger` is wider than what a
   * timestamp can be, so the bound is stated rather than inherited.
   */
  from_ms: auditTimestampMs.optional(),
  to_ms: auditTimestampMs.optional(),
})
  .strict()
  .refine((query) => !(query.action !== undefined && query.action_prefix !== undefined), {
    message: 'action and action_prefix cannot be combined',
    path: ['action_prefix'],
  })
export type AuditQuery = z.infer<typeof auditQuery>

export const auditListResponse = z.object({
  events: z.array(auditEvent),
  /**
    * The `seq` a caller sends as `before_seq` to keep reading — or `null` when
    * there is nothing further.
    *
    * **`null` means the end, and that is a promise rather than an
    * observation.** A caller who instead compares `events.length` against
    * `limit` is wrong the moment a filter makes a page thin: a short page does
    * not mean *no more* here. The same distinction `historySamples` was given
    * `truncated` for.
    */
  next_cursor: z.number().int().positive().nullable(),
})
export type AuditListResponse = z.infer<typeof auditListResponse>

/**
 * **What a CSV export of this log looks like.**
 *
 * The column order lives here because otherwise the cloud and the console
 * would each carry their own, and nobody would notice them drifting apart
 * until a spreadsheet at a customer had the wrong headings. One order, one
 * place.
 *
 * `details` is written as JSON into a single cell. That is ugly and honest:
 * the alternative is leaving it out, and an audit export that omits *what
 * happened* is not an audit export.
 */
export const AUDIT_CSV_COLUMNS = ['seq', 'at', 'actor_kind', 'actor_id', 'action', 'target_kind', 'target_id', 'target_label', 'details'] as const

/**
 * The audit log is kept for **90 days**.
 *
 * A constant here so no consumer derives it a second time — the same reasoning
 * as `ROBOT_ASSET_STORE_BYTES`.
 */
export const AUDIT_RETENTION_DAYS = 90
