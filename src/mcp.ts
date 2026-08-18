import { z } from 'zod'
import { slug } from './common.js'

/**
 * The MCP server of §17: a remote MCP endpoint per app, whose tools are the
 * exposed services and datapoints the end user's role permits.
 *
 * **This file describes the seam, not the protocol.** The MCP messages
 * themselves (`initialize`, `tools/list`, `tools/call`) are defined by the
 * Model Context Protocol and implemented with its official SDK — writing our
 * own zod copies of them would create a second source of truth for somebody
 * else's specification, which is the one thing this package exists to avoid.
 * What lives here is what *Fleetless* decides: which revision we speak, where
 * the endpoint is, how a tool is named, and what the console is shown before
 * an end user ever connects.
 */

/**
 * The protocol revision W7c speaks. Chosen with André on 2026-08-18 over the
 * newer `2026-07-28`.
 *
 * This is the latest revision the **stable** MCP TypeScript SDK ships, and it
 * negotiates down to `2024-11-05`, so it covers the AI tools that exist today.
 * `2026-07-28` is real and is where the protocol is going — it *removes*
 * Streamable HTTP's session ids, the standalone SSE channel and resumability,
 * and servers speaking only it answer `405` to GET and DELETE.
 *
 * **Which is why this server is stateless anyway.** Building sessions we would
 * have to delete again is work in the wrong direction, and a per-process
 * session map is the assumption that breaks at the second cloud instance —
 * the register already carries one row of exactly that shape
 * (`max_realtime_connections`), and W8 is where a second instance appears.
 */
export const MCP_PROTOCOL_VERSION = '2025-11-25' as const

/** The path an end user pastes into their AI tool. */
export function mcpEndpointPath(appIdentifier: string): string {
  return `/mcp/${appIdentifier}`
}

/**
 * Which exposed kind a tool came from. Not the MCP protocol's vocabulary —
 * ours, so the console can group a preview the way the services editor is
 * grouped.
 */
export const mcpToolKind = z.enum(['datapoint', 'service', 'action', 'publisher', 'camera'])
export type McpToolKind = z.infer<typeof mcpToolKind>

/** MCP's own bound on a tool name, and the charset that is safe across clients. */
export const MCP_TOOL_NAME_MAX = 128
export const mcpToolNamePattern = /^[a-z0-9][a-z0-9_-]*$/

/**
 * The separator between the robot part of a tool name and the service part.
 *
 * A double underscore rather than a dot or a slash: a slug is
 * `[a-z0-9-]`, so `__` cannot occur inside either half and the name splits
 * back apart unambiguously. Some clients also reject `.` and `/` in tool
 * names.
 */
export const MCP_TOOL_NAME_SEPARATOR = '__'

/**
 * The robot half of a tool name, derived from the robot's **id**.
 *
 * **Not from its name, and that is the whole point.** A tool name is an
 * identifier a model has already put in its context and may have been told
 * about by the user; §4.1's own reasoning for slugs applies one level up.
 * Renaming a robot in the console must not silently rename every tool, and
 * two robots may legitimately be called `RX1`. The human-readable name goes
 * in the tool's `title` and description, which is exactly what MCP defines
 * `title` for.
 *
 * Twelve hex characters, not thirty-two, because the whole name has to stay
 * under `MCP_TOOL_NAME_MAX` alongside a slug of up to 63 characters — and 48
 * bits is far past any collision an app's robot quota could produce. That is
 * an argument, not a guarantee, so `mcpRobotKeys` below **checks** rather than
 * assuming, and widens to the full id if it is ever wrong.
 */
export function mcpRobotKey(robotId: string, hexLength = 12): string {
  return `r${robotId.replace(/-/g, '').slice(0, hexLength)}`
}

/**
 * Keys for every robot of an app, guaranteed distinct.
 *
 * Re-derives the collision claim instead of trusting it — W7a's rule, which
 * was earned three times in one commit: *a bound is only a bound if somebody
 * re-derives the number rather than reading it.* If two twelve-character
 * prefixes ever collide, **every** key in the app widens to the full id
 * together, so the mapping stays a pure function of the robot set rather than
 * of the order they were added in.
 */
