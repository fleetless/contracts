/**
 * W6b — addressing: everything the platform could not name.
 *
 * Written **with** the contracts delta, not after it. W6a shipped four new
 * shapes with zero contract tests because a change to an existing shape
 * breaks the tests that cover it while a new shape breaks nothing — the note
 * at the top of `w6a.test.ts` says so, and this file is that note being acted
 * on rather than repeated.
 *
 * Each test below names the *confusion* it removes. That is the whole wave:
 * seven places where two different things shared one address, and the
 * platform resolved the ambiguity by picking one of them silently.
 */
import { describe, it, expect } from 'vitest'
import {
  activeJob,
  bridgeHello,
  cloudCancel,
  cloudInvoke,
  cloudCameraStart,
  cloudCameraStop,
  bridgeCameraState,
  DEFAULT_PATIENCE_MS,
  MAX_PATIENCE_MS,
  MIN_PATIENCE_MS,
} from '../src/protocol.js'
import { invokeRequest, liveSessionResponse, cancelRequest, releaseLiveQuery, robotJobsResponse } from '../src/rest.js'
import { clientCancel, clientInvoke } from '../src/realtime.js'
import { jobQueueFullDetails, job } from '../src/jobs.js'
import { auditEvent } from '../src/audit.js'
import { ERROR_CODES } from '../src/errors.js'

const UUID = '7e2b1a4c-3d5f-4a6b-8c9d-0e1f2a3b4c5d'
const UUID2 = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9'
const NOW = '2026-08-12T10:00:00.000Z'

describe('W6b error codes', () => {
  it('registers every code the wave introduced', () => {
    // The convention `w6a.test.ts` restored, applied on the way in this time
    // rather than by a reviewer on the way out.
    for (const code of ['job_queue_full', 'invalid_uuid']) {
      expect(ERROR_CODES).toContain(code)
    }
  })

  it('keeps a malformed id apart from a missing thing', () => {
    // One code for both made a typo indistinguishable from a deletion: a
    // client that built its URL wrong got a clean 404 and its developer went
    // looking for a robot they had never lost.
    expect(ERROR_CODES).toContain('not_found')
    expect(ERROR_CODES.indexOf('invalid_uuid')).not.toBe(ERROR_CODES.indexOf('not_found'))
  })
})

describe('W6b — naming a job', () => {
  it('lets a cancel say WHICH job, and still lets it say "whatever is running"', () => {
    // Both are real requests. An operator hitting stop means the second; a
    // client cancelling its own job means the first, and until now could not
    // say so — so a cancel arriving just after its own job ended stopped the
    // next caller's job on the same slug.
    expect(clientCancel.safeParse({
      type: 'cancel', request_id: 'r1', robot_id: UUID2, slug: 'drive-to', job_id: UUID,
    }).success).toBe(true)
    expect(clientCancel.safeParse({
      type: 'cancel', request_id: 'r1', robot_id: UUID2, slug: 'drive-to', job_id: null,
    }).success).toBe(true)
  })

  it('never lets a cancel omit the field, because absent and null would differ by author', () => {
    // `null` is a decision — "I mean whatever is running". An absent field is
    // whatever the reader assumes, and two readers assume differently.
    expect(clientCancel.safeParse({
      type: 'cancel', request_id: 'r1', robot_id: UUID2, slug: 'drive-to',
    }).success).toBe(false)
    expect(cloudCancel.safeParse({ type: 'cancel', slug: 'drive-to' }).success).toBe(false)
  })

  it('keeps the slug required on a cancel even when an id is given', () => {
    // The bridge finds the tracker by slug; an id alone would make it search.
    expect(cloudCancel.safeParse({ type: 'cancel', job_id: UUID }).success).toBe(false)
    expect(cloudCancel.safeParse({ type: 'cancel', slug: 'drive-to', job_id: UUID }).success).toBe(true)
  })

  it('refuses a job id that is not a uuid, rather than passing the string through', () => {
    // This is the contract half of `invalid_uuid`: the wire will not carry a
    // shape the route is expected to refuse.
    expect(clientCancel.safeParse({
      type: 'cancel', request_id: 'r1', robot_id: UUID2, slug: 'drive-to', job_id: 'not-a-uuid',
    }).success).toBe(false)
  })
})

