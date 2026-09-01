import { describe, expect, it } from 'vitest'
import {
  alertRowCondition as alertCondition,
  datapointAlertRow as datapointAlert,
  createAlertRequest,
  patchAlertRequest,
  alertListResponse,
  orgFiringAlertsResponse,
  datapointDisplay,
  putDatapointDisplayRequest,
  orgEvent,
  slugUsageResponse,
} from '../src/index.js'

// Valid UUIDs: zod 4's z.uuid() enforces the version and variant nibbles, so
// `11111111-1111-1111-1111-111111111111` is refused (see org-events.test.ts).
const ROBOT = '22222222-4222-8222-9222-222222222222'
const ALERT = '33333333-4333-8333-9333-333333333333'
const NOW = '2026-08-28T20:00:00.000Z'

const VALID_ALERT = {
  id: ALERT,
  robot_id: ROBOT,
  slug: 'battery_voltage',
  name: 'Battery low',
  enabled: true,
  severity: 'warning' as const,
  condition: { kind: 'below' as const, threshold: 20 },
  cooldown_minutes: 15,
  recipients: ['dev@example.com'],
  notify_on_resolve: false,
  state: 'ok' as const,
  state_since: null,
  last_value: null,
  created_at: NOW,
}

describe('alertCondition — discriminated union on kind', () => {
  it('above requires a numeric threshold', () => {
    expect(alertCondition.safeParse({ kind: 'above', threshold: 10 }).success).toBe(true)
    // Required-field pin: an `above` with no threshold at all must be
    // rejected, not silently accepted as "no bound".
    expect(alertCondition.safeParse({ kind: 'above' }).success).toBe(false)
  })

  it('below requires a numeric threshold too — the mirror of above', () => {
    expect(alertCondition.safeParse({ kind: 'below', threshold: 10 }).success).toBe(true)
    expect(alertCondition.safeParse({ kind: 'below' }).success).toBe(false)
  })

  it('resolve_hysteresis is optional on input but non-negative when present', () => {
    expect(alertCondition.safeParse({ kind: 'above', threshold: 10, resolve_hysteresis: 0 }).success).toBe(true)
    expect(alertCondition.safeParse({ kind: 'above', threshold: 10, resolve_hysteresis: 2 }).success).toBe(true)
    // Bounds pin: -1 must be refused, not clamped or silently accepted.
    expect(alertCondition.safeParse({ kind: 'above', threshold: 10, resolve_hysteresis: -1 }).success).toBe(false)
  })

  it('resolve_hysteresis defaults to 0 when absent, on both above and below', () => {
    expect(alertCondition.parse({ kind: 'above', threshold: 10 })).toMatchObject({ resolve_hysteresis: 0 })
    expect(alertCondition.parse({ kind: 'below', threshold: 10 })).toMatchObject({ resolve_hysteresis: 0 })
  })

  it('above rejects an unrecognized key — each union member is .strict(), not zod\'s default strip', () => {
    expect(alertCondition.safeParse({ kind: 'above', threshold: 10, value: true }).success).toBe(false)
  })

  it('equals rejects a stray threshold — the exact silent-drop this schema\'s doc comment used to be wrong about', () => {
    expect(alertCondition.safeParse({ kind: 'equals', value: true, threshold: 5 }).success).toBe(false)
  })

  it('equals accepts a JSON scalar and refuses object/array values', () => {
    expect(alertCondition.safeParse({ kind: 'equals', value: true }).success).toBe(true)
    expect(alertCondition.safeParse({ kind: 'equals', value: 'obstacle' }).success).toBe(true)
    expect(alertCondition.safeParse({ kind: 'equals', value: 42 }).success).toBe(true)
    // An object value would parse as *something* if `value` were `z.unknown()`
    // — the discriminated union's refinement is exactly that it does not.
    expect(alertCondition.safeParse({ kind: 'equals', value: { nested: true } }).success).toBe(false)
    expect(alertCondition.safeParse({ kind: 'equals', value: [1, 2] }).success).toBe(false)
  })

  it('an unknown kind is rejected', () => {
    expect(alertCondition.safeParse({ kind: 'exceeds', threshold: 10 }).success).toBe(false)
  })
})

