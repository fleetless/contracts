// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { slug, wireSeqCursor, wireTimestampMs } from './common.js'

/**
 * Jobs: one running unit of work on a robot — an action
 * goal or a service call — with an id both sides know, so bridge and cloud
 * stay in sync across a disconnect.
 *
 * Two rules shape everything here:
 *
 * 1. **State is observed by slug, not by id.** The id is informative; a client
 *    watches `robot × slug` and sees whatever job is running there, which is
 *    also why every observer of a slug sees the same job.
 * 2. **`lost` is a real outcome and must be said out loud.** Job state
 *    lives only in the bridge's memory; if it restarts mid-job, the results
 *    are gone. The cloud then marks the job `lost` — never leaves it reading
 *    "running" because nobody contradicted it. A system that reports a
 *    machine is still working when it does not know is worse than one that
 *    admits it lost track.
 */
export const jobState = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'lost'])
export type JobState = z.infer<typeof jobState>

export const job = z.object({
  id: z.uuid().meta({
    description: 'The job\'s id, minted by the cloud when the invocation is accepted. Informative: state is observed by slug, and this id is what a cancel names when a caller wants to stop one specific job rather than whatever is running.',
  }),
  robot_id: z.uuid().meta({ description: 'The robot this job is running on.' }),
  slug: slug.meta({
    description: 'The action or service this job is running, as the published configuration exposes it. One slug carries one job at a time, so every observer of that slug sees the same one.',
  }),
  state: jobState.meta({
    description: 'Where the job stands: `running`, `succeeded`, `failed`, `cancelled` or `lost`. `lost` is a real outcome — the bridge restarted mid-job and the result is gone — and is said out loud rather than left reading `running` because nobody contradicted it.',
  }),
  started_at: z.iso.datetime().meta({
    description: 'When the cloud minted this job, as an ISO 8601 timestamp. For a job adopted from a reconnecting bridge it is **adoption time**, not the real start, because the cloud never minted it and has no honest alternative.',
  }),
  updated_at: z.iso.datetime().meta({
    description: 'When this job last changed, as an ISO 8601 timestamp.',
  }),
  /**
   * A monotonic counter, ascending in mint order, and the **named** tiebreaker
   * for any listing that claims an order.
   *
   * `started_at` is not a total order: two jobs minted in the same millisecond
   * sort against each other arbitrarily, and arbitrarily means *differently on
   * each query* — so `GET /api/robots/:id/jobs`, which documents "newest
   * first", can show one twice and the other not at all. `auditEvent.seq`
   * exists for the same reason on the audit log.
   *
   * **Scoped honestly: per cloud process, per run.** Job state lives in memory
   * — that is why `lost` exists at all — so this counter restarts when
   * the cloud does, alongside the jobs it orders. Sound, because it only ever
   * orders jobs that coexist in one registry — and stated, because a reader
   * who assumed `auditEvent.seq`'s durable semantics would be wrong.
   */
  seq: z.number().int().positive().meta({
    description: 'A monotonic counter ascending in mint order, and the named tiebreaker for any listing that claims one — `started_at` alone is not a total order. Scoped per cloud process and per run: job state lives in memory, so this restarts with the registry it orders.',
  }),
  result: z.unknown().nullable().meta({
    description: 'What the call returned once it succeeded, shaped by the ROS action or service itself. `null` until then, and for a job that did not succeed.',
  }),
  /**
   * Present on `failed`; a human message, plus a code where one exists.
   *
   * `details` exists because a refusal that carries only prose forces every
   * consumer to parse it. A documented payload with nowhere to put it — the
   * bridge reports a full queue as a job error — ends up formatted into the
   * message and lost, and every consumer then builds the structured shape by
   * hand from its own assumption.
   *
   * Optional, because most job errors have nothing structured to add. Where a
   * code has a documented payload — `job_queue_full` has
   * `jobQueueFullDetails` — it belongs here, not in the sentence.
   */
  error: z
    .object({
      code: z.string().min(1).meta({
        description: 'A machine-readable code for the failure, such as `job_queue_full`, where one exists for it.',
      }),
      message: z.string().min(1).meta({
        description: 'A human-readable sentence saying what went wrong.',
      }),
      details: z.unknown().optional().meta({
        description: 'The structured payload belonging to `code`, for the codes that document one — `job_queue_full` carries its `limit` and its `queued` count here. Absent for a failure with nothing structured to add, which is most of them.',
      }),
    })
    .nullable()
    .meta({
      description: 'Why the job failed: a human `message`, a `code` where one exists, and `details` for the codes that carry a documented payload. `null` unless `state` is `failed`.',
    }),
})
export type Job = z.infer<typeof job>

