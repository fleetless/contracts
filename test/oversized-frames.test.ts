// SPDX-License-Identifier: Apache-2.0
/**
 * fleetless/fleetless#1222: no bridge text frame over `BRIDGE_FRAME_MAX_BYTES`.
 * The limit, the `datapoint_dropped` frame, `result_omitted` on the job
 * shapes, `rosGraph.omitted`, the datapoint health kind and `too_large`, and
 * the validation code.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  BRIDGE_FRAME_MAX_BYTES,
  ERROR_CODES,
  RESOURCE_HEALTH_KINDS,
  RESOURCE_HEALTH_STATES,
  SNAPSHOT_MAX_BYTES,
  bridgeDatapointDropped,
  bridgeIntrospect,
  bridgeJobStatus,
  bridgeJobUpdate,
  job,
  jobEvent,
  jobRun,
  resourceHealthCleared,
  resourceHealthEvent,
  resourceHealthState,
  resultOmitted,
  rosGraph,
  serviceCallResponse,
} from '../src/index.js'
import { BRIDGE_SENT_SCHEMAS, exportedSchemas, schemaIo } from '../scripts/export-schemas.js'

const ROBOT = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'
const omitted = { reason: 'too_large', bytes: 3_145_728, limit_bytes: BRIDGE_FRAME_MAX_BYTES }

describe('BRIDGE_FRAME_MAX_BYTES', () => {
  it('is 1.5 MiB, its own constant beside SNAPSHOT_MAX_BYTES', () => {
    expect(BRIDGE_FRAME_MAX_BYTES).toBe(1_572_864)
    expect(BRIDGE_FRAME_MAX_BYTES).toBe(SNAPSHOT_MAX_BYTES)
  })

  it('is exported into constants.json for the bridge', () => {
    const constants = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(constants.BRIDGE_FRAME_MAX_BYTES).toBe(BRIDGE_FRAME_MAX_BYTES)
  })
})

describe('datapoint_dropped', () => {
  const frame = {
    type: 'datapoint_dropped',
    slug: 'map',
    reason: 'too_large',
    bytes: 10_485_760,
    limit_bytes: BRIDGE_FRAME_MAX_BYTES,
    timestamp_ms: 1_795_000_000_000,
  }

  it('parses the frame the bridge sends', () => {
    expect(bridgeDatapointDropped.parse(frame)).toEqual(frame)
  })

  it('refuses an unknown reason, a zero size and a missing capture time', () => {
    expect(bridgeDatapointDropped.safeParse({ ...frame, reason: 'too_fast' }).success).toBe(false)
    expect(bridgeDatapointDropped.safeParse({ ...frame, bytes: 0 }).success).toBe(false)
    expect(bridgeDatapointDropped.safeParse({ ...frame, limit_bytes: 0 }).success).toBe(false)
    const { timestamp_ms: _dropped, ...withoutTime } = frame
    expect(bridgeDatapointDropped.safeParse(withoutTime).success).toBe(false)
  })

  it('is registered for export as a bridge-sent frame, in both renderings', () => {
    expect(Object.keys(exportedSchemas)).toContain('bridge-datapoint-dropped')
    expect(BRIDGE_SENT_SCHEMAS).toContain('bridge-datapoint-dropped')
    expect(schemaIo('bridge-datapoint-dropped')).toBe('input')
    for (const dir of ['schema', 'schema-outgoing']) {
      expect(existsSync(join(import.meta.dirname, '..', 'artifacts', dir, 'bridge-datapoint-dropped.schema.json'))).toBe(true)
    }
  })
})

describe('result_omitted', () => {
  const update = {
    type: 'job_update',
    job_id: JOB,
    slug: 'build_map',
    state: 'succeeded',
    origin: 'fleetless',
    goal_id: 'goal-1',
    feedback: null,
    progress: null,
    result: null,
    error: null,
    timestamp_ms: 1_795_000_000_000,
  }
  const entry = { job_id: JOB, state: 'succeeded', feedback: null, progress: null, result: null, error: null }

  it('rides on job_update and job_status entries, present or absent', () => {
    expect(bridgeJobUpdate.parse({ ...update, result_omitted: omitted }).result_omitted).toEqual(omitted)
    expect(bridgeJobUpdate.parse(update).result_omitted).toBeUndefined()
    const status = { type: 'job_status', request_id: 'q1', jobs: [{ ...entry, result_omitted: omitted }, entry], unknown_job_ids: [] }
    const parsed = bridgeJobStatus.parse(status)
    expect(parsed.jobs[0]!.result_omitted).toEqual(omitted)
    expect(parsed.jobs[1]!.result_omitted).toBeUndefined()
  })

  it('keeps the state: a failed job may carry it beside its error', () => {
    const failed = { ...update, state: 'failed', error: { code: 'goal_aborted', message: 'Aborted.' }, result_omitted: omitted }
    expect(bridgeJobUpdate.safeParse(failed).success).toBe(true)
  })

  it('refuses a malformed omission', () => {
    expect(resultOmitted.safeParse({ ...omitted, reason: 'other' }).success).toBe(false)
    expect(resultOmitted.safeParse({ ...omitted, bytes: -1 }).success).toBe(false)
    expect(bridgeJobUpdate.safeParse({ ...update, result_omitted: { reason: 'too_large' } }).success).toBe(false)
  })

  it('reaches job, the realtime job event, the run history and a service call answer', () => {
    const theJob = {
      id: JOB,
      robot_id: ROBOT,
      slug: 'build_map',
      state: 'succeeded',
      origin: 'fleetless',
      started_at: '2026-11-25T10:00:00.000Z',
      updated_at: '2026-11-25T10:00:05.000Z',
      seq: 1,
      result: null,
      result_omitted: omitted,
      error: null,
    }
    expect(job.parse(theJob).result_omitted).toEqual(omitted)
    const { result_omitted: _none, ...withoutOmission } = theJob
    expect(job.parse(withoutOmission).result_omitted).toBeUndefined()
    const event = { type: 'job', robot_id: ROBOT, slug: 'build_map', job: theJob, feedback: null, progress: null, result_omitted: omitted, timestamp_ms: 1 }
    expect(jobEvent.parse(event).result_omitted).toEqual(omitted)
    const run = {
      id: JOB,
      robot_id: ROBOT,
      slug: 'build_map',
      kind: 'action',
      state: 'succeeded',
      started_at: '2026-11-25T10:00:00.000Z',
      ended_at: '2026-11-25T10:00:05.000Z',
      duration_ms: 5000,
      result: null,
      result_omitted: omitted,
      error: null,
      actor: { kind: 'developer', id: ROBOT, label: 'dev@example.com', name: null },
      seq: 1,
      progress: null,
      feedback: null,
    }
    expect(jobRun.parse(run).result_omitted).toEqual(omitted)
    expect(serviceCallResponse.parse({ result: null, result_omitted: omitted }).result_omitted).toEqual(omitted)
    expect(serviceCallResponse.parse({ result: { ok: true } }).result_omitted).toBeUndefined()
  })

  it('is stripped, not refused, by an 18.0.0-shaped receiver (an older cloud)', () => {
    // The 18.0.0 shape of bridgeJobUpdate is this one without the key; a
    // plain z.object strips what it does not know.
    const older = bridgeJobUpdate.omit({ result_omitted: true })
    const parsed = older.parse({ ...update, result_omitted: omitted })
    expect(parsed).not.toHaveProperty('result_omitted')
  })
})

describe('rosGraph.omitted', () => {
  const graph = { topics: [], services: [], actions: [], captured_at_ms: 1 }

  it('is optional and counts per list', () => {
    expect(rosGraph.parse(graph).omitted).toBeUndefined()
    const cut = { ...graph, omitted: { topics: 59_000, services: 0, actions: 3 } }
    expect(rosGraph.parse(cut).omitted).toEqual(cut.omitted)
    expect(bridgeIntrospect.parse({ type: 'introspect', request_id: 'r1', graph: cut }).graph.omitted).toEqual(cut.omitted)
  })

  it('refuses a negative or a partial count', () => {
    expect(rosGraph.safeParse({ ...graph, omitted: { topics: -1, services: 0, actions: 0 } }).success).toBe(false)
    expect(rosGraph.safeParse({ ...graph, omitted: { topics: 1 } }).success).toBe(false)
  })

  it('is stripped by an 18.0.0-shaped receiver', () => {
    const older = rosGraph.omit({ omitted: true })
    expect(older.parse({ ...graph, omitted: { topics: 1, services: 0, actions: 0 } })).not.toHaveProperty('omitted')
  })
})

describe('datapoint health', () => {
  const entry = {
    robot_id: ROBOT,
    kind: 'datapoint' as const,
    ref: 'map',
    facet: 'source' as const,
    state: 'too_large' as const,
    reason: '10.0 MiB over the 1.5 MiB limit',
    changed_at_ms: 1,
  }

  it('is a second kind, declared once, and too_large a state', () => {
    expect(RESOURCE_HEALTH_KINDS).toEqual(['camera', 'datapoint'])
    expect(RESOURCE_HEALTH_STATES).toContain('too_large')
  })

  it('parses on the snapshot, the push and the clearing', () => {
    expect(resourceHealthState.safeParse(entry).success).toBe(true)
    expect(resourceHealthEvent.safeParse({ type: 'resource_health', ...entry }).success).toBe(true)
    const { state: _s, reason: _r, changed_at_ms: _c, ...ids } = entry
    expect(resourceHealthCleared.safeParse({ type: 'resource_health_cleared', ...ids, cleared_at_ms: 2 }).success).toBe(true)
  })

  it('refuses a kind nobody declared', () => {
    expect(resourceHealthState.safeParse({ ...entry, kind: 'publisher' }).success).toBe(false)
  })

  it('renders the one enum in both standalone artifacts', () => {
    for (const name of ['resource-health-state', 'resource-health-event']) {
      const schema = z.toJSONSchema(exportedSchemas[name as keyof typeof exportedSchemas] as z.ZodType, { io: schemaIo(name) }) as unknown as {
        properties: { kind: { enum: string[] } }
      }
      expect(schema.properties.kind.enum).toEqual(['camera', 'datapoint'])
    }
  })
})

describe('datapoint_large_message', () => {
  it('is in the shared vocabulary', () => {
    expect(ERROR_CODES).toContain('datapoint_large_message')
  })
})
