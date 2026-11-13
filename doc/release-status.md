# Release status and catalogue access

Target contract for #810–#813, agreed with the owner on 2026-11-13. Runtime integration follows this documentation in separate PRs. This is a reusable facet for definitions, including materials and modifiers, not a developer-room flag or a claim that every existing registry already enforces it.

## Meaning and ownership

Exactly one effective facet member is required on every definition admitted to the new availability catalogue: `certified` or `provisional`. Certified means approved for normal play, subject to all existing unlock, weight, retirement and acquisition rules. Provisional means excluded from ordinary generation and available through explicitly composed experimental catalogue access. Certification does not guarantee appearance in any shop or approve every use of a definition.

The definition owns its declaration; the facet contributes registered availability behavior and a public status description. Definitions may inherit a declaration from a documented parent, but registration resolves and validates one effective member. Conflicting local declarations or an unresolved declaration fail registration. Missing metadata must never default an experimental item into production. The migration explicitly declares current approved content certified and current prototypes provisional. Existing lists are source evidence for that audit, not a permanent identity-keyed status table.

The owner/design agent records promotion or demotion in the design documentation and a focused ticket, with evidence and limitations. A runtime agent implements that already merged decision. Successfully running a prototype, completing a test or opening a bench does not promote it. A certification change does not by itself destroy, rematerialize or reset instances already owned by a run.

## Composition and registered behavior

Use one release-status facet whose members bring behavior. During catalogue composition each member registers its definition contribution with the appropriate admission handlers, plus a descriptor for presentation. A generic catalogue runner dispatches registered handlers and applies the catalogue's configured admission operations uniformly. It never tests `traits.certified`, `traits.provisional`, material names, room identity or a dev flag.

Normal generation composes certified admission. An experimental catalogue can explicitly compose both admission operations; this must not affect other catalogues sharing the registry. Availability is a request-local configuration rather than a mutable global experimental toggle. Dev-only catalogue access/controller traits begin with Dev and are composed only into dev modes. Catalogue access does not make a provisional object available in every bench: a bench may request only the relevant capability family.

Admission is separate from ordinary generation policy. A certified candidate still needs an applicable offer/deck capability and must satisfy configured round unlocks and weights. A provisional definition must not enter normal random stock merely because it is registered for lookup or rendering. Random generation consumes only the admitted candidate set, preserving the caller's explicit RNG ownership and stable ordering. Definition IDs remain opaque lookup handles; status data belongs to the definition/facet, never an external map keyed by ID.

Bench lists and inspection consume the same immutable descriptor supplied by the member: public status label `Certified` or `Provisional`, and concise explanation of normal-play eligibility. They do not recalculate status, read hidden Present contents, or expose internal configuration. Inspection of an existing owned instance may show its definition's release status even when that definition is excluded from new acquisition.

## Existing instances and restoration

This facet controls new catalogue admission, not identity resolution or save validity. Keep definitions needed by valid saves resolvable even when excluded from current generation; lookup-by-ID is not random admission. Do not reroll a saved starting deck or delete cards because current certification differs. Existing normal-run persistence never gains provisional objects through a bench session: use the established isolated mode/save namespace. Exact clones and revealed payloads keep their declared definition/capabilities; cloning is not an admission loophole for a new acquisition request. No change to opaque payload visibility is approved here.

Catalogue attachment/disposal owns contribution registrations. Re-entering or switching a room cannot duplicate candidates or retain experimental access in a production catalogue. Descriptors are data, so no timers, model mutations or new sound triggers are introduced by displaying the label. Existing inspection/input effects remain responsible for their own sounds and scheduler scope.

## Source audit, decision and limits

- `src/materials.ts` exports `materialDefinitions`, `experimentalMaterials`, a lookup registry and `materialPools`; `gameplay` currently returns the production list while `registered` returns all definitions. These establish an existing availability distinction but do not supply a common cross-object facet.
- `src/passives.ts` has `passiveDefinitions`, shop configuration, and `randomPassiveDefinitions`, which filters retired definitions. Retirement is not experimental certification; both constraints must remain expressible.
- `src/run-setup.ts` and `src/run-setup-behaviours.ts` let a mode choose a material pool through registered steps. The new catalogue access must preserve that composition without a room-specific branch.
- `src/traits/inspectable.ts` provides registered inspection contributions and lifecycle-owned core-block inspection. Reuse that description mechanism rather than duplicate a status field in each view.

A common facet is chosen over separate experimental arrays for each family because the owner wants the same release policy and label on arbitrary definitions. A passive flag read by consumers would recreate a special case and is rejected. Keeping lookup separate from admission avoids making existing saves invalid merely because new generation changes. This audit supports the architecture; it is not evidence that all render-only prototypes already have full game semantics, or that every registry requires migration in one PR.

## Delivery and verification

#811 implements the facet/handlers and validation. #812 audits and applies declarations and connects catalogue entry points without changing approved production stock. #813 displays descriptors in bench listings and inspection. All wait for this contract to merge; each implementation must cite it and report any concrete unresolved ownership gap rather than invent a new mechanism.

Verify certified-only and explicit mixed catalogues, missing/conflicting members, unlock/weight/retirement composition, registration disposal and repeated room entry, status/inspection agreement, save lookup without new admission, and no experimental access leaking across room changes. Confirm normal generation behavior remains unchanged for migrated certified definitions. Production balance and approval of the new spatial modifiers are outside this contract.
