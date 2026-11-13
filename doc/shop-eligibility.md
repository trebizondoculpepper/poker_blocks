# Current shop eligibility and compatible owned items (#791)

The owner excludes Paper cards and Paper-material purchasable items, including the Paper transmogrifier, from every round's stock. This supersedes the historical round-one weight 0.5 exception. It does not exclude Paper starter cards, already owned items, or a Paper-rendered Continue menu action.

## Configuration and ownership

Use the existing definition-owned offer curves: configure the Paper transmogrifier curve as `[[1, 0]]`. Generic stock generation and buying consume resolved current eligibility uniformly; no material-name checks, side tables or trait flags. Keep the item definition, codec and historical price available for existing owned-item restoration. Visual wrapping does not decide eligibility.

New stock uses current curves. Restored shop offers are reconciled through the same registered offer eligibility providers before display, and buying revalidates current eligibility at commit. An obsolete saved offer is omitted without awarding, charging or replacing it through an extra RNG draw. Preserve the ordering and state of other restored stock; do not replay stock generation merely to fill the vacated slot. Current weight zero forbids purchasing an obsolete saved offer even if a stale UI request remains. Use ordinary action-denied feedback. This does not confiscate an already purchased item or invalidate its normal use/resale policy.

## Evidence and verification

Source audit: `src/materials.ts` supplies `paper.transmogrifier` price 2 and historical `weights: [[1, 0.5]]`; `src/transmogrifiers.ts` resolves `transmogrifierBalance` and `itemOfferPools`; `src/offer-weights.ts:weightAt` holds the last keyframe. Therefore the existing curve pattern expresses all-round zero without a new architecture. The restore/current-eligibility check is a target guarantee, not a claim that today's restoration already filters offers correctly.

Verify all rounds' generated card/item pools, a restored obsolete offer and a stale buy request, preservation of owned Paper cards/transmogrifiers, no new RNG consumption or save data loss during reconciliation, and the unaffected Paper Continue action. No new save version or economy redesign is required merely to configure eligibility; report a concrete codec conflict if implementation finds one.
