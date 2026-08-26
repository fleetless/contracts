import { z } from 'zod'
import { applyError, slug, rosName, rosTypeName, fieldPath } from './common.js'

/**
 * The exposure model (spec §4): what a developer configures per robot, how a
 * configuration moves from draft to published, and how the cloud reports what
 * it refuses.
 *
 * The envelope is deliberately kind-agnostic. W2 implements the datapoint
 * kind; W4 adds actions, services and publishers to `robotConfigDoc`, W5 the
 * cameras — without changing draft/publish, versioning or slug rules.
 */

/**
 * Parameter checks for actions, services and publishers (spec §4.4).
 *
 * Defined in W2 so the shape is settled and stored configurations stay
 * valid; **enforced in W4**, where parameters exist. There is deliberately
 * no evaluator in W2 — a rule engine without a caller is dead weight.
 */
export const valueRule = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  enum: z.array(z.union([z.string(), z.number()])).min(1).optional(),
  pattern: z.string().optional(),
  required: z.boolean().optional(),
})
export type ValueRule = z.infer<typeof valueRule>

/**
 * What an exposed service *is*, in the developer's own words (§17).
 *
 * This is what an MCP tool description carries verbatim, so it is read by a
 * model that has never seen this robot and cannot ask a follow-up question.
 * `unit` and `range` already say what a number *is*; this says what it
 * *means*.
 *
 * **It lives on the configuration rather than on the app, and that was a
 * decision with a cost.** §17's own wording put the semantic descriptions in
 * the MCP app; André moved them here on 2026-08-18 so that a description is
 * written once per service and true for every app that reaches the robot,
 * beside the other metadata. What is given up is real and should not be
 * rediscovered as a bug: **two apps can no longer describe one service
 * differently for two audiences.** §17 was reworded in the same wave rather
 * than left contradicting this field.
 *
 * **`.optional()` and not `.nullable().default(null)`, deliberately.** The
 * established shape in this file is a default — and every use of it has
 * added an instance to a known contradiction: `.default()` publishes the
 * field as **required** in the generated JSON Schema, because after parsing
 * it is always present. That is recorded four times over in
 * `scripts/export-schemas.ts`, whose fix (`io: 'input'`, applied per schema)
 * is a judgement call across roughly sixty schemas plus a re-vendor and a
 * re-pin in four repos. W7c's playbook said task 0 would do it; reading the
 * measured blast radius — 90 artifacts, 436 deletions for the blanket
 * version — said otherwise, at the start of a wave with five people blocked
 * on this pin. So the field simply does not create a fifth instance:
 * optional is optional in both modes, and *absent* is the single spelling of
 * "not described". `.min(1)` keeps the empty string from becoming a second.
 */
export const serviceDescription = z.string().min(1).max(2000).optional()

/**
 * One parameter's prose, for the same reader as `serviceDescription` and
 * under the same rules. Shorter, because it describes one field of one call
 * rather than the call itself.
 */
export const parameterDescription = z.string().min(1).max(500).optional()

/**
 * One parameter of an action, service or publisher, with the check the cloud
 * applies before anything reaches a robot (spec §4.4). `valueRule` was
 * defined in W2 and deliberately left unenforced until its subjects existed;
 * W4 is when they exist.
 */
export const parameterSpec = z.object({
  /** Field path into the ROS request/goal/message — same grammar as a datapoint's. */
  name: fieldPath,
  /** The ROS type, for the console to render an input the developer recognises. */
  type: z.string().min(1).max(255),
  rule: valueRule,
  description: parameterDescription,
})
export type ParameterSpec = z.infer<typeof parameterSpec>

/** Built-in slugs (spec §4.3) — never available to a configured service. */
export const RESERVED_SLUGS = ['bridge-state', 'robot-details', 'bridge-pressure'] as const

/**
 * How often a datapoint is sent (spec §4.2). The **bridge** enforces this, so
 * every realtime subscriber sees the same rate by construction (§11.1).
 */
export const datapointRate = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('max_hz'), hz: z.number().positive().max(100) }),
  z.object({ mode: z.literal('on_change') }),
])
export type DatapointRate = z.infer<typeof datapointRate>

/** Plausibility bounds shown to clients; metadata, not a filter. */
export const datapointRange = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
})
export type DatapointRange = z.infer<typeof datapointRange>