describe('W6b — naming what a robot is still doing', () => {
  it('reports a job with its slug and state, not only its id', () => {
    const entry = { job_id: UUID, slug: 'drive-to', state: 'running' }
    expect(activeJob.parse(entry)).toEqual(entry)
  })

  it('refuses an entry that names a job it cannot describe', () => {
    // A bare id was the old shape. A restarted cloud could ask "is this one
    // still alive?" about jobs it already knew, and nothing at all about a
    // job it never recorded — which is exactly the job a crash between
    // minting the id and writing the row leaves behind.
    expect(activeJob.safeParse({ job_id: UUID }).success).toBe(false)
    expect(activeJob.safeParse({ job_id: UUID, slug: 'drive-to' }).success).toBe(false)
    expect(activeJob.safeParse({ job_id: UUID, slug: 'drive-to', state: 'busy' }).success).toBe(false)
  })

  it('lets the bridge report a terminal state it is still holding', () => {
    // Not only `running`. A bridge that finished a job while the cloud was
    // down has the result in hand; publishing `lost` over it would destroy a
    // fact the robot was still able to state.
    for (const state of ['running', 'succeeded', 'failed', 'cancelled', 'lost']) {
      expect(activeJob.safeParse({ job_id: UUID, slug: 'drive-to', state }).success).toBe(true)
    }
  })

  it('keeps the empty list meaning "I have none", never "I did not say"', () => {
    const hello = { type: 'hello', protocol_version: 1, token: 'frt_x', bridge_version: '0.6.0' }
    expect(bridgeHello.parse(hello).active_jobs).toEqual([])
    expect(bridgeHello.parse({ ...hello, active_jobs: [] }).active_jobs).toEqual([])
  })

  it('has dropped the old name rather than accepting both', () => {
    // Two accepted spellings would have to be reconciled forever, and the
    // reconciliation would live in whichever consumer remembered to write it.
    const hello = { type: 'hello', protocol_version: 1, token: 'frt_x', bridge_version: '0.4.0' }
    const parsed = bridgeHello.parse({ ...hello, active_job_ids: [UUID] })
    expect(parsed.active_jobs).toEqual([])
    expect('active_job_ids' in parsed).toBe(false)
  })
})

describe('W6b — asking what a robot is doing without knowing what to ask', () => {
  it('lists the jobs a robot has, including ones no slug would find', () => {
    // The per-slug route needs the slug first, and W6b creates two kinds of
    // job nobody can name in advance: one adopted from a reconnecting bridge
    // that the cloud has no row for, and one left on a slug a configuration
    // change removed.
    const j = {
      id: UUID, robot_id: UUID2, slug: 'drive-to', state: 'running' as const,
      started_at: NOW, updated_at: NOW, result: null, error: null,
    }
    expect(robotJobsResponse.parse({ jobs: [j] }).jobs).toHaveLength(1)
  })

  it('answers an empty list for an idle robot, and refuses a null one', () => {
    // "Nothing is running" and "we did not look" are different facts.
    expect(robotJobsResponse.parse({ jobs: [] }).jobs).toEqual([])
    expect(robotJobsResponse.safeParse({ jobs: null }).success).toBe(false)
    expect(robotJobsResponse.safeParse({}).success).toBe(false)
  })
})

