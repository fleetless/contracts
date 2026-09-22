// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

import { slug } from './common.js'

/**
 * The asset store.
 *
 * An **asset is an immutable file belonging to a robot**. It has a uuid and is
 * fetched by it. There are no org-level assets and no public retrieval: every
 * read is authenticated and checked against the `assets` role.
 *
 * **One authorization model — the `Authorization` header.** Not a signed URL,
 * not a cookie, not a token in a query string. The reason is not ergonomics
 * but the number of mechanisms: a second credential would carry its own
 * lifetime, its own renewal, its own rotation, and in every log the question
 * of which token that was. Directus solves the same problem with a cookie and
 * an `access_token` query parameter, and the cookie half does not transfer —
 * Fleetless has no end-user interface of its own, so the consumers of a robot's
 * assets sit on other origins.
 *
 * **The consequence, said out loud: this is not a CDN.** A shared cache must
 * not store a response to a request carrying `Authorization`. Assets are
 * immutable, so `Cache-Control: private, immutable` is correct and the
 * browser's own cache works fully; nothing edge-caches. Calling it a CDN would
 * promise something that does not happen. Signed URLs stay **additive** later —
 * a second endpoint, not a migration — precisely because assets are immutable
 * and uuid-addressed.
 *
 * ---
 *
 * **Three kinds, and every one of them is a thing a renderer does something
 * with.**
 *
 * A `urdf` is the description, a `mesh` is geometry, a `texture` is an image
 * referenced by the URDF's own `<material><texture>` **or** by a mesh file
 * internally (a `.dae`'s `<init_from>`). A client that renders a robot must
 * know, from the asset list alone and before fetching anything, which bytes
 * it has to pre-fetch. Every load in the browser goes through the SDK with
 * the bearer token — there is no lazy second fetch a renderer can make on its
 * own account — so "what must be in memory before anything renders" is a
 * question the list has to be able to answer, and a kind meaning *something
 * else* answers it for nothing.
 *
 * There was a fourth, `other`, and **no producer ever sent it**: the bridge
 * classifies what it uploads and has only these three to choose from. It was
 * a slot for a file nobody had, which every consumer still had to branch on.
 */
export const assetKind = z.enum(['urdf', 'mesh', 'texture'])
export type AssetKind = z.infer<typeof assetKind>

/**
 * The `name` a URDF asset carries.
 *
 * A mesh names itself — its `package://` URI is the only string anyone can
 * match against a workspace. A URDF has no such natural name, so producers
 * agree on one: `robot_description`, after the topic it comes from.
 *
 * **Its job changed once the store stopped overwriting it.** It was pinned
 * because the bridge and the cloud had settled on a value in conversation, and
 * conversations drift — then the gate found the cloud renaming every URDF to
 * `robot.urdf` regardless of what arrived, so the pinned value was decorative
 * and the contract looked authoritative while being ignored. The store now
 * keeps `asset.name` verbatim, which is what `asset.name`'s own comment
 * already promised.
 *
 * So this is now a **convention among producers**, not an agreement the store
 * enforces: it exists so two different bridges do not name the same thing two
 * ways and leave a developer looking at an inconsistent fleet. Nothing
 * validates it, and that is deliberate — the store's job is to record what it
 * was told.
 *
 * Consumers must not match on it. `kind === 'urdf'` is the reliable test; the
 * cloud identifies a robot's URDF row by kind alone, so a producer that sends
 * a different string updates the same singleton rather than orphaning a second.
 */
export const URDF_ASSET_NAME = 'robot_description'

