import { describe, expect, it } from 'vitest'
import { idpConfig, idpConfigRequest, orgFederationPolicy, orgFederationPolicyRequest } from '../src/identity.js'
import { consentGrantSummary, consentGrantListResponse, consentRevokeResponse } from '../src/oauth.js'
import { clientLogoutResponse } from '../src/client-auth.js'
import type {
  ClientLogoutResponse,
  ConsentGrantListResponse,
  ConsentGrantSummary,
  ConsentRevokeResponse,
  OrgFederationPolicy,
  OrgFederationPolicyRequest,
} from '../src/index.js'

const UUID = '00000000-0000-4000-8000-000000000000'
const NOW = '2026-08-19T12:00:00.000Z'

describe('one account, one linking policy (DEF-094)', () => {
  const base = {
    app_id: UUID,
    issuer: 'https://idp.example.com',
    client_id: 'c',
    scopes: ['openid'],
    claims: { subject: 'sub', email: 'email' },
    has_client_secret: false,
    updated_at: NOW,
  }

  it('strips the flag from the per-app config, so nothing downstream can read it', () => {
    // **Die erste Fassung verlangte eine Ablehnung und war falsch.** `idpConfig`
    // ist eine ANTWORT und deshalb absichtlich nicht `.strict()` — eine
    // strikte Antwortform bricht jeden alten Konsumenten, sobald ein Feld
    // dazukommt, und dieses Projekt hat eine Rueckwaertskompatibilitaets-
    // zusage. Was hier zaehlt, ist nicht die Ablehnung, sondern dass das Feld
    // **nicht ankommt**: eine Cloud, die es weiter sendet, kann niemanden mehr
    // dazu verleiten, es zu lesen.
    const parsed = idpConfig.safeParse({ ...base, link_verified_emails: true })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'link_verified_emails' in parsed.data).toBe(false)
    expect(idpConfig.safeParse(base).success).toBe(true)
  })

  it('refuses it on the request too, so a developer cannot set it per app', () => {
    const req = { issuer: 'https://idp.example.com', client_id: 'c', scopes: ['openid'] }
    expect(idpConfigRequest.safeParse({ ...req, link_verified_emails: true }).success).toBe(false)
    expect(idpConfigRequest.safeParse(req).success).toBe(true)
  })

  it('carries it once, at org scope', () => {
    expect(orgFederationPolicy.safeParse({ link_verified_emails: true, updated_at: NOW }).success).toBe(true)
    expect(orgFederationPolicyRequest.safeParse({ link_verified_emails: false }).success).toBe(true)
    // **`.strict()`, und die erste Fassung dieser Zeile konnte nicht scheitern.**
    // Sie schickte NUR den Tippfehler — dann fehlt aber das Pflichtfeld, und
    // die Form scheitert mit oder ohne `.strict()`. Gefunden, indem `.strict()`
    // entfernt und der Testlauf beobachtet wurde: er blieb gruen. Der Tippfehler
    // muss NEBEN dem richtigen Feld stehen, sonst misst er die Pflicht statt
    // die Striktheit.
    expect(orgFederationPolicyRequest.safeParse({ link_verified_emails: false, link_verified_email: true }).success).toBe(false)
  })
})

describe('a grant a person can recognise, and a revocation that says what it ended (DEF-099)', () => {
  const grant = {
    client_id: 'client-abc',
    client_name: 'Fleet Dashboard',
    app_id: UUID,
    app_name: 'Warehouse',
    role_id: UUID,
    role_name: 'Operator',
    scope: 'openid profile',
    granted_at: NOW,
  }

  it('carries the names that were on the screen, not only the ids', () => {
    expect(consentGrantSummary.safeParse(grant).success).toBe(true)
    for (const missing of ['client_name', 'app_name', 'role_name'] as const) {
      const { [missing]: _drop, ...rest } = grant
      expect(consentGrantSummary.safeParse(rest).success).toBe(false)
    }
  })

  it('bounds the list', () => {
    const list = (n: number) => ({ grants: Array.from({ length: n }, () => grant), truncated: n >= 200 })
    expect(consentGrantListResponse.safeParse(list(200)).success).toBe(true)
    expect(consentGrantListResponse.safeParse(list(201)).success).toBe(false)
  })

  /**
   * **Die Grenze allein sagt nicht, ob etwas fehlt** (DEF-151). `truncated`
   * ist Pflicht, damit eine Antwort ohne das Feld nicht als *"es gibt nicht
   * mehr"* durchgeht — genau die stille Kuerzung, die diese Zeile geoeffnet
   * hat.
   */
  it('requires truncated — a short page must say whether it is short', () => {
    expect(consentGrantListResponse.safeParse({ grants: [grant] }).success).toBe(false)
    expect(consentGrantListResponse.safeParse({ grants: [grant], truncated: false }).success).toBe(true)
    const cut = consentGrantListResponse.safeParse({ grants: [grant], truncated: true })
    expect(cut.success && cut.data.truncated).toBe(true)
  })

  it('distinguishes nothing-matched from matched-and-ended, with a count', () => {
    expect(consentRevokeResponse.safeParse({ revoked: false, tokens_revoked: 0 }).success).toBe(true)
    expect(consentRevokeResponse.safeParse({ revoked: true, tokens_revoked: 3 }).success).toBe(true)
    // Ein Widerruf ohne Zahl waere die Auskunft, die die Zeile bemaengelt.
    expect(consentRevokeResponse.safeParse({ revoked: true }).success).toBe(false)
    expect(consentRevokeResponse.safeParse({ revoked: true, tokens_revoked: -1 }).success).toBe(false)
  })
})