describe('datapointAlert — the entity, definition + runtime state together', () => {
  it('parses a valid alert', () => {
    expect(datapointAlert.parse(VALID_ALERT).state).toBe('ok')
  })

  it('pins the 120-char name bound', () => {
    expect(datapointAlert.safeParse({ ...VALID_ALERT, name: 'a'.repeat(120) }).success).toBe(true)
    expect(datapointAlert.safeParse({ ...VALID_ALERT, name: 'a'.repeat(121) }).success).toBe(false)
  })

  it('state_since and last_value are nullable', () => {
    expect(datapointAlert.parse({ ...VALID_ALERT, state_since: NOW, last_value: 19.4 }).last_value).toBe(19.4)
    expect(datapointAlert.parse({ ...VALID_ALERT, state_since: null, last_value: null }).last_value).toBeNull()
  })

  it('a parsed entity never needs to re-derive "absent means 0" — resolve_hysteresis defaults on the entity too', () => {
    const parsed = datapointAlert.parse({ ...VALID_ALERT, condition: { kind: 'below', threshold: 20 } })
    expect(parsed.condition).toMatchObject({ resolve_hysteresis: 0 })
  })

  it('orphaned is optional — an entity without it still parses (create/patch responses, org firing endpoint)', () => {
    const parsed = datapointAlert.parse(VALID_ALERT)
    expect(parsed.orphaned).toBeUndefined()
  })

  it('orphaned is accepted when boolean, in both directions', () => {
    expect(datapointAlert.parse({ ...VALID_ALERT, orphaned: true }).orphaned).toBe(true)
    expect(datapointAlert.parse({ ...VALID_ALERT, orphaned: false }).orphaned).toBe(false)
  })

  it('orphaned rejects a non-boolean value rather than coercing it', () => {
    expect(datapointAlert.safeParse({ ...VALID_ALERT, orphaned: 'true' }).success).toBe(false)
    expect(datapointAlert.safeParse({ ...VALID_ALERT, orphaned: 1 }).success).toBe(false)
    expect(datapointAlert.safeParse({ ...VALID_ALERT, orphaned: null }).success).toBe(false)
  })

  it('caps recipients at ALERT_RECIPIENTS_MAX (20)', () => {
    expect(datapointAlert.safeParse({ ...VALID_ALERT, recipients: Array(20).fill('dev@example.com') }).success).toBe(
      true,
    )
    expect(datapointAlert.safeParse({ ...VALID_ALERT, recipients: Array(21).fill('dev@example.com') }).success).toBe(
      false,
    )
  })
})

describe('createAlertRequest — strict, no id/state fields, defaults', () => {
  const BASE = {
    slug: 'battery_voltage',
    name: 'Battery low',
    severity: 'warning' as const,
    condition: { kind: 'below' as const, threshold: 20 },
    recipients: ['dev@example.com'],
  }

  it('accepts the minimal shape and fills defaults', () => {
    const parsed = createAlertRequest.parse(BASE)
    expect(parsed.cooldown_minutes).toBe(15)
    expect(parsed.notify_on_resolve).toBe(false)
    expect(parsed.enabled).toBe(true)
  })

  it('rejects a name over 120 characters', () => {
    expect(createAlertRequest.safeParse({ ...BASE, name: 'a'.repeat(121) }).success).toBe(false)
  })

  it('rejects an above condition with no threshold', () => {
    expect(createAlertRequest.safeParse({ ...BASE, condition: { kind: 'above' } }).success).toBe(false)
  })

  it('rejects an equals condition with an object value', () => {
    expect(
      createAlertRequest.safeParse({ ...BASE, condition: { kind: 'equals', value: { bad: true } } }).success,
    ).toBe(false)
  })

  it('rejects a negative resolve_hysteresis', () => {
    expect(
      createAlertRequest.safeParse({
        ...BASE,
        condition: { kind: 'below', threshold: 20, resolve_hysteresis: -1 },
      }).success,
    ).toBe(false)
  })

  it('rejects a recipient that is not an email address', () => {
    expect(createAlertRequest.safeParse({ ...BASE, recipients: ['not-an-email'] }).success).toBe(false)
  })

  it('accepts an empty recipients list — "no mail" is a valid state, not an omission', () => {
    expect(createAlertRequest.safeParse({ ...BASE, recipients: [] }).success).toBe(true)
  })

  it('is strict: an id alongside otherwise-valid fields is rejected', () => {
    expect(createAlertRequest.safeParse({ ...BASE, id: ALERT }).success).toBe(false)
  })

  it('is strict: a caller-supplied state alongside otherwise-valid fields is rejected', () => {
    expect(createAlertRequest.safeParse({ ...BASE, state: 'firing' }).success).toBe(false)
  })

  it('rejects a 21st recipient — fan-out bound, ALERT_RECIPIENTS_MAX', () => {
    expect(createAlertRequest.safeParse({ ...BASE, recipients: Array(20).fill('dev@example.com') }).success).toBe(
      true,
    )
    expect(createAlertRequest.safeParse({ ...BASE, recipients: Array(21).fill('dev@example.com') }).success).toBe(
      false,
    )
  })

  it('rejects cooldown_minutes over a week (10080) — a sanity ceiling, not a product decision', () => {
    expect(createAlertRequest.safeParse({ ...BASE, cooldown_minutes: 10_080 }).success).toBe(true)
    expect(createAlertRequest.safeParse({ ...BASE, cooldown_minutes: 10_081 }).success).toBe(false)
  })
})