export const asset = z.object({
  id: z.uuid().meta({ description: 'The asset\'s id in the store.' }),
  robot_id: z.uuid().meta({ description: 'The robot this asset belongs to.' }),
  kind: assetKind.meta({
    description: 'What the file is: the `urdf` itself, a `mesh` it references, or a `texture` a mesh or the URDF paints with. A renderer decides from this alone, before fetching anything, what to pre-fetch.',
  }),
  /**
   * What the robot called it — for a mesh, the `package://` URI the URDF
   * references, verbatim. That is the only string a developer can match
   * against their own workspace, and matching is the whole job when a sync
   * comes back incomplete.
   *
   * **The naming rule for a file nothing in the URDF names.** A
   * `.dae` carries its own image references — `<init_from>textures/skin.png`
   * — resolved by the renderer against *the `.dae`'s own directory*, and no
   * `package://` URI for them appears anywhere in the URDF. The rule is:
   *
   *     name = the .dae's package:// URI, directory part,
   *            joined with the internal reference, normalized.
   *
   * So `package://robot_description/meshes/arm.dae` referencing
   * `textures/skin.png` uploads as
   * `package://robot_description/meshes/textures/skin.png`.
   *
   * **Renderers depend on this rule holding.** three.js resolves that internal reference
   * relative to wherever it loaded the `.dae` from and asks the loading
   * manager for the result; the client can only answer if the asset's name
   * still carries the same **relative tail** (`textures/skin.png`) that the
   * `.dae` asked for. Normalizing into a `package://` URI preserves that tail
   * exactly, keeps every name in one namespace a developer already reads, and
   * keeps `urdfCompleteness.missing` meaningful for files the URDF never
   * mentioned.
   *
   * A reference that escapes its package (`../../etc/passwd`) is **not**
   * renamed into something harmless — it is refused at the producer, by the
   * same containment check that guards `package://` resolution. Two identical
   * rules, one enforced and one only documented, is how a traversal gets in.
   */
  name: z.string().min(1).max(500).meta({
    description: 'What the robot called it — for a mesh, the `package://` URI the URDF references, verbatim, the only string a developer can match against their own workspace. A file the URDF never names (an image a `.dae` loads for itself) is named by joining the mesh\'s own directory with that internal reference.',
  }),
  media_type: z.string().min(1).max(120).meta({
    description: 'The media type of the stored bytes, as the producer reported it.',
  }),
  size_bytes: z.number().int().nonnegative().meta({
    description: 'How large the stored file is, in bytes.',
  }),
  /**
   * The content hash, and the reason two robots sharing a mesh cost one copy.
   *
   * Exposed rather than kept internal because it is the only way a client can
   * tell "this is the same mesh I already have" across robots — and a 3D view
   * that re-downloads an identical arm for every robot in a fleet is the
   * predictable failure of a store that hides it.
   */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).meta({
    description: 'The content hash, lowercase hex. Exposed because it is the only way a client can tell "this is the same mesh I already have" across robots — the reason two robots sharing a mesh cost one copy.',
  }),
  created_at: z.iso.datetime().meta({
    description: 'When the asset was first stored, as an ISO 8601 timestamp.',
  }),
})
export type Asset = z.infer<typeof asset>

/**
 * Whether a URDF can actually be rendered, which is not the same as whether it
 * was uploaded.
 *
 * `missing` carries **the reference, verbatim, that no asset answers** — for
 * a `package://` mesh the URI the bridge could not resolve in the workspace,
 * and also the absolute paths and bare relative paths a URDF may carry, which
 * the extractor sees and the sync deliberately never offers. A developer whose
 * URDF names `/opt/meshes/arm.stl` is entitled to be told that nothing will
 * ever fetch it.
 *
 * A bare count of what is missing is a dead end: it tells a developer to go
 * looking through a workspace by hand. The references are what they can act
 * on, so the references travel.
 *
 * **Every entry must be actionable, and that is a constraint on the producers,
 * not on this field.** An entry a developer cannot make disappear by fixing
 * what it names is a defect in whoever put it there.
 */