describe('logout says which of four things is true (DEF-098)', () => {
  const parse = (idp_logout: unknown) => clientLogoutResponse.safeParse({ idp_logout })

  it('accepts exactly the four outcomes, and no fifth', () => {
    expect(parse({ status: 'redirect', url: 'https://idp.example.com/logout?id_token_hint=x' }).success).toBe(true)
    expect(parse({ status: 'not_federated' }).success).toBe(true)
    expect(parse({ status: 'unsupported_by_idp' }).success).toBe(true)
    expect(parse({ status: 'hint_unavailable' }).success).toBe(true)
    expect(parse({ status: 'dunno' }).success).toBe(false)
  })

  it('strips a url from `hint_unavailable`, so no consumer can follow one', () => {
    // **Zweite falsche Behauptung dieser Art an einem Tag** — die erste stand
    // heute Morgen an `idpConfig`. Eine Antwortform ist absichtlich nicht
    // `.strict()`; ein zusaetzlicher Schluessel wird ENTFERNT, nicht abgelehnt.
    // Fuer diesen Ausgang ist das sogar das bessere Verhalten: eine Cloud, die
    // faelschlich eine URL mitschickt, kann damit trotzdem niemanden auf eine
    // Seite schicken, die FRAGT statt zu beenden (an echtem Keycloak gemessen:
    // "Do you want to log out?"). Was zaehlt, ist nicht die Ablehnung, sondern
    // dass die URL nicht ankommt.
    const parsed = parse({ status: 'hint_unavailable', url: 'https://idp.example.com/logout' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'url' in parsed.data.idp_logout).toBe(false)
  })

  it('keeps "the IdP cannot" separable from "we cannot ask it"', () => {
    const idp = parse({ status: 'unsupported_by_idp' })
    const us = parse({ status: 'hint_unavailable' })
    expect(idp.success && us.success && idp.data.idp_logout.status === us.data.idp_logout.status).toBe(false)
  })

  it('cannot say "redirect" without somewhere to redirect to', () => {
    expect(parse({ status: 'redirect' }).success).toBe(false)
    expect(parse({ status: 'redirect', url: 'not-a-url' }).success).toBe(false)
  })

  it('keeps "no IdP was involved" separable from "the IdP cannot end it"', () => {
    const a = parse({ status: 'not_federated' })
    const b = parse({ status: 'unsupported_by_idp' })
    expect(a.success && b.success && a.data.idp_logout.status === b.data.idp_logout.status).toBe(false)
  })
})

describe('the barrel exports the TYPES, not only the schemas', () => {
  // **Data-W9c hat das gefunden, bevor er darauf gebaut hat.** Mein Delta hat
  // die Werte re-exportiert und die inferierten Typen vergessen — `tsc` sagte
  // ihm *has no exported member named 'ClientLogoutResponse'. Did you mean
  // 'clientLogoutResponse'?*, also die Grossschreibung als einziger
  // Unterschied. Ein Konsument kann dann das Schema benutzen und die Form
  // nicht benennen, was in der Praxis heisst: er schreibt sie noch einmal ab.
  //
  // Dieser Test ist bewusst ein TYP-Test und laeuft daher in `tsc`, nicht zur
  // Laufzeit — ein `expect` auf einen Typ gibt es nicht.
  it('compiles a value of each new type, taken from the barrel', () => {
    const logout: ClientLogoutResponse = { idp_logout: { status: 'not_federated' } }
    const summary: ConsentGrantSummary = {
      client_id: 'c', client_name: 'C', app_id: UUID, app_name: 'A',
      role_id: UUID, role_name: 'R', scope: '', granted_at: NOW,
    }
    const list: ConsentGrantListResponse = { grants: [summary], truncated: false }
    const revoke: ConsentRevokeResponse = { revoked: true, tokens_revoked: 1 }
    const policy: OrgFederationPolicy = { link_verified_emails: true, updated_at: NOW }
    const req: OrgFederationPolicyRequest = { link_verified_emails: false }
    expect([logout, list, revoke, policy, req].every(Boolean)).toBe(true)
  })
})
