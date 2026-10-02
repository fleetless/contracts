// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

/**
 * The plan catalogue.
 *
 * Four plans, cheapest first: `basic` (free), `plus`, `pro` and
 * `enterprise` (sold by contract, never self-service — its limits and
 * features are the catalogue's ceiling, not a priced row). Add-ons exist on
 * `pro` only; see `ADDONS` and the `addons` feature.
 */
export const planId = z.enum(['basic', 'plus', 'pro', 'enterprise'])
export type PlanId = z.infer<typeof planId>

/**
 * Cheapest first. `requiredPlanFor` and `nextPlanRaising` both read "higher"
 * and "lower" from this order, so a plan's position here — not its name — is
 * what decides whether a change is an upgrade or a downgrade.
 */
export const PLAN_ORDER: readonly PlanId[] = ['basic', 'plus', 'pro', 'enterprise']

/**
 * The limits a plan ties a number to. `history_days` and `audit_days` are
 * not refused against — they size a retention window, not a quota that an
 * action can exceed — but they share this vocabulary because they are read
 * off the same catalogue row.
 */
export const planLimitKey = z.enum([
  'seats',
  'robots',
  'apps',
  'app_users',
  'live_video_ms_per_month',
  'asset_bytes_per_robot',
  'history_days',
  'audit_days',
])
export type PlanLimitKey = z.infer<typeof planLimitKey>

/** `null` = by contract (Enterprise) or unlimited; see `orgPlan.limits`. */
const limit = z.number().int().positive().nullable()

export const planLimits = z.object({
  seats: limit,
  robots: limit,
  apps: limit,
  app_users: limit,
  live_video_ms_per_month: limit,
  asset_bytes_per_robot: limit,
  history_days: limit,
  audit_days: limit,
})
export type PlanLimits = z.infer<typeof planLimits>

/**
 * What a plan unlocks beyond a number: `app_mcp` (the app's MCP server),
 * `two_factor` (a developer may turn it on), `require_two_factor` (an owner
 * may force it org-wide), `app_oidc` (an app may federate sign-in to an
 * external IdP), `hosted_logo` (a custom logo on the app's hosted pages),
 * `audit_export` (the audit log's CSV export) and `addons` (whether add-ons
 * may be bought at all — `pro` only).
 */
export const planFeature = z.enum(['app_mcp', 'two_factor', 'require_two_factor', 'app_oidc', 'hosted_logo', 'audit_export', 'addons'])
export type PlanFeature = z.infer<typeof planFeature>

export const planFeatures = z.object(
  Object.fromEntries(planFeature.options.map((f) => [f, z.boolean()])) as Record<PlanFeature, z.ZodBoolean>,
)
export type PlanFeatures = z.infer<typeof planFeatures>

/** Integer cents, excluding VAT. */
const cents = z.number().int().nonnegative()

export const planPrices = z.object({
  eur_month: cents,
  usd_month: cents,
  eur_year: cents,
  usd_year: cents,
})
export type PlanPrices = z.infer<typeof planPrices>

export const planSupport = z.enum(['community', 'email', 'priority', 'named_contact'])
export type PlanSupport = z.infer<typeof planSupport>

export const planCatalogueEntry = z.object({
  id: planId,
  name: z.string().min(1).meta({ description: 'The plan\'s display name: Basic, Plus, Pro or Enterprise.' }),
  limits: planLimits,
  features: planFeatures,
  prices: planPrices.nullable().meta({ description: '`null` for Enterprise: sold by contract, on request.' }),
  support: planSupport,
})
export type PlanCatalogueEntry = z.infer<typeof planCatalogueEntry>

/**
 * What can be bought on top of a plan, each raising exactly one
 * `planLimitKey` by `per_unit`. Exist on `pro` only: on any other plan an
 * org's add-on counts are zero, and a plan change away from `pro` resets
 * them to zero (the add-ons feature gate, `planFeature.addons`).
 */
