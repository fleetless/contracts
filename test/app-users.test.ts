// SPDX-License-Identifier: Apache-2.0
/**
 * **The per-app identity space**, as redesigned on 2026-09-05.
 *
 * Two identity spaces, joined by nothing: *Fleetless users* (the org's team,
 * `identity.ts`) and *app users* (per app, `app-users.ts`). This file pins
 * the second, plus the client-auth shapes the developer's login UI posts to.
 *
 * **Every `it` names the wrong outcome it exists to catch.** A shape test
 * that only restates the schema cannot fail for any reason worth knowing —
 * it goes red exactly when somebody edits the schema, which they already know.
 */
import { describe, it, expect } from 'vitest'
import * as barrel from '../src/index.js'
import * as appUsers from '../src/app-users.js'
import * as clientAuthModule from '../src/client-auth.js'
import * as identity from '../src/identity.js'
import {
  APP_USER_DISPLAY_NAME_MAX,
  APP_URL_PLACEHOLDERS,
  MAIL_TEMPLATE_VARIABLES,
  DEFAULT_MAIL_TEMPLATES,
  allowedOrigin,
  appAuthConfig,
  appInvitation,
  appOidcProvider,
  appUrlTemplate,
  appUser,
  appUserStatus,
  createAppOidcProviderRequest,
  emailDomain,
  mailTemplateKind,
  patchAppOidcProviderRequest,
  patchAppUserRequest,
  pendingAppInvitation,
  providerSlug,
  putAppAuthConfigRequest,
  putAppMailTemplateRequest,
} from '../src/app-users.js'
import { clientIdentity, clientOidcErrorCode, clientOidcStartQuery } from '../src/client-auth.js'

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

/* ------------------------------------------------------- the app URLs -- */

describe('appUrlTemplate — an app-hosted URL with exactly one placeholder', () => {
  const invite = appUrlTemplate('{token}')

  /**
   * **The whole point of the scheme rule.** An invite link carries a
   * single-use credential in its path; over plain http on a public host,
   * every hop can read it. `localhost` is the exception — a developer has no
   * certificate there, and blocking it would just get worked around with an
   * unreviewed proxy.
   */
  it('refuses plain http on a public host, which would mail a token in the clear', () => {
    expect(invite.safeParse('http://example.com/x/{token}').success).toBe(false)
  })

  it('accepts http on localhost, the one place a developer has no certificate', () => {
    expect(invite.safeParse('http://localhost:3000/invite/{token}').success).toBe(true)
    expect(invite.safeParse('http://127.0.0.1:3000/invite/{token}').success).toBe(true)
  })

  it('accepts https anywhere', () => {
    expect(invite.safeParse('https://app.example.com/i/{token}').success).toBe(true)
  })

  /**
   * **Twice is not "more than once" — it's ambiguous.** The cloud substitutes
   * the token by plain string replace, so a template naming it twice leaves
   * one occurrence literal: the link 404s for the user instead of failing
   * for the developer who wrote it. Refusing at config time is where the
   * mistake is cheap.
   */
  it('refuses a template that names the placeholder twice', () => {
    expect(invite.safeParse('https://app.example.com/{token}/{token}').success).toBe(false)
  })

  it('refuses a template with no placeholder at all, which would mail the same link to everybody', () => {
    expect(invite.safeParse('https://app.example.com/invite').success).toBe(false)
  })

  it('refuses a value that is not a URL', () => {
    expect(invite.safeParse('not a url {token}').success).toBe(false)
  })

  /**
   * The MCP login URL uses a different placeholder, so the factory must
   * actually read its argument — one that hard-coded `{token}` would pass
   * every assertion above.
   */
  it('reads its argument: the mcp template wants {interaction}, not {token}', () => {
    const mcp = appUrlTemplate('{interaction}')
    expect(mcp.safeParse('https://app.example.com/mcp/{interaction}').success).toBe(true)
    expect(mcp.safeParse('https://app.example.com/mcp/{token}').success).toBe(false)
  })

  it('APP_URL_PLACEHOLDERS names one placeholder per configurable URL', () => {
    expect(APP_URL_PLACEHOLDERS).toEqual({
      invite_url: '{token}',
      verify_url: '{token}',
      reset_url: '{token}',
      mcp_login_url: '{interaction}',
    })
  })
})