describe('W6b — naming how long a caller will wait', () => {
  it('defaults to what both sides already did independently', () => {
    // The cloud's commandTimeoutMs and the bridge's GOAL_ACCEPT_TIMEOUT_S
    // were both 15 s by two separate decisions. Picking that number as the
    // default is what makes this change add an option rather than change
    // anybody's behaviour.
    expect(DEFAULT_PATIENCE_MS).toBe(15_000)
  })

  it('lets a REST caller omit it, and a bridge frame never omit it', () => {
    // Absent at the edge means "I have no opinion". By the time the frame is
    // on the bridge socket somebody has decided, and the bridge must not be
    // picking a number the cloud is already counting against.
    expect(invokeRequest.parse({ params: {} }).patience_ms).toBeUndefined()
    expect(cloudInvoke.safeParse({
      type: 'invoke', job_id: UUID, slug: 'drive-to', params: {},
    }).success).toBe(false)
  })

  it('refuses a patience above the cap instead of clamping it', () => {
    // A caller who asked for ten minutes and was quietly given two would read
    // the timeout as the robot's failure. There is no rate limiting until W8,
    // so an unbounded wait is a way to pin the cloud's sockets open.
    expect(invokeRequest.safeParse({ params: {}, patience_ms: MAX_PATIENCE_MS }).success).toBe(true)
    expect(invokeRequest.safeParse({ params: {}, patience_ms: MAX_PATIENCE_MS + 1 }).success).toBe(false)
    expect(cloudInvoke.safeParse({
      type: 'invoke', job_id: UUID, slug: 'drive-to', params: {}, patience_ms: MAX_PATIENCE_MS + 1,
    }).success).toBe(false)
  })

  it('refuses a patience below the floor, because impatience reaches the robot', () => {
    // Omitting the field is how a caller says nothing. A number too small to
    // be satisfiable is different: measured in review, `patience_ms: 1` on an
    // action makes the bridge report `goal_timeout` and then issue a
    // CORRECTIVE CANCEL against a goal the server accepts a moment later — so
    // an unreachable deadline does not merely produce an error, it stops a
    // machine. Repeatable, with no rate limiting until W8.
    for (const bad of [0, -1, 1.5, 1, 999]) {
      expect(invokeRequest.safeParse({ params: {}, patience_ms: bad }).success).toBe(false)
    }
    expect(invokeRequest.safeParse({ params: {}, patience_ms: MIN_PATIENCE_MS }).success).toBe(true)
  })
})

