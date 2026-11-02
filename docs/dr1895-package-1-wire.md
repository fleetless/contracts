# Package 1 wire integration

Single package bundle for DR-3011, based on Contracts `76d65d1` and the
technically approved [#1008](https://github.com/fleetless/fleetless/issues/1008) spec at
`21bd3dff5291fd7655adb8a5d1031334eae4a005`, with the confirmed-copy
delta at `286684f1e69a96191018d1c18b93e59dc5da7184` pending the package
review. The shared plan is DR-3008.
The C.4 consumer alignment is [#965](https://github.com/fleetless/fleetless/issues/965).
The H.1/H.3/banner wording was approved by André in DR-3032 at 16:08 UTC;
customer notice and legal publication still follow package 1. This branch
does not send notices, merge, publish a release or establish a consumer pin. Finn reviews
the complete bundle after Cloud and Console agree the exact head.

## New H.3 surface

`legal-offers.ts` exports the list query/summary/response, display request and
response, decision request/result/lookup query, decision snapshot and conflict
details, with corresponding inferred types and JSON Schemas. The route manifest
adds GET list, POST display, POST decisions and GET decision recovery under
`/api/org/legal/offers`. List is member-readable; the other routes require a real
Owner and refuse support/synthetic decisions. Every response is no-store.

Terms and price snapshots have separate strict fields and text IDs. Four result
arms distinguish accepted/declined Terms/prices. Terms summary and display
expose the actual publication instant, per-organization acceptance deadline and
developer access state. A pending display has the exact `Accept` and `Decline`
labels; a suspended display has `Accept` and no decline label. The Terms text ID
`DR-3032-2026-11-02-H.3-terms` identifies the H.3 wording approved in
DR-3032 comment `01a19d04-f67d-747b-87a2-ad2d14cc0262`, based on the exact
dialog in comment `01a19ce8-0136-73e6-bbb5-4ce75bc2041b`. It must not be
used with an older draft or synthetic placeholder as customer-facing copy.
The response `text` is the exact rendered dialog with the offered deadline and
permanent proposed Terms URL; Cloud binds it to the proof and stored decision.
The shared schema enforces the ID, action labels and state arms, while the
consumer must verify the rendered wording and its source values. Both Basic
and paid Terms offers use the same wire. All H.3 DPA fields are explicitly
null. A decline belongs only in decision history; accepted amendments
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
response for an exact retry. It must compute the paid deadline from the proved
current term end and the Basic deadline as seven full days after publication,
lock expiry and acceptance together, and clear only the Terms restriction on
acceptance. The wire rejects a termination field. No Terms decision starts
contract-end, retrieval or erasure work; no independent restriction is lifted.
An unprovable paid-term deadline uses `target_state_conflict` rule
`deadline_unavailable`; that rule is not a Basic prohibition.
Schema success proves none of those operations. The tests exercise the approved
H.3 wording with synthetic URLs, dates and identities; they are not customer
offer records.

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
- The Terms publication and deadline source, restriction reason, Console
  acceptance route under suspension and Cloud/Console field names must be
  reconciled against the complete package heads. The H.1/H.3/banner copy is
  confirmed; publication and customer send still wait for the package release.
- Finn reviews the complete head, then handles merge/release and the exact common
  Cloud/Console pin. There is no per-slice review or intermediate release.
- Cloud/Console acceptance tests still prove paid/Basic deadline boundaries,
  decline and silence parity, acceptance before and after suspension, unrelated
  restrictions surviving acceptance, absence of contract termination and deletion,
  price-boundary equality, delayed payment, failed replacement preserving the
  future agreement, and role/replay failures.
  Contracts tests validate wire shapes, not those live transactions.
