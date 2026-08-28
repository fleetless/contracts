import { z } from 'zod'
import { slug } from './common.js'

/**
 * Datapoint alerts and per-datapoint chart display config (spec
 * `2026-08-28-alerts-and-datapoint-modal-design`, D1/D2/D5).
 *
 * An alert is a **state machine** (`ok ⇄ firing`), not a fire-once event —
 * the definition (this file's request/entity shapes) and the runtime state
 * (`state`, `state_since`, `last_value`) share one row, evaluated by the
 * cloud at ingest. Neither table is part of `robotConfigDoc`: both apply
 * immediately, with no publish step, which is the whole reason they are
 * their own entity rather than a datapoint config field.
 */

/**
 * `above`/`below` compare the numeric sample value (already scale/offset
 * applied by the bridge) against `threshold`. `resolve_hysteresis` (≥ 0,
 * default 0 — plain re-cross) moves the resolve point off the threshold
 * itself: `above` resolves at `value ≤ threshold − resolve_hysteresis`,
 * mirrored for `below`. `equals` compares the raw value for equality — the
 * shape for boolean/string datapoints a threshold cannot describe ("Hindernis
 * erkannt" = `equals true`) — and carries no hysteresis, because equality has
 * no direction to relax.
 *
 * A discriminated union on `kind` rather than one object with optional
 * fields: an `equals` alert carrying a stray `threshold` would otherwise
 * parse silently and mean nothing, and a consumer's `switch (kind)` fails
 * `tsc` on an unhandled member instead of failing at runtime on a `never`.
 */
export const alertCondition = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('above'),
    threshold: z.number().finite(),
    resolve_hysteresis: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('below'),
    threshold: z.number().finite(),
    resolve_hysteresis: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('equals'),
    /** A JSON scalar, matching what a datapoint value actually is on the wire — never an object or array. */
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
])
export type AlertCondition = z.infer<typeof alertCondition>

/**
 * Assigned at creation, carried onto every `orgEventKind: 'alert'` firing
 * event verbatim (resolved events are always `info` — see
 * `orgEventKind`'s doc comment in `realtime.ts`).
 */
export const alertSeverity = z.enum(['warning', 'error'])
export type AlertSeverity = z.infer<typeof alertSeverity>

/** The two states of the alert state machine. There is no third state — an alert is never "unknown" or "pending"; it holds its last state across non-comparable samples (D2). */
export const alertState = z.enum(['ok', 'firing'])
export type AlertState = z.infer<typeof alertState>

/** Mail throttle: at most one firing mail per alert per this many minutes. Events themselves are never throttled — only mail (D2). */
export const ALERT_COOLDOWN_MINUTES_DEFAULT = 15

/**
 * One alert row, definition and runtime state together — the runtime fields
 * (`state`, `state_since`, `last_value`) are DB-held so they survive a cloud
 * restart, and are read-only from every client's point of view: they never
 * appear on `createAlertRequest` or `patchAlertRequest` (pinned by
 * `alerts-shapes.test.ts` — a `PATCH` naming `state` is rejected by
 * `.strict()`, not silently ignored).
 */
export const datapointAlert = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  slug,
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  severity: alertSeverity,
  condition: alertCondition,
  cooldown_minutes: z.number().int().min(1),
  /**
   * Prefilled with the creating developer by the console, not by this
   * schema. **An empty list is a valid, meaningful state** — "no mail" — not
   * an omission this shape should refuse.
   */
  recipients: z.array(z.email()),
  notify_on_resolve: z.boolean(),
  state: alertState,
  /** `null` only until the first evaluation writes a state; every alert is created `ok` (D2), so in practice this is set from creation onward. */
  state_since: z.iso.datetime().nullable(),
  /** The last sample value the evaluator saw for this slug, whatever shape that datapoint carries — same `unknown` as `datapointValue.value`. `null` before the first sample. */
  last_value: z.unknown().nullable(),
  created_at: z.iso.datetime(),
})
export type DatapointAlert = z.infer<typeof datapointAlert>