export const urdfCompleteness = z.object({
  present: z.boolean().meta({
    description: 'Whether a URDF has been synced at all. Whether one *could* be synced is a different question, answered by `urdf_available`.',
  }),
  mesh_count: z.number().int().nonnegative().meta({
    description: 'How many distinct meshes the URDF references.',
  }),
  /**
   * **What is missing, and what kind of thing it was.**
   *
   * Each entry carries its element rather than only its URI. Without that a
   * client can only report every entry as a missing mesh, which contradicts
   * `mesh_count` printed beside it — two statements about the same subject
   * that disagree.
   *
   * The producer knows the element when it extracts the reference, so it
   * travels with it. A client that re-derived it from the file extension
   * would be a second derivation of the same fact, free to diverge from the
   * first.
   */
  missing: z.array(z.object({
    uri: z.string().min(1).max(500).meta({
      description: 'The reference, verbatim, that no stored asset answers — a `package://` URI the workspace does not hold, or an absolute or bare relative path nothing will ever fetch.',
    }),
    element: z.enum(['mesh', 'texture']).meta({
      description: 'Which kind of reference it was: geometry the URDF names as a `mesh`, or a `texture` a surface paints with. Without it a client reports a missing texture as a missing mesh, contradicting `mesh_count` beside it.',
    }),
  })).meta({
    description: 'The references nothing in the store answers, each with the element that asked for it. A bare count would send a developer hunting through the workspace by hand; the references are what they can act on.',
  }),
})
export type UrdfCompleteness = z.infer<typeof urdfCompleteness>

/**
 * A sync is long-running and is therefore answered with something to watch,
 * never with a status that was true at the moment of asking.
 *
 * **`source` has one value, and that is deliberate.** A manual upload path is
 * planned but has no body defined for the bytes yet. An enum value with no
 * producer and no payload invites every consumer to guess a shape, and each
 * guesses differently, so it stays out of the wire until it is real.
 *
 * A single-member enum rather than no field at all: the second source is a
 * question of when, not whether, and a caller that already names its source
 * does not change shape when the second one arrives.
 */
export const assetSyncRequest = z.object({
  source: z.enum(['bridge']).meta({
    description: 'Where the bytes come from. `bridge` is the only value today: the connected bridge reads them from the robot\'s own workspace. Validated rather than ignored, so a caller naming an unknown source is told so instead of silently getting a bridge sync.',
  }),
}).strict()
/**
 * **And the route reads it.** The body is `.strict()`, so `{source:'upload'}`
 * and `{nonsense:1}` are refusals rather than silent bridge syncs. A shape no
 * route validates is not a contract; it is a comment with a type. Validation
 * is what makes the single member mean something: a caller who names a source
 * that does not exist yet learns that, instead of getting a different one.
 */
export type AssetSyncRequest = z.infer<typeof assetSyncRequest>

export const assetSyncResponse = z.object({
  sync_id: z.uuid().meta({
    description: 'The sync that has just started. A sync is long-running, so the answer is something to watch rather than a status that was true at the moment of asking.',
  }),
})
export type AssetSyncResponse = z.infer<typeof assetSyncResponse>

/**
 * Progress of one sync.
 *
 * `failed` names the URIs that could not be resolved, and it is required
 * rather than optional: a sync that drops three meshes and reports success is
 * worse than one that fails outright, because the failure surfaces later, in a
 * renderer, as a robot with missing limbs and no explanation.
 *
 * **`failed` carries per-reference facts and `reason` carries the sync's
 * own.** Anything that is not about one specific reference goes in `reason` —
 * one human-readable sentence about why the sync ended as it did, `null` when
 * the outcome speaks for itself. A whole-sync condition written into `failed`
 * reaches a developer as a mesh they are told to go and find.
 *
 * Not every `failed` entry is a mesh URI. A URDF upload can fail like any
 * other asset, and it appears under the name `robot_description`; see
 * `assetFailure.reference`. A consumer must not assume every entry is a
 * `package://` URI.
 *
 * **`assetSyncState` is deliberately not widened to carry the reason.**
 * Consumers switch on it, and a new member silently changes what every
 * existing switch covers. A sync refused because another was in flight is
 * still a terminal outcome with a reason, not a different state. Adding a
 * field is additive; adding an enum member is not.
 */
