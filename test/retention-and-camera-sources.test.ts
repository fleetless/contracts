// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  cameraConfig,
  cameraSource,
  historyBucketsResponse,
  historyQuery,
  historySamplesResponse,
  orgQuotas,
  orgQuotaUsage,
  orgQuotaUsageCounts,
  ERROR_CODES,
} from '../src/index.js'

const ROS = { kind: 'ros', topic: '/image_raw', type: 'sensor_msgs/msg/Image' } as const
const CAM = { source: ROS, width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5 }

describe('camera sources', () => {
  it('makes an impossible camera unrepresentable, not merely invalid', () => {
    // A discriminated union: no rule to forget, since the shapes cannot mix.
    expect(cameraSource.safeParse({ kind: 'rtsp', topic: '/image_raw' }).success).toBe(false)
    expect(cameraSource.safeParse({ kind: 'ros', url: 'rtsp://cam.local/s' }).success).toBe(false)
    expect(cameraSource.safeParse({ kind: 'v4l2', url: 'http://cam/s.mjpg' }).success).toBe(false)
    expect(cameraSource.safeParse({ kind: 'ftp', url: 'ftp://cam/s' }).success).toBe(false)
  })

  it('binds all four camera sources the platform names', () => {
    for (const source of [
      ROS,
      { kind: 'rtsp', url: 'rtsp://cam.local/stream' },
      { kind: 'mjpeg', url: 'http://cam.local/stream.mjpg' },
      { kind: 'v4l2', device: '/dev/video0' },
    ]) {
      expect(cameraConfig.safeParse({ ...CAM, source }).success).toBe(true)
    }
  })

  it('leaves RTSP transport unset rather than default it — absent is not a second spelling of tcp', () => {
    const parsed = cameraSource.parse({ kind: 'rtsp', url: 'rtsp://cam.local/s' })
    expect(parsed).not.toHaveProperty('transport')
    expect(cameraSource.parse({ kind: 'rtsp', url: 'rtsp://cam.local/s', transport: 'udp' })).toMatchObject({ transport: 'udp' })
  })

  it('accepts a URL carrying userinfo — it is one of the two places credentials may live', () => {
    // A developer may do this; neither schema nor cloud refuses it — see
    // `credentials_in_url` and `credentials_in_url_ignored`. The explicit
    // `credentials` block now always wins, so there is nothing left to warn about.
    expect(cameraSource.safeParse({ kind: 'rtsp', url: 'rtsp://u:p@cam.local/s' }).success).toBe(true)
  })

  it('refuses a URL scheme that would make a camera a file reader on the robot', () => {
    // The bridge opens these via libraries that honour file: and ftp:, so an
    // unconstrained URL turns a config doc into an arbitrary local-file read —
    // and two failure codes into an existence oracle. ROS-pure exposure
    // forbids this class; it came back by omission.
    for (const url of ['file:///etc/hostname', 'ftp://host/x', 'http://cam/s.mjpg']) {
      expect(cameraSource.safeParse({ kind: 'rtsp', url }).success).toBe(false)
    }
    for (const url of ['file:///etc/hostname', 'ftp://host/x', 'rtsp://cam/s']) {
      expect(cameraSource.safeParse({ kind: 'mjpeg', url }).success).toBe(false)
    }
    expect(cameraSource.safeParse({ kind: 'rtsp', url: 'rtsps://cam/s' }).success).toBe(true)
    expect(cameraSource.safeParse({ kind: 'mjpeg', url: 'https://cam/s.mjpg' }).success).toBe(true)
  })

  it('carries credentials inline, in the document — there is no named store any more', () => {
    // 2026-09 redesign: no credential store. A camera's password lives in
    // `source.credentials`, in the document, in every published version. See
    // `cameraCredentials`'s doc comment for the recorded objection and where
    // the real bound lives — the publish audit event and org event stream
    // must not carry the document body (covered in cloud/, not here).
    const parsed = cameraSource.parse({
      kind: 'mjpeg', url: 'http://cam/s.mjpg', credentials: { username: 'admin', password: 'hunter2' },
    })
    expect(parsed).toMatchObject({ credentials: { username: 'admin', password: 'hunter2' } })
    expect(cameraSource.safeParse({ kind: 'mjpeg', url: 'http://cam/s.mjpg', credentials_ref: 'site-nvr' }).success).toBe(false)
  })
})

