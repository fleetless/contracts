import { z } from 'zod'
import { appIdentifier } from './apps.js'

/**
 * What a client app sends to become someone (spec §3.4, §11.1).
 *
 * Two kinds of caller reach the client API, and both use the `Authorization:
 * Bearer` header:
 *
 * - an **end user**, with the JWT access token issued here;
 * - a **server key** (`flk_…`), for server-side code, carrying full app
 *   rights.
 *
 * The cloud tells them apart by shape — a `flk_` prefix is a server key,
 * anything else is parsed as a JWT. That rule is written down once, here, so
 * the SDK and the cloud cannot drift into disagreeing about it.
 *
 * The credentials path is the whole of W3. The OIDC redirect flow of §3.4
 * arrives in W7 with the hosted login page, and ends in exactly these same
 * tokens.
 */

export const clientLoginRequest = z.object({
  app_identifier: appIdentifier,
  email: z.email(),
  password: z.string().min(1),
})
export type ClientLoginRequest = z.infer<typeof clientLoginRequest>

export const clientRefreshRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientRefreshRequest = z.infer<typeof clientRefreshRequest>

/**
 * Logging out revokes the whole token family server-side. Without this, a
 * refresh token stolen before the user pressed "log out" keeps working —
 * clearing a client-side store is a UI gesture, not a revocation.
 */
export const clientLogoutRequest = z.object({
  refresh_token: z.string().min(1),
})
export type ClientLogoutRequest = z.infer<typeof clientLogoutRequest>

/**
 * **What logout can and cannot end, said in three separable facts (W9c,
 * DEF-098).**
 *
 * Until now this route answered `204`: the Fleetless session was over and the
 * response had nothing to say about the *other* session. For a federated user
 * that is the larger half — they clicked "log out", the IdP's cookie survived,
 * and the next login goes straight through without a password. The register
 * row calls that an expectation gap, and it is: the word on the button is
 * "log out", not "log out of this app".
 *
 * **The Fleetless session is ended before this is computed, unconditionally.**
 * Nothing below can fail in a way that leaves the caller logged in here — a
 * logout that depends on reaching a third party is not a logout.
 *
 * **Four outcomes**, and they are deliberately not collapsed into a nullable
 * URL. *No IdP was involved* and *an IdP was involved and publishes no
 * `end_session_endpoint`* are different things: the first needs no action and
 * the second means a session survives that this platform cannot end. A caller
 * that renders them identically is choosing to; a contract that cannot tell
 * them apart makes the choice for everyone.
 *
 * **This sentence said "three" for a whole wave, directly above a four-branch
 * union in this same file** — found by Momus-W9, along with the same number in
 * `sdk/src/auth.ts` and `sdk/README.md`. The type is derived
 * (`ClientLogoutResponse['idp_logout']`), so `tsc` had nothing to say, and the
 * sweep shows the mechanism plainly: `sdk d065447` is literally titled *"logout
 * says three separable things"* — correct when written, never carried forward
 * when `hint_unavailable` arrived in `b417d2a`.
 *
 * The count is not the point. **`hint_unavailable` is precisely the case this
 * comment warns about** — the IdP session survives — so a caller who handles
 * the three documented branches drops it into an `else` they believe means
 * *nothing to do*.
 */
