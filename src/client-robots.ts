// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { bridgeState } from './protocol.js'
import { robot } from './rest.js'

/* ------------------------------------------ the robots an app user reaches */

/**
 * One robot as `GET /api/client/robots` lists it — the REST twin of the MCP
 * tool `robots_list`, and the one robot question no robot-scoped route can
 * answer: which robots may I name at all.
 *
 * Deliberately not `robotListItem`: that one carries `exposes`, the per-kind
 * counts a developer's list shows, which are a configuration fact rather than
 * something an app user's role grants. What an app user is entitled to is the
 * robot, its bridge state, and whether anything is published on it yet.
 */
export const clientRobotListItem = z.object({
  ...robot.shape,
  bridge_state: bridgeState.meta({
    description: 'The built-in `bridge_state` datapoint as the cloud observes it right now: whether the bridge is connected, and its latency when it is.',
  }),
  published_version: z.number().int().positive().nullable().meta({
    description: 'The published configuration version, or `null` when nothing has been published yet. A robot with nothing published is still listed — "not configured yet" is a real state, and the caller is entitled to it — and its datasheet answers an empty exposure list.',
  }),
})
export type ClientRobotListItem = z.infer<typeof clientRobotListItem>

/** What `GET /api/client/robots` answers. Never null: a caller who reaches nothing gets an empty array, and an absent key would make "nothing" and "not answered" the same reading. */
export const clientRobotListResponse = z.object({
  robots: z.array(clientRobotListItem).meta({
    description: 'Every robot the caller reaches, in name order with the id as the tiebreak. An app user reaches the robots their app attaches on which their role grants at least one slug or capability; a server key reaches every robot its app attaches; a developer reaches every robot of the organisation.',
  }),
})
export type ClientRobotListResponse = z.infer<typeof clientRobotListResponse>
