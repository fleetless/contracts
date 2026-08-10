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