/* ---------------------------------------------------- allowed origins -- */

describe('allowedOrigin — an origin, and nothing longer than an origin', () => {
  /**
   * This list is both the CORS allow-list and the redirect-URI check. A value
   * with a path would never equal the browser's `Origin` header — a rule
   * that silently never matches, worse than one that refuses.
   */
  it('refuses a URL with a path, which is not an origin and would never match a browser Origin header', () => {
    expect(allowedOrigin.safeParse('https://a.example.com/path').success).toBe(false)
  })

  it('refuses plain http on a public host', () => {
    expect(allowedOrigin.safeParse('http://a.example.com').success).toBe(false)
  })

  it('accepts http on a loopback host, where a dev server lives', () => {
    expect(allowedOrigin.safeParse('http://localhost:5173').success).toBe(true)
    expect(allowedOrigin.safeParse('http://127.0.0.1:5173').success).toBe(true)
  })

  it('accepts an https origin', () => {
    expect(allowedOrigin.safeParse('https://app.example.com').success).toBe(true)
  })

  it('refuses a trailing slash, which is a URL and not an origin', () => {
    expect(allowedOrigin.safeParse('https://app.example.com/').success).toBe(false)
  })
})

/* ------------------------------------------------------ email domains -- */

describe('emailDomain — one canonical spelling, so two entries that look alike are alike', () => {
  /**
   * The whitelist is compared against an address the cloud has already
   * lowercased. A capitalised entry could never match — self-registration
   * would refuse everybody, with no message explaining why.
   */
  it('refuses a capitalised domain, which could never match a lowercased address', () => {
    expect(emailDomain.safeParse('Example.com').success).toBe(false)
  })

  it('refuses a label starting with a hyphen', () => {
    expect(emailDomain.safeParse('-a.com').success).toBe(false)
  })

  it('refuses a bare label with no dot', () => {
    expect(emailDomain.safeParse('localhost').success).toBe(false)
  })

  it('accepts a hyphenated domain', () => {
    expect(emailDomain.safeParse('robot-fleet.example.com').success).toBe(true)
  })
})

/* ------------------------------------------------- provider slug rule -- */

describe('providerSlug — hyphenated, not the ROS slug grammar', () => {
  /**
   * `appIdentifier` is `slug`: lowercase, **underscore**-separated. A
   * provider slug appears in a URL path (`/api/client/oidc/:slug/start`) and
   * in the developer's own buttons, so it's hyphenated instead — pinned
   * because the two grammars differ by one character, and reusing the wrong
   * one would be invisible until a customer typed `azure-ad`.
   */
  it('accepts a hyphenated slug', () => {
    expect(providerSlug.safeParse('azure-ad').success).toBe(true)
    expect(providerSlug.safeParse('google').success).toBe(true)
  })

  it('refuses an underscore, the separator the ROS slug grammar uses', () => {
    expect(providerSlug.safeParse('azure_ad').success).toBe(false)
  })

  it('refuses a leading digit, a leading hyphen and a trailing hyphen', () => {
    expect(providerSlug.safeParse('1google').success).toBe(false)
    expect(providerSlug.safeParse('-google').success).toBe(false)
    expect(providerSlug.safeParse('google-').success).toBe(false)
  })

  it('refuses a capital', () => {
    expect(providerSlug.safeParse('Google').success).toBe(false)
  })
})

/* --------------------------------------------------------- the enums -- */

