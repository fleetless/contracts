import { z } from 'zod'
import { slug } from './common.js'

/**
 * The MCP server of §17: **one** remote MCP endpoint for the whole platform,
 * whose tools are the exposed services and datapoints the signed-in user's
 * roles permit. The per-app `/mcp/<identifier>` servers this file once
 * described were deleted by the org-central identity redesign (D5/D6).
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

/**
 * The path of the **central** MCP server — what a *Fleetless user* pastes into
 * their AI tool, appended to the cloud's public base URL.
 *
 * **Not parameterised, and that is now a statement rather than the absence of
 * one.** The central endpoint serves the org's team with the console tool
 * family (2026-09-05, D7); an app's users reach a different endpoint, whose
 * path `mcpAppEndpointPath` builds. Two constants for two audiences, so a call
 * site says which it means instead of an argument deciding it.
 *
 * **The canonical URL is `<PUBLIC_API_BASE_URL>${MCP_ENDPOINT_PATH}`, not the
 * friendly alias.** `mcp.fleetless.dev` is a reverse proxy onto the same
 * cloud, but the cloud mints every OAuth issuer, resource and `aud` from
 * `PUBLIC_API_BASE_URL` and compares the token's `aud` against that string —
 * never against the request's `Host`. Hand out the canonical one.
 */
export const MCP_ENDPOINT_PATH = '/mcp' as const

/**
 * The path of **one app's** MCP server (D7) — what an app user pastes into
 * their AI tool, served only while the app's `appAuthConfig.mcp_enabled` is on.
 *
 * A helper rather than a template literal at four call sites, for
 * `OAUTH_PATHS`' reason: the console shows this string with a copy button, the
 * cloud registers the route from it, and the docs render it. A path spelled in
 * three places is a path two of them will one day spell differently — and this
 * repository has already paid for exactly that, with an `idpStart` entry naming
 * a route the cloud had deleted.
 *
 * **This is the path, not the URL.** Append it to `PUBLIC_API_BASE_URL`, the
 * canonical origin the cloud mints every issuer and audience from, rather than
 * to the friendly `mcp.fleetless.dev` alias — a token's `aud` is compared
 * against the canonical string and never against the request's `Host`.
 *
 * There was a `mcpEndpointPath(appIdentifier)` before, deleted with the per-app
 * endpoint in the central-MCP cut and remembered here because the shape of that
 * mistake is worth not repeating: the console kept offering a copy button for a
 * URL that answered `404`. This one exists **with** its endpoint, and the
 * cloud's route-manifest test is what keeps them together.
 */
export function mcpAppEndpointPath(appIdentifier: string): string {
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
 * One exposure of a robot, as `robot_describe` and the console's per-role
 * preview list it (FL-006). Every exposure the role grants is listed —
 * a missing `description` is shown as `null`, never used to hide the entry.
 *
 * `input_schema` is a JSON Schema document generated from an action's,
 * service's or publisher's `parameters`; `null` for the other kinds. It is
 * `unknown` for the same reason the retired `mcpToolPreview.input_schema`
 * was: pinning it would mean maintaining a zod description of JSON Schema.
 */
export const mcpExposure = z.object({
  slug,
  kind: mcpToolKind,
  description: z.string().max(2000).nullable(),
  /** A datapoint's `numeric.unit`, verbatim; `null` for every other kind and for a unitless datapoint. */
  unit: z.string().max(32).nullable(),
  /**
   * A datapoint's `numeric.decimals`, verbatim; `null` for every other kind
   * and for a datapoint that does not set it. Required-nullable rather than
   * optional for the same reason as `unit`: an omitted field would make a
   * producer that forgot the datapoint's configuration indistinguishable from
   * one reporting a datapoint that has none.
   */
  decimals: z.number().int().min(0).max(6).nullable(),
  input_schema: z.unknown().nullable(),
})
export type McpExposure = z.infer<typeof mcpExposure>

/** The two role capabilities a robot tool can need beyond a slug grant. `presence` is a stream and has no tool. */
export const mcpCapabilities = z.object({
  action_history: z.boolean(),
  assets: z.boolean(),
})
export type McpCapabilities = z.infer<typeof mcpCapabilities>

/** What one caller may do on one robot — the answer to `robot_describe`. */
export const mcpRobotDatasheet = z.object({
  robot_id: z.uuid(),
  robot_name: z.string().min(1).max(200),
  capabilities: mcpCapabilities,
  exposures: z.array(mcpExposure).max(2000),
})
export type McpRobotDatasheet = z.infer<typeof mcpRobotDatasheet>

/**
 * What a developer sees before an end user connects: the datasheet each
 * robot of the app would answer for one role. Replaces the per-slug tool
 * preview and its `omitted` list — with a fixed catalog there is no tool to
 * omit, only exposures to grant.
 */
export const mcpRolePreviewResponse = z.object({
  role_id: z.uuid(),
  robots: z.array(mcpRobotDatasheet).max(500),
})
export type McpRolePreviewResponse = z.infer<typeof mcpRolePreviewResponse>

/**
 * Where a signed asset link is served. An MCP session token is refused on
 * REST by design, so `asset_get`/`urdf_get` mint a bearer-free link the agent
 * behind the client can fetch. Lifetime is fixed; the token binds robot, asset
 * and expiry under `JWT_SECRET`.
 */
export const MCP_ASSET_LINK_PATH = '/api/asset-links' as const
export const MCP_ASSET_LINK_TTL_MS = 15 * 60 * 1000
