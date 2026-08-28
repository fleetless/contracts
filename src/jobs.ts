import { z } from 'zod'
import { slug, wireSeqCursor, wireTimestampMs } from './common.js'

/**
 * Jobs (spec §6.1, §11.3): one running unit of work on a robot — an action
 * goal or a service call — with an id both sides know, so bridge and cloud
 * stay in sync across a disconnect.
 *
 * Two rules shape everything here:
 *
 * 1. **State is observed by slug, not by id.** The id is informative (§11.3);
 *    a client watches `robot × slug` and sees whatever job is running there,
 *    which is also why every observer of a slug sees the same job.
 * 2. **`lost` is a real outcome and must be said out loud** (§6.1). Job state
 *    lives only in the bridge's memory; if it restarts mid-job, the results
 *    are gone. The cloud then marks the job `lost` — never leaves it reading
 *    "running" because nobody contradicted it. A system that reports a
 *    machine is still working when it does not know is worse than one that
 *    admits it lost track.
 */
export const jobState = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'lost'])
export type JobState = z.infer<typeof jobState>

export const job = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  slug,
  state: jobState,
  started_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  /**
   * A monotonic counter, ascending in mint order (W7), and the **named**
   * tiebreaker for any listing that claims an order.
   *
   * `started_at` is not a total order: two jobs minted in the same millisecond
   * sort against each other arbitrarily, and arbitrarily means *differently on
   * each query* — so `GET /api/robots/:id/jobs`, which documents "newest
   * first", can show one twice and the other not at all. Exactly the defect
   * `auditEvent.seq` was added for in W6b, in a route the same wave shipped.
   *
   * **Scoped honestly: per cloud process, per run.** Job state lives in memory
   * (§6.1 — that is why `lost` exists at all), so this counter restarts when
   * the cloud does, alongside the jobs it orders. Sound, because it only ever
   * orders jobs that coexist in one registry — and stated, because a reader
   * who assumed `auditEvent.seq`'s durable semantics would be wrong.
   */
  seq: z.number().int().positive(),
  /** Present once the job succeeded; shape is the ROS result's. */
  result: z.unknown().nullable(),
  /**
   * Present on `failed`; a human message, plus a code where one exists.
   *
   * `details` exists because a refusal that carries only prose forces every
   * consumer to parse it. W6b shipped `job_queue_full` with a documented
   * `{limit, queued}` payload and **nowhere to put it**: the bridge reports a
   * full queue as a job error, this shape had no `details`, and so the numbers
   * were formatted into the message and lost. The console then rendered a
   * "wait for one of N to finish" alert from a shape nothing in the system
   * produced, and its test built that shape by hand — three repos agreeing
   * with each other about a payload none of them exchanged (Momus, W6b
   * review).
   *
   * Optional, because most job errors have nothing structured to add. Where a
   * code has a documented payload — `job_queue_full` has
   * `jobQueueFullDetails` — it belongs here, not in the sentence.
   */
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.unknown().optional(),
    })
    .nullable(),
})
export type Job = z.infer<typeof job>

/**
 * One update about a job, pushed to subscribers of its slug.
 *
 * `timestamp_ms` is the bridge's capture time, exactly as for a datapoint
 * (§6.3 says action feedback carries it too) — so a client computes the age
 * of a progress report the same way it computes the age of a sensor value,
 * and a burst of late-delivered feedback after a reconnect is visibly late
 * rather than looking current.
 */
export const jobEvent = z.object({
  type: z.literal('job'),
  robot_id: z.uuid(),
  slug,
  job,
  /** Action feedback, if this update carries any. */
  feedback: z.unknown().nullable(),
  /** 0..1 when the action reports progress; null when it does not. */
  progress: z.number().min(0).max(1).nullable(),
  timestamp_ms: z.number().int().nonnegative(),
})
export type JobEvent = z.infer<typeof jobEvent>