/**
 * One update about a job, pushed to subscribers of its slug.
 *
 * `timestamp_ms` is the bridge's capture time, exactly as for a datapoint —
 * action feedback carries it too — so a client computes the age
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
 * What a busy refusal tells the caller: what is already running. A refusal that
 * only says "busy" forces the caller to guess whether to wait or to give up.
 */
export const busyDetails = z.object({
  running: job,
})
export type BusyDetails = z.infer<typeof busyDetails>

/**
 * What a `publisher_busy` refusal tells the caller.
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
 * What a `job_queue_full` refusal tells the caller.
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
 * **`app_user` is what a client-app caller writes now, and `end_user` stays**
 * identity spaces. The seam this comment used to describe — two names for
 * two ways into one merged pool — is settled: the two identity spaces are
 * separate tables again, and `app_user` is a row in `app_users`, belonging to
 * exactly one app. `end_user` is kept for the same reason `auditActor.kind`
 * keeps it: a job run is history, and every row written before the cut carries
 * it. Removing the member would make the whole trail unparseable to a client
 * that validates, which is the one thing a history shape must never do.
 */
export const jobActor = z.object({
  kind: z.enum(['developer', 'end_user', 'app_user', 'server_key']).meta({
    description: 'What the caller was acting as: a `developer` in the console, an `app_user` of one app, or a `server_key` used by server-side code. A bridge invokes nothing, so it is deliberately not a case here. `end_user` appears only on runs recorded before app users replaced the organisation-wide user pool — it is kept so a history page can still render them, and nothing writes it any more.',
  }),
  id: z.uuid().meta({
    description: 'The id of the Fleetless user, app user or server key that invoked the run.',
  }),
  /**
   * The email for a person, the key's `name` for a server key. A display
   * snapshot taken at invoke time: renaming a key afterwards does not rewrite
   * history, which is the point of storing it rather than joining.
   */
  label: z.string().min(1).max(200).meta({
    description: 'A display name taken at invoke time — the email for a Fleetless user or an app user, the key\'s own name for a server key. Storing it rather than joining is the point: renaming a key afterwards does not rewrite history.',
  }),
})
export type JobActor = z.infer<typeof jobActor>

export const jobRunKind = z.enum(['action', 'service'])
export type JobRunKind = z.infer<typeof jobRunKind>

/**
 * One durable record of one invocation. One row per run, never one per event:
 * the per-event timeline's write rate
 * is set by the bridge, and a throttled log that cannot say it was throttled is
 * an instrument that cannot say what it does not know. The live timeline is
 * delivered in full by realtime, for as long as somebody is watching.
 */