describe('W6b — the same thing over both transports', () => {
  it('lets a REST cancel carry an id, and lets it carry nothing at all', () => {
    // The body is fully optional because `POST .../cancel` was bodyless before
    // this wave and every existing caller still sends nothing. W5's worst bug
    // was a bodyless POST being rejected outright, which took cancel, publish,
    // restore, key rotation and member removal down with it.
    expect(cancelRequest.parse({}).job_id).toBeUndefined()
    expect(cancelRequest.parse({ job_id: null }).job_id).toBeNull()
    expect(cancelRequest.parse({ job_id: UUID }).job_id).toBe(UUID)
    expect(cancelRequest.safeParse({ job_id: 'nope' }).success).toBe(false)
  })

  it('makes absent and null differ by transport, deliberately', () => {
    // Over REST an absent body IS how a pre-W6b caller says "cancel whatever
    // is running", so absent and null must mean the same thing. On the socket
    // the frame is assembled fresh by a client that has already been updated,
    // so `null` is a decision and an omission is a bug.
    expect(cancelRequest.safeParse({}).success).toBe(true)
    expect(clientCancel.safeParse({
      type: 'cancel', request_id: 'r1', robot_id: UUID2, slug: 'drive-to',
    }).success).toBe(false)
  })

  it('lets a socket caller state a patience, because parity is a rule', () => {
    // §11.1: what REST can do travels over this socket. The first version of
    // this delta gave `patience_ms` to the REST body only — and this project's
    // own SDK invokes exclusively over the realtime channel, so the field
    // would have been documented and unreachable for every SDK caller. W6a
    // shipped four such methods; this one was caught before it shipped.
    expect(clientInvoke.safeParse({
      type: 'invoke', request_id: 'r1', robot_id: UUID2, slug: 'drive-to',
      params: {}, patience_ms: 2000,
    }).success).toBe(true)
    expect(clientInvoke.parse({
      type: 'invoke', request_id: 'r1', robot_id: UUID2, slug: 'drive-to', params: {},
    }).patience_ms).toBeUndefined()
    expect(clientInvoke.safeParse({
      type: 'invoke', request_id: 'r1', robot_id: UUID2, slug: 'drive-to',
      params: {}, patience_ms: MAX_PATIENCE_MS + 1,
    }).success).toBe(false)
  })

  it('refuses a misspelled field instead of silently widening the request', () => {
    // Both shapes strip unknown keys by default, and stripping fails UNSAFE
    // here: the id disappears and what is left is the slug-wide cancel or the
    // identity-wide release — the most destructive reading of a request the
    // caller did not make. Measured in review: `{jobId: ...}` answered 200 and
    // stopped the job that was actually running; `?sessionid=` released both
    // holds and stranded the other tab.
    expect(cancelRequest.safeParse({ jobId: UUID }).success).toBe(false)
    expect(releaseLiveQuery.safeParse({ sessionid: UUID }).success).toBe(false)
    // The correct spellings still parse, and so does an empty body/query.
    expect(cancelRequest.safeParse({ job_id: UUID }).success).toBe(true)
    expect(cancelRequest.safeParse({}).success).toBe(true)
    expect(releaseLiveQuery.safeParse({ session_id: UUID }).success).toBe(true)
    expect(releaseLiveQuery.safeParse({}).success).toBe(true)
  })

  it('carries the session id in the query, where a closing tab can still send it', () => {
    // A query parameter, following `?force=true` on robot deletion — the
    // precedent for "a DELETE that needs one more fact". A body on a DELETE is
    // carried inconsistently, and this call runs from a tab that is closing.
    expect(releaseLiveQuery.parse({ session_id: UUID }).session_id).toBe(UUID)
    expect(releaseLiveQuery.parse({}).session_id).toBeUndefined()
    expect(releaseLiveQuery.safeParse({ session_id: 'nope' }).success).toBe(false)
  })
})

describe('W6b — naming a session', () => {
  it('gives every live hold its own id', () => {
    // Two tabs of one identity were one hold, so either tab's release stopped
    // the robot for both — and the surviving tab kept rendering, because a
    // LiveKit token is checked at join and never again. A frozen picture, not
    // an ended session.
    const parsed = liveSessionResponse.parse({
      session_id: UUID, url: 'ws://localhost:7880', room: 'r-1', token: 't', expires_at: NOW,
    })
    expect(parsed.session_id).toBe(UUID)
  })

  it('makes the id required, so no caller can be handed a hold it cannot release', () => {
    expect(liveSessionResponse.safeParse({
      url: 'ws://localhost:7880', room: 'r-1', token: 't', expires_at: NOW,
    }).success).toBe(false)
  })
})

