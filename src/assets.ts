import { z } from 'zod'

/**
 * The asset store (spec §4.6, W7).
 *
 * An **asset is an immutable file belonging to a robot**. It has a uuid and is
 * fetched by it. There are no org-level assets and no public retrieval: every
 * read is authenticated and role-checked (`assets`, §3.3).
 *
 * **One authorization model — the `Authorization` header.** Not a signed URL,
 * not a cookie, not a token in a query string. The reason is not ergonomics
 * but the number of mechanisms: a second credential would carry its own
 * lifetime, its own renewal, its own rotation, and in every log the question
 * of which token that was. Directus solves the same problem with a cookie and
 * an `access_token` query parameter, and the cookie half does not transfer —
 * Fleetless has no interface of its own (§1), so the consumers of a robot's
 * assets sit on other origins.
 *
 * **The consequence, said out loud: this is not a CDN.** A shared cache must
 * not store a response to a request carrying `Authorization`. Assets are
 * immutable, so `Cache-Control: private, immutable` is correct and the
 * browser's own cache works fully; nothing edge-caches. Calling it a CDN would
 * promise something that does not happen. Signed URLs stay **additive** later —
 * a second endpoint, not a migration — precisely because assets are immutable
 * and uuid-addressed.
 */
export const assetKind = z.enum(['urdf', 'mesh', 'other'])
export type AssetKind = z.infer<typeof assetKind>

/**
 * The `name` a URDF asset carries.
 *
 * A mesh names itself — its `package://` URI is the only string anyone can
 * match against a workspace. A URDF has no such natural name, so the bridge
 * and the cloud agreed on one in conversation: `robot_description`, after the
 * topic it comes from. **An agreement in conversation is exactly the thing
 * that drifts**, and this project has now written down two other shared
 * strings for the same reason (`ASSET_UPLOAD_HEADERS`, the mailed-link paths)
 * after being bitten each time. So it is pinned here rather than living in two
 * repos and a message.
 *
 * Consumers should not match on it: `kind === 'urdf'` is the reliable test,
 * and this constant exists so the producer and the store agree, not so readers
 * compare strings.
 */
export const URDF_ASSET_NAME = 'robot_description'

export const asset = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  kind: assetKind,
  /**
   * What the robot called it — for a mesh, the `package://` URI the URDF
   * references, verbatim. That is the only string a developer can match
   * against their own workspace, and matching is the whole job when a sync
   * comes back incomplete.
   */
  name: z.string().min(1).max(500),
  media_type: z.string().min(1).max(120),
  size_bytes: z.number().int().nonnegative(),
  /**
   * The content hash, and the reason two robots sharing a mesh cost one copy.
   *
   * Exposed rather than kept internal because it is the only way a client can
   * tell "this is the same mesh I already have" across robots — and a 3D view
   * that re-downloads an identical arm for every robot in a fleet is the
   * predictable failure of a store that hides it.
   */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.iso.datetime(),
})
export type Asset = z.infer<typeof asset>

/**
 * Whether a URDF can actually be rendered, which is not the same as whether it
 * was uploaded.
 *
 * `missing` carries the `package://` URIs the bridge could not resolve in the
 * workspace. The spec's example is "2 Meshes fehlen" and that number alone is
 * a dead end: it tells a developer to go looking through a workspace by hand.
 * The URIs are what they can act on, so the URIs travel.
 */
export const urdfCompleteness = z.object({
  /** Whether a URDF has been synced at all. Availability is a different question. */
  present: z.boolean(),
  /** How many distinct meshes the URDF references. */
  mesh_count: z.number().int().nonnegative(),
  missing: z.array(z.string().min(1)),
})
export type UrdfCompleteness = z.infer<typeof urdfCompleteness>

export const assetListResponse = z.object({
  assets: z.array(asset),
  urdf: urdfCompleteness,
  /**
   * What the connected bridge says it *could* transfer, which is deliberately
   * separate from what has been transferred (§4.6: the bridge "meldet nur
   * Verfügbarkeit"). `null` when no bridge is connected — distinct from
   * `false`, because "no robot is online to ask" and "the robot has no URDF"
   * send a developer to two different places.
   */
  urdf_available: z.boolean().nullable(),
})
export type AssetListResponse = z.infer<typeof assetListResponse>

/**
 * A sync is long-running and is therefore answered with something to watch,
 * never with a status that was true at the moment of asking.
 *
 * **`source` has one value, and that is deliberate.** §4.6 also names a manual
 * zip upload, and the first version of this shape had `'upload'` in the enum —
 * with **no body defined for the bytes**. An enum value with no producer and
 * no payload invites every consumer to guess a shape, and each guesses
 * differently; that is the exact defect Nimbus-W6c refused to introduce in
 * W6c, when the lead asked twice for an error code whose payload had moved.
 * The zip path is in `DEFERRALS.md` with a condition instead of sitting in the
 * wire as a promise.
 *
 * A single-member enum rather than dropping the field: the second source is a
 * question of when, not whether, and a caller that already names its source
 * does not change shape when the second one arrives.
 *
 * Caught by Eve-W7 asking what body `'upload'` takes, rather than building
 * against a guess.
 */
export const assetSyncRequest = z.object({
  source: z.enum(['bridge']),
})
export type AssetSyncRequest = z.infer<typeof assetSyncRequest>

export const assetSyncResponse = z.object({
  sync_id: z.uuid(),
})
export type AssetSyncResponse = z.infer<typeof assetSyncResponse>

/**
 * Progress of one sync.
 *
 * `failed` names the URIs that could not be resolved, and it is required
 * rather than optional: a sync that drops three meshes and reports success is
 * worse than one that fails outright, because the failure surfaces later, in a
 * renderer, as a robot with missing limbs and no explanation.
 */
export const assetSyncState = z.enum(['running', 'succeeded', 'failed'])
export type AssetSyncState = z.infer<typeof assetSyncState>

export const assetSyncStatus = z.object({
  sync_id: z.uuid(),
  robot_id: z.uuid(),
  state: assetSyncState,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  failed: z.array(z.string().min(1)),
  started_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})
export type AssetSyncStatus = z.infer<typeof assetSyncStatus>

/**
 * What an `asset_too_large` refusal tells the caller — the same discipline as
 * `publisher_busy` and `job_queue_full`: a refusal that names a state and no
 * number leaves the caller unable to decide anything.
 */
export const assetTooLargeDetails = z.object({
  limit_bytes: z.number().int().positive(),
  size_bytes: z.number().int().positive(),
})
export type AssetTooLargeDetails = z.infer<typeof assetTooLargeDetails>