describe('the enums, by arity AND content', () => {
  /**
   * `.options` equality, not membership: counting members passes when two
   * are swapped; checking membership passes when a sixth appears. Both have
   * happened here.
   */
  it('appUserStatus is exactly the three lifecycle states', () => {
    expect(appUserStatus.options).toEqual(['pending_verification', 'active', 'blocked'])
  })

  it('mailTemplateKind is exactly the three customisable mails', () => {
    expect(mailTemplateKind.options).toEqual(['invite', 'verify', 'reset'])
  })

  it('clientOidcErrorCode is exactly the twelve callback outcomes', () => {
    expect(clientOidcErrorCode.options).toEqual([
      'no_access',
      'email_taken',
      'email_unverified',
      'domain_not_allowed',
      'registration_closed',
      'idp_unavailable',
      'exchange_failed',
      'claims_incomplete',
      'provider_misconfigured',
      'provider_disabled',
      'invalid_request',
      // The twelfth: the org is at `max_end_users` and this identity would
      // need a new account. Its own code, not `no_access` — same reason as
      // `domain_not_allowed`: not about the person, remedy is the
      // developer's.
      'quota_exceeded',
    ])
  })

  it('MAIL_TEMPLATE_VARIABLES is exactly what a Liquid template may name', () => {
    expect([...MAIL_TEMPLATE_VARIABLES]).toEqual([
      'app.name',
      'org.name',
      'user.email',
      'user.display_name',
      'role.name',
      'link',
      'expires_in_hours',
    ])
  })

  /**
   * **The Fleetless default text, pinned as a set.**
   *
   * The cloud (no template configured) and the console (*Customise*) both
   * send these words, and have disagreed on them before. So the set is
   * checked against `mailTemplateKind.options`, not a hand-written list of
   * three — a fourth kind with no default would otherwise be a mail the
   * cloud can't send, caught only by the enum test.
   *
   * Deliberately NOT checked: that these compile as Liquid. Contracts has no
   * renderer, and building one just to check this constant would be a
   * weaker copy of what actually sends mail. The cloud asserts the exact
   * text it sends for each kind.
   */
  it('DEFAULT_MAIL_TEMPLATES covers every kind, text-only, with nothing empty', () => {
    expect(Object.keys(DEFAULT_MAIL_TEMPLATES).sort()).toEqual([...mailTemplateKind.options].sort())

    for (const kind of mailTemplateKind.options) {
      const template = DEFAULT_MAIL_TEMPLATES[kind]
      // Non-empty, not merely present: a `''` subject satisfies "the key is
      // there" while shipping a mail with no subject line.
      expect(template.subject.length, `${kind} subject`).toBeGreaterThan(0)
      expect(template.text.length, `${kind} text`).toBeGreaterThan(0)
      // Text-only by construction — markup here would make every app that
      // never opens the Mails tab send Fleetless-styled HTML on someone
      // else's behalf.
      expect(template.html, `${kind} html`).toBeNull()
      // A real template, not three copies of one: the body must satisfy the
      // same bounds the PUT enforces on a custom one.
      expect(putAppMailTemplateRequest.safeParse(template).success, `${kind} within the request bounds`).toBe(true)
    }

    // Three distinct subjects — arity alone would pass three copies of one
    // line.
    expect(new Set(mailTemplateKind.options.map(kind => DEFAULT_MAIL_TEMPLATES[kind].subject)).size).toBe(3)
  })
})

/* ------------------------------------------------------- the app user -- */

describe('appUser and the requests that write one', () => {
  const ROW = {
    id: UUID,
    app_id: UUID2,
    email: 'a@example.com',
    display_name: 'Ada',
    role_id: UUID,
    status: 'active',
    has_password: true,
    providers: ['azure-ad'],
    last_login_at: '2026-09-05T10:00:00.000Z',
    created_at: '2026-09-05T09:00:00.000Z',
  }

  it('accepts a complete row', () => {
    expect(appUser.safeParse(ROW).success).toBe(true)
  })

  it('accepts an OIDC-only user: no password, and providers names where they came from', () => {
    expect(appUser.safeParse({ ...ROW, has_password: false, providers: ['google'] }).success).toBe(true)
  })

  it('accepts a password-only user with an empty provider list', () => {
    expect(appUser.safeParse({ ...ROW, providers: [] }).success).toBe(true)
  })

  /**
   * `null` is a user who was invited or registered but never signed in.
   * Required-and-nullable rather than optional keeps *never logged in*
   * distinguishable from *the mapper forgot the column* — the distinction
   * `orgUser.tier` was written to preserve.
   */
  it('requires last_login_at to be present, nullable rather than optional', () => {
    expect(appUser.safeParse({ ...ROW, last_login_at: null }).success).toBe(true)
    const { last_login_at, ...withoutIt } = ROW
    void last_login_at
    expect(appUser.safeParse(withoutIt).success).toBe(false)
  })

  it('requires a role: an app user with no role could reach nothing and would still be listed', () => {
    const { role_id, ...withoutRole } = ROW
    void role_id
    expect(appUser.safeParse(withoutRole).success).toBe(false)
  })

  /**
   * **A developer cannot un-verify somebody.** `pending_verification` is
   * reached once, by self-registration, and left by spending the mailed
   * token. A PATCH that could set it back would let an admin void a
   * verified address with no mail ever sent — and no route out again that
   * skips the token.
   */
  it('patchAppUserRequest refuses status: pending_verification', () => {
    expect(patchAppUserRequest.safeParse({ status: 'blocked' }).success).toBe(true)
    expect(patchAppUserRequest.safeParse({ status: 'active' }).success).toBe(true)
    expect(patchAppUserRequest.safeParse({ status: 'pending_verification' }).success).toBe(false)
  })

  it('patchAppUserRequest is strict, so an offered email is a refusal rather than a silent drop', () => {
    expect(patchAppUserRequest.safeParse({ email: 'b@example.com' }).success).toBe(false)
  })

  it('a display name is bounded, and the bound is the exported constant', () => {
    expect(appUser.safeParse({ ...ROW, display_name: 'x'.repeat(APP_USER_DISPLAY_NAME_MAX) }).success).toBe(true)
    expect(appUser.safeParse({ ...ROW, display_name: 'x'.repeat(APP_USER_DISPLAY_NAME_MAX + 1) }).success).toBe(false)
  })
})