describe('patchAlertRequest — strict, every definition field optional, never state', () => {
  it('accepts an empty patch and a single-field patch', () => {
    expect(patchAlertRequest.safeParse({}).success).toBe(true)
    expect(patchAlertRequest.safeParse({ enabled: false }).success).toBe(true)
  })

  it('rejects a state key alongside a valid field — the load-bearing pin: runtime state never travels through this route', () => {
    expect(patchAlertRequest.safeParse({ enabled: false, state: 'firing' }).success).toBe(false)
  })

  it('also rejects state_since and last_value', () => {
    expect(patchAlertRequest.safeParse({ state_since: null }).success).toBe(false)
    expect(patchAlertRequest.safeParse({ last_value: 42 }).success).toBe(false)
  })

  it('rejects slug — immutable through this route; only the rename transaction moves it', () => {
    expect(patchAlertRequest.safeParse({ slug: 'other_slug' }).success).toBe(false)
  })

  it('validates condition when present', () => {
    expect(patchAlertRequest.safeParse({ condition: { kind: 'above', threshold: 5 } }).success).toBe(true)
    expect(patchAlertRequest.safeParse({ condition: { kind: 'above' } }).success).toBe(false)
  })

  it('rejects cooldown_minutes over the week ceiling when present', () => {
    expect(patchAlertRequest.safeParse({ cooldown_minutes: 10_081 }).success).toBe(false)
  })

  it('rejects a 21st recipient when present', () => {
    expect(patchAlertRequest.safeParse({ recipients: Array(21).fill('dev@example.com') }).success).toBe(false)
  })
})

describe('slugUsageResponse — alert_count (D5): the rename dialog counts alerts too', () => {
  const USAGE = {
    grant_count: 2,
    app_identifiers: ['nav-app'],
    has_recorded_history: true,
    alert_count: 3,
  }

  it('parses with alert_count', () => {
    expect(slugUsageResponse.parse(USAGE).alert_count).toBe(3)
  })

  it('requires alert_count — a rename-usage preview silent about alerts undercounts the blast radius', () => {
    const { alert_count: _omit, ...withoutAlertCount } = USAGE
    expect(slugUsageResponse.safeParse(withoutAlertCount).success).toBe(false)
  })
})

describe('alertListResponse / orgFiringAlertsResponse', () => {
  it('alertListResponse wraps a list of alerts', () => {
    expect(alertListResponse.parse({ alerts: [VALID_ALERT] }).alerts).toHaveLength(1)
  })

  it('alertListResponse accepts orphaned on an entry — the shape this route actually sends', () => {
    const parsed = alertListResponse.parse({ alerts: [{ ...VALID_ALERT, orphaned: true }] })
    expect(parsed.alerts[0]!.orphaned).toBe(true)
  })

  it('orgFiringAlertsResponse requires robot_name alongside every alert field', () => {
    expect(orgFiringAlertsResponse.safeParse({ alerts: [VALID_ALERT] }).success).toBe(false)
    expect(
      orgFiringAlertsResponse.safeParse({ alerts: [{ ...VALID_ALERT, robot_name: 'rx1' }] }).success,
    ).toBe(true)
  })
})

describe('datapointDisplay / putDatapointDisplayRequest', () => {
  it('null means auto-scale on both bounds', () => {
    expect(datapointDisplay.parse({ y_min: null, y_max: null })).toEqual({ y_min: null, y_max: null })
  })

  it('a literal 0 bound round-trips as 0, not auto', () => {
    expect(putDatapointDisplayRequest.parse({ y_min: 0, y_max: null }).y_min).toBe(0)
  })

  it('putDatapointDisplayRequest is strict', () => {
    expect(putDatapointDisplayRequest.safeParse({ y_min: 0, y_max: 10, robot_id: '1' }).success).toBe(false)
  })

  it('rejects non-finite bounds', () => {
    expect(putDatapointDisplayRequest.safeParse({ y_min: Number.POSITIVE_INFINITY, y_max: null }).success).toBe(
      false,
    )
  })
})

describe('orgEventKind gains \'alert\'', () => {
  it('parses an alert-kind event, firing severity carried through', () => {
    const parsed = orgEvent.parse({
      type: 'org_event',
      seq: 1,
      at: NOW,
      kind: 'alert',
      severity: 'error',
      robot_id: ROBOT,
      subject: 'Battery low',
      detail: { slug: 'battery_voltage', value: 18.2, threshold: 20 },
    })
    expect(parsed.kind).toBe('alert')
    expect(parsed.severity).toBe('error')
  })
})
