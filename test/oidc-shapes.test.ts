// SPDX-License-Identifier: Apache-2.0
/**
 * **What is left of the federation shapes after the two-space cut** (spec
 * `2026-09-05-app-user-auth`).
 *
 * The group provider, its just-in-time grants, the org-level linking policy,
 * the impersonation interstitial and the federated callback error page are all
 * deleted. What survives is the issuer rule — because it is a rule about URLs
 * the *server* dereferences, and the next such field should find it already
 * written down.
 *
 * The per-app provider that replaced the group one is pinned in
 * `app-users.test.ts`, next to the rest of the app-user surface.
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '../src/index.js'
import * as identity from '../src/identity.js'
import { idpIssuer } from '../src/index.js'

describe('idpIssuer — the string that decides where the server connects', () => {
  it('accepts an ordinary issuer', () => {
    expect(idpIssuer.safeParse('https://idp.example.com/realms/acme').success).toBe(true)
  })

  /**
   * `file:`, `gopher:` and friends are what turn an issuer field into a read of
   * the server's own disk. This is the check that a scheme allow-list, not a
   * `z.url()`, is what stands here — the defect found by storing
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
    // The federated MCP callback's error vocabulary. Its only renderer was
    // `GET /mcp/oauth/idp-callback`, a route D1 leaves unreachable and this
    // round deletes; `clientOidcErrorCode` is the per-app list that replaces
    // it, and two coexisting callback enums is how the wrong one gets picked.
    'oidcCallbackErrorCode',
    'oidcCallbackError',
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
    // The per-app callback vocabulary, which is what a reader looking for the
    // deleted one should find instead.
    expect('clientOidcErrorCode' in barrel).toBe(true)
  })
})