export const addonKey = z.enum(['seats', 'robots', 'apps', 'app_user_packs', 'live_video_packs'])
export type AddonKey = z.infer<typeof addonKey>

export const addonCatalogueEntry = z.object({
  key: addonKey,
  raises: planLimitKey.meta({ description: 'The plan limit this add-on raises.' }),
  per_unit: z.number().int().positive().meta({ description: 'How much one unit of this add-on raises `raises` by.' }),
  prices: planPrices,
})
export type AddonCatalogueEntry = z.infer<typeof addonCatalogueEntry>

/**
 * **No floating-point money, anywhere.** `eurCents * 1.15` would introduce
 * the fraction of a cent that floating point cannot hold exactly, so the
 * conversion is integer arithmetic throughout: scale by 115, add 9_999 to
 * round the result up to the next whole 10_000 (i.e. the next whole dollar)
 * and only then divide back down. Rounds *up*, never to nearest: a plan that
 * reads cheaper in dollars than its true euro equivalent is the error this
 * guards against, not the one it risks.
 */
export function usdCentsFromEurCents(eurCents: number): number {
  return Math.floor((eurCents * 115 + 9_999) / 10_000) * 100
}

/** Yearly is twelve months at 15% off, rounded to the nearest cent. */
export function yearlyEurCents(monthEurCents: number): number {
  return Math.round((monthEurCents * 12 * 85) / 100)
}

/**
 * The catalogue writes every price through this one function, from the
 * monthly EUR cents alone — never as the other three numbers as literals —
 * so the USD and yearly rules can only ever be applied once, here.
 */
export function pricesFromEurMonth(eurMonthCents: number): PlanPrices {
  const eurYear = yearlyEurCents(eurMonthCents)
  return {
    eur_month: eurMonthCents,
    usd_month: usdCentsFromEurCents(eurMonthCents),
    eur_year: eurYear,
    usd_year: usdCentsFromEurCents(eurYear),
  }
}

/**
 * The catalogue, exactly as the decision table (2026-09-30) states it.
 * Live video is in milliseconds, asset storage in decimal bytes per robot;
 * Enterprise's limits and features are `null` / `true` throughout because
 * they are set by contract, not read off this table.
 */
export const PLANS: Readonly<Record<PlanId, PlanCatalogueEntry>> = {
  basic: {
    id: 'basic',
    name: 'Basic',
    limits: {
      seats: 1,
      robots: 1,
      apps: 1,
      app_users: 10,
      live_video_ms_per_month: 36_000_000,
      asset_bytes_per_robot: 1_000_000_000,
      history_days: 7,
      audit_days: 7,
    },
    features: {
      app_mcp: false,
      two_factor: false,
      require_two_factor: false,
      app_oidc: false,
      hosted_logo: false,
      audit_export: false,
      addons: false,
    },
    prices: pricesFromEurMonth(0),
    support: 'community',
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    limits: {
      seats: 3,
      robots: 3,
      apps: 3,
      app_users: 25,
      live_video_ms_per_month: 360_000_000,
      asset_bytes_per_robot: 2_000_000_000,
      history_days: 30,
      audit_days: 30,
    },
    features: {
      app_mcp: true,
      two_factor: true,
      require_two_factor: false,
      app_oidc: true,
      hosted_logo: true,
      audit_export: false,
      addons: false,
    },
    prices: pricesFromEurMonth(2900),
    support: 'email',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    limits: {
      seats: 5,
      robots: 5,
      apps: 5,
      app_users: 50,
      live_video_ms_per_month: 900_000_000,
      asset_bytes_per_robot: 3_000_000_000,
      history_days: 90,
      audit_days: 90,
    },
    features: {
      app_mcp: true,
      two_factor: true,
      require_two_factor: true,
      app_oidc: true,
      hosted_logo: true,
      audit_export: true,
      addons: true,
    },
    prices: pricesFromEurMonth(14900),
    support: 'priority',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    limits: {
      seats: null,
      robots: null,
      apps: null,
      app_users: null,
      live_video_ms_per_month: null,
      asset_bytes_per_robot: null,
      history_days: null,
      audit_days: null,
    },
    features: {
      app_mcp: true,
      two_factor: true,
      require_two_factor: true,
      app_oidc: true,
      hosted_logo: true,
      audit_export: true,
      addons: true,
    },
    prices: null,
    support: 'named_contact',
  },
}

