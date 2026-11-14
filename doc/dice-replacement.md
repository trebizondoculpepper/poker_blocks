# D12 replacement and dice artwork intake (#1003, #1014)

Owner decision 2026-11-14: replace the D10 passive with a true D12, using a regular dodecahedron and a uniform 1–12 roll. The reason is preferred shape/readability. This is a gameplay range change as well as artwork, not a renamed ten-sided die. Implementation follows this separately merged contract; existing runtime may still show D10 until then.

Keep the existing one-roll-per-scoring-operation semantics, independent per-instance rolls and the same resolved amount added to every scored line after its zero clamp. No additional roll per row, no presentation RNG and no effect on candidate-hand evaluation. Initial base price remains 6 coins, unlock round 3 and additiveScoring frequency; these are continuity defaults, not measured new balance. D6, D8 and D20 ranges/prices remain unchanged.

## Compatibility decision

Retain the current opaque definition handle `d10` for the replacement slot; its displayed name, description, configured sides and registered shape become D12/12/dodecahedron. An opaque stable handle is not a die behavior test. Existing ordinary saves containing that definition restore the replacement D12 and keep instance IDs, rack order and other persisted state. New stock also uses the same definition handle, so a new `d12` definition does not duplicate a saved item or break the current no-owned-offers rule. Do not add a saved-name branch or global string replacement. Generic save restoration already resolves definitions and attaches registered persisted traits; no save schema bump is required just for retaining the handle.

Source evidence: `src/passives.ts:die` owns `sides`, `shape`, faces, name, description and shop config. `src/save.ts:SavedRackItem`, `saveRackItem` and `restoreRackItem` store definitionId/instanceId and registered trait persistence, then rebuild via `createPassiveBlock`. Inspect any persisted per-instance override at implementation intake; preserve validated overrides through their existing registered codec rather than silently dropping them. A conflicting override exposing old ten-sided rules must be reported with a concrete fixture before selecting a migration. This document does not promise arbitrary historical custom artifacts remain reproducible; exact-build experiment imports reject mismatched identities.

## Artwork

D12 uses twelve pentagonal faces with labels 1–12 fitted inside each face and consistent margins, correctly oriented and opposite faces summing to 13. Reuse/extend the registered shape and face-label builder; no named-die branch in a generic renderer. D20 needs its own triangular label/outline fix (#1002). The owner intends to source replacement models for all dice (#1014); this preference is not yet a supplied/license-cleared set. Keep geometry preparation/intake separate from game-rule delivery, and do not make a specific unprovided mesh a prerequisite for registering a correct dodecahedron.

Verify seeded min/max/distribution, one-roll reuse across multiple rows, independent copies where experimental configurations admit them, standard old-save restoration into D12 with stable identity, no duplicate shop definitions and all shared visual consumers. Audition number fit/key lines from multiple angles and at rack scale. No numerical rebalance, asset license approval or finished-art acceptance is implied by this source audit.
