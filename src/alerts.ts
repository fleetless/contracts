import { z } from 'zod'
import { slug } from './common.js'

/**
 * Datapoint alerts and per-datapoint chart display config (spec
 * `2026-08-28-alerts-and-datapoint-modal-design`, D1/D2/D5).
 *
 * An alert is a **state machine** (`ok ⇄ firing`), not a fire-once event —
 * the definition (this file's request/entity shapes) and the runtime state
 * (`state`, `state_since`, `last_value`) share one row, evaluated by the
 * cloud at ingest.
 *
 * **Both tables moved into `robotConfigDoc` in FL-002.** The alert definition
 * is `config.ts`'s `datapointAlert`, nested under the datapoint it watches;
 * the chart bounds are `datapointChart`. They therefore take effect on
 * publish rather than immediately, and in exchange every change to them is
 * versioned, comparable and revertible. The runtime state stays wherever the
 * definition goes: it belongs in the database and has no business in a
 * versioned document.
 *
 * **What is left here is the read surface**, which FL-002 wave 4 kept rather
 * than deleted: `GET /api/robots/:id/alerts` and `GET /api/org/alerts` still
 * answer with the definition joined to its state, and the shapes below are
 * what they answer with. What wave 4 did remove is the mail path — the fields
 * `cooldown_minutes`, `recipients` and `notify_on_resolve`, and the two
 * bounds that guarded them. No alert can send mail, so nothing here describes
 * one.
 */

/**
 * `above`/`below` compare the numeric sample value (already scale/offset
 * applied by the bridge) against `threshold`. `resolve_hysteresis` (≥ 0,
 * **defaulted to 0** — plain re-cross) moves the resolve point off the
 * threshold itself: `above` resolves at `value ≤ threshold −
 * resolve_hysteresis`, mirrored for `below`. Defaulted rather than left
 * `optional` so a parsed entity never makes a consumer re-derive "absent
 * means 0" — the cloud always sends an explicit resolve point, and every
 * reader gets the same number whether it was sent or not. `equals` compares
 * the raw value for equality — the shape for boolean/string datapoints a
 * threshold cannot describe ("Hindernis erkannt" = `equals true`) — and
 * carries no hysteresis, because equality has no direction to relax.
 *
 * A discriminated union on `kind` rather than one object with optional
 * fields: an `equals` alert carrying a stray `threshold` would otherwise
 * parse silently and mean nothing, and a consumer's `switch (kind)` fails
 * `tsc` on an unhandled member instead of failing at runtime on a `never`.
 *
 * **Each member is `.strict()`, not the union's default `z.object`.** A
 * plain `z.object` strips unknown keys silently rather than refusing them —
 * so without this, `{kind: 'equals', value: true, threshold: 5}` would
 * parse successfully with `threshold` dropped on the floor, which is exactly
 * the "parse silently and mean nothing" failure the paragraph above already
 * argued against, just one layer further in.
 *
 * **`Row` distinguishes this from the document's own condition.**
 * `config.ts`'s `alertCondition` is what an author writes inside a datapoint —
 * a different shape for a different question (`fire_at`/`resolve_at` rather
 * than `kind`/`threshold`/`resolve_hysteresis`). This one is what the
 * evaluator switches on and what the read routes answer with; the cloud
 * derives it from the document (`alert-definitions.ts`'s `toRowCondition`) and
 * derives it nowhere else.
 *
 * **It was renamed for a wave 4 deletion that did not happen**, and the name
 * is kept because the distinction it draws is still needed: two condition
 * shapes coexist, and only one of them is authored. Nothing is stored under
 * this shape any more — the database keeps runtime state only — so read `Row`
 * as "the derived one", not as "the persisted one".
 */
export const alertRowCondition = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('above'),
    threshold: z.number().finite(),
    resolve_hysteresis: z.number().nonnegative().default(0),
  }),
  z.strictObject({
    kind: z.literal('below'),
    threshold: z.number().finite(),
    resolve_hysteresis: z.number().nonnegative().default(0),
  }),
  z.strictObject({
    kind: z.literal('equals'),
    /** A JSON scalar, matching what a datapoint value actually is on the wire — never an object or array. */
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
])
export type AlertRowCondition = z.infer<typeof alertRowCondition>

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

/**
 * One alert row, definition and runtime state together — the runtime fields
 * (`state`, `state_since`, `last_value`) are DB-held so they survive a cloud
 * restart, and are read-only from every client's point of view: nothing
 * writes them from outside the cloud's own evaluator.
 *
 * **`Row` is a name the shape outgrew**, kept only to keep it apart from
 * `config.ts`'s `datapointAlert`, which is the definition an author writes.
 * Nothing is stored in this shape: the definition comes out of the published
 * document and the runtime state out of `datapoint_alert_state`, and the
 * cloud joins the two per request (`routes/alerts.ts`'s `toWire`).
 *
 * **It carried three mail settings — `cooldown_minutes`, `recipients` and
 * `notify_on_resolve` — and FL-002 wave 4 removed them with the mail path.**
 * The format has no mail fields, so no alert could be configured to send one;
 * the three had nothing behind them well before they were deleted.
 */
export const datapointAlertRow = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  slug,
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  severity: alertSeverity,
  condition: alertRowCondition,
  state: alertState,
  /** `null` only until the first evaluation writes a state; every alert is created `ok` (D2), so in practice this is set from creation onward. */
  state_since: z.iso.datetime().nullable(),
  /**
   * The value at the alert's last state transition — written only when the
   * alert fires or resolves, never on a per-sample basis. This is a
   * deliberate cost trade, not an oversight: a per-sample write would turn
   * every accepted sample into a DB write regardless of whether anything
   * changed, which is exactly the hot-path cost the evaluator avoids
   * everywhere else. It follows that this is NOT "the datapoint's current
   * value" — for that, read the live snapshot (`datapointValue`, or the
   * realtime datapoint stream), never this field. `null` before the
   * alert's first transition, and returns to `null` when a `PATCH`
   * replaces `condition` wholesale — the old value was judged against the
   * old condition, and the store resets runtime state in that same write
   * rather than let it survive a condition change it no longer means
   * anything against.
   */
  last_value: z.unknown().nullable(),
  created_at: z.iso.datetime(),
})
export type DatapointAlertRow = z.infer<typeof datapointAlertRow>

/** `GET /api/robots/:id/alerts`. */
export const alertListResponse = z.object({
  alerts: z.array(datapointAlertRow),
})
export type AlertListResponse = z.infer<typeof alertListResponse>

/**
 * `GET /api/org/alerts?state=firing` — feeds the overview's "open issues"
 * tile and the fleet grid's per-robot badge (D3). Org-scoped and
 * cross-robot, so each entry carries `robot_name` alongside the alert: the
 * overview has no robot context of its own to join against.
 */
export const orgFiringAlertsResponse = z.object({
  alerts: z.array(datapointAlertRow.extend({ robot_name: z.string().min(1).max(63) })),
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
