import { z } from 'zod'

/**
 * Audit (spec §16). Every state-changing interaction is recorded and **every
 * entry carries its actor — never anonymous** (§16.2). Reads are not audited.
 *
 * W3 writes the events that exist once identities do: logins, failed logins,
 * end-user management, config publishes, bridge connect/disconnect. The view
 * with filters, CSV export and the 90-day retention window is W6 (André,
 * 2026-08-10) — same shape of work as the history API.
 */

/**
 * The four kinds of actor the platform knows (§3.4). `label` is what a human
 * reads in the log — an email, a key name, a robot name — so the console
 * never has to resolve four different id kinds to render a row.
 */
export const auditActor = z.object({
  kind: z.enum(['developer', 'end_user', 'server_key', 'bridge']),
  id: z.uuid(),
  label: z.string().min(1).max(200),
})
export type AuditActor = z.infer<typeof auditActor>

export const auditEvent = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  at: z.iso.datetime(),
  /**
   * A monotonic counter, ascending in write order, unique across the log
   * (W6b).
   *
   * `at` is not a total order. Two events written in the same millisecond —
   * a login and the config publish it enables, a cascade writing several
   * rows — sort against each other arbitrarily, and "arbitrarily" means
   * *differently on each query*. A reader paging through "newest first" can
   * therefore see one of them twice and the other not at all, which is the
   * one failure mode an audit log may not have: a record that is present and
   * invisible.
   *
   * It is also the only correct **cursor** for paging this log, for the same
   * reason: a cursor that is not unique either skips rows or repeats them at
   * every page boundary. No cursor parameter exists on `GET /api/audit` yet —
   * the route returns the whole log — and that is stated here rather than
   * implied, because a contract that describes a capability the API does not
   * have is the defect this project keeps finding. When paging is added it
   * uses this field; nothing else in this shape can carry it.
   *
   * Required, not optional: an event without a sequence cannot be ordered
   * against one that has it, and a log with two orderings has none.
   */
  seq: z.number().int().positive(),
  actor: auditActor,
  /** Stable dotted name, e.g. `end_user.invited`, `config.published`. */
  action: z.string().min(1).max(80),
  /**
   * What the action was about, if anything — a robot, an app, a user. Free
   * of ids the console cannot resolve: carry the label with it.
   */
  target: z
    .object({
      kind: z.string().min(1).max(40),
      id: z.string().min(1),
      label: z.string().min(1).max(200),
    })
    .nullable(),
  /** Action-specific extras. Never credentials, never tokens. */
  details: z.record(z.string(), z.unknown()).nullable(),
})
export type AuditEvent = z.infer<typeof auditEvent>

export const auditListResponse = z.object({
  events: z.array(auditEvent),
})
export type AuditListResponse = z.infer<typeof auditListResponse>
