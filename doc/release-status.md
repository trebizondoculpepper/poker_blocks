# Release status and catalogue access

Target contract for #810–#813, agreed with the owner on 2026-11-13. Runtime integration follows this documentation in separate PRs. This is a reusable facet for definitions, including materials and modifiers, not a developer-room flag or a claim that every existing registry already enforces it.

## Meaning and ownership

Exactly one effective facet member is required on every definition admitted to the new availability catalogue: `certified` or `provisional`. Certified means approved for normal play, subject to all existing unlock, weight, retirement and acquisition rules. Provisional means excluded from ordinary generation and available through explicitly composed experimental catalogue access. Certification does not guarantee appearance in any shop or approve every use of a definition.

The definition owns its declaration; the facet contributes registered availability behavior and its registered public inspection contribution, which may be empty. Definitions may inherit a declaration from a documented parent, but registration resolves and validates one effective member. Conflicting local declarations or an unresolved declaration fail registration. Missing metadata must never default an experimental item into production. The migration explicitly declares current approved content certified and current prototypes provisional. Existing lists are source evidence for that audit, not a permanent identity-keyed status table.

The owner/design agent records promotion or demotion in the design documentation and a focused ticket, with evidence and limitations. A runtime agent implements that already merged decision. Successfully running a prototype, completing a test or opening a bench does not promote it. A certification change does not by itself destroy, rematerialize or reset instances already owned by a run.

## Composition and registered behavior

Use one release-status facet whose members bring behavior. During catalogue composition each member registers its definition contribution with the appropriate admission handlers, plus a descriptor for presentation. A generic catalogue runner dispatches registered handlers and applies the catalogue's configured admission operations uniformly. It never tests `traits.certified`, `traits.provisional`, material names, room identity or a dev flag.

Normal generation composes certified admission. An experimental catalogue can explicitly compose both admission operations; this must not affect other catalogues sharing the registry. Availability is a request-local configuration rather than a mutable global experimental toggle. Dev-only catalogue access/controller traits begin with Dev and are composed only into dev modes. Catalogue access does not make a provisional object available in every bench: a bench may request only the relevant capability family.

Admission is separate from ordinary generation policy. A certified candidate still needs an applicable offer/deck capability and must satisfy configured round unlocks and weights. A provisional definition must not enter normal random stock merely because it is registered for lookup or rendering. Random generation consumes only the admitted candidate set, preserving the caller's explicit RNG ownership and stable ordering. Definition IDs remain opaque lookup handles; status data belongs to the definition/facet, never an external map keyed by ID.

Bench lists and inspection consume registered presentation contributions from the same facet. The certified member contributes no public badge, status row or approval explanation: certification is internal admission metadata, not player-facing content. The provisional member contributes the visible label `Provisional` (or configured `Experimental`) with a concise experimental-availability explanation. Ordinary descriptions remain intact. Generic views render the supplied contributions uniformly and never branch on status identity or treat an empty label as a hidden certification test. Internal diagnostics/export may retain resolved metadata without exposing it in the player description. An owned provisional definition remains visibly marked on inspection even when excluded from new acquisition. These changes do not reveal hidden Present contents.

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

#811 implements the facet/handlers and validation. #812 audits and applies declarations and connects catalogue entry points without changing approved production stock. #813 introduced descriptors in bench listings and inspection; #923 updates them to the owner's public-provisional-only rule. All wait for this contract to merge; each implementation must cite it and report any concrete unresolved ownership gap rather than invent a new mechanism.

Verify certified-only and explicit mixed catalogues, missing/conflicting members, unlock/weight/retirement composition, registration disposal and repeated room entry, provisional warning/inspection agreement and absence of Certified text, save lookup without new admission, and no experimental access leaking across room changes. Confirm normal generation behavior remains unchanged for migrated certified definitions. Production balance and approval of the new spatial modifiers are outside this contract.

## Public-status correction evidence (#923)

The owner reports that Certified appears in item descriptions and explicitly wants it hidden. src/release-status.ts registers both labels, and src/release-status-declarations.test.ts expects Status: Certified. This confirms the changed presentation seam; no catalogue admission change is needed. Choose registered empty certified presentation contributions over a view-level status comparison, preserving composability. Verify certified materials/modifiers have ordinary descriptions without a certification notice, provisional warnings remain, and ordinary versus experimental admission is unchanged.

## Production Present wrapper certification (#1129)

**Explicit design promotion:** the existing Gift Wrap definition used by the approved stage-three Present reward is **certified** for that production wrapper role. The authorizing game decision is [Present acquisition](presents.md#acquisition-and-lifetime), implemented by #651/PR #1127; the owner approved that normal-play reward, not merely a successful preview. This design decision reconciles its required public appearance with the release facet rather than bypassing admission or hiding a provisional warning in one view. The promotion is limited to this definition; it certifies neither the new packing/weight passives nor unrelated visual prototypes.

The definition owns its certified member, whose public inspection contribution is empty under the existing facet. Keep lookup/save identity and contents-derived mass/opacity unchanged. Certification adds no shop entry, price, sale, payload-generation eligibility or random deck weight. Existing offer/payload capabilities continue to exclude wrappers. Registry array placement is not release policy: an implementation may retain the lookup registration while changing the explicit facet and misleading prototype-only comments. Audit catalogue entry points so changing the facet cannot accidentally make the wrapper a random material candidate.

**Evidence and alternative.** `src/materials.ts` still declares the production wrapper under `experimentalMaterials` with a provisional facet and concealed face artwork. Present acquisition is documented in [presents.md](presents.md), and #651/PR #1127 records the production reward integration. The inconsistent warning follows directly from the registered provisional inspection contribution; it is not a reason for a view-level identity exception. Keeping the approved reward with a provisional wrapper contradicts the ordinary-acquisition policy. Inventing a second production wrapper would duplicate identity/artwork/save concerns without a new owner request. A focused declaration change after this docs merge is the smaller conforming path.

Runtime follow-up #1151 must verify normal reward/inspection, absence of accidental shop/payload/random admission, retained save/clone behavior and unchanged warnings on other provisional definitions. This contract records the release decision; it does not claim runtime certification has already shipped or grant visual acceptance to a future imported wrapper model.
