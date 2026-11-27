// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * Why the robot refused to start a camera's live video, as a class
 * (fleetless/fleetless#1126). The cloud maps the bridge's `error.code` to one
 * of these and to a fixed sentence; the bridge's `error.message` is free text
 * and never leaves the cloud, because a camera password has appeared in one.
 *
 * - `low_bandwidth` — the bridge is in low-bandwidth mode and refuses new
 *   streams until the link recovers. Snapshots go on. Not an error.
 * - `source_auth` — the camera source refused the configured credentials.
 * - `source_unreachable` — the camera source could not be reached or used.
 * - `not_startable` — the bridge could not start this camera's live video
 *   for a reason of its own configuration or encoder; the bridge's log names
 *   it.
 * - `unknown` — a code this cloud does not know yet.
 *
 * A consumer that switches over it has a fallback to keep: the list can
 * grow in a minor.
 */
export const LIVE_START_REFUSALS = ['low_bandwidth', 'source_auth', 'source_unreachable', 'not_startable', 'unknown'] as const

export const liveStartRefusal = z.enum(LIVE_START_REFUSALS).meta({
  description:
    'Why the robot refused to start live video: `low_bandwidth` (the link is weak; snapshots go on), `source_auth` (the source refused the credentials), `source_unreachable` (the source could not be reached), `not_startable` (the bridge could not start it; its log says why), `unknown` (a reason this cloud does not know yet).',
})
export type LiveStartRefusal = z.infer<typeof liveStartRefusal>

/**
 * The `details` of a `409 camera_offline` refusal of `POST
 * /api/robots/:id/cameras/:slug/live` (fleetless/fleetless#1126): the robot
 * already refused the current attempt to start this camera's live video. The
 * error's `message` is the cloud's fixed sentence for `refusal`, never the
 * robot's own words.
 */
export const cameraOfflineDetails = z.object({
  refusal: liveStartRefusal,
})
export type CameraOfflineDetails = z.infer<typeof cameraOfflineDetails>