describe('H.264 passthrough (fleetless/fleetless#1117)', () => {
  const RTSP = { kind: 'rtsp', url: 'rtsp://cam.local/s' } as const

  it('accepts passthrough on an RTSP source, and leaves it unset when nobody wrote it', () => {
    expect(cameraSource.parse({ ...RTSP, passthrough: true })).toMatchObject({ passthrough: true })
    expect(cameraSource.parse({ ...RTSP, passthrough: false })).toMatchObject({ passthrough: false })
    // Absent is not a second spelling of `false`: an existing document stays
    // byte-identical through a parse, and the bridge reads absent as off.
    expect(cameraSource.parse(RTSP)).not.toHaveProperty('passthrough')
    expect(cameraConfig.safeParse({ ...CAM, source: { ...RTSP, passthrough: true } }).success).toBe(true)
  })

  it('refuses a passthrough that is not a boolean', () => {
    for (const passthrough of ['true', 1, null, 'h264']) {
      expect(cameraSource.safeParse({ ...RTSP, passthrough }).success).toBe(false)
    }
  })

  it('refuses passthrough on every other source kind', () => {
    // A ROS topic is passed through by what it carries, not by a switch; MJPEG
    // and V4L2 are never passed through.
    for (const source of [
      { ...ROS, passthrough: true },
      { kind: 'mjpeg', url: 'http://cam.local/stream.mjpg', passthrough: true },
      { kind: 'v4l2', device: '/dev/video0', passthrough: true },
    ]) {
      expect(cameraSource.safeParse(source).success).toBe(false)
    }
  })

  it('accepts the third ROS type by its name', () => {
    const parsed = cameraSource.safeParse({ kind: 'ros', topic: '/camera/h264', type: 'foxglove_msgs/msg/CompressedVideo' })
    expect(parsed.success).toBe(true)
  })

  it('says in the descriptions what passthrough changes', () => {
    const schema = z.toJSONSchema(cameraConfig, { io: 'input' }) as any
    const branches: any[] = schema.properties.source.oneOf ?? schema.properties.source.anyOf
    const branch = (kind: string) => branches.find((b) => b.properties.kind.const === kind)

    const passthrough: string = branch('rtsp').properties.passthrough.description
    // What must match (the size), what stops applying (fps, bitrate), and
    // the two things the stream itself has to bring.
    for (const word of ['`width`', '`height`', '`fps`', '`bitrate_kbps`', 'H.264', 'B-frames', 'keyframe']) {
      expect(passthrough, word).toContain(word)
    }

    const rosType: string = branch('ros').properties.type.description
    expect(rosType).toContain('foxglove_msgs/msg/CompressedVideo')
    expect(rosType).toContain('h264')

    for (const key of ['fps', 'bitrate_kbps']) {
      expect(schema.properties[key].description, key).toContain('passthrough')
    }
  })
})

