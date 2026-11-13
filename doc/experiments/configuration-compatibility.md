# Experiment configuration compatibility: bounded first delivery (#980)

This resolves the repeated-review blocker on #934 / PR #962. Configuration export and verified import are a smaller first capability than portable cross-build replay. The design agent selects the conservative exact-build boundary, and the implementer confirmed it is a workable small follow-up to the existing PR. This is a technical delivery decision, not approval of any balance or gameplay change.

## Exact-build verified import

The exported `revision` is the explicit identity of the build that created the configuration. Import receives the current build identity explicitly from its trusted caller. Refuse verified import if either identity is absent/unknown/empty or they differ. Perform this gate before reconstructing a scenario, allocating its objects or consulting generated gameplay state. A mismatch returns a clear compatibility diagnostic, not a partial trial or a silently rewritten revision.

Identity equality is necessary, not sufficient. Preserve ordinary format/schema validation, bounded horizon/allocation checks, scenario validation, generated-card and initial-passive records, effective settings/rules/scoring records and their same-build comparisons. An invalid configuration still fails atomically. Existing metadata/fixes in PR #962 remain useful for diagnostics and comparisons when the same build is configured differently; they are not a proof that arbitrary changed source code is semantically equivalent.

This first implementation makes no portable cross-build compatibility claim. It must not successively serialize every referenced registry or reinterpret each newly discovered global default merely to permit import under a different build. Copying serialized data and reconstructing a verified trial are separate actions; plain JSON round-trip alone is not a replay-compatibility proof. Full action/result replay remains #936 and must respect this boundary until a separately documented portable contract replaces it.

## Build identity ownership

The build/runtime adapter owns the identity; the import helper does not infer it from the artifact being imported, the scenario seed, a mode/room name, a timestamp sampled at import, or a generic release label. The caller supplies an opaque, nonempty identity known to distinguish the actual gameplay code/configuration build. A complete source revision is suitable only where the adapter can establish that it identifies the actual built inputs; dirty working trees, build-input overrides and hot reload can invalidate that assumption. Reusing one identity for materially different builds violates the adapter contract.

`appVersion` is a display/release version, not automatically that identity: `src/version.ts`, `vite.config.ts` and `scripts/versioning.ts` derive a semantic version from release/first-parent commit counts and permit an environment override. They do not establish an immutable identity for arbitrary dirty/HMR builds. Do not silently substitute it, a fixed development marker or a package version as the verified identity.

For the reusable #934 helper, accept the explicit current identity through the caller/runtime boundary and test it with controlled fixture identities. Do not add runtime Git commands, network calls, a new build fingerprint framework or a registry-wide hashing pass to that ticket. A bench adapter that cannot establish a valid identity must report verified import as unavailable; it may not fabricate an identity to enable the button. #937's UI integration must provide that boundary or expose this unavailable state. A concrete missing adapter capability can be sliced separately under the normal documented-pattern process.

The value is a compatibility identifier for local experiment artifacts, not cryptographic attestation. Editable JSON and a matching string do not prove authenticity or prevent intentional alteration. No signing system, secret, migration, production-save format or acquisition policy is introduced here.

## Cross-build work is separate

A mismatch means unsupported verified import, not data deletion. Keep the artifact available for inspection. Do not silently treat it as a new trial, strip its provenance, or retag it with the current identity. Applying an old recipe deliberately as a new experiment, a gameplay-configuration fingerprint, compatibility migrations and cross-build replay each need their own explicit behavior and evidence. They are deferred in [#981](https://github.com/trebizondoculpepper/poker_blocks/issues/981), not prerequisites for finishing this exact-build capability.

## Evidence and alternatives

`github-triage pr 962 --history --json` and the linked review history show repeated gaps in the inferred compatibility record: generated distribution, passive defaults, base scoring, dealer settings, omitted defaults and referenced material behavior. `src/experiment-config.ts` on PR #962 already exports a revision and compares rebuilt inputs, but lacks a revision gate. `src/configurable-passive.ts:effectiveSettings`, `src/scoring.ts:handMultipliers`, `src/dealer.ts:Dealer.handSize`, `src/lifecycle/action.ts:defaultResolutionLimits` and `src/materials.ts:MaterialDefinition` show why a few top-level run settings are not the full semantic dependency set. The existing experiment docs require provenance and rejection of unsupported imports; they do not require portable verification of arbitrary code changes.

A build-time gameplay fingerprint could eventually support safe reuse across unrelated visual changes, but requires a defined dependency boundary, invalidation experiments and a trusted producer. A best-effort field list cannot establish the promised semantic equivalence, and would continue the review loop. Exact-build gating is conservative: even a harmless new build identity rejects the old verified import. That false-negative cost is accepted for the bounded first delivery; cross-build usefulness is deferred rather than falsely claimed.

This source/review audit supports the ownership and compatibility decision. It is not a measured portable-fingerprint design, browser acceptance of export controls, or proof that the current app already supplies an immutable build identity.

## Focused implementation and verification

After these docs merge, #934 adds the explicit identity gate to PR #962 and preserves its existing records. No new extraction is necessary if the implementer can deliver that small change against the merged contract. The closed #978/#979 proposals are not prerequisites.

Verify matching identities with otherwise equivalent inputs; mismatching, unknown, missing and empty producer/current identities; a mismatch refused before any scenario construction; unchanged runtime/model/RNG on rejection; invalid input still rejected under a matching identity; retained diagnostics/metadata; and absence of hidden revision rewrites or an unchecked cross-build success path. Tests must state their controlled identity assumption. UI integration separately verifies actual adapter provenance and a clear unavailable/mismatch message. Existing exports/replay evidence stay isolated from normal saves and public inspection.