export const jobRun = z.object({
  id: z.uuid().meta({
    description: 'The run\'s id, which is the same id the invocation was answered with — so a caller that kept a job id can find its durable record here later.',
  }),
  robot_id: z.uuid().meta({ description: 'The robot the run happened on.' }),
  slug: slug.meta({
    description: 'The action or service that was invoked, as the published configuration exposed it at the time.',
  }),
  kind: jobRunKind.meta({
    description: 'Whether the slug was an `action` or a `service`.',
  }),
  state: jobState.meta({
    description: 'How the run ended, or `running` while it is still going. `lost` means the bridge restarted mid-run and the outcome is unknowable rather than unknown.',
  }),
  started_at: z.iso.datetime().meta({
    description: 'When the run started, as an ISO 8601 timestamp. Runs are listed and filtered by this instant.',
  }),
  ended_at: z.iso.datetime().nullable().meta({
    description: 'When the run finished, as an ISO 8601 timestamp. `null` while it is still `running` — a run has an end only once it has one.',
  }),
  duration_ms: z.number().int().nonnegative().nullable().meta({
    description: 'How long the run took, in milliseconds. `null` while it is still `running`, never `0` standing in for "nothing so far".',
  }),
  result: z.unknown().nullable().meta({
    description: 'What the action or service returned once it succeeded, shaped by ROS itself. `null` otherwise.',
  }),
  error: z
    .object({
      code: z.string().min(1).meta({
        description: 'A machine-readable code for the failure, such as `job_queue_full`, where one exists for it.',
      }),
      message: z.string().min(1).meta({
        description: 'A human-readable sentence saying what went wrong.',
      }),
      details: z.unknown().optional().meta({
        description: 'The structured payload belonging to `code`, for the codes that document one. Absent for a failure with nothing structured to add.',
      }),
    })
    .nullable()
    .meta({
      description: 'Why the run failed — a `message`, a `code` where one exists, and the structured `details` some codes carry. `null` unless it failed.',
    }),
  actor: jobActor.meta({
    description: 'Who invoked the run, and what they were acting as at the time.',
  }),
  /**
   * **Durable, unlike `job.seq`.** That one is a per-process counter that
   * restarts with the cloud; this is a postgres `bigserial` and is the cursor
   * `before_seq` walks.
   */
  seq: z.number().int().positive().meta({
    description: 'The durable cursor this history is ordered and paged by. Unlike `job.seq` it does not restart when the cloud does; it is the value a caller sends back as `before_seq`.',
  }),
  progress: z.number().min(0).max(1).nullable().meta({
    description: 'How far a still-running run has got, as a fraction from `0` to `1`, read live from the in-memory registry. `null` means **not known right now** — after a cloud restart, before the bridge reconnects — and never a `0` standing in for \"no progress yet\".',
  }),
  feedback: z.unknown().nullable().meta({
    description: 'The most recent action feedback for a run that is still running, shaped by the ROS action. Live-only, so it is `null` for every settled run and whenever the registry has nothing.',
  }),
})
export type JobRun = z.infer<typeof jobRun>

export const jobRunQuery = z
  .object({
    before_seq: wireSeqCursor.optional().meta({
      description: 'Return only runs with a `seq` below this value — the next, older page. Send back the `next_cursor` of the previous response rather than computing one.',
    }),
    limit: z
      .union([z.string().regex(/^\d{1,4}$/), z.number().int()])
      .transform((v) => Number(v))
      .pipe(z.number().int().positive().max(JOB_RUN_PAGE_MAX))
      .optional()
      .meta({
        description: 'How many runs to return, from `1` to `200`. Absent means `100`. It arrives on the query string, so a numeric string and a number are both accepted.',
      }),
    robot_id: z.uuid().optional().meta({
      description: 'Only runs on this robot. Absent means every robot in the organisation.',
    }),
    slug: slug.optional().meta({
      description: 'Only runs of this action or service.',
    }),
    state: jobState.optional().meta({
      description: 'Only runs in this state — `running`, `succeeded`, `failed`, `cancelled` or `lost`.',
    }),
    kind: jobRunKind.optional().meta({
      description: 'Only `action` runs, or only `service` runs.',
    }),
    from_ms: wireTimestampMs.optional().meta({
      description: 'Only runs that started at or after this unix timestamp in milliseconds. Together with `to_ms` the window is half-open, `[from, to)`, so adjacent windows tile without counting a run twice.',
    }),
    to_ms: wireTimestampMs.optional().meta({
      description: 'Only runs that started **before** this unix timestamp in milliseconds. The window is half-open, so a run starting exactly on `to_ms` belongs to the next one.',
    }),
  })
  .strict()
export type JobRunQuery = z.infer<typeof jobRunQuery>

export const jobRunListResponse = z.object({
  runs: z.array(jobRun).meta({
    description: 'This page of runs, newest first by `seq`. Empty means the filter matched nothing, not that the history is gone.',
  }),
  /**
   * The `seq` a caller sends as `before_seq` to keep reading — or `null` when
   * there is nothing further. **`null` means the end, and that is a promise
   * rather than an observation.** A caller who instead compares `runs.length`
   * against `limit` is wrong the moment a filter makes a page thin.
   */
  next_cursor: z.number().int().positive().nullable().meta({
    description: 'The `seq` to send as `before_seq` to keep reading, or `null` when there is nothing further. **`null` is a promise, not an observation** — a caller who instead compares the page length against `limit` is wrong the moment a filter makes a page thin.',
  }),
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