/**
 * One exposed datapoint: one field of a topic, or the whole topic
 * (`field: null`) — never several topics (spec §4.2).
 *
 * `scale`/`offset` are applied at the bridge (`value * scale + offset`) so
 * that REST and realtime carry identical numbers; `unit` and `range` travel
 * as metadata.
 */
export const datapointConfig = z.object({
  slug,
  topic: rosName,
  type: rosTypeName,
  field: fieldPath.nullable(),
  rate: datapointRate,
  unit: z.string().max(32).nullable(),
  scale: z.number().nullable(),
  offset: z.number().nullable(),
  range: datapointRange.nullable(),
  description: serviceDescription,
  /**
   * Record this datapoint (spec §8). Recorded values go to the time-series
   * store and are queryable through the history API; everything else is
   * live-only and leaves no trace.
   *
   * **Exactly one representation of "not recorded": `false`.** W5 reserved
   * this field as `z.null().optional()`, so stored documents may carry
   * `retention: null` — the cloud normalises that to `false` on read rather
   * than the contract accepting both, because two spellings of one fact is
   * the defect this project has spent two waves removing.
   *
   * Defaulted so a document written before W6 still parses.
   *
   * **The `.default()`-publishes-as-`required` trap is closed** (W9d, DEF-059,
   * `62ede62`): artifacts are now emitted per schema in the mode their
   * direction calls for, and `retention` no longer appears in `required` in
   * `cloud-config.schema.json`. This comment described it as *"deferred to
   * W7 with the fix identified"* for two waves after the fix landed — found by
   * Momus-W9, and it is the same shape as the three comments in `bridge/` that
   * were corrected in the same wave: **a note that names a defect as open is
   * itself a claim, and it goes stale exactly like a register row.**
   */
  retention: z.boolean().default(false),
  /**
   * What happens to this datapoint's values while the bridge is disconnected
   * (spec §6.3). Buffered values are backfilled after reconnect — **after**
   * live telemetry and job results, at a limited rate, so closing a gap can
   * never delay what is happening now. An unbuffered datapoint simply has a
   * gap, which is an honest answer and often the right one.
   */
  buffer: z
    .object({
      enabled: z.boolean(),
      /**
       * Zero is legal and means "no depth" — it is what a disabled buffer
       * carries. The invariant that matters is stated below: *enabled*
       * implies a depth greater than zero.
       */
      max_values: z.number().int().nonnegative().max(100_000),
    })
    .refine((b) => !b.enabled || b.max_values > 0, {
      message: 'an enabled buffer needs max_values > 0',
      path: ['max_values'],
    })
    .default({ enabled: false, max_values: 0 }),
})
export type DatapointConfig = z.infer<typeof datapointConfig>

/**
 * An action the robot can be asked to perform (spec §4.2, §11.3). At most one
 * job runs per action slug; a second call is refused `busy`, and every
 * observer of the slug watches the same job.
 */
export const actionConfig = z.object({
  slug,
  ros_name: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
  description: serviceDescription,
})
export type ActionConfig = z.infer<typeof actionConfig>

/** A ROS service call with validated parameters (spec §4.2). */
export const serviceConfig = z.object({
  slug,
  ros_name: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
  description: serviceDescription,
})
export type ServiceConfig = z.infer<typeof serviceConfig>

/**
 * A topic clients may publish to (spec §4.2, §6.4).
 *
 * The two timeouts are the whole safety story of this kind, and they are
 * different things:
 *
 * - `timeout_ms` + `failsafe`: if client publishes stop arriving — including
 *   because the client crashed or lost its connection — **the bridge itself**
 *   publishes `failsafe` on the topic. This is the platform's safety
 *   primitive (§7.2); a cmd_vel publisher with a zero-twist failsafe is the
 *   canonical case.
 * - `quiet_timeout_ms`: how long a publisher must be silent before a
 *   *different* user may publish. Whoever publishes holds the publisher
 *   implicitly exclusive, with no session machinery.
 */
export const publisherConfig = z.object({
  slug,
  topic: rosName,
  type: rosTypeName,
  parameters: z.array(parameterSpec).max(50),
  timeout_ms: z.number().int().positive().max(60_000),
  /** The message the bridge publishes on timeout. Shape is the ROS type's. */
  failsafe: z.unknown(),
  quiet_timeout_ms: z.number().int().nonnegative().max(600_000),
  description: serviceDescription,
})
export type PublisherConfig = z.infer<typeof publisherConfig>