/**
 * The add-on catalogue. Every price goes through `pricesFromEurMonth`, same
 * discipline as `PLANS`.
 */
export const ADDONS: Readonly<Record<AddonKey, AddonCatalogueEntry>> = {
  seats: { key: 'seats', raises: 'seats', per_unit: 1, prices: pricesFromEurMonth(900) },
  robots: { key: 'robots', raises: 'robots', per_unit: 1, prices: pricesFromEurMonth(1900) },
  apps: { key: 'apps', raises: 'apps', per_unit: 1, prices: pricesFromEurMonth(900) },
  app_user_packs: { key: 'app_user_packs', raises: 'app_users', per_unit: 5, prices: pricesFromEurMonth(1000) },
  live_video_packs: { key: 'live_video_packs', raises: 'live_video_ms_per_month', per_unit: 900_000_000, prices: pricesFromEurMonth(900) },
}

/** The cheapest plan that has the feature. */
export function requiredPlanFor(feature: PlanFeature): PlanId {
  for (const plan of PLAN_ORDER) {
    if (PLANS[plan].features[feature]) return plan
  }
  // Every feature is true on `enterprise`, the last entry in `PLAN_ORDER`, so
  // this is unreachable — kept as a defined return rather than a non-null
  // assertion at the call site.
  return PLAN_ORDER[PLAN_ORDER.length - 1]
}

/**
 * The cheapest plan above `plan` whose catalogue limit for `key` is higher
 * than `plan`'s own (`null` counts as higher, since it means unlimited);
 * `null` when no plan above it raises the limit any further.
 */
export function nextPlanRaising(plan: PlanId, key: PlanLimitKey): PlanId | null {
  const at = PLAN_ORDER.indexOf(plan)
  const current = PLANS[plan].limits[key]
  for (let i = at + 1; i < PLAN_ORDER.length; i++) {
    const candidate = PLAN_ORDER[i]
    const candidateLimit = PLANS[candidate].limits[key]
    if (current === null) continue // already unlimited, nothing raises it further
    if (candidateLimit === null || candidateLimit > current) return candidate
  }
  return null
}

/*
 * ---------------------------------------------------------------------------
 * The organization's plan (2026-10-02, fleetless/fleetless#103).
 *
 * Everything above is the catalogue: the same four rows for every org. What
 * follows is one org's position in it — what it bought, what it is using,
 * and the change it has queued but not yet crossed into.
 * ---------------------------------------------------------------------------
 */

/** What an org is billed in. The catalogue's prices are fixed in both; this picks which one an invoice reads in. */
export const planCurrency = z.enum(['eur', 'usd'])
export type PlanCurrency = z.infer<typeof planCurrency>

/**
 * How many units of each add-on an org has bought. Meaningful on `pro` only
 * — see `planFeature.addons` — and zero on every other plan: a plan change
 * away from `pro` resets every count here to zero rather than leaving them
 * stored and merely unread.
 */
export const orgAddons = z.object({
  seats: z.number().int().nonnegative(),
  robots: z.number().int().nonnegative(),
  apps: z.number().int().nonnegative(),
  app_user_packs: z.number().int().nonnegative(),
  live_video_packs: z.number().int().nonnegative(),
})
export type OrgAddons = z.infer<typeof orgAddons>