describe('retention and history', () => {
  it('accepts a range both ways a caller thinks about time', () => {
    expect(historyQuery.safeParse({ from: 'now-30s' }).success).toBe(true)
    expect(historyQuery.safeParse({ from: '1786453230705', to: '1786453290705' }).success).toBe(true)
  })

  it('keeps samples and buckets distinguishable by type, not by inspection', () => {
    const samples = historySamplesResponse.parse({
      slug: 'battery', kind: 'samples',
      samples: [{ timestamp_ms: 1786453230705, value: 0.91 }], truncated: false, truncated_by: null,
    })
    const buckets = historyBucketsResponse.parse({
      slug: 'battery', kind: 'buckets', window_ms: 10_000, agg: 'avg',
      buckets: [{ bucket_start_ms: 1786453230000, value: 0.91, sample_count: 7 }],
    })
    expect(samples.kind).not.toBe(buckets.kind)
    // A client branches on `kind`; it never has to guess from the payload.
    expect(historySamplesResponse.safeParse(buckets).success).toBe(false)
    expect(historyBucketsResponse.safeParse(samples).success).toBe(false)
  })

  it('separates an empty bucket from a bucket averaging zero', () => {
    const parsed = historyBucketsResponse.parse({
      slug: 'battery', kind: 'buckets', window_ms: 1000, agg: 'avg',
      buckets: [
        { bucket_start_ms: 0, value: null, sample_count: 0 },
        { bucket_start_ms: 1000, value: 0, sample_count: 4 },
      ],
    })
    // Two facts, two representations. Collapsing them has cost this package
    // real time before.
    expect(parsed.buckets[0]!.sample_count).toBe(0)
    expect(parsed.buckets[1]!.value).toBe(0)
    expect(parsed.buckets[1]!.sample_count).toBeGreaterThan(0)
  })

  it('says when it truncated, rather than looking like a quiet period', () => {
    expect(historySamplesResponse.parse({ slug: 'battery', kind: 'samples', samples: [], truncated: true, truncated_by: 'limit' }).truncated).toBe(true)

    // The two causes have different remedies, so a boolean alone sends a
    // caller who hit the byte budget to raise a limit that will not help.
    const byBytes = historySamplesResponse.parse(
      { slug: 'battery', kind: 'samples', samples: [], truncated: true, truncated_by: 'bytes' })
    expect(byBytes.truncated_by).toBe('bytes')
    expect(historySamplesResponse.safeParse(
      { slug: 'battery', kind: 'samples', samples: [], truncated: true }).success).toBe(false)
  })

  it('names the codes a history caller must be able to branch on', () => {
    for (const code of ['not_recorded', 'not_aggregatable', 'quota_exceeded'] as const) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})

describe('quotas', () => {
  it('shows a limit beside its usage — a limit alone tells nobody where they stand', () => {
    const quotas = {
      max_robots: 50, max_apps: 10, max_end_users: 1000,
      max_retention_bytes: 10_000_000_000, max_retention_writes_per_minute: 60_000,
      max_realtime_connections: 500,
      collection_records: 250_000, collection_bytes: 10_000_000_000,
    }
    const parsed = orgQuotaUsage.parse({ quotas, usage: { max_robots: 3, max_retention_bytes: 12_345 } })
    expect(parsed.usage.max_robots).toBe(3)
    expect(parsed.quotas.max_robots).toBe(50)
  })

  it('carries the collection limits, null when the contract sets them, and their usage with the history size beside it', () => {
    const quotas = {
      max_robots: 50, max_apps: 10, max_end_users: 1000,
      max_retention_bytes: 10_000_000_000, max_retention_writes_per_minute: 60_000,
      max_realtime_connections: 500,
      collection_records: null, collection_bytes: null,
    }
    const usage = { collection_records: 1_204, collection_bytes: 3_400_000, collection_history_bytes: 91_000_000 }
    expect(orgQuotaUsage.parse({ quotas, usage })).toEqual({ quotas, usage })
    // Not measured is absent, never zero: a usage without the three keys is still a usage.
    expect(orgQuotaUsageCounts.parse({})).toEqual({})
    // A limit of zero would forbid everything, so it is no limit; a usage of zero is the day-one answer.
    expect(orgQuotas.safeParse({ ...quotas, collection_records: 0 }).success).toBe(false)
    expect(orgQuotas.safeParse({ ...quotas, collection_bytes: 0 }).success).toBe(false)
    expect(orgQuotaUsageCounts.safeParse({ collection_history_bytes: 0 }).success).toBe(true)
    expect(orgQuotaUsageCounts.safeParse({ collection_records: -1 }).success).toBe(false)
    expect(orgQuotaUsageCounts.safeParse({ collection_bytes: 1.5 }).success).toBe(false)
    // The limits are always stated (null = by contract), so an answer that leaves them out is a bug of the sender.
    const { collection_records: _r, ...withoutRecords } = quotas
    expect(orgQuotas.safeParse(withoutRecords).success).toBe(false)
  })
})
