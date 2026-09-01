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
 * **`Row` names the stored row, not the document.** `config.ts`'s own
 * `alertCondition` is the definition nested inside a datapoint — a different
 * shape for a different question (`fire_at`/`resolve_at` rather than
 * `kind`/`threshold`/`resolve_hysteresis`). This one and `datapointAlertRow`
 * below are retired in wave 4, once the document is the only place an alert
 * is defined.
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

/** Mail throttle: at most one firing mail per alert per this many minutes. Events themselves are never throttled — only mail (D2). */
export const ALERT_COOLDOWN_MINUTES_DEFAULT = 15
/** A week. Not a documented product decision — a sanity ceiling so a typo (`15000`) doesn't silently mean "never mails again" rather than failing loudly. */
export const ALERT_COOLDOWN_MINUTES_MAX = 10_080
/** Fan-out bound, the same discipline as the other per-alert bounds in this file — a mistyped mailing list should fail validation, not become an incident. */
export const ALERT_RECIPIENTS_MAX = 20

/**
 * One alert row, definition and runtime state together — the runtime fields
 * (`state`, `state_since`, `last_value`) are DB-held so they survive a cloud
 * restart, and are read-only from every client's point of view: they never
 * appear on `createAlertRequest` or `patchAlertRequest` (pinned by
 * `alerts-shapes.test.ts` — a `PATCH` naming `state` is rejected by
 * `.strict()`, not silently ignored).
 *
 * **`Row`, because this is the stored row** — id, ownership, runtime state
 * and mail settings together. The document's own alert (`config.ts`'s
 * `datapointAlert`) is definition only, nested under its datapoint, and
 * sends no mail. Both exist through wave 4, which deletes this one.
 */
export const datapointAlertRow = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  slug,
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  severity: alertSeverity,
  condition: alertRowCondition,
  cooldown_minutes: z.number().int().min(1).max(ALERT_COOLDOWN_MINUTES_MAX),
  /**
   * Prefilled with the creating developer by the console, not by this
   * schema. **An empty list is a valid, meaningful state** — "no mail" — not
   * an omission this shape should refuse. Capped at `ALERT_RECIPIENTS_MAX`.
   */
  recipients: z.array(z.email()).max(ALERT_RECIPIENTS_MAX),
  notify_on_resolve: z.boolean(),
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
  /**
   * Whether this alert's `slug` is absent from the robot's published
   * config. Computed on read, not stored — it would otherwise need its own
   * write path kept in sync with every publish — and true for an absent
   * slug the same way a missing key reads as "not there" — **except when
   * the robot has no published config at all** (never published, or a
   * draft only): that case marks NOTHING orphaned, deliberately, not the
   * naive reading of "absent from an empty set". A robot pre-first-publish
   * has no config yet for a slug to be absent *from*, and a developer's
   * freshly created alert against their own unpublished draft must not
   * read as broken. Set only by `GET /api/robots/:id/alerts`; absent
   * (never `false`) from `createAlertRequest`/`patchAlertRequest`
   * responses and from `orgFiringAlertsResponse`, which have no
   * published-config context to compute it against at their call sites.
   * Optional, not required, so those other shapes — which share this same
   * entity — stay valid without carrying a field that does not apply to
   * them.
   */
  orphaned: z.boolean().optional(),
})
export type DatapointAlertRow = z.infer<typeof datapointAlertRow>

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
    condition: alertRowCondition,
    cooldown_minutes: z.number().int().min(1).max(ALERT_COOLDOWN_MINUTES_MAX).default(ALERT_COOLDOWN_MINUTES_DEFAULT),
    recipients: z.array(z.email()).max(ALERT_RECIPIENTS_MAX),
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
    condition: alertRowCondition.optional(),
    cooldown_minutes: z.number().int().min(1).max(ALERT_COOLDOWN_MINUTES_MAX).optional(),
    recipients: z.array(z.email()).max(ALERT_RECIPIENTS_MAX).optional(),
    notify_on_resolve: z.boolean().optional(),
  })
  .strict()
export type PatchAlertRequest = z.infer<typeof patchAlertRequest>

/** `GET /api/robots/:id/alerts` — the one route that sets `datapointAlertRow.orphaned` on every entry. */
export const alertListResponse = z.object({
  alerts: z.array(datapointAlertRow),
})
export type AlertListResponse = z.infer<typeof alertListResponse>

/**
 * `GET /api/org/alerts?state=firing` — feeds the overview's "open issues"
 * tile and the fleet grid's per-robot badge (D3). Org-scoped and
 * cross-robot, so each entry carries `robot_name` alongside the alert: the
 * overview has no robot context of its own to join against. Never sets
 * `orphaned` — this route has no per-robot published-config context to
 * compute it against, and the shape's own doc comment says so.
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