/* ----------------------------------------------------- the invitation -- */

describe('appInvitation — the accept link is nullable, and that is a policy', () => {
  const ROW = {
    id: UUID,
    app_id: UUID2,
    email: 'a@example.com',
    role_id: UUID,
    expires_at: '2026-09-12T09:00:00.000Z',
    accept_url: 'https://app.example.com/invite/abc',
    mail: 'sent',
  }

  it('accepts a complete invitation', () => {
    expect(appInvitation.safeParse(ROW).success).toBe(true)
  })

  /**
   * An app with no `invite_url` has nowhere for the link to point. `null`
   * says that outright — an absent key would look like a mapper dropped the
   * field, and a fabricated Fleetless-hosted URL is a page this product
   * doesn't have.
   */
  it('accepts a null accept_url, the state of an app with no invite_url configured', () => {
    expect(appInvitation.safeParse({ ...ROW, accept_url: null }).success).toBe(true)
  })

  /**
   * Withholds the token for `pendingUserInvite`'s reason: a page nobody
   * thinks of as sensitive stops being sensitive the moment it renders live
   * credentials.
   */
  it('pendingAppInvitation carries neither the accept_url nor the mail status', () => {
    expect('accept_url' in pendingAppInvitation.shape).toBe(false)
    expect('mail' in pendingAppInvitation.shape).toBe(false)
    expect('email' in pendingAppInvitation.shape).toBe(true)
    expect('role_id' in pendingAppInvitation.shape).toBe(true)
  })
})

/* -------------------------------------------------------- the provider -- */