/**
 * What the org is using right now, counted the way each limit refuses
 * against: `seats` is developers, owners included, plus pending team
 * invitations; `app_users` is app users of every app plus pending app-user
 * invitations; `live_video_ms_this_month` is this UTC calendar month's
 * app-attributed live video only — a console session never counts and is
 * never ended for it; `asset_bytes` is the sum of every robot's stored
 * assets across the whole org. Read fresh on every call, the same discipline
 * `GET /api/org/quotas` already keeps, so a number here is never one call
 * behind the limit it is compared against.
 */
export const orgPlanUsage = z.object({
  seats: z.number().int().nonnegative(),
  robots: z.number().int().nonnegative(),
  apps: z.number().int().nonnegative(),
  app_users: z.number().int().nonnegative(),
  live_video_ms_this_month: z.number().int().nonnegative(),
  asset_bytes: z.number().int().nonnegative(),
})
export type OrgPlanUsage = z.infer<typeof orgPlanUsage>

/**
 * What a downward plan change keeps, by id, when the target plan cannot hold
 * everything the org has today. `owners` is deliberately not a field: an
 * owner is never a candidate for deletion and always stays, so a chooser
 * cannot even name one here — but an owner still counts against the target
 * plan's `seats`, and if the owners alone already exceed it the change is
 * refused `409 plan_limit` naming `seats`, before anything else about the
 * choice is even considered. `.strict()` so an extra key — `owners` most of
 * all — is refused at the door rather than silently ignored.
 */
export const planChangeKeep = z.object({
  robots: z.array(z.uuid()),
  apps: z.array(z.uuid()),
  app_users: z.array(z.uuid()),
  developers: z.array(z.uuid()),
}).strict()
export type PlanChangeKeep = z.infer<typeof planChangeKeep>

/**
 * Why a change is pending. `downgrade` and `cancel` (to Basic) are a
 * developer's own choice — `PUT /api/org/plan/change` only ever moves an org
 * down; an upgrade or an add-on needs payment this route does not collect,
 * and today goes through a Feedback request that Fleetless applies through
 * the admin route. `migration` is a plan the platform is moving every org on
 * the beta through; `lock` is a change the platform queued because the org
 * is locked (see `orgLock`) and must land on Basic.
 */
export const planChangeReason = z.enum(['downgrade', 'cancel', 'migration', 'lock'])
export type PlanChangeReason = z.infer<typeof planChangeReason>

/**
 * A downward plan change the org has chosen, or been queued for by the
 * platform, not yet in effect. `effective_at` is normally
 * `orgPlan.period_ends_at`, so the org keeps full use of what it has until
 * the billing period actually turns over — except a choice made while the
 * org was locked, which takes effect at once, and a `migration`, which takes
 * effect at the platform's switch date instead; it is `null` only while that
 * date is not yet set. `keep` is `null` when the org's usage already fits
 * the target plan outright and nothing is deleted; otherwise it is exactly
 * what the confirmation counted — anything created while the choice is still
 * pending is checked against the target plan too and, passing, is folded
 * into `keep`, so what lands at `effective_at` is never a surprise. A later
 * `PUT /api/org/plan/change` replaces a still-pending choice outright;
 * `DELETE` withdraws it and leaves the org on its current plan.
 * `history_days_after` is what the confirmation announces to whoever chose
 * it, so the warning they read before confirming is the same number that
 * lands.
 */
export const pendingPlanChange = z.object({
  target_plan: planId,
  reason: planChangeReason,
  effective_at: z.iso.datetime().nullable(),
  keep: planChangeKeep.nullable(),
  history_days_after: z.number().int().positive(),
  chosen_by: z.uuid(),
  chosen_at: z.iso.datetime(),
})
export type PendingPlanChange = z.infer<typeof pendingPlanChange>

/**
 * An org restricted, while locked, to moving straight to Basic — narrower
 * still than the already-downward-only `PUT /api/org/plan/change`. `payment`
 * is a failed charge; `migration` is the platform's own move off the beta.
 * Either way the only plan a developer may choose while locked is Basic —
 * see `target_state_conflict` with rule `locked_basic_only` on
 * `PUT /api/org/plan/change`; a choice made while locked takes effect at
 * once rather than waiting for the billing period to turn over.
 */