/**
 * **How much asset storage a robot has: one number, the same for every robot.**
 *
 * It replaces two dials that answered neither question well — a per-file
 * ceiling, which refused a single large mesh while saying nothing about the
 * robot's total, and a per-organisation quota, which said nothing about any
 * one robot. A developer syncing a robot asks *will this robot's description
 * fit*, and only this number answers it.
 *
 * **Content addressing still stores a shared blob once, and each robot's
 * counter still carries it.** Two robots referencing the same mesh cost one
 * object and count against both stores, so a robot's number never depends on
 * another robot's — which is the only way "used of 1 GB" means anything on a
 * page about one robot.
 *
 * Stated here, and in `constants.json`, because the bridge cannot import this
 * package and the cloud enforces the check: a limit the sender guesses and
 * the receiver enforces is two numbers that agree until one of them moves.
 */
export const ROBOT_ASSET_STORE_BYTES = 1_000_000_000

/**
 * What a full store tells the caller — the same discipline as `job_queue_full`
 * and `publisher_busy`: a refusal that names a state and no number leaves the
 * caller unable to decide anything.
 *
 * Three numbers, because two of them answer different questions. `store_bytes`
 * and `used_bytes` say how much room there is; `size_bytes` says what did not
 * fit. Without the pair a developer cannot tell whether to delete something or
 * to shrink the mesh, and "the store is full" answers neither.
 */
export const assetStoreRefusedDetails = z.object({
  store_bytes: z.number().int().positive().meta({
    description: 'The robot\'s store, in bytes.',
  }),
  used_bytes: z.number().int().nonnegative().meta({
    description: 'Bytes the robot\'s assets occupy before this upload.',
  }),
  size_bytes: z.number().int().positive().meta({
    description: 'The refused upload, in bytes.',
  }),
})
export type AssetStoreRefusedDetails = z.infer<typeof assetStoreRefusedDetails>

/**
 * Why one reference did not make it into the store.
 *
 * Three kinds because three things were already happening and only one word
 * was available for them:
 *
 * - **`unresolvable`** — the reference names nothing the producer can find, or
 *   nothing it is allowed to read (a `package://` URI absent from the
 *   workspace, an absolute path, a `.dae`-internal reference escaping its own
 *   package). **Permanent.** No retry changes it, and it is the only kind a
 *   reconciliation may treat as gone.
 * - **`upload_failed`** — the bytes exist and the transfer did not succeed.
 *   **Transient.** The asset is still wanted; a later sync will carry it.
 * - **`refused`** — never attempted. Either the robot's asset store had no
 *   room for it, in which case `details` carries the three numbers, or a
 *   producer-side ceiling was hit (a `.dae` carrying more internal references
 *   than one file or one sync will report), in which case it does not.
 *   **Transient in the same sense**: nothing is known to be missing, only
 *   unexamined.
 *
 * There was a fourth, `too_large`, for a file over a per-file ceiling. That
 * ceiling is gone — a robot has one store and nothing is refused for its own
 * size — so the kind had no producer left and one fewer thing to branch on is
 * the whole of the gain.
 *
 * A consumer that cannot act on the distinction may still print `reference`
 * alone and lose nothing it had before.
 */
export const assetFailureKind = z.enum(['unresolvable', 'upload_failed', 'refused'])
export type AssetFailureKind = z.infer<typeof assetFailureKind>

