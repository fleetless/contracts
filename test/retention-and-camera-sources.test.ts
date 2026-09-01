import { describe, expect, it } from 'vitest'
import {
  cameraConfig,
  cameraSource,
  cloudConfig,
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
const CAM = { slug: 'front', source: ROS, width: 1280, height: 720, fps: 15, bitrate_kbps: 2000, snapshot_interval_ms: 5000 }

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

  it('defaults RTSP transport to tcp — udp loses frames silently on a congested link', () => {
    const parsed = cameraSource.parse({ kind: 'rtsp', url: 'rtsp://cam.local/s' })
    expect(parsed).toMatchObject({ transport: 'tcp', credentials_ref: null })
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

  it('references a shared credential by NAME, so nothing secret enters the document', () => {
    const parsed = cameraSource.parse({ kind: 'mjpeg', url: 'http://cam/s.mjpg', credentials_ref: 'site-nvr' })
    expect(parsed).toMatchObject({ credentials_ref: 'site-nvr' })
    expect(JSON.stringify(parsed)).not.toContain('password')
  })
})

describe('credentials on the wire, not in the document', () => {
  it('carries credentials as a sibling of doc, never inside it', () => {
    const frame = cloudConfig.parse({
      type: 'config',
      version: 3,
      doc: { datapoints: [], cameras: [{ ...CAM, source: { kind: 'rtsp', url: 'rtsp://cam/s', credentials_ref: 'site-nvr' } }] },
      credentials: { 'site-nvr': { username: 'admin', password: 'hunter2' } },
    })
    expect(frame.credentials['site-nvr']?.password).toBe('hunter2')
    // The document a developer writes, and which gets versioned and audited,
    // must not be able to hold the secret at all.
    expect(JSON.stringify(frame.doc)).not.toContain('hunter2')
  })

  it('defaults to no credentials, so a frame written before they existed still parses', () => {
    const frame = cloudConfig.parse({ type: 'config', version: 0, doc: { datapoints: [] } })
    expect(frame.credentials).toEqual({})
  })

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