export const orgLock = z.object({
  reason: z.enum(['payment', 'migration']),
  since: z.iso.datetime(),
})
export type OrgLock = z.infer<typeof orgLock>

/**
 * **The one read everything about an org's plan comes from**: the console's
 * Plan & billing page, its usage and limit gauges, every upgrade prompt and
 * every gate a feature check renders. `limits` is the *effective* ceiling —
 * the catalogue row plus `addons`, or an operator's `overrides` in place of
 * either — so a consumer never has to recompute it from the catalogue and
 * the add-on counts itself. `switch` is set only for an organization still
 * on the beta and carries the date its plan changes on its own, and whether
 * it still has to choose one.
 */
export const orgPlan = z.object({
  plan: planId,
  currency: planCurrency,
  period_ends_at: z.iso.datetime().meta({
    description:
      "The end of the organization's current billing period; while no payment period exists yet, the end of the current UTC calendar " +
      'month. A pending downward plan change normally takes effect at this exact instant — except one chosen while the org was locked, ' +
      "which lands at once, and the platform's own move off the beta, which lands at its switch date instead.",
  }),
  addons: orgAddons,
  limits: planLimits,
  features: planFeatures,
  usage: orgPlanUsage,
  pending_change: pendingPlanChange.nullable(),
  lock: orgLock.nullable(),
  switch: z.object({
    at: z.iso.datetime().nullable(),
    needs_choice: z.boolean(),
  }).nullable(),
})
export type OrgPlan = z.infer<typeof orgPlan>

/**
 * What a developer may ask for on `PUT /api/org/plan/change` — **a downward
 * move only**: a lower plan, or Basic as a cancellation. An upgrade or an
 * add-on needs payment this route does not collect, and is not reachable
 * through it at all today; it goes through a Feedback request that Fleetless
 * applies through the admin route instead. `.strict()` for the same reason
 * `planChangeKeep` is: a caller cannot send a field this shape does not
 * name, `keep` included, and an owner cannot be smuggled into it through a
 * typo that `.strict()` would otherwise swallow in silence.
 */
export const planChangeRequest = z.object({
  target_plan: planId,
  keep: planChangeKeep.nullable(),
}).strict()
export type PlanChangeRequest = z.infer<typeof planChangeRequest>

/**
 * An operator's per-org replacement for one or more catalogue limits —
 * Enterprise's contracted numbers, most of all, which exist nowhere else.
 * Every key is optional, so an operator sets only what differs from the
 * plan; a key present with `null` clears an earlier override back to the
 * plan's own number, which is why every value is nullable as well as
 * optional — omitted and `null` are two different instructions.
 */
export const planOverrides = z.object(
  Object.fromEntries(
    planLimitKey.options.map((k) => [k, z.number().int().positive().nullable().optional()]),
  ) as Record<PlanLimitKey, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>,
).strict()
export type PlanOverrides = z.infer<typeof planOverrides>

/**
 * What the operator sends on `PATCH /api/admin/orgs/:id/plan`. Every field
 * is optional because this one route carries every shape of change an
 * operator makes to an org's plan — switching it, adding or removing
 * add-ons, overriding a limit, changing the billing currency, or moving the
 * period boundary — and a request that touched all of them at once would be
 * no easier to audit than four small ones in its place. `addons` is a
 * partial `orgAddons`: only the counts named change, the rest are left as
 * they are. `overrides` follows `planOverrides`: a key present with `null`
 * clears that override.
 */
export const adminPlanChangeRequest = z.object({
  plan: planId,
  addons: orgAddons.partial().strict().optional(),
  overrides: planOverrides.optional(),
  currency: planCurrency.optional(),
  period_ends_at: z.iso.datetime().nullable().optional(),
}).strict()
export type AdminPlanChangeRequest = z.infer<typeof adminPlanChangeRequest>
