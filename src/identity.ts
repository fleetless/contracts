import { z } from 'zod'

/**
 * Identity (spec §3). Two spaces that never mix: **developers**, who own an
 * org and use the console, and **end users**, who belong to an org's pool and
 * use apps. A credential from one space must never authenticate the other
 * (§3.1, §3.4) — the shapes are kept apart here so that nothing accidentally
 * accepts both.
 */

/**
 * The password rule, stated once so the cloud, the console and the SDK refuse
 * the same inputs for the same reason. Length only: a rule a user cannot
 * predict is a rule they work around.
 */
export const password = z.string().min(12).max(256)

/** Org access comes in two tiers (spec §3.1). */
export const orgMemberRole = z.enum(['owner', 'member'])
export type OrgMemberRole = z.infer<typeof orgMemberRole>

export const org = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
})
export type Org = z.infer<typeof org>

export const orgMember = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  role: orgMemberRole,
  created_at: z.iso.datetime(),
})
export type OrgMember = z.infer<typeof orgMember>

/**
 * Access plus refresh (spec §3.4). The access token is short-lived; the
 * refresh token rotates on every use, so a stolen one is detectable when the
 * original is presented again.
 */
export const sessionTokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})
export type SessionTokens = z.infer<typeof sessionTokens>

export const refreshRequest = z.object({ refresh_token: z.string().min(1) })
export type RefreshRequest = z.infer<typeof refreshRequest>

/**
 * Registering an org creates the org and its first owner in one step
 * (André, 2026-08-10): whoever registers the organisation is the owner.
 */
export const signUpRequest = z.object({
  org_name: z.string().min(1).max(120),
  email: z.email(),
  password,
})
export type SignUpRequest = z.infer<typeof signUpRequest>

export const signUpResponse = z.object({
  org,
  member: orgMember,
  tokens: sessionTokens,
})
export type SignUpResponse = z.infer<typeof signUpResponse>

export const developerLoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type DeveloperLoginRequest = z.infer<typeof developerLoginRequest>

/**
 * An end user of the org's pool (spec §3.2). Blocked users keep their
 * memberships — blocking is reversible and must not silently drop role
 * assignments.
 */
export const endUser = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  status: z.enum(['invited', 'active', 'blocked']),
  created_at: z.iso.datetime(),
})
export type EndUser = z.infer<typeof endUser>

/**
 * An invitation carries its own accept URL: the link is the primary path
 * (the developer shares it), mail is the second. A cloud with no SMTP
 * configured still issues invitations — it just cannot send them, and says so
 * via `mail_sent`.
 */
export const invitation = z.object({
  id: z.uuid(),
  email: z.email(),
  app_id: z.uuid(),
  role_id: z.uuid(),
  expires_at: z.iso.datetime(),
  accept_url: z.url(),
  mail_sent: z.boolean(),
})
export type Invitation = z.infer<typeof invitation>

export const createInvitationRequest = z.object({
  email: z.email(),
  app_id: z.uuid(),
  role_id: z.uuid(),
  send_mail: z.boolean(),
})
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>

export const acceptInvitationRequest = z.object({
  token: z.string().min(1),
  password,
})
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>
