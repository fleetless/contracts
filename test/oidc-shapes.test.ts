/**
 * **What is left of the federation shapes after the two-space cut** (spec
 * `2026-09-05-app-user-auth`).
 *
 * The group provider, its just-in-time grants, the org-level linking policy and
 * the impersonation interstitial are all deleted. What survives is the issuer
 * rule — because it is a rule about URLs the *server* dereferences and the next
 * such field should find it already written down — and the callback error page
 * the central MCP flow still renders.
 *
 * The per-app provider that replaced the group one is pinned in
 * `app-users.test.ts`, next to the rest of the app-user surface.
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import * as identity from '../src/identity.js'
import { idpIssuer, oidcCallbackError, oidcCallbackErrorCode } from '../src/index.js'

describe('idpIssuer — the string that decides where the server connects', () => {
  it('accepts an ordinary issuer', () => {
    expect(idpIssuer.safeParse('https://idp.example.com/realms/acme').success).toBe(true)
  })

  /**
   * `file:`, `gopher:` and friends are what turn an issuer field into a read of
   * the server's own disk. This is the check that a scheme allow-list, not a
   * `z.url()`, is what stands here — the defect Argus-W7b found by storing
   * `file:///etc/passwd` through the app's IdP route and catching the outbound
   * fetch on a listener.
   */
  it('refuses a non-http(s) scheme', () => {
    expect(idpIssuer.safeParse('file:///etc/passwd').success).toBe(false)
    expect(idpIssuer.safeParse('gopher://idp.example.com/').success).toBe(false)
  })

  it('refuses credentials in the URL, which are a redirect trick', () => {
    expect(idpIssuer.safeParse('https://user:pw@idp.example.com/').success).toBe(false)
  })

  /**
   * RFC 8414 §3 builds the discovery URL from the issuer's **path**, so a query
   * or a fragment there is meaningless — and a value carrying one is either a
   * mistake or an attempt to make the discovery URL point somewhere else.
   */
  it('refuses a query string and a fragment', () => {
    expect(idpIssuer.safeParse('https://idp.example.com/?next=x').success).toBe(false)
    expect(idpIssuer.safeParse('https://idp.example.com/#x').success).toBe(false)
  })

  it('bounds the length, because the value is stored, logged and rendered', () => {
    expect(idpIssuer.safeParse(`https://idp.example.com/${'a'.repeat(500)}`).success).toBe(false)
  })

  /**
   * **The residual, asserted rather than described.** This rule cannot tell the
   * dev identity provider from a loopback database, and a test that only proved
   * what it refuses would let a reader take it for the SSRF defence. It is not;
   * the defence is at the discovery fetch, in the cloud.
   */
  it('accepts loopback http, so it cannot be the SSRF defence and does not pretend to be', () => {
    expect(idpIssuer.safeParse('http://localhost:8081/realms/fleetless-test').success).toBe(true)
    expect(idpIssuer.safeParse('http://127.0.0.1:5432').success).toBe(true)
  })
})

describe('the callback error page contract', () => {
  it('enumerates exactly the six documented codes', () => {
    expect(oidcCallbackErrorCode.options).toEqual([
      'idp_unreachable',
      'exchange_failed',
      'claims_incomplete',
      'jit_disabled',
      'email_collision',
      'provider_misconfigured',
    ])
  })

  it('accepts a code with safe user text and refuses an unknown code', () => {
    expect(oidcCallbackError.safeParse({ code: 'exchange_failed', message: 'Please try again.' }).success).toBe(true)
    expect(oidcCallbackError.safeParse({ code: 'kaboom', message: 'x' }).success).toBe(false)
  })

  /**
   * An error page with no words is not an error page, and an unbounded message
   * is a size nobody chose on a value that gets rendered.
   */
  it('requires a message and bounds it', () => {
    expect(oidcCallbackError.safeParse({ code: 'exchange_failed' }).success).toBe(false)
    expect(oidcCallbackError.safeParse({ code: 'exchange_failed', message: '' }).success).toBe(false)
    expect(oidcCallbackError.safeParse({ code: 'exchange_failed', message: 'x'.repeat(301) }).success).toBe(false)
  })

  /**
   * **This vocabulary is not the app-user one, and conflating them would put a
   * group-era code in front of an app's users.** `clientOidcErrorCode` is the
   * per-app list, redirected to the developer's own page; this one is rendered
   * by Fleetless for the central MCP flow. Pinned as a pair so a later edit
   * cannot quietly merge them.
   */
  it('is a different list from the per-app clientOidcErrorCode', () => {
    expect(barrel.clientOidcErrorCode.options).not.toEqual(oidcCallbackErrorCode.options)
    expect(barrel.clientOidcErrorCode.options).toContain('no_access')
    expect(oidcCallbackErrorCode.options).not.toContain('no_access')
  })
})

describe('the group-scoped federation shapes are gone', () => {
  /**
   * Removed-symbol guards. Each named a mechanism the two-space cut deleted
   * with no successor, so a re-appearance is a merge accident rather than a
   * decision — and a `grep` over the source proves nothing about what a
   * consumer can import.
   */
  const DELETED = [
    'groupOidcProvider',
    'putGroupOidcProviderRequest',
    'jitGrant',
    'orgFederationPolicy',
    'orgFederationPolicyRequest',
    'idpConfig',
    'idpConfigRequest',
    'idpClaimMapping',
    'impersonationChoice',
  ] as const

  it('exports none of them from the barrel or from the identity module', () => {
    for (const name of DELETED) {
      expect(name in barrel, name).toBe(false)
      expect(name in identity, name).toBe(false)
    }
  })

  it('and the replacement is exported, so this file is not asserting an empty world', () => {
    expect('appOidcProvider' in barrel).toBe(true)
    expect('createAppOidcProviderRequest' in barrel).toBe(true)
  })
})
