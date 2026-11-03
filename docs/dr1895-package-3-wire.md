# DR-1895 package 3 wire inventory

Work in progress for DR-3011. This is the single Contracts package branch.
Keep it in Draft until the complete wire and its exact head pass Finn's review
and CI. Finn then merges and publishes one bundled Contracts release before
Cloud and Ops pin that exact version, as DR-3010 section 1 requires. Runtime
activation and acceptance have separate gates below.

## Approved inputs

- [#903](https://github.com/fleetless/fleetless/issues/903), `18f38f21c5f3d748db2fdcc1b9c161f745a7c85e`.
- [#873](https://github.com/fleetless/fleetless/issues/873), `f3ef8230c3222e6fca95a17ef15d9437727c262b`.
- [#872](https://github.com/fleetless/fleetless/issues/872), `08bf0e2dce38718e41e71a7b4c8bea249f4042f4`.
- Their common package implementation approval of 2026-11-02.

The three control formats below are specified field-for-field in #873 and #872.
Their definitions are additive to the published Contracts `12.1.0` base; this does not decide
the semantic version of the completed package.

| Surface | Contracts exports | State |
| --- | --- | --- |
| C0, `fleetless.journal-first-checkpoint.v1` | `journalFirstCheckpointBody`, `journalFirstCheckpoint` and inferred types | Implemented, JSON schemas and negative fixtures |
| Registry control, `fleetless.registry-transition.v1` | `journalRegistryTransitionBody`, `journalRegistryTransition` and inferred types | Implemented, JSON schemas and negative fixtures |
| Activation, `fleetless.registry-activation-receipt.v1` | `journalRegistryActivationReceiptBody`, `journalRegistryActivationReceipt` and inferred types | Implemented; C0 sentinel fields are distinct from later receipts |
| v2 intent bodies/envelopes and exact `ids` | `journalIntentV2Body`, `journalIntentV2` and inferred types | Implemented from Cloud `013afb2`, with the existing four-value template enum; producer activation and v1 export remain unimplemented |
| Protected manifests, including scoped rows, asset/export versions and frozen batches | `journalManifestScope`, `journalManifestRow`, `journalManifestEntry`, `journalManifestBatch`, `journalDeletionManifest`, `journalManifestIntentProjection`, `journalManifestBinding` and inferred types | Implemented from Cloud `c76fbeb1`; raw protected identifiers stay outside ordinary intents/receipts |
| v2/generation activation checkpoints and final seal | `journalV2ActivationCheckpointBody`, `journalV2ActivationCheckpoint`, `journalGenerationCheckpointBody`, `journalGenerationCheckpoint`, `journalFinalSealBody`, `journalFinalSeal` and inferred types | Implemented from Ops `e465abb4`; original control bodies remain unchanged |
| Mixed export bundle and closed mirror inventory | `journalMirrorAttempt`, `journalExportItem`, `journalMixedExport` and inferred types | Implemented from Ops `9e5fcbc3`; failed marker/inventory arms remain visible and cannot claim complete mirror coverage |
| Replay operation outcomes, typed evidence, access proofs and gate receipt | `journalEvidenceRef`, `journalAccessProof`, `journalReplayReceiptBody`, `journalReplayReceipt` and inferred types | Implemented from Ops `9e5fcbc3`; a serializable failed scope cannot pass |

## Consumer validation boundary

The twenty-eight exports validate decoded object shape, not the signed wire bytes or
activation. They reject extra/missing fields, nulls, noncanonical UUID/hash/time/
LSN syntax, unsafe integers and invalid Ed25519 signature encodings. They do not
normalize or strip signed fields. JSON Schema preserves the same structural
constraints, including C0's zero hashes and empty old-version IDs.

Before trusting a record, Cloud and Ops must reject duplicate JSON keys and
noncanonical RFC-8785 bytes, invalid Unicode, floats/noncanonical number tokens,
and invalid hashes/signatures. Re-encoding comparison and signature checks belong
on the original bytes, before a parsed object can lose duplicate-key information.
The schema alone cannot distinguish JSON `1` from JSON `1.0` after decoding.

For each implemented signable body use `UTF8(body.schema) || 0x00 || RFC8785_UTF8(body)`.
SHA-256 hashes and Ed25519 signatures cover those same domain-separated bytes.
The envelope adds `checkpoint_hash`, `record_hash`, `receipt_hash` or `seal_hash` respectively,
and `signature`; those envelope fields are not signed as part of the body.
Signature syntax is exactly 64 bytes encoded as unpadded canonical base64url.

Consumers separately verify the pinned signer, sequence/hash/generation links,
monotone epoch, old/new registry/build digests, previous receipt hash, exact
mirror/fence/registry/build versions and effective retention, source timeline/LSN,
pinned standby readback, complete copy coverage and every historical build/path.
`coverage_verdict: gap` is a valid failure report, never an activation permit.
No customer route, storage resource, key, retention extension or traffic-opening
operation is introduced by these definitions.

Legacy v1 bytes must instead be preserved and verified by their original rules.
The fixtures in `test/journal-controls.test.ts`, `test/journal-intents.test.ts`, `test/journal-seals.test.ts`, `test/journal-restore-wire.test.ts` and `test/journal-manifest-wire.test.ts` are synthetic shared wire examples,
not valid cryptographic signatures or evidence of runtime coverage.

The sequenced v2 checkpoint requires `first_v2_sequence = sequence + 1` within
safe integer range. A generation checkpoint requires a different generation
and does not reset the sequence. The final seal uses the actual selected
timestamp/LSN recovery point; an LSN requires its independently evidenced UTC
mapping. The oldest selectable mapping-bearing point is a separate export
coverage bound, not an alternative value for the seal's selected point.
Zod also enforces the exact cutoff formula with overflow-safe integer addition:
`C = max(ceil_to_second(T + E_max + W_max), previous C + 1 second)`.
Standard JSON Schema cannot express these cross-field arithmetic/inequality
checks; its consumers must perform them separately. Neither Zod nor JSON Schema
proves the declared historical bounds, original bytes or commit/readback evidence.

## Remaining concrete inputs for the bundle

Frieda builds the Cloud ledger and schema/backfill design; Philipp remains Cloud
owner and Bernd coordinates Ops. Doris supplied an initial source/writer/wire
inventory against Cloud `399d4e8a`. It identifies `basic_activity_history`,
`basic_activity_observations` and `synthetic_org_fixtures` beyond the older
95-table inventory, the asset delete/error and late export-upload races, and the
required restore-closure migration. It explicitly does not claim a complete
schema/build registry or runtime coverage. Its candidate registry still describes
several alternatives rather than exact wire fields. Cloud `013afb2` now supplies
closed identities for 44 kinds, including central MCP/console rows without a
fabricated organization, three valid auth-factor combinations, role reassignment,
stable source generations, frozen batch IDs and the five authority kinds.
Those v2 forms are implemented here. Unlike that proposal's three-value template
list, the existing Contracts enum includes `login_code` (also in `v8.2.0`);
the journal reuses all four values. Every kind either requires all three manifest
reference fields or forbids them. A proposed dependent capture for a manifest-free
kind requires a concrete agreed wire revision before activation, not optional
references or an epoch-dependent permissive union. The existing approval makes this inventory
implementation work; it does not require another general spec approval.

Cloud `fb438e6` adds a machine-readable matrix: 48 branches for 45 kinds.
The additional `ops_global_event.retention` branch captures an exact protected
batch without an invented organization ID; `ops_event.retention` still requires
its organization. This delta is implemented, and the corrected Cloud template
enum now agrees with Contracts. Registry source paths stay outside intent IDs.

Cloud `c76fbeb1913b737b6f51c0edf0015870687b8bdd` closes the protected
manifest candidate with seven scope arms, 18 row variants, two object mapping
variants, 14 cutoff sweeps and two explicit frozen sets. Contracts validates
the strict envelope and each arm. `journalManifestBinding` joins the exact
manifest-backed v2 kind/IDs projection to one operation, scope and frozen batch;
it requires sorted physical membership, no duplicated row/mapping identity,
and every affected row in the one matching batch. Eight complete positive and
ten negative Cloud vectors exercise whole/scoped, central/global, shared object,
microsecond sample and dependent-row cases. The projection is not the signed
intent, and placeholder hashes/version IDs are not protected readback evidence.
The local vector copies omit only the Cloud document-level schema labels; their
manifest, intent, and membership payloads match that source commit.
JSON Schema consumers must enforce cross-record equality, physical ordering,
version uniqueness and protected bytes separately. Unknown kinds remain
rejected; an omitted registry row cannot be treated as a safe exclusion. No
public erasure route is invented from #903, which assigns its exact route/copy
separately.

Retention ranges (2026-11-03): the volume of `history.retention`,
`history.slug_delete` and `latency.retention` made one manifest row per deleted
sample or bucket impractical. `journalManifestRow` therefore has a 19th member,
`retention_range`, naming the expired range of one robot (optionally one
series) as `[from, cutoff)` with the frozen `row_count` and a `rows_digest`.
The digest is SHA-256 over the sorted row keys the range held when it was
frozen, so an older backup of the range can be compared with what was deleted;
replay itself deletes by range and never by digest. A row written later with a
timestamp inside the range is therefore inside the deletion; a row at or after
`cutoff` is never touched. The exact-generation guarantee ("a newly written row
survives") no longer holds for these two tables, by decision. The per-row
members stay valid for journals written earlier.

Ops `9e5fcbc3d231b3d96be9fb9cf1bd2789542daa24` closes the earlier
failed-scope, mirror and evidence-binding questions. The test fixture is copied
from its four complete unsigned receipt bodies and three mirror examples. A
successful scoped proof requires `unaffected_state_ref_id`; a failed scoped
proof may omit it, but a present reference must bind the same operation.
`MirrorAttempt` has object-version, unexpected-delete-marker and inventory-error
arms. `mirror_verdict:complete` rejects a marker in both Zod and JSON Schema;
failed inventory remains serializable. Global source-isolation/copy/closure refs
forbid `operation_id`; access/policy/preservation refs require it. Receipt Zod
validation checks replay counts, exact erase-operation/proof membership and
reference binding, and forbids a failed operation, access proof or access probe
with `pass`. Passing access proofs require a nonempty probe list; policy negative
export probes must resolve to denied probes for the same operation.
For `verdict:pass`, whole and scoped organization erasure require
`database:absent`; `not-applicable` and `revoked` cannot stand in for DB
absence. The fixed object kinds `app_logo.delete` and
`organization_export.expire` require `customer_target_object:absent`. Explicit
key, grant and client revocations and the five `instance.*` authority kinds
require `authority:revoked`. These are minimum static checks, not a complete
surface inventory. Cloud and Ops must resolve every operation against the
signed kind registry and protected manifest, then reject `not-applicable` for
each applicable DB, object or authority surface. A retained shared blob may
make physical object removal inapplicable only with the deleted owner's mapping
absent, the surviving owner's reference intact and the target copy readable.
Neither an empty evidence list nor a source-side 404 proves target absence.
The generated JSON Schema checks the closed field shapes but cannot express
these Zod cross-field and registry-dependent pass rules. JSON Schema consumers
must implement the same minimum checks and the registry/manifest comparison
before accepting a passing receipt. They must perform the other cross-record
checks themselves as well. These fixtures have placeholder hashes and version
IDs: shape validation is not
signature, protected readback, deployed source coverage or permission to replay.

Contracts release gate: a complete, reviewed package wire and green CI. The
Cloud/Ops consumer field reconciliation is an input to that review; exact
consumer pins follow the one bundled release. Cloud/Ops activation and
acceptance additionally require deployed and historical source/identity/backup
coverage, protected readbacks and whole/scope access and replay probes. This
draft does not claim to execute those scenarios.
The current kind union is not proof of complete source coverage. Unregistered
producers, unproved source identities, historical backfill gaps and unfinished
writer/build rosters keep activation closed even when an intent parses.