describe('appOidcProvider — the secret goes in and never comes back', () => {
  const ROW = {
    id: UUID,
    app_id: UUID2,
    slug: 'azure-ad',
    name: 'Azure AD',
    issuer: 'https://login.microsoftonline.com/tid/v2.0',
    client_id: 'abc',
    scopes: ['openid', 'email'],
    link_verified_emails: false,
    enabled: true,
    created_at: '2026-09-05T09:00:00.000Z',
  }

  it('accepts a complete provider', () => {
    expect(appOidcProvider.safeParse(ROW).success).toBe(true)
  })

  /**
   * Same rule this platform keeps for server keys and the group provider it
   * replaces: a secret a response can carry is a secret in every log that
   * captured one. Asserted on the **shape**, not by parsing — zod would
   * strip an extra key silently and pass for the wrong reason.
   */
  it('has no client_secret field at all', () => {
    expect('client_secret' in appOidcProvider.shape).toBe(false)
  })

  it('refuses an issuer with a query string, the redirect trick idpIssuer names', () => {
    expect(appOidcProvider.safeParse({ ...ROW, issuer: 'https://idp.example.com/?next=x' }).success).toBe(false)
  })

  it('refuses a file: issuer, which would point the server at its own disk', () => {
    expect(appOidcProvider.safeParse({ ...ROW, issuer: 'file:///etc/passwd' }).success).toBe(false)
  })

  it('refuses an empty scope list: a provider that asks for nothing learns nothing', () => {
    expect(appOidcProvider.safeParse({ ...ROW, scopes: [] }).success).toBe(false)
  })

  /**
   * A one-character client secret is a misconfiguration, not a rotation —
   * `putGroupOidcProviderRequest`'s bound, carried over.
   */
  it('createAppOidcProviderRequest requires a client secret of real length', () => {
    const REQ = {
      slug: 'azure-ad',
      name: 'Azure AD',
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      client_id: 'abc',
      client_secret: 'x'.repeat(16),
    }
    expect(createAppOidcProviderRequest.safeParse(REQ).success).toBe(true)
    expect(createAppOidcProviderRequest.safeParse({ ...REQ, client_secret: 'x' }).success).toBe(false)
  })

  it('createAppOidcProviderRequest defaults the scopes and the two switches', () => {
    const parsed = createAppOidcProviderRequest.parse({
      slug: 'azure-ad',
      name: 'Azure AD',
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      client_id: 'abc',
      client_secret: 'x'.repeat(16),
    })
    expect(parsed.scopes).toEqual(['openid', 'email', 'profile'])
    expect(parsed.link_verified_emails).toBe(false)
    expect(parsed.enabled).toBe(true)
  })

  /**
   * The slug is in the path and keys every linked identity row, so renaming
   * it would orphan every `app_user_identities` row that named it. Strict,
   * so offering it is a refusal, not a silent drop.
   */
  it('patchAppOidcProviderRequest cannot change the slug', () => {
    expect(patchAppOidcProviderRequest.safeParse({ name: 'Entra ID' }).success).toBe(true)
    expect(patchAppOidcProviderRequest.safeParse({ slug: 'entra-id' }).success).toBe(false)
  })

  it('patchAppOidcProviderRequest accepts an empty body: every field is optional', () => {
    expect(patchAppOidcProviderRequest.safeParse({}).success).toBe(true)
  })
})

/* ------------------------------------------------------ the auth config -- */

describe('appAuthConfig — what the developer may set, and the one field they may not', () => {
  const ROW = {
    self_registration: true,
    allowed_domains: ['example.com'],
    allowed_origins: ['https://app.example.com'],
    mcp_enabled: false,
    invite_url: 'https://app.example.com/invite/{token}',
    verify_url: 'https://app.example.com/verify/{token}',
    reset_url: 'https://app.example.com/reset/{token}',
    mcp_login_url: null,
    oidc_callback_url: 'https://api.fleetless.dev/api/client/oidc/callback',
    updated_at: '2026-09-05T09:00:00.000Z',
  }

  it('accepts a complete config', () => {
    expect(appAuthConfig.safeParse(ROW).success).toBe(true)
  })

  it('accepts an app that has configured none of the four URLs', () => {
    expect(
      appAuthConfig.safeParse({ ...ROW, invite_url: null, verify_url: null, reset_url: null, mcp_login_url: null })
        .success,
    ).toBe(true)
  })

  /**
   * **The one callback URL a developer registers at every IdP is minted by
   * the cloud, not chosen.** Writable, a caller could point the OIDC return
   * leg — which carries an authorization code — at a host they own. Strict,
   * so offering it is a `400`, not a silently ignored field.
   */
  it('putAppAuthConfigRequest refuses the callback URL and the timestamp', () => {
    const { oidc_callback_url, updated_at, ...writable } = ROW
    void updated_at
    expect(putAppAuthConfigRequest.safeParse(writable).success).toBe(true)
    expect(putAppAuthConfigRequest.safeParse({ ...writable, oidc_callback_url }).success).toBe(false)
    expect(putAppAuthConfigRequest.safeParse({ ...writable, updated_at: ROW.updated_at }).success).toBe(false)
  })

  it('refuses a plain-http invite URL through the template rule', () => {
    expect(appAuthConfig.safeParse({ ...ROW, invite_url: 'http://app.example.com/i/{token}' }).success).toBe(false)
  })

  it('refuses an allowed origin carrying a path', () => {
    expect(appAuthConfig.safeParse({ ...ROW, allowed_origins: ['https://app.example.com/x'] }).success).toBe(false)
  })

  /**
   * Bounded like every other stored, logged, rendered array: an unbounded
   * list is a size nobody chose, and this one is walked on every CORS
   * preflight.
   */
  it('bounds both lists', () => {
    expect(appAuthConfig.safeParse({ ...ROW, allowed_domains: Array(51).fill('a.com') }).success).toBe(false)
    expect(
      appAuthConfig.safeParse({ ...ROW, allowed_origins: Array(21).fill('https://a.com') }).success,
    ).toBe(false)
  })
})

