import { describe, it, expect } from 'vitest'
import { jobRun, jobRunQuery, jobRunListResponse, jobRunSummaryQuery, jobRunSummary, JOB_RUN_PAGE_MAX } from '../src/index.js'

const RUNNING = {
  id: '11111111-1111-4111-8111-111111111111',
  robot_id: '22222222-2222-4222-8222-222222222222',
  slug: 'dock',
  kind: 'action',
  state: 'running',
  started_at: '2026-08-20T14:21:49.000Z',
  ended_at: null,
  duration_ms: null,
  result: null,
  error: null,
  actor: { kind: 'developer', id: '33333333-3333-4333-8333-333333333333', label: 'a.kern@example.com' },
  seq: 1,
  progress: 0.62,
  feedback: 'approaching dock, 1.4 m',
}

describe('jobRun', () => {
  it('accepts a running row with no end and no duration', () => {
    expect(jobRun.parse(RUNNING).ended_at).toBeNull()
  })

  it('accepts a settled row with an end and a duration', () => {
    const settled = { ...RUNNING, state: 'succeeded', ended_at: '2026-08-20T14:23:49.000Z', duration_ms: 120_000, progress: null, feedback: null }
    expect(jobRun.parse(settled).duration_ms).toBe(120_000)
  })

  // The whole reason jobActor is not auditActor.
  it('refuses `bridge` as an actor kind — a bridge invokes nothing', () => {
    const forged = { ...RUNNING, actor: { ...RUNNING.actor, kind: 'bridge' } }
    expect(jobRun.safeParse(forged).success).toBe(false)
  })

  it('refuses a progress above 1 — progress is a fraction, not a percentage', () => {
    expect(jobRun.safeParse({ ...RUNNING, progress: 62 }).success).toBe(false)
  })
})

describe('jobRunQuery', () => {
  // The query string is the wire: every value arrives as a string.
  it('coerces the numeric filters a query string actually carries', () => {
    const parsed = jobRunQuery.parse({ before_seq: '412', limit: '50', from_ms: '1755690000000' })
    expect(parsed).toMatchObject({ before_seq: 412, limit: 50, from_ms: 1755690000000 })
  })

  it('refuses a cursor JavaScript cannot represent, rather than handing Postgres an out-of-range bigint', () => {
    // The regex admits 19 digits and `Number()` renders those as 1e19, which
    // `Number.isInteger` calls an integer. What refuses it is `.int()` bounding
    // the SAFE-integer range — pinned here because that is not obvious from
    // reading `.int().positive()`, and loosening it would be a silent 500.
    expect(jobRunQuery.safeParse({ before_seq: '9999999999999999999' }).success).toBe(false)
    expect(jobRunQuery.safeParse({ before_seq: String(Number.MAX_SAFE_INTEGER) }).success).toBe(true)
  })

  it(`refuses a limit above ${JOB_RUN_PAGE_MAX}`, () => {
    expect(jobRunQuery.safeParse({ limit: String(JOB_RUN_PAGE_MAX + 1) }).success).toBe(false)
  })

  // Borrowed from auditTimestampMs, not invented a second time.
  it('refuses a timestamp past year 9999', () => {
    expect(jobRunQuery.safeParse({ from_ms: 253402300800000 }).success).toBe(false)
  })

  it('refuses an unknown filter rather than ignoring it', () => {
    expect(jobRunQuery.safeParse({ nonsense: 'x' }).success).toBe(false)
  })
})

describe('jobRunListResponse', () => {
  it('carries a nullable cursor', () => {
    expect(jobRunListResponse.parse({ runs: [], next_cursor: null }).next_cursor).toBeNull()
  })
})

describe('jobRunSummary', () => {
  it('echoes the window boundary the caller named', () => {
    const parsed = jobRunSummary.parse({ running: 2, started: 14, failed: 1, since_ms: 1755690000000 })
    expect(parsed.since_ms).toBe(1755690000000)
  })
})

describe('jobRunSummaryQuery', () => {
  it('accepts since_ms as the numeric string a query string carries', () => {
    expect(jobRunSummaryQuery.parse({ since_ms: '1755690000000' }).since_ms).toBe(1755690000000)
  })

  /**
   * The one property this schema exists for. A cloud that defaulted the
   * window would show a developer in another timezone a number they cannot
   * reproduce — so the absence of a default is the contract, and a test that
   * would still pass with `.default(startOfToday)` bolted on would not be
   * testing it.
   */
  it('requires since_ms, because a summary over an unnamed window is a number nobody can reproduce', () => {
    expect(jobRunSummaryQuery.safeParse({}).success).toBe(false)
  })

  it('refuses an unknown parameter rather than summarising something else', () => {
    expect(jobRunSummaryQuery.safeParse({ since_ms: 1000, robot_id: '00000000-0000-4000-8000-000000000000' }).success).toBe(false)
  })
})