describe('W6b — naming a publish attempt', () => {
  it('makes every camera command carry the id its answer will echo', () => {
    expect(cloudCameraStart.safeParse({
      type: 'camera_start', slug: 'front', url: 'ws://x', room: 'r-1', token: 't', request_id: 'cs-1',
    }).success).toBe(true)
    expect(cloudCameraStart.safeParse({
      type: 'camera_start', slug: 'front', url: 'ws://x', room: 'r-1', token: 't',
    }).success).toBe(false)
    expect(cloudCameraStop.safeParse({ type: 'camera_stop', slug: 'front', request_id: 'cs-2' }).success).toBe(true)
    expect(cloudCameraStop.safeParse({ type: 'camera_stop', slug: 'front' }).success).toBe(false)
  })

  it('lets an unsolicited health report answer no request', () => {
    // `null` here is not a gap. A `source` frame — the one that makes a wrong
    // password visible with nobody watching — answers nothing by definition,
    // and so does a `config_change` stop.
    const frame = {
      type: 'camera_state', slug: 'front', publishing: false, error: null,
      cause: 'source', observed_at_ms: 1786522606705, request_id: null,
    }
    expect(bridgeCameraState.parse(frame).request_id).toBeNull()
  })

  it('never omits the field, because absent would mean "unsolicited" to some readers and "old bridge" to others', () => {
    expect(bridgeCameraState.safeParse({
      type: 'camera_state', slug: 'front', publishing: false, error: null,
      cause: 'command', observed_at_ms: 1786522606705,
    }).success).toBe(false)
  })

  it('does NOT enforce the pairing rule, and says so out loud', () => {
    // "Non-null iff cause === 'command'" is a cross-field constraint. A zod
    // `.refine()` would hold at runtime and vanish from the generated JSON
    // Schema the bridge vendors — the cloud would then reject frames the
    // bridge had just validated as correct. That is the `.default()`-publishes
    // -as-`required` divergence pointing the other way, and this project has
    // paid for it four times.
    //
    // So the rule lives in the cloud's frame handler. This test exists to
    // make that a recorded decision rather than a gap someone finds later and
    // reports as a bug.
    expect(bridgeCameraState.safeParse({
      type: 'camera_state', slug: 'front', publishing: true, error: null,
      cause: 'source', observed_at_ms: 1786522606705, request_id: 'cs-9',
    }).success).toBe(true)
    expect(bridgeCameraState.safeParse({
      type: 'camera_state', slug: 'front', publishing: false, error: null,
      cause: 'command', observed_at_ms: 1786522606705, request_id: null,
    }).success).toBe(true)
  })
})

describe('W6b — bounding a queue, and ordering a log', () => {
  it('gives a full-queue refusal somewhere to actually put its numbers', () => {
    // It shipped with a documented {limit, queued} payload and nowhere to put
    // it: the bridge reports a full queue as a JOB error, and `job.error` was
    // {code, message} with no details — so the numbers were formatted into the
    // sentence and lost. The console then rendered an alert from a shape
    // nothing produced, and its test built that shape by hand.
    const withDetails = {
      id: UUID, robot_id: UUID2, slug: 'drive-to', state: 'failed' as const,
      started_at: NOW, updated_at: NOW, result: null,
      error: { code: 'job_queue_full', message: '200 jobs are already queued', details: { limit: 200, queued: 200 } },
    }
    const parsed = job.parse(withDetails)
    expect(jobQueueFullDetails.parse(parsed.error?.details)).toEqual({ limit: 200, queued: 200 })
    // Optional: most job errors have nothing structured to add.
    expect(job.safeParse({ ...withDetails, error: { code: 'failed', message: 'nope' } }).success).toBe(true)
  })

  it('makes a full-queue refusal say whether waiting would help', () => {
    // `limit` alone says how big the queue is and nothing about now; `queued`
    // alone cannot be read without the bound.
    const d = jobQueueFullDetails.parse({ limit: 16, queued: 16 })
    expect([d.limit, d.queued]).toEqual([16, 16])
    expect(jobQueueFullDetails.safeParse({ limit: 16 }).success).toBe(false)
    expect(jobQueueFullDetails.safeParse({ queued: 16 }).success).toBe(false)
    expect(jobQueueFullDetails.safeParse({ limit: 0, queued: 0 }).success).toBe(false)
  })

  it('gives the audit log a total order, because a timestamp is not one', () => {
    // Two events in the same millisecond sort arbitrarily — and arbitrarily
    // means differently on each query, so a reader paging "newest first" sees
    // one twice and the other never. A record that is present and invisible
    // is the one thing an audit log may not have.
    const base = {
      id: UUID, org_id: UUID2, at: NOW,
      actor: { kind: 'developer', id: UUID, label: 'andre@example.com' },
      action: 'config.published', target: null, details: null,
    }
    expect(auditEvent.parse({ ...base, seq: 1 }).seq).toBe(1)
    expect(auditEvent.safeParse(base).success).toBe(false)
    expect(auditEvent.safeParse({ ...base, seq: 0 }).success).toBe(false)
  })
})