export const assetFailure = z.object({
  /**
   * What could not be provided, verbatim — the same string `asset.name` would
   * have stored and `urdfCompleteness.missing` reports, so a developer can
   * match it against their own workspace by eye. For a URDF upload failure it
   * is `URDF_ASSET_NAME`, which is **not** a mesh URI: a consumer rendering
   * this list must not assume every entry is one.
   */
  reference: z.string().min(1).max(500).meta({
    description: 'What could not be provided, verbatim — the same string the asset would have been stored under, so a developer can match it against their own workspace by eye. For a failed URDF upload it is `robot_description`, which is **not** a mesh URI: a consumer must not assume every entry is one.',
  }),
  kind: assetFailureKind.meta({
    description: 'Why it failed. `unresolvable` means the reference names nothing the producer can find or may read, and is **permanent** — the only kind reconciliation may treat as gone. `upload_failed` means the bytes exist and the transfer did not succeed, and `refused` means it was never attempted, either because the robot\'s asset store had no room — then `details` carries the three numbers — or because a producer-side ceiling was hit.',
  }),
  /**
   * **The three numbers behind a full store.**
   *
   * A reason without numbers is not one a caller can act on. *"Refused"* does
   * not answer whether to delete an old sync or shrink the mesh;
   * `store_bytes`, `used_bytes` and `size_bytes` do.
   *
   * **Present only on `refused`, and not on every `refused`.** The other half
   * of that kind is the single collective entry a sync emits when it stops
   * naming individual failures, and no store number describes it — requiring
   * details there would mean inventing them. So the enforcement below is the
   * half that can be enforced: details belong to `refused` and to nothing
   * else. A forced `details: null` on every `unresolvable` buys nothing.
   */
  details: assetStoreRefusedDetails.nullish().meta({
    description: 'The three numbers behind a `refused` entry the robot\'s store had no room for, and absent for every other kind — a forced `null` on every `unresolvable` entry buys nothing. A `refused` entry may also carry no details: the producer\'s own ceiling is the other half of that kind, and no store number describes it.',
  }),
}).superRefine((f, ctx) => {
  // Enforced here, not merely described above — a rule that lives only in a
  // comment gets filled with something else.
  if (f.kind !== 'refused' && f.details != null) {
    ctx.addIssue({ code: 'custom', path: ['details'], message: 'store details belong to `refused` only' })
  }
})
export type AssetFailure = z.infer<typeof assetFailure>

export const assetSyncState = z.enum(['running', 'succeeded', 'failed'])
export type AssetSyncState = z.infer<typeof assetSyncState>

export const assetSyncStatus = z.object({
  sync_id: z.uuid().meta({ description: 'The sync this status describes.' }),
  robot_id: z.uuid().meta({ description: 'The robot whose assets are being synced.' }),
  state: assetSyncState.meta({
    description: 'Whether the sync is still `running`, or ended `succeeded` or `failed`. It ends `succeeded` only when nothing was left behind: a single entry in `failed` makes the whole sync `failed`.',
  }),
  done: z.number().int().nonnegative().meta({
    description: 'How many files have been transferred so far.',
  }),
  total: z.number().int().nonnegative().meta({
    description: 'How many files this sync set out to transfer. It is `0` until the producer has finished working out what there is.',
  }),
  /**
   * **Every entry says *why*.**
   *
   * A flat `string[]` cannot carry three different facts distinguishably: a
   * reference that resolves to nothing in the workspace, a file that exists
   * and whose transfer failed, and one that was never attempted at all.
   *
   * The distinction is what makes reconciliation possible. `unresolvable` is
   * the only kind that means *this will not come back*, so it is the only kind
   * an unreferenced-asset sweep may act on. `upload_failed` and `refused` both
   * mean *this was meant to be provided and was not*, and dropping the asset
   * on either would delete something still wanted.
   *
   * **Bounded, per entry and in total.** One mesh reference can expand into a
   * list bounded only by the text of the `.dae` it points at, and the whole
   * status travels in one WebSocket frame with a maximum payload. Without a
   * cap the outcome is not a dropped frame but the robot's socket closed
   * mid-sync by a file in its own workspace. At most 1000 entries of at most
   * 500 bytes is about 0.5 MiB of names, comfortably inside that frame.
   *
   * A producer that reaches its own ceiling reports **one** entry saying so
   * rather than growing the list: fail naming the limit, rather than silently
   * reporting resolvable meshes as missing.
   */
  failed: z.array(assetFailure).max(1000).meta({
    description: 'What could not be provided, one entry per reference, each saying why. Required rather than optional: a sync that quietly drops three meshes and reports success moves the failure into somebody\'s renderer, where it shows up as a robot with missing limbs and no cause. At most `1000` entries — a producer at its own ceiling reports one entry saying so rather than growing the list.',
  }),
  reason: z.string().min(1).nullable().meta({
    description: 'Why the sync ended as it did, when that is not a per-reference fact. `null` when `failed` already says everything there is to say.',
  }),
  /**
   * **What the receiver counted, next to what the producer claimed.**
   *
   * `state` is the bridge's own terminal frame and nothing else. A dev stack
   * with no object store answered `500` to every upload and the sync still
   * read `succeeded` — the producer had genuinely sent every file, and no
   * one had asked the store. These two numbers are the cloud's own count,
   * taken after the terminal frame: how many of the announced files
   * (`assets_available`'s URDF and mesh list) its store actually holds.
   *
   * They are a pair because neither alone answers anything. `stored` without
   * `announced` cannot say whether four files is all of them or a tenth of
   * them, and `announced` alone is what the producer said it had, which is
   * the claim under examination.
   *
   * A partial store is still `succeeded`: some meshes were never going to
   * resolve, and the per-reference `failed` entries say which. An empty one
   * under a `succeeded` frame is `failed`, because no transport succeeds at
   * nothing.
   */
  stored: z.number().int().nonnegative().meta({
    description: 'How many of the announced files the cloud\'s store actually holds, counted after the sync ended. Read it against `announced`: `state` is what the robot reported, this is what arrived.',
  }),
  announced: z.number().int().nonnegative().meta({
    description: 'How many files the robot announced for this sync — the URDF, if it has one, plus every mesh URI its description references. `0` when the robot announced nothing.',
  }),
  started_at: z.iso.datetime().meta({
    description: 'When the sync started, as an ISO 8601 timestamp.',
  }),
  updated_at: z.iso.datetime().meta({
    description: 'When this status last changed, as an ISO 8601 timestamp. A sync that stops moving is visible here rather than only in `state`.',
  }),
})
export type AssetSyncStatus = z.infer<typeof assetSyncStatus>