/**
 * What a busy refusal tells the caller (spec §11.3: "inkl. Information, was
 * läuft"). A refusal that only says "busy" forces the caller to guess whether
 * to wait or to give up.
 */
export const busyDetails = z.object({
  running: job,
})
export type BusyDetails = z.infer<typeof busyDetails>

/**
 * What a `publisher_busy` refusal tells the caller (spec §6.4).
 *
 * "Another caller is publishing and has not been quiet long enough" names a
 * state and no action: the caller does not know how much longer, because
 * `quiet_timeout_ms` lives in the configuration document, which a client app
 * never reads. Without a number they busy-loop — on the one verb that moves
 * a machine, on a platform with no rate limiting. So the refusal carries the
 * wait itself.
 *
 * `holder` is deliberately absent: it would name another end user to a
 * caller who may have no right to know they exist.
 */
export const publisherBusyDetails = z.object({
  /** The configured silence a holder must leave before anyone else may publish. */
  quiet_timeout_ms: z.number().int().nonnegative(),
  /** How much of that silence is still outstanding, now. */
  retry_after_ms: z.number().int().nonnegative(),
})
export type PublisherBusyDetails = z.infer<typeof publisherBusyDetails>

/**
 * What a `job_queue_full` refusal tells the caller (W6b).
 *
 * Both numbers, not just the limit: `limit` alone says how big the queue is
 * and nothing about whether waiting will help, and `queued` alone cannot be
 * read without knowing the bound. Together they are the only two facts a
 * caller needs to decide between retrying and giving up.
 */
export const jobQueueFullDetails = z.object({
  /** The bridge's bound on queued jobs. */
  limit: z.number().int().positive(),
  /** How many are queued right now — `>= limit` when this refusal is sent. */
  queued: z.number().int().nonnegative(),
})
export type JobQueueFullDetails = z.infer<typeof jobQueueFullDetails>

/** A page of run history is bounded; 200 is what one console screen can ever want. */
export const JOB_RUN_PAGE_MAX = 200

/**
 * Job runs keep the audit log's retention, and that is not a coincidence:
 * every invoke already writes an `action.invoked` audit event. A different
 * figure here creates a window in which the audit log shows a call whose
 * outcome has already been deleted — a state no developer can be expected to
 * read as anything but a bug.
 */
export const JOB_RUN_RETENTION_DAYS = 90

/**
 * Who invoked a run.
 *
 * Deliberately **not** `auditActor`: that enum carries `bridge` as a fourth
 * case, and a bridge invokes nothing. An enum that names an impossible case
 * invites every reader to handle it.
 *
 * **Seam — an unassigned residual (2026-08-29, D1).** `developer` and
 * `end_user` were two identity spaces; they are now two ways of reaching the
 * same pool — an Org Admins member and an assigned user. The distinction the
 * enum draws is still *observable* (it is what the caller was acting as), so
 * this is not yet wrong, but the words are the old model's. No current plan
 * touches it; a rename would rewrite the meaning of every historical job row,
 * which is a migration, not a contract edit.
 */
export const jobActor = z.object({
  kind: z.enum(['developer', 'end_user', 'server_key']),
  id: z.uuid(),
  /**
   * The email for a developer or end user, the key's `name` for a server key.
   * A display snapshot taken at invoke time: renaming a key afterwards does not
   * rewrite history, which is the point of storing it rather than joining.
   */
  label: z.string().min(1).max(200),
})
export type JobActor = z.infer<typeof jobActor>

export const jobRunKind = z.enum(['action', 'service'])
export type JobRunKind = z.infer<typeof jobRunKind>

/**
 * One durable record of one invocation (spec `2026-08-20-timeseries-and-run-history`,
 * D2). One row per run, never one per event: the per-event timeline's write rate
 * is set by the bridge, and a throttled log that cannot say it was throttled is
 * the instrument this codebase refuses everywhere else. The live timeline is
 * delivered in full by realtime, for as long as somebody is watching.
 */