/**
 * A camera the robot exposes (spec §10).
 *
 * W5 binds **ROS image topics**; RTSP, MJPEG and V4L2 are further source
 * adapters against this same shape and arrive in W6.
 *
 * `width`/`height`/`fps`/`bitrate_kbps` are not cosmetic: §10 makes them the
 * developer's control over **the robot's own bandwidth**, which is why they
 * live in the configuration rather than in a viewer's request. A viewer never
 * gets to make a robot send more.
 *
 * The two modes are deliberately independent (§10):
 *
 * - **Snapshot** runs always, at `snapshot_interval_ms`, whether or not
 *   anyone is watching live. The cloud caches the one frame and serves every
 *   client from it, so a hundred pollers cost the robot exactly one image per
 *   interval.
 * - **Live** runs on demand and is refcounted in the cloud: the first viewer
 *   starts it, the last one ends it.
 */
/**
 * A reference to a named credential (§12), by **name**. Never a secret, so it
 * is safe everywhere a configuration document goes: version history, the
 * console, audit details, a log line.
 */
export const credentialRef = z.string().min(1).max(64)

/**
 * Where a camera's frames come from (§10 names four sources).
 *
 * A discriminated union rather than optional fields, so an impossible camera
 * is **unrepresentable** rather than merely invalid — there is no way to
 * write an RTSP camera with a ROS topic, or a V4L2 device with a URL, and
 * therefore no validation rule to forget.
 *
 * `credentials_ref` names a shared credential; one site account typically
 * serves many cameras, across robots. Credentials themselves never appear
 * here — see `cloudConfig.credentials`, which carries them on the wire to the
 * robot and nowhere else.
 *
 * A URL **may** carry userinfo (`rtsp://user:pass@host`). It publishes, with
 * a `credentials_in_url` **warning**: that password becomes part of the
 * configuration document, so it lands in every published version and in the
 * audit log, and cannot be rotated without republishing. If both are present
 * the named credential wins, with a second warning — silently preferring one
 * would make a rotation appear not to work.
 */