export const assetListResponse = z.object({
  assets: z.array(asset).meta({
    description: 'Every asset stored for this robot: the URDF, the meshes it references, and the textures those paint with.',
  }),
  /**
   * **This field exists for the reload case.** A client that holds the
   * `sync_id` only in memory loses its progress display on a refresh, and the
   * state is still there server-side under `GET .../assets/sync/<id>` —
   * unreachable to anyone who did not keep the id. A page that loads fresh
   * presses no button; it asks this list, so this list has to say.
   */
  active_sync: assetSyncStatus.nullable().meta({
    description: 'The sync running right now, or `null`. It is on this list so a page that reloads and has lost the sync id can still show progress — a freshly loaded page presses no button, it asks this list.',
  }),
  urdf: urdfCompleteness.meta({
    description: 'Whether the stored URDF can actually be rendered, and what it is still missing. Not the same question as whether one was uploaded.',
  }),
  /**
   * What the connected bridge says it *could* transfer, which is deliberately
   * separate from what has been transferred. `null` when no bridge is
   * connected — distinct from `false`, because "no robot is online to ask" and
   * "the robot has no URDF" send a developer to two different places.
   *
   * The bridge answers by actively counting publishers on its own timer, so
   * both the appearance and the disappearance of a robot description are
   * noticed. A callback-driven answer can only see presence.
   *
   * **What a consumer needs to know is the clock.** An ungraceful loss — the
   * publisher process killed rather than shut down — is noticed on DDS's
   * liveliness timeout, not on the bridge's check interval. A clean
   * `destroy_node()` is visible in a second or two; a killed process can take
   * around twenty. So `true` can outlive the truth by some seconds after a
   * crash, and no amount of polling shortens it.
   */
  urdf_available: z.boolean().nullable().meta({
    description: 'What the connected bridge says it *could* transfer — deliberately separate from what has been transferred. `null` when no bridge is connected, distinct from `false`: "no robot is online to ask" and "the robot has no URDF" send a developer to different places. After a publisher is killed rather than shut down this can read `true` for some seconds, on the underlying DDS liveliness timeout rather than on any check made here.',
  }),
  /**
   * **How full this robot's store is, on the list that already names what is
   * in it.** A page showing assets is the page where "will the next sync fit"
   * is asked, and a second round trip to some quota endpoint would answer it
   * about the organisation instead — which is a different number about a
   * different thing.
   */
  store: z.object({
    bytes: z.number().int().positive().meta({
      description: 'The robot\'s asset store, `ROBOT_ASSET_STORE_BYTES`.',
    }),
    used_bytes: z.number().int().nonnegative().meta({
      description: 'Bytes its assets occupy.',
    }),
  }).meta({ description: 'How full this robot\'s store is.' }),
  /**
   * The datapoint that moves the joints in a renderer, chosen by a developer
   * and stored on the robot. It rides on this list because a client that has
   * just fetched the URDF and the meshes needs exactly one more thing to
   * animate them, and asking a second endpoint for one slug is a round trip
   * that buys nothing.
   *
   * `null` is an ordinary answer: none was ever chosen, or a publish removed
   * the datapoint it named and the cloud cleared the mapping rather than
   * leave it pointing at something that no longer qualifies.
   */
  joint_state_slug: slug.nullable().meta({
    description: 'The whole-message `sensor_msgs/msg/JointState` datapoint that drives the console\'s URDF viewer; null when none is chosen or a publish removed it. Set through `PUT /api/robots/:id/urdf/joint-state`.',
  }),
})
export type AssetListResponse = z.infer<typeof assetListResponse>