/* ----------------------------------------------------- mail templates -- */

describe('the mail templates', () => {
  const BODY = { subject: 'Welcome', text: 'Hello {{ user.email }}', html: null }

  it('accepts a text-only template', () => {
    expect(putAppMailTemplateRequest.safeParse(BODY).success).toBe(true)
  })

  it('accepts a template with an html part', () => {
    expect(putAppMailTemplateRequest.safeParse({ ...BODY, html: '<p>Hello</p>' }).success).toBe(true)
  })

  it('accepts an omitted html part, which is not the same request as an explicit null', () => {
    const { html, ...withoutHtml } = BODY
    void html
    expect(putAppMailTemplateRequest.safeParse(withoutHtml).success).toBe(true)
  })

  /**
   * `kind` is in the path, `updated_at` is a server fact. A body carrying
   * `kind` could disagree with the path, leaving the handler to pick which
   * half to believe — `putAssignmentRequest`'s reasoning, kept.
   */
  it('refuses kind and updated_at in the body', () => {
    expect(putAppMailTemplateRequest.safeParse({ ...BODY, kind: 'invite' }).success).toBe(false)
    expect(putAppMailTemplateRequest.safeParse({ ...BODY, updated_at: '2026-09-05T09:00:00.000Z' }).success).toBe(false)
  })

  it('refuses an empty subject and an empty text: a mail with neither is not a template', () => {
    expect(putAppMailTemplateRequest.safeParse({ ...BODY, subject: '' }).success).toBe(false)
    expect(putAppMailTemplateRequest.safeParse({ ...BODY, text: '' }).success).toBe(false)
  })

  /**
   * The preview posts the same document the PUT does, so both shapes derive
   * from one definition — but as **two objects**, not one aliased twice,
   * because the export registry resolves an artifact name by object identity
   * and refuses a schema registered under two names.
   */
  it('mailTemplatePreviewRequest accepts exactly what putAppMailTemplateRequest accepts', () => {
    expect(Object.keys(appUsers.mailTemplatePreviewRequest.shape).sort()).toEqual(
      Object.keys(putAppMailTemplateRequest.shape).sort(),
    )
    expect(appUsers.mailTemplatePreviewRequest).not.toBe(putAppMailTemplateRequest)
  })

  it('mailTemplateProblemDetails names which part of the template failed', () => {
    expect(appUsers.mailTemplateProblemDetails.shape.part.options).toEqual(['subject', 'text', 'html'])
  })
})

/* ---------------------------------------------------- the client identity -- */

describe('clientIdentity after impersonation and the org pool are gone', () => {
  it('names exactly three kinds of caller, and app_user replaced end_user', () => {
    expect(clientIdentity.shape.kind.options).toEqual(['developer', 'app_user', 'server_key'])
  })

  /**
   * `act` was the impersonating org admin (RFC 8693). Impersonation is
   * deleted with no successor — a field that could still arrive would
   * describe a delegation nothing can mint, and a console rendering "you are
   * acting as …" would show a state the platform cannot enter.
   */
  it('has no act: impersonation is gone with no successor', () => {
    expect('act' in clientIdentity.shape).toBe(false)
  })

  it('has no end_user_id: the org-pool end user is gone, and app_user_id is not the same subject', () => {
    expect('end_user_id' in clientIdentity.shape).toBe(false)
    expect('app_user_id' in clientIdentity.shape).toBe(true)
  })
})

describe('clientOidcStartQuery — PKCE is not optional here', () => {
  const Q = {
    app_identifier: 'warehouse_ops',
    redirect_uri: 'https://app.example.com/callback',
    state: 'abcdefgh',
    code_challenge: 'a'.repeat(43),
  }

  it('accepts a complete start query', () => {
    expect(clientOidcStartQuery.safeParse(Q).success).toBe(true)
  })

  /**
   * A short `state` is guessable, and `state` binds the callback to the
   * browser that started the flow. Eight characters is the design's floor —
   * fewer gets a refusal rather than a flow that looks fine and defends
   * nothing.
   */
  it('refuses a state shorter than eight characters', () => {
    expect(clientOidcStartQuery.safeParse({ ...Q, state: 'abc' }).success).toBe(false)
  })

  it('refuses a code challenge outside RFC 7636 length and alphabet', () => {
    expect(clientOidcStartQuery.safeParse({ ...Q, code_challenge: 'a'.repeat(42) }).success).toBe(false)
    expect(clientOidcStartQuery.safeParse({ ...Q, code_challenge: `${'a'.repeat(42)}+` }).success).toBe(false)
  })
})

