import { z } from 'zod'
import { slug } from './common.js'

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
  /** Present once the job succeeded; shape is the ROS result's. */
  result: z.unknown().nullable(),
  /** Present on `failed`; a human message, plus a code where one exists. */
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
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