/**
 * What `DELETE /api/robots/:id/assets` answers — the store's escape hatch.
 *
 * A full store is never a dead end: the URDF upload is exempt from the gate,
 * reconcile after every sync already frees what the new URDF stopped
 * referencing, and this route is the third leg — an Owner can empty the
 * store outright and let the next sync refill it. `deleted` and
 * `bytes_freed` are what changed, not the store's state afterward — that is
 * `0` by construction and not worth a field of its own.
 */
export const assetsClearResponse = z.object({
  deleted: z.number().int().nonnegative().meta({
    description: 'How many assets — URDF, meshes and textures together — were removed.',
  }),
  bytes_freed: z.number().int().nonnegative().meta({
    description: 'The bytes the robot\'s store got back.',
  }),
})
export type AssetsClearResponse = z.infer<typeof assetsClearResponse>

/**
 * The query of `GET /api/robots/:id/assets/missing`, the placeholder a
 * rewritten URDF points at for a mesh Fleetless does not hold.
 *
 * **The route answers `404` either way** — this parameter changes the sentence,
 * never the outcome. It is echoed back into the refusal message so a developer
 * reading a failed mesh load learns *which* reference did not resolve; absent,
 * the message says `unknown`. Echoing it discloses nothing, since it is what
 * the caller itself sent.
 */
export const missingAssetQuery = z
  .object({
    name: z.string().optional().meta({
      description: 'The unresolved reference, as the URDF spelled it, echoed into the `404 asset_missing` message. Omitted, the message names `unknown` instead. It never changes the status.',
    }),
  })
  .meta({ description: 'The one optional parameter of the missing-asset placeholder; it names the reference in the refusal.' })
export type MissingAssetQuery = z.infer<typeof missingAssetQuery>

/**
 * What a `busy` refusal on an asset sync has to carry.
 *
 * A refusal that names a **state** — "a sync is already in progress" — and not
 * the **thing** in that state leaves the caller with nothing to look at. The
 * running sync is observable under `GET .../assets/sync/<id>`, but only to
 * someone who kept its id.
 *
 * These details serve the caller that presses the button again. A client that
 * reloads instead presses nothing, which is why `active_sync` sits on the
 * asset list as well.
 */
export const assetSyncBusyDetails = z.object({
  sync_id: z.uuid(),
  /** When it started, so "still running" is distinguishable from "stuck for an hour". */
  started_at_ms: z.number().int().nonnegative(),
})
export type AssetSyncBusyDetails = z.infer<typeof assetSyncBusyDetails>