export function mcpRobotKeys(robotIds: readonly string[]): Map<string, string> {
  for (const hexLength of [12, 32]) {
    const keys = new Map<string, string>()
    for (const id of robotIds) keys.set(id, mcpRobotKey(id, hexLength))
    if (new Set(keys.values()).size === robotIds.length) return keys
  }
  /* Unreachable: two distinct uuids cannot share all 32 hex characters. */
  throw new Error('mcpRobotKeys: robot ids are not distinct')
}

/** `r<12 hex>__<slug>` — the name an AI tool calls. */
export function mcpToolName(robotKey: string, serviceSlug: string): string {
  return `${robotKey}${MCP_TOOL_NAME_SEPARATOR}${serviceSlug}`
}

/**
 * Why a slug a role grants produced no tool.
 *
 * **An open set deliberately, like `ERROR_CODES`** — a new reason must be
 * reportable without a contracts release, because the alternative is reporting
 * it as one of these and being wrong.
 */
export const MCP_OMISSION_REASONS = [
  /** The service carries no `description`, and a tool a model cannot understand is worse than no tool. */
  'no_description',
  /** A camera with no snapshot to take — §17 exposes a snapshot, never a live session. */
  'no_snapshot',
  /** The slug is granted by the role and exists in no published configuration. */
  'not_in_configuration',
  /** The role grants the slug but not the capability the kind needs (e.g. `assets`). */
  'capability_missing',
] as const
export type McpOmissionReason = (typeof MCP_OMISSION_REASONS)[number]

/**
 * One tool, as the console previews it.
 *
 * `input_schema` is `unknown` on purpose: it is a **JSON Schema document**
 * generated from `parameterSpec[]` and `valueRule`, and pinning its shape here
 * would mean maintaining a zod description of JSON Schema. The console renders
 * it; nothing validates against it in TypeScript.
 */
export const mcpToolPreview = z.object({
  name: z.string().min(1).max(MCP_TOOL_NAME_MAX).regex(mcpToolNamePattern),
  /** The human-readable label — where the robot's actual name goes. */
  title: z.string().min(1).max(200),
  /**
   * **Four thousand, not two thousand, and the difference is the point.**
   *
   * `serviceDescription` bounds what a *developer writes* at 2000. This bounds
   * what the *generator produces*, which is that text **plus** what it folds
   * in — a datapoint's `Unit:` and `Plausible range:`, a camera's fixed
   * sentence about snapshots. Measured by Kassandra-W7c and Momus-W7c
   * independently: a maximal description came back at 2036–2068 characters
   * against a 2000 bound, so the cloud served a document its own contract
   * rejected — silently, because the route returns a typed literal without
   * parsing it.
   *
   * **Do not "tidy" these two numbers into agreement.** They describe
   * different things, and making them equal reintroduces the defect: either
   * the generator truncates a developer's own words, or the response
   * overflows again. The gap is the room the generator needs.
   */
  description: z.string().min(1).max(4000),
  robot_id: z.uuid(),
  slug,
  kind: mcpToolKind,
  input_schema: z.unknown(),
})
export type McpToolPreview = z.infer<typeof mcpToolPreview>

/** A slug the role grants that produced no tool, with the reason it did not. */
export const mcpOmission = z.object({
  robot_id: z.uuid(),
  slug,
  /** One of `MCP_OMISSION_REASONS`; the wire allows any string, as with `ERROR_CODES`. */
  reason: z.string().min(1),
  message: z.string().min(1),
})
export type McpOmission = z.infer<typeof mcpOmission>

/**
 * What a developer sees **before** an end user ever connects: the exact tool
 * list one role would be offered.
 *
 * **`omitted` is not decoration, and it is the half that will be cut if
 * nobody says this.** A developer who grants a slug and is shown no tool has
 * to be told which reason applies. §3.3 makes `forbidden` deliberately silent
 * about existence — but that is a rule about *end users*, and this screen has
 * none: it belongs to the person who owns every object on it, where silence is
 * only ever a bug report. The console's own history has the matching scar:
 * three cameras were configured that no end user could reach, and the symptom
 * was that they were simply not there.
 */
export const mcpToolPreviewResponse = z.object({
  role_id: z.uuid(),
  tools: z.array(mcpToolPreview).max(500),
  omitted: z.array(mcpOmission).max(500),
})
export type McpToolPreviewResponse = z.infer<typeof mcpToolPreviewResponse>
