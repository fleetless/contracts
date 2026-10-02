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