/* --------------------------------------------------- what must be gone -- */

describe('the deleted identity model is gone from the barrel', () => {
  /**
   * Removed-symbol guards, one per deleted concept. A `grep` over the source
   * proves nothing about what a consumer can import; this is what a consumer
   * sees. Each was load-bearing in the model the redesign replaced — a
   * re-appearance is a merge accident, not a decision.
   */
  it.each([
    ['orgGroup', 'groups are deleted with no successor'],
    ['orgUser', 'replaced by fleetlessUser and appUser'],
    ['appAssignment', 'app access is the app user\'s own row, not an assignment'],
    ['brandingConfig', 'Fleetless renders no page an app user sees'],
    ['groupOidcProvider', 'a provider belongs to an app now'],
    ['clientLogoutResponse', 'logout answers 204; the IdP logout hint is cut'],
    ['impersonationChoice', 'impersonation is deleted'],
    ['orgFederationPolicy', 'the org-level linking policy is per provider now'],
    ['jitGrant', 'JIT grants died with assignments'],
    ['idpConfig', 'the per-app seam is replaced by appOidcProvider'],
    ['patchUserRequest', 'replaced by patchFleetlessUserRequest and patchAppUserRequest'],
    ['createUserInviteRequest', 'replaced by createTeamInviteRequest'],
    ['mcpAccess', 'MCP is decided per app, not per user override'],
  ])('%s is not exported (%s)', (name) => {
    expect(name in barrel).toBe(false)
  })

  it('the replacements are exported', () => {
    for (const name of [
      'fleetlessUser',
      'createTeamInviteRequest',
      'appUser',
      'appOidcProvider',
      'appAuthConfig',
      'appUrlTemplate',
    ]) {
      expect(name in barrel).toBe(true)
    }
  })
})

/* --------------------------------------------- the credential sweep -- */

describe('no identity schema carries a credential', () => {
  /**
   * A sweep, not a per-shape assertion: the failure this guards against is a
   * **new** shape adding `password_hash`, and a hand-written list of shapes
   * is exactly the check nobody updates for the new one.
   *
   * Extended here with `client_secret` — but only over **response** shapes,
   * since `createAppOidcProviderRequest` carries one by design and a blanket
   * ban would refuse the one place it belongs.
   */
  const FORBIDDEN = ['password_hash', 'passwordHash', 'hashed_password', 'client_secret_hash']

  const modules: Array<[string, Record<string, unknown>]> = [
    ['app-users', appUsers as Record<string, unknown>],
    ['client-auth', clientAuthModule as Record<string, unknown>],
    ['identity', identity as Record<string, unknown>],
  ]

  const objectShapes: Array<[string, Record<string, unknown>]> = modules.flatMap(([mod, exports]) =>
    Object.entries(exports).flatMap(([name, value]) =>
      typeof value === 'object' && value !== null && 'shape' in value
        ? [[`${mod}.${name}`, (value as { shape: Record<string, unknown> }).shape] as [string, Record<string, unknown>]]
        : [],
    ),
  )

  it('found schemas to sweep (a vacuous pass is the failure mode here)', () => {
    expect(objectShapes.length).toBeGreaterThan(20)
  })

  it('no exported object schema has a credential-shaped field', () => {
    const offenders: string[] = []
    for (const [name, shape] of objectShapes) {
      for (const forbidden of FORBIDDEN) {
        if (forbidden in shape) offenders.push(`${name}.${forbidden}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * The write-only half, stated as its own rule: a `client_secret` may appear
   * on a request and must never appear on anything a route answers with.
   */
  it('no response schema echoes a client_secret', () => {
    const offenders = objectShapes
      .filter(([name]) => !name.includes('Request') && !name.includes('request'))
      .filter(([, shape]) => 'client_secret' in shape)
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })

  it('and the sweep can see a client_secret where one is allowed, so it is not blind to the field', () => {
    expect('client_secret' in createAppOidcProviderRequest.shape).toBe(true)
  })
})