export const cameraSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ros'),
    topic: rosName,
    /** `sensor_msgs/msg/Image` or `sensor_msgs/msg/CompressedImage`. */
    type: rosTypeName,
  }),
  z.object({
    kind: z.literal('rtsp'),
    /**
     * Scheme-constrained deliberately. The playbook drafted `z.string().url()`
     * here and the shipped contract was `z.string().min(1).max(2048)` — nobody
     * recorded the change, and the W6 review found the consequence: the bridge
     * opens these with libraries that honour `file:` and `ftp:`, so an
     * unconstrained URL turns a configuration document into an arbitrary
     * local-file read on the robot, with the two distinct failure codes
     * doubling as a file-existence oracle. Spec §7.6 is ROS-pure exposure with
     * no shell or http features; that rule came back by omission rather than
     * by intent. The bridge re-checks this too — a robot must not become a
     * file server because a validator changed.
     */
    url: z.string().min(1).max(2048).regex(/^rtsps?:\/\//i, 'must be an rtsp:// or rtsps:// URL'),
    /** TCP by default: UDP loses frames on a congested link, silently. */
    transport: z.enum(['tcp', 'udp']).default('tcp'),
    credentials_ref: credentialRef.nullable().default(null),
  }),
  z.object({
    kind: z.literal('mjpeg'),
    /** `http:`/`https:` only — see the `rtsp` variant above for why. */
    url: z.string().min(1).max(2048).regex(/^https?:\/\//i, 'must be an http:// or https:// URL'),
    credentials_ref: credentialRef.nullable().default(null),
  }),
  z.object({
    kind: z.literal('v4l2'),
    /**
     * e.g. `/dev/video0`, or a stable `/dev/v4l/by-id/...` symlink. Resolved
     * on the robot, never by the cloud.
     *
     * Constrained to `/dev/` for the same reason the `rtsp` and `mjpeg` URLs
     * are constrained to their schemes, and it was missed the first time
     * (Momus, W6 verification). The device string reaches
     * `cv2.VideoCapture(device)` on the robot, and OpenCV does not restrict
     * itself to devices: measured on cv2 4.5.4, an ordinary local video file
     * opens and its pixels are published to the cloud, and so does
     * `http://127.0.0.1:8899/secret.jpg`. Unconstrained, this field is an
     * arbitrary local-file read *and* an outbound fetch from inside the robot
     * — the §7.6 violation closed for the other two source kinds, reachable
     * through the fourth, because "it is just a device path" read like a
     * reason not to check.
     *
     * Narrower than the URL hole in one respect worth recording: a non-media
     * file and a missing file both fail to open, so this branch never worked
     * as a file-existence oracle.
     *
     * The bridge re-derives this constraint rather than trusting the wire
     * (`validate_device_path`), exactly as it re-derives the URL scheme.
     */
    device: z
      .string()
      .min(1)
      .max(128)
      .regex(/^\/dev\/[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'must be a device path under /dev/')
      .refine((v) => !v.split('/').includes('..'), 'must not contain a `..` path segment')
      .refine((v) => !v.endsWith('/'), 'must name a device, not a directory'),
  }),
])
export type CameraSource = z.infer<typeof cameraSource>

export const cameraConfig = z.object({
  slug,
  source: cameraSource,
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(4320),
  fps: z.number().int().positive().max(60),
  bitrate_kbps: z.number().int().positive().max(50_000),
  /**
   * How often a snapshot is captured. Bounded below at one second because a
   * snapshot is the *cheap* mode — a developer who wants motion wants live,
   * and an interval faster than this is a live stream wearing a disguise.
   */
  snapshot_interval_ms: z.number().int().min(1000).max(3_600_000),
  description: serviceDescription,
})
export type CameraConfig = z.infer<typeof cameraConfig>

/**
 * A whole robot configuration. One document per draft and per published
 * version. The kinds are sibling arrays, and **slugs are one namespace across
 * all of them** (§4.1) — which is what lets a role grant say
 * `{robot, slug}` without ever naming a kind.
 */
export const robotConfigDoc = z.object({
  datapoints: z.array(datapointConfig).max(200),
  /**
   * The three kinds W4 adds default to empty so that **every configuration
   * published before W4 still parses**. Stored documents are jsonb; a
   * required field here would have invalidated live robots' published
   * versions on the first read after deploy.
   */
  actions: z.array(actionConfig).max(200).default([]),
  services: z.array(serviceConfig).max(200).default([]),
  publishers: z.array(publisherConfig).max(200).default([]),
  /** W5, defaulted for the same reason the W4 kinds were: stored jsonb. */
  cameras: z.array(cameraConfig).max(50).default([]),
})
export type RobotConfigDoc = z.infer<typeof robotConfigDoc>


/**
 * One thing the cloud has to say about a configuration (spec §11.5: field +
 * violated rule).
 *
 * `error` blocks the publish. `warning` does not — an unknown topic is a
 * warning on purpose, because configuring a robot that has never been
 * connected must stay possible (spec §4.1).
 */
export const validationIssue = z.object({
  path: z.string().min(1),
  slug: z.string().nullable(),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']),
})
export type ValidationIssue = z.infer<typeof validationIssue>

/**
 * Where a robot's configuration stands — the material for the console's
 * "draft newer than published", "published v2 · applied v1 · bridge offline"
 * (spec §15.2, robot tab 1).
 */
export const configState = z.object({
  published_version: z.number().int().positive().nullable(),
  published_at: z.iso.datetime().nullable(),
  draft_updated_at: z.iso.datetime().nullable(),
  applied_version: z.number().int().nonnegative().nullable(),
  applied_ok: z.boolean().nullable(),
  /**
   * The bridge's own `bridgeConfigApplied.errors` (`protocol.ts`), read back
   * verbatim. **Reuses `applyError` rather than restating `{ slug, message
   * }`** — a narrower local copy here used to silently strip `kind`, `code`
   * and `details` on every read: `configState.safeParse` dropped every field
   * a caller did not ask for, and `robotDetailResponse` embeds `configState`
   * (`useCloudApi.ts`'s `getRobot`), so the console lost the fields one
   * layer before anyone could see them.
   */
  applied_errors: z.array(applyError).nullable(),
})
export type ConfigState = z.infer<typeof configState>
