import { z } from 'zod'

/**
 * Names shared by every layer: the Fleetless slug and the ROS names it is
 * deliberately decoupled from (spec §4.1).
 *
 * They live here rather than in `protocol.ts` so the exposure model
 * (`config.ts`) and the bridge protocol can both use them without importing
 * each other.
 */

/**
 * A slug names an exposed service or datapoint: lowercase, dash-separated,
 * letter-initial, 2..63 characters, no leading/trailing/doubled dashes.
 * Slugs are stable and decoupled from ROS names (spec §4.1) — renaming a
 * topic on the robot must never break a client app.
 */
export const slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)

/**
 * A fully qualified ROS graph name: absolute, slash-separated, each segment
 * letter- or underscore-initial. Relative names are refused — the bridge
 * would have to resolve them against a namespace the cloud cannot see.
 */
export const rosName = z
  .string()
  .max(255)
  .regex(/^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/)

/**
 * A ROS interface type as ROS 2 spells it: `pkg/msg/Type`, `pkg/srv/Type`,
 * `pkg/action/Type`. W2 resolves field trees for `msg` only (§4.5); the
 * other two are listed by the introspection browser and get their trees in
 * W4, where action and service parameters exist.
 */
export const rosTypeName = z
  .string()
  .max(255)
  .regex(/^[a-z][a-z0-9_]*\/(?:msg|srv|action)\/[A-Za-z][A-Za-z0-9]*$/)

/**
 * A path into a message: dot-separated field names with optional array
 * indices, e.g. `percentage`, `pose.position.x`, `ranges[0]`. `null` in a
 * datapoint config means *the whole message* (spec §4.2: one field or one
 * whole topic — never several topics).
 */
export const fieldPath = z
  .string()
  .max(255)
  .regex(/^[a-z_][a-z0-9_]*(?:\[\d+\])*(?:\.[a-z_][a-z0-9_]*(?:\[\d+\])*)*$/)

/**
 * A unix-millisecond instant as a **query string** actually carries it, bounded
 * to years 1..9999.
 *
 * The union's input branch **is the wire** — a `z.coerce` cannot be published,
 * because zod renders the coercion's result in either `io` direction, so the
 * artifact would describe a shape a query string can never carry (DEF-059).
 *
 * The year bound is borrowed rather than invented: `nonnegative()` alone let
 * `253402300800000` through, where the Postgres bind path has no representation
 * and the route answered 500 — measured either side of the edge,
 * `253402300799000` -> 200 and `253402300800000` -> 500 (Argus-W9). This moved
 * here from `audit.ts` when `jobRunQuery` needed the same guard; a second copy
 * would have been a second policy for one decision.
 */
/**
 * A `seq` cursor as a **query string** actually carries it.
 *
 * The regex admits 19 digits, which is wider than a JavaScript number can
 * represent — `Number('9999999999999999999')` is `1e19`. That is safe, and
 * for a reason worth writing down rather than re-deriving: **zod 4's `.int()`
 * bounds the safe-integer range**, so such a value is refused here with a
 * `too_big` issue and the route answers 400. It never reaches Postgres as an
 * out-of-range `bigint`, and no extra `.max()` is needed — one that merely
 * restated `.int()` would be a second policy for one decision.
 *
 * Lives here because `auditQuery` and `jobRunQuery` had this **twice**, which
 * is how the newer copy ends up the weaker one.
 *
 * **What the published artifact does not say:** zod renders a
 * `.transform().pipe()` from its *input* branch, so the JSON Schema shows the
 * union and none of the constraints below it — a generated client reading it
 * would believe `-5` is acceptable. The runtime is the authority for this
 * field; the artifact describes only what the wire may carry.
 */
export const wireSeqCursor = z
  .union([z.string().regex(/^\d{1,19}$/), z.number().int()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive())

export const wireTimestampMs = z
  .union([z.string().regex(/^\d{1,15}$/), z.number().int()])
  .transform((v) => Number(v))
  .pipe(
    z
      .number()
      .int()
      .nonnegative()
      .refine((ms) => {
        const year = new Date(ms).getUTCFullYear()
        return Number.isFinite(year) && year >= 1 && year <= 9999
      }, 'must fall within years 1..9999'),
  )