/**
 * `POST /api/robots/:id/alerts`. `robot_id` comes from the path, never the
 * body (the usual split — see `renameSlugRequest`'s sibling shapes). No
 * `id` and none of the three runtime-state fields: those are the cloud's to
 * assign, and a caller-supplied `state` would let a client fabricate a
 * firing alert that never fired.
 *
 * `enabled` defaults to `true` — a created alert is active unless the caller
 * says otherwise, matching `notify_on_resolve`'s and `cooldown_minutes`'s
 * defaults below being the common case, not the exceptional one.
 */
export const createAlertRequest = z
  .object({
    slug,
    name: z.string().min(1).max(120),
    enabled: z.boolean().default(true),
    severity: alertSeverity,
    condition: alertCondition,
    cooldown_minutes: z.number().int().min(1).default(ALERT_COOLDOWN_MINUTES_DEFAULT),
    recipients: z.array(z.email()),
    notify_on_resolve: z.boolean().default(false),
  })
  .strict()
export type CreateAlertRequest = z.infer<typeof createAlertRequest>

/**
 * `PATCH /api/robots/:id/alerts/:alertId`. Every definition field is
 * optional (a caller changes one thing at a time — flip `enabled`, tighten
 * `threshold`), and `slug` is **absent**, not merely un-required: an alert's
 * slug does not travel through this route at all. The one case that moves
 * it — a datapoint rename — is the atomic slug-rename transaction touching
 * the row server-side, not a developer-issued PATCH.
 *
 * `state`/`state_since`/`last_value` are never accepted here — pinned by
 * `alerts-shapes.test.ts` — for the same reason they are absent from
 * `createAlertRequest`.
 */
export const patchAlertRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    severity: alertSeverity.optional(),
    condition: alertCondition.optional(),
    cooldown_minutes: z.number().int().min(1).optional(),
    recipients: z.array(z.email()).optional(),
    notify_on_resolve: z.boolean().optional(),
  })
  .strict()
export type PatchAlertRequest = z.infer<typeof patchAlertRequest>

/** `GET /api/robots/:id/alerts`. */
export const alertListResponse = z.object({
  alerts: z.array(datapointAlert),
})
export type AlertListResponse = z.infer<typeof alertListResponse>

/**
 * `GET /api/org/alerts?state=firing` — feeds the overview's "open issues"
 * tile and the fleet grid's per-robot badge (D3). Org-scoped and
 * cross-robot, so each entry carries `robot_name` alongside the alert: the
 * overview has no robot context of its own to join against.
 */
export const orgFiringAlertsResponse = z.object({
  alerts: z.array(datapointAlert.extend({ robot_name: z.string().min(1).max(63) })),
})
export type OrgFiringAlertsResponse = z.infer<typeof orgFiringAlertsResponse>

/**
 * `GET /api/robots/:id/datapoints/:slug/display` — chart display config from
 * the modal's Chart tab (D1, D4). `robot_id`/`slug` live in the path, not
 * the body; there is exactly one row per `(robot_id, slug)`, so there is
 * nothing to list or identify beyond the path itself.
 *
 * `null` means auto-scale — the uPlot chart's default — not "unset versus
 * zero": a bound of literal `0` is a real, common y-axis floor and must
 * round-trip as `0`, not fall back to auto because it was falsy.
 */
export const datapointDisplay = z.object({
  y_min: z.number().finite().nullable(),
  y_max: z.number().finite().nullable(),
})
export type DatapointDisplay = z.infer<typeof datapointDisplay>

/**
 * `PUT /api/robots/:id/datapoints/:slug/display` — applies immediately,
 * never published, never sent to the bridge (D1). Same shape as
 * `datapointDisplay`, kept as its own type per house convention (`put*Request`
 * beside the entity it writes) so the two can diverge if the read side ever
 * grows a field the write side should not accept.
 */
export const putDatapointDisplayRequest = z
  .object({
    y_min: z.number().finite().nullable(),
    y_max: z.number().finite().nullable(),
  })
  .strict()
export type PutDatapointDisplayRequest = z.infer<typeof putDatapointDisplayRequest>
