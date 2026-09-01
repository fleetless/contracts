import { describe, expect, it } from 'vitest'
import {
  cameraConfig,
  cameraSource,
  credentialListResponse,
  credentialSummary,
  credentialWriteRequest,
  historyBucketsResponse,
  historyQuery,
  historySamplesResponse,
  orgQuotaUsage,
  ERROR_CODES,
} from '../src/index.js'

const ROS = { kind: 'ros', topic: '/image_raw', type: 'sensor_msgs/msg/Image' } as const
const CAM = { source: ROS, width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_seconds: 5 }

describe('camera sources', () => {
  it('makes an impossible camera unrepresentable, not merely invalid', () => {
    // The point of the discriminated union: there is no validation rule to
    // forget, because the shapes cannot be mixed in the first place.
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

  it('accepts a URL carrying userinfo — permitted, and warned about elsewhere', () => {
    // André's call: a developer may do this. The schema does not refuse it;
    // the cloud answers `credentials_in_url` with severity `warning`, which
    // does not block a publish. Encoding the refusal here would make that
    // decision unimplementable.
    expect(cameraSource.safeParse({ kind: 'rtsp', url: 'rtsp://u:p@cam.local/s' }).success).toBe(true)
  })

  it('refuses a URL scheme that would make a camera a file reader on the robot', () => {
    // The bridge opens these with libraries that honour file: and ftp:, so an
    // unconstrained URL turns a config document into an arbitrary local-file
    // read — and the two distinct failure codes into an existence oracle.
    // ROS-pure exposure forbids exactly this class; it came back by omission.
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
    // 2026-09 redesign: the credential store is gone. A camera's password
    // lives in `source.credentials`, in the document itself, and therefore
    // in every published version. See `cameraCredentials`'s doc comment for
    // the recorded objection and where its bound actually lives (the publish
    // audit event and the org event stream must not carry the document body —
    // covered in cloud/, not here).
    const parsed = cameraSource.parse({
      kind: 'mjpeg', url: 'http://cam/s.mjpg', credentials: { username: 'admin', password: 'hunter2' },
    })
    expect(parsed).toMatchObject({ credentials: { username: 'admin', password: 'hunter2' } })
    expect(cameraSource.safeParse({ kind: 'mjpeg', url: 'http://cam/s.mjpg', credentials_ref: 'site-nvr' }).success).toBe(false)
  })
})

describe('credentials on the wire', () => {
  it('never describes a password on a read surface', () => {
    const listed = credentialListResponse.parse({
      credentials: [{ name: 'site-nvr', username: 'admin', set: true, readable: true, used_by: [] }],
    })
    expect('password' in listed.credentials[0]!).toBe(false)
    // …and the one shape that does carry a password is a write.
    expect(credentialWriteRequest.safeParse({ username: 'admin', password: 'hunter2' }).success).toBe(true)
  })

  it('separates "a password is stored" from "we can still decrypt it"', () => {
    // These two came apart once and the API could not say so: an
    // undecryptable credential answered `set: true` with `used_by` naming the
    // camera depending on it, while every config frame shipped `credentials:
    // {}`. The only evidence was a server log no developer can read.
    const unreadable = credentialSummary.parse({
      name: 'site-nvr', username: 'admin', set: true, readable: false, used_by: [],
    })
    expect(unreadable.set).toBe(true)
    expect(unreadable.readable).toBe(false)
    // Both are required: a summary that omits either is not a summary of
    // credential health, and the omission would read as the healthy value.
    expect(credentialSummary.safeParse(
      { name: 'site-nvr', username: 'admin', set: true, used_by: [] }).success).toBe(false)
  })

  it('reports who uses a credential, because rotating a shared one blind breaks a camera elsewhere', () => {
    const listed = credentialListResponse.parse({
      credentials: [{
        name: 'site-nvr', username: 'admin', set: true, readable: true,
        used_by: [
          { robot_id: '11111111-1111-4111-8111-111111111111', slug: 'front' },
          { robot_id: '22222222-2222-4222-8222-222222222222', slug: 'dock' },
        ],
      }],
    })
    expect(listed.credentials[0]!.used_by).toHaveLength(2)
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
    // Two facts, two representations. Collapsing them has cost this project
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
      max_realtime_connections: 500, max_asset_storage_bytes: 5_000_000_000,
    }
    const parsed = orgQuotaUsage.parse({ quotas, usage: { max_robots: 3, max_retention_bytes: 12_345 } })
    expect(parsed.usage.max_robots).toBe(3)
    expect(parsed.quotas.max_robots).toBe(50)
  })
})
