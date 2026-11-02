# Package 1 wire integration

Single package bundle for DR-3011, based on Contracts `76d65d1` and the technical
approval of [#1008](https://github.com/fleetless/fleetless/issues/1008) at
`032f215e96cd0757faeae290e26728922f428ed2`. The shared plan is DR-3008.
The C.4 consumer alignment is [#965](https://github.com/fleetless/fleetless/issues/965).
This branch does not approve customer wording, activate Basic Terms decisions,
send notices, merge, publish a release or establish a consumer pin. Finn reviews
the complete bundle after Cloud and Console agree the exact head.

## New H.3 surface

`legal-offers.ts` exports the list query/summary/response, display request and
response, decision request/result/lookup query, decision snapshot and conflict
details, with corresponding inferred types and JSON Schemas. The route manifest
adds GET list, POST display, POST decisions and GET decision recovery under
`/api/org/legal/offers`. List is member-readable; the other routes require a real
Owner and refuse support/synthetic decisions. Every response is no-store.

Terms and price snapshots have separate strict fields and text IDs. Four result
arms distinguish accepted/declined Terms/prices. Only Terms can carry a causal
scheduled termination or its reversal; prices cannot. All H.3 DPA fields are
explicitly null. A decline belongs only in decision history; accepted amendments
and prices also appear in the existing Owner acceptance history via the new
`amendment` and `price_offer` contexts. Cloud must select those rows correctly;
the row schema cannot infer an unexposed stored decision.

Limits are optional canonical decimal **strings** from 1 to 100; Cloud defaults
to 50. The Zod cursor validator checks unpadded base64url, a strict decoded object
and exact JSON key order `v`, `created_at`, `id`, without whitespace or duplicates.
JSON Schema checks encoding syntax; its consumers must perform the decoded
canonical-payload and organization-scope checks themselves. Runtime display
validation also checks positive lifetime up to ten minutes and equal response/
snapshot expiry. These relative-time checks are not expressible in standard
JSON Schema and remain mandatory in consumers using the artifacts.

Cloud remains responsible for authenticating the real actor, scoping lookup,
checking the stored proof and offer revision, validating exact rendered text,
serializing decisions, keeping accepted commitments, and recovering the original
response for an exact retry. Schema success proves none of those operations.
Synthetic fixture wording is not approved customer text.

## Breaking C.4 migration

Every existing `period` gets `anchor: existing_period`; all existing date,
time-zone and effect fields and checks remain. A first checkout may instead use
`anchor: on_first_successful_payment`, `cycle`, `start_statement` and
`period_statement`. The two statements are the approved literal start and
month/year duration sentences. This arm forbids fixed date/effect fields, must
match `selection.cycle`, and is rejected on paid and plan changes. Both Zod and
JSON Schema enforce those structural/cycle rules.

Every snapshot must also supply `future_price_replacement`: null unless the
decision replaces an accepted future agreement, otherwise `{ agreement_id, text }`.
Console renders the exact statement and agreement identity in the final view;
Cloud binds them into the same proof and supersedes the schedule only when the
order becomes effective. Missing identity/text fails shape validation. Detecting
a semantically mismatched agreement or statement requires the stored Cloud
binding. Money fields and existing quote/VAT rules are unchanged.

Console must handle both period arms before consuming this breaking release,
display Cloud statements without inventing dates, and display the replacement
before confirmation. Cloud must persist the accepted conditional snapshot
unchanged and create a separate payment-derived actual-period projection for E.
The new record shape does not mutate old evidence or authorize backfills.

## Remaining integration gates

- Frieda confirms the exact package head against the updated #965/Console flow
  and its tests; the prior unconditional date requirement must not survive.
- Basic Terms display and both decisions stay unavailable while `term_end_at`
  cannot be truthfully supplied; read-only notices remain available. The Basic
  policy and exact Terms-decline/replacement wording remain with their owners.
- Finn reviews the complete head, then handles merge/release and the exact common
  Cloud/Console pin. There is no per-slice review or intermediate release.
- Cloud/Console acceptance tests still prove the nonretroactive Terms effect,
  same-decline reversal before term end, price-boundary equality, delayed payment,
  failed replacement preserving the future agreement, and role/replay failures.
  Contracts tests validate wire shapes, not those live transactions.
