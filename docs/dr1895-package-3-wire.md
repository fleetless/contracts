# DR-1895 package 3 wire inventory

Work in progress for DR-3011. This is the single Contracts package branch;
do not merge, release or pin it until the remaining rows below are integrated
and Finn has reviewed the complete head. The package plan is DR-3010 section 1.

## Approved inputs

- [#903](https://github.com/fleetless/fleetless/issues/903), `18f38f21c5f3d748db2fdcc1b9c161f745a7c85e`.
- [#873](https://github.com/fleetless/fleetless/issues/873), `f3ef8230c3222e6fca95a17ef15d9437727c262b`.
- [#872](https://github.com/fleetless/fleetless/issues/872), `08bf0e2dce38718e41e71a7b4c8bea249f4042f4`.
- Their common package implementation approval of 2026-11-02.

The three control formats below are specified field-for-field in #873 and #872.
Their definitions are additive to Contracts base `76d65d1`; this does not decide
the semantic version of the completed package.

| Surface | Contracts exports | State |
| --- | --- | --- |
| C0, `fleetless.journal-first-checkpoint.v1` | `journalFirstCheckpointBody`, `journalFirstCheckpoint` and inferred types | Implemented, JSON schemas and negative fixtures |
| Registry control, `fleetless.registry-transition.v1` | `journalRegistryTransitionBody`, `journalRegistryTransition` and inferred types | Implemented, JSON schemas and negative fixtures |
| Activation, `fleetless.registry-activation-receipt.v1` | `journalRegistryActivationReceiptBody`, `journalRegistryActivationReceipt` and inferred types | Implemented; C0 sentinel fields are distinct from later receipts |
| v1/v2 obligation kind registry and exact `ids` | Pending Philipp's complete source-to-obligation ledger | Not implemented; no permissive catch-all kind |
| Protected manifests, including scoped rows, asset/export versions and frozen batches | Shared concrete shape from Philipp and Bernd | Not implemented; raw protected identifiers must never enter ordinary intents/receipts |
| v2/generation activation checkpoint, final seal and mixed export bundle | Shared concrete shape from Philipp and Bernd | Not implemented; no invented legacy v1 signing rules |
| Replay operation outcomes, final operation-bound access proofs and gate receipt | Shared concrete shape from Philipp and Bernd | Not implemented; interim replay is not traffic permission |

## Consumer validation boundary

The six exports validate decoded object shape, not the signed wire bytes or
activation. They reject extra/missing fields, nulls, noncanonical UUID/hash/time/
LSN syntax, unsafe integers and invalid Ed25519 signature encodings. They do not
normalize or strip signed fields. JSON Schema preserves the same structural
constraints, including C0's zero hashes and empty old-version IDs.

Before trusting a record, Cloud and Ops must reject duplicate JSON keys and
noncanonical RFC-8785 bytes, invalid Unicode, floats/noncanonical number tokens,
and invalid hashes/signatures. Re-encoding comparison and signature checks belong
on the original bytes, before a parsed object can lose duplicate-key information.
The schema alone cannot distinguish JSON `1` from JSON `1.0` after decoding.

For each signable body use `UTF8(body.schema) || 0x00 || RFC8785_UTF8(body)`.
SHA-256 hashes and Ed25519 signatures cover those same domain-separated bytes.
The envelope adds `checkpoint_hash`, `record_hash` or `receipt_hash` respectively,
and `signature`; those envelope fields are not signed as part of the body.
Signature syntax is exactly 64 bytes encoded as unpadded canonical base64url.

Consumers separately verify the pinned signer, sequence/hash/generation links,
monotone epoch, old/new registry/build digests, previous receipt hash, exact
mirror/fence/registry/build versions and effective retention, source timeline/LSN,
pinned standby readback, complete copy coverage and every historical build/path.
`coverage_verdict: gap` is a valid failure report, never an activation permit.
No customer route, storage resource, key, retention extension or traffic-opening
operation is introduced by these definitions.

The fixtures in `test/journal-controls.test.ts` are synthetic shared wire examples,
not valid cryptographic signatures or evidence of runtime coverage.

## Remaining concrete inputs for the bundle

Philipp owns the current-base Cloud ledger and its schema/backfill design after
the package owner reassignment. Doris supplied an initial source/writer/wire
inventory against Cloud `399d4e8a`. It identifies `basic_activity_history`,
`basic_activity_observations` and `synthetic_org_fixtures` beyond the older
95-table inventory, the asset delete/error and late export-upload races, and the
required restore-closure migration. It explicitly does not claim a complete
schema/build registry or runtime coverage. Its candidate registry still describes
several alternatives rather than exact wire
fields: retention rows versus protected batch membership, stable slug identities,
logo/template generations, auth-factor subject/factor identifiers, and MCP grant
versus client identifiers. The existing approval explicitly makes this inventory
implementation work; it does not require another general spec approval.

Philipp and Bernd must agree the exact member names/types for those shapes and for
typed restricted probe/policy/preservation references, protected manifest entries,
mixed export, seal and final receipt. Examples must cover whole/scoped erasure,
unaffected access allowed versus policy-denied, later backdated/replacement rows,
shared objects and old binding revocations. Arne integrates them here with strict
kind-specific schemas, negative tests and artifacts before the one review/release.
Unknown kinds remain rejected; an omitted registry row cannot be treated as a
safe exclusion. No public erasure route is invented from #903, which assigns its
exact route/copy separately.