export const jobRun = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  slug,
  kind: jobRunKind,
  state: jobState,
  started_at: z.iso.datetime(),
  /** `null` while `running` — a run has an end only once it has one. */
  ended_at: z.iso.datetime().nullable(),
  /** `null` while `running`. Not "0 so far". */
  duration_ms: z.number().int().nonnegative().nullable(),
  result: z.unknown().nullable(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1), details: z.unknown().optional() })
    .nullable(),
  actor: jobActor,
  /**
   * **Durable, unlike `job.seq`.** That one is a per-process counter that
   * restarts with the cloud; this is a postgres `bigserial` and is the cursor
   * `before_seq` walks.
   */
  seq: z.number().int().positive(),
  /**
   * Live-only, read from the in-memory registry for rows that are still
   * running. `null` means **"not known right now"** — after a cloud restart,
   * before the bridge reconnects — and never "0 %". A fraction, as in
   * `jobEvent.progress`, not a percentage.
   */
  progress: z.number().min(0).max(1).nullable(),
  feedback: z.unknown().nullable(),
})
export type JobRun = z.infer<typeof jobRun>

export const jobRunQuery = z
  .object({
    /** Only runs with a smaller `seq` — the next, older page. */
    before_seq: wireSeqCursor.optional(),
    limit: z
      .union([z.string().regex(/^\d{1,4}$/), z.number().int()])
      .transform((v) => Number(v))
      .pipe(z.number().int().positive().max(JOB_RUN_PAGE_MAX))
      .optional(),
    robot_id: z.uuid().optional(),
    slug: slug.optional(),
    state: jobState.optional(),
    kind: jobRunKind.optional(),
    /** Half-open `[from, to)`, the same rule the history shapes follow (DEF-062). */
    from_ms: wireTimestampMs.optional(),
    to_ms: wireTimestampMs.optional(),
  })
  .strict()
export type JobRunQuery = z.infer<typeof jobRunQuery>

export const jobRunListResponse = z.object({
  runs: z.array(jobRun),
  /**
   * The `seq` a caller sends as `before_seq` to keep reading — or `null` when
   * there is nothing further. **`null` means the end, and that is a promise
   * rather than an observation.** A caller who instead compares `runs.length`
   * against `limit` is wrong the moment a filter makes a page thin.
   */
  next_cursor: z.number().int().positive().nullable(),
})
export type JobRunListResponse = z.infer<typeof jobRunListResponse>

/**
 * The overview tile's three numbers, over a window **the caller names**.
 *
 * `since_ms` rather than "today": which day that is, only the browser knows. A
 * cloud that picks its own day boundary shows a developer in another timezone a
 * number they cannot reproduce. Echoed back so a rendered tile can say which
 * window it is describing.
 */
/**
 * `GET /api/org/jobs/summary`'s query: the window, and nothing else.
 *
 * **`since_ms` is required and has no default.** Which day "today" is, only
 * the browser knows; a cloud that picked its own boundary would show a
 * developer in another timezone a number they cannot reproduce from anything
 * in front of them. The absence of a default is the contract here, not an
 * omission — see `jobRunSummary`, which echoes the window back so a rendered
 * tile can say what it is describing.
 *
 * Its own shape rather than a slice of `jobRunQuery`: pagination and filters
 * mean nothing to an aggregate, and `.strict()` would refuse them anyway, so
 * borrowing that schema would advertise seven parameters the route ignores.
 *
 * `.strict()` for `jobRunQuery`'s reason — a mistyped `since_mss` that is
 * silently ignored answers `200` over a window nobody chose, which is worse
 * than a refusal because it looks like data.
 */
export const jobRunSummaryQuery = z.object({ since_ms: wireTimestampMs }).strict()
export type JobRunSummaryQuery = z.infer<typeof jobRunSummaryQuery>

export const jobRunSummary = z.object({
  running: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  since_ms: z.number().int().nonnegative(),
})
export type JobRunSummary = z.infer<typeof jobRunSummary>