export const clientLogoutResponse = z.object({
  idp_logout: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('redirect'),
      /** Send the browser here. Built from the IdP's own `end_session_endpoint`. */
      url: z.url().max(2000),
    }),
    /** This session did not come from an IdP — there is nothing else to end. */
    z.object({ status: z.literal('not_federated') }),
    /**
     * It did, and the IdP's discovery document names no `end_session_endpoint`
     * (RP-initiated logout is optional in OIDC). **The IdP session survives and
     * this platform cannot end it** — say so rather than implying success.
     */
    z.object({ status: z.literal('unsupported_by_idp') }),
    /**
     * **Federated, the IdP *can* end the session, and we cannot ask it to
     * (W9c, Nimbus-W9c's proposal).**
     *
     * `id_token_hint` is missing: the stored value could not be decrypted, or
     * the session predates the fix that started keeping one. Deliberately not
     * folded into `unsupported_by_idp` — there the cause is **the IdP's**, here
     * it is **ours**, and an operator reading a rise in these needs to know
     * which of the two they are looking at.
     *
     * **No `url` field, and that is the whole point.** Sending somebody to a
     * bare `end_session_endpoint` produces a page that *asks* rather than one
     * that ends — measured against real Keycloak, which renders *"Do you want
     * to log out?"* and leaves the session alive. An outcome that promises
     * something it does not deliver is worse than one that admits it.
     *
     * **The two causes are one status on purpose.** A caller can do nothing
     * differently between "decryption failed" and "this session is older than
     * the fix" — both mean *the IdP session survives and you cannot end it
     * from here*. The distinction matters to whoever runs this platform, and
     * it belongs in the server's log, not on the wire: splitting a wire enum
     * to carry a fact no consumer can act on is how a contract grows keys
     * nobody reads.
     */
    z.object({ status: z.literal('hint_unavailable') }),
    /**
     * **The server does not know this session, so it can say nothing about an
     * IdP** (W9 review, Argus-W9; André, 2026-08-19).
     *
     * The token was unknown, already superseded, revoked, or expired. There is
     * nothing to end here and — this is the whole point — **nothing to claim
     * either**. `not_federated` would be a statement about a login this server
     * never saw.
     *
     * Same shape of argument that produced `hint_unavailable`: *there the cause
     * is the IdP's, here it is ours.* Here it is neither — it is an **absence
     * of knowledge**, and a contract whose job on this route is to keep facts
     * apart should not spend a fact it does not have.
     *
     * **What a caller does with it: nothing, but not the same nothing as
     * `not_federated`.** A first logout in the same flow may well have returned
     * a `redirect` that is still worth following. Reading this as *"the user is
     * fully logged out"* is exactly the mistake a second logout invites.
     */
    z.object({ status: z.literal('session_unknown') }),
  ]),
})
export type ClientLogoutResponse = z.infer<typeof clientLogoutResponse>

/**
 * Who the caller turned out to be. Returned by the "who am I" endpoint and by
 * the realtime `auth_ok` frame, so a client can render a session without
 * decoding a token itself — decoding a JWT in the client is how apps end up
 * trusting claims nobody verified.
 *
 * **Three kinds of caller reach the client API, not two.** Besides end users
 * and server keys, a **developer** does: spec §15.2 says the console's
 * playground runs over the real client API and appears in the audit as the
 * developer, and the console's own live views (robot list badges, the Live
 * tab) subscribe on `/realtime` as one. A developer is **org-scoped, not
 * app-scoped** — they own the configuration of every robot in their org — so
 * `app_id` and `role_id` are null for them, and roles do not filter what they
 * see. `kind` states this explicitly rather than leaving it to be inferred
 * from which id happens to be set.
 *
 * **`act` is the real admin behind an impersonation** (spec
 * `2026-08-29-org-identity-redesign`, D4, the `act`-claim pattern of RFC
 * 8693). An Org Admins member entering an app through the interstitial
 * (`impersonationChoice`) gets a token whose *effective* identity is the role
 * or user they chose — that is what the rest of this shape describes — while
 * `act` names **the admin who is actually driving**. So every action can
 * audit as "Admin A as User B / as role X", and a client can render the "you
 * are acting as …" banner without decoding the token.
 *
 * **Optional, not a nullable actor, for `orgUser.tier`'s reason:** absence
 * means *this is an ordinary session, nobody is delegating*, which is not the
 * same fact as *the actor is unknown*. The overwhelming majority of sessions
 * are ordinary and carry no `act` at all; a session that has one is a
 * delegation and says who by. The schema cannot check that `act` is present
 * exactly when the effective identity was impersonated — that pairing is the
 * cloud's, minted at the authorize step. Only the admin's **id** rides here:
 * the label is resolved by whoever renders it, not carried as a second
 * unverified name on the wire.
 */
export const clientIdentity = z.object({
  kind: z.enum(['developer', 'end_user', 'server_key']),
  developer_id: z.uuid().nullable(),
  end_user_id: z.uuid().nullable(),
  server_key_id: z.uuid().nullable(),
  app_id: z.uuid().nullable(),
  role_id: z.uuid().nullable(),
  email: z.email().nullable(),
  /** Present only under impersonation — the real admin's user id (D4, `act`-claim). */
  act: z.object({ admin_user_id: z.uuid() }).strict().optional(),
})
export type ClientIdentity = z.infer<typeof clientIdentity>
