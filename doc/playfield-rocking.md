# Delayed, mass-dependent playfield rocking (#782)

Target contract for #783. Preserve two-axis rocking rather than continuous spinning. Source audit: `table-input.ts:endBoardDrag` restores normal rate immediately; `camera-view.ts:changeMotionRate` eases for 0.5 seconds and `wobbleTime` integrates the rate; `motion.ts` defines pitch/yaw sinusoidal curves. `center-of-gravity.ts`/`field-view.ts` compute a geometric cell centroid by count. `materials.ts` declares solids, physical-looking composites and generated experimental variants. The equal-mass description in the architecture is superseded **for mass and speed**, not by silently changing the pivot, manual drag sensitivity, torque or gameplay rules.

## Data, mass query and geometry

A resolved block definition provides a registered physical-mass capability: either explicit positive effective mass with an authored rationale, or `sumComponents` with positive density and nominal physical volume for each configured component. Shared physical presets are definition configuration, never a side table keyed by material in a camera/query/service. Definition composition may inherit or override a complete physical recipe. Validate all installed production/experimental definitions at composition; missing/invalid values are explicit errors, not a fallback to equal mass. New definitions must provide this capability too.

Adopt a nominal **0.1 m cube edge**, volume **V = 0.001 m³**, as an authoring convention. It calibrates relative mass, not the display's world-unit metres or an assertion these are real objects. Mesh tessellation, chamfers, camera zoom, hover/pulse scale, optical shader density/opacity and cosmetic particles do not change authored volume/mass. Density changes no scoring, material reaction or drag rule. A visual-only renderer switch retains the same physical recipe.

The pure snapshot-scoped query returns M = sum(rho × authored volume) for **placed field-owned/current field instances only**, plus revision and availability diagnostics. Hand, deck, discard, shop and detached fading ghosts contribute nothing. A stored opaque payload is not independently counted; its wrapper has a fixed authored mass until model opening replaces it. Do not inspect hidden contents to determine a wrapper's public mass. The controller requests this query from the committed field snapshot provider on enter/restoration and publication after placement/removal/material replacement. The model's publication/revision boundary supplies invalidation; a service must not diff frames to infer actions. Cache only within an immutable revision, no per-frame full scan if unchanged and no new wall-clock polling loop.

The pivot remains the **geometric centroid of occupied cells**, preserving current positions/phase. Existing helpers named centerOfGravity are legacy equal-mass terminology, not a density-weighted calculation. A weighted pivot/moment-of-inertia solver or mass-dependent manual resistance is separate work. Do not alter them in #783.

## Density calibration and full current catalogue

Calibration checked 2026-11-12: NIST lists [gold](https://pml.nist.gov/cgi-bin/Star/compos.pl?matno=079) at 19.32 g/cm³, [iron](https://pml.nist.gov/cgi-bin/Star/compos.pl?matno=026) at 7.874 g/cm³ and [liquid water](https://pml.nist.gov/cgi-bin/Star/compos.pl?matno=276) at 1.000 g/cm³. Multiply by 1000 for kg/m³. Gold/water are adopted reference values; **steel 7850** is a rounded alloy proxy, not a NIST measurement of this model. All other values below are explicit plausible initial authoring assumptions, not empirical findings for wood species, recipes, moisture, fill, temperature or fantasy matter. These are reversible tuning choices the user authorized the designer to make.

Density kg/m³ for physical material: paper 800 (bulk paper); wood 650 (dry representative); steel 7850; prismatic 2500 (glass-like proxy); gold 19320; terracotta 1800 (porous fired clay); ice 917; meat 1050 (water-rich tissue). Cooked states inherit meat's mass; heated/boiling state bonuses do not silently change the Water definition's mass.

Paper uses an explicitly hollow/lightweight construction: 0.02 V of paper at 800 kg/m³ = **0.016 kg**, rather than a solid cubic stack of paper. This distinguishes substance density from how much substance the authored block contains, and preserves the owner’s lightweight-paper intent without inventing an implausibly low substance density. All other solids below use V.

Shared **physical** component recipes (fractions of nominal V, independently authored from visual inset/opacity):

- Plastic shell P: 0.04 V at 1200 kg/m³ = **0.048 kg**.
- Stained glass lantern L: 0.06 V glass at 2500 plus 0.04 V iron-frame proxy at 7850 = **0.464 kg**.
- Framed glass F: 0.08 V iron-frame proxy at 7850 plus 0.02 V glass at 2500 = **0.678 kg**.
- Contents water W: 0.55 V at 1000 = **0.55 kg**; custard C: 0.55 V at 1050 = **0.5775 kg**; soil E: 0.55 V at 1500 = **0.825 kg**; dark oily fluid D: 0.55 V at 900 = **0.495 kg**.
- Three Gelato scoops G: total 0.05 V at 700 = **0.035 kg** (aerated frozen food proxy).
- Cloud A: 0.55 V at 1.2 = **0.00066 kg** (air/droplet bulk proxy); flame H: 0.55 V at 0.3 = **0.000165 kg** (hot gas proxy). Neither removes the housing's mass.
- Magic/stars S: 0.55 V at **authored fictional density 50** = **0.0275 kg**. Not a real substance measurement.
- Gift wrapping R: cardboard 0.06 V at700 + paper/foil-look proxy 0.02 V at800 + ribbon 0.005 V at1100 = **0.0635 kg**. Hidden payload mass is excluded while wrapped.
- Air fan housing B: plastic 0.06 V at1200 + rotor/hardware 0.01 V at7850 + air 0.80 V at1.2 = **0.15146 kg**. Fan animation/mesh simplification does not alter it.

The following enumerates the **34 definitions** exposed by `materialDefinitions` plus `experimentalMaterials` at the earlier audited revision `5344a08` (new definitions must declare their own profile; this is not a claim that the registry never changes), loaded through Vite SSR during the audit. IDs locate definitions for authors; this table must **not** become a generic identity-keyed runtime mass map. Put each recipe on its own definition or shared definition-producing helper. Composite fill recipes are deliberate simplifications, not conservation-of-mass simulation.

| Definition            | Recipe / effective mass kg |
| --------------------- | -------------------------- |
| paper                 | paper shell, 0.016         |
| wood                  | solid, 0.65                |
| steel                 | solid, 7.85                |
| prismatic             | solid, 2.5                 |
| gold                  | solid, 19.32               |
| earth                 | P + E = 0.873              |
| terracotta            | solid, 1.8                 |
| ice                   | solid, 0.917               |
| meat                  | solid, 1.05                |
| fire                  | F + H = 0.678165           |
| custard               | P + C = 0.6255             |
| gelato                | P + G = 0.083              |
| cloud                 | P + A = 0.04866            |
| water                 | P + W = 0.598              |
| magic                 | P + S = 0.0755             |
| giftWrap              | R = 0.0635                 |
| emptyVessel           | P = 0.048                  |
| airVent               | B = 0.15146                |
| emptyLantern          | L = 0.464                  |
| custardLantern        | L + C = 1.0415             |
| flameLantern          | L + H = 0.464165           |
| waterInLantern        | L + W = 1.014              |
| cloudInLantern        | L + A = 0.46466            |
| earthInLantern        | L + E = 1.289              |
| magicLockLantern      | L + S = 0.4915             |
| aggressiveFlame       | F + H = 0.678165           |
| custardFrame          | F + C = 1.2555             |
| waterInPlastic        | P + W = 0.598              |
| earthInPlastic        | P + E = 0.873              |
| hotWaterInPlastic     | P + W = 0.598              |
| boilingWaterInPlastic | P + W = 0.598              |
| darkFluid             | P + D = 0.543              |
| cloudInPlastic        | P + A = 0.04866            |
| magicLock             | P + S = 0.0755             |

Future opaque Present definitions inherit the explicit wrapper recipe; future imported visual assets keep the same mass unless a separately documented physical definition changes it. Bubbles/grass/stars/puffs are presentation, not extra inventory blocks. Standalone future geometry gets an authored recipe, not guessed shell membership from its shader name.

## Controller and rate envelope

Compose `playfieldRockingController` on the playfield with mass-query provider, numeric motion sink, registered gesture/scene lifecycle, quiet/ramp settings and rate calibration. Camera/view services accept explicit phase/rate/pose values; they know no material/scene identity. `main.ts` wires these capabilities only. Use the existing board-gesture owner/use-gesture path; do not add pointer recognition in the controller or add policy to the input adapter.

Reversible defaults: **15 game-time units quiet (1 second)** after board drag ended, then **15 units smooth ramp (1 second)** from rest. A new board rotation immediately holds phase advancement at zero and cancels/replaces its prior restart lease without resetting phase/manual pose. End/cancel/lost capture/blur close the gesture consistently and start the quiet lease when the scene is active; scene exit disposes it. Cover/paused scene and reduced motion independently hold motion at zero and dominate pending restart. Resume uses the current mass and a fresh eased envelope, never a stale callback from before cover.

Base target is **r = min(1.5, 5 kg / max(M, 0.001 kg))**, with empty field r=0. Valid nonempty definitions have positive mass; the denominator floor is numerical safety, not a missing-data fallback. No positive lower speed clamp: sufficiently heavy stacks approach rest. The reference mass is 5 kg at rate1, configurable. This is inverse **total mass**, not inverse count or square root. At10 blocks: wood M6.5kg → r0.769231; steel M78.5kg → r0.063694; gold M193.2kg → r0.025880. Doubling any such stack halves its rate outside the explicit upper cap. Very light one-block stacks may hit1.5; disclose that rather than claim an uncapped ratio.

Combine the mass base with owned interaction envelopes: board hold/quiet/ramp; existing hand-drag damping (0.1 factor with its existing 0.5-second easing); scene suspension; reduced motion. Releasing one owner removes only its own envelope, never writes a magic normal rate over another owner's hold. The controller supplies the product/minimum gating policy through registered configuration. When field mass changes, retarget smoothly from the current rate over1second (15units), preserving phase and continuous angular velocity; during a hold update the pending target without restarting the quiet interval unless another board drag occurs.

Keep existing pitch/yaw amplitudes and curves. Integrate accumulated phase with the single presentation clock; do not reset `wobbleTime` from absolute time on speed changes. Quiet/restart scheduling uses the shared scheduler and cancellable generation/scope; easing uses the narrow interpolation service. Ambient sinusoidal rocking remains per-frame, not one queued event per frame. No animation callback changes a gameplay result, RNG, ownership, price or action allowance. Manual drag sensitivity remains unchanged and input never waits for easing.

## Verification and limits

Test the pure mass query against all34 definitions, composed/derived profiles, invalid/missing values, current material changes, restoration and ghost/hand/shop exclusion. Check the numeric examples and exact inverse ratios outside caps, empty/light cases and floating-point finiteness. Inject time to test release quiet/ramp, repeated gestures, cancel/blur/cover/exit, mass changes during hold/ramp, independent hand-drag damping and reduced motion. Track phase/orientation and rate continuity: never snap to an identity rotation or reset a curve when retargeting. Supply desktop/touch clips of light and heavy stacks at fixed viewpoint; counts/recipes are configuration, not claimed measured densities or benchmark results. Query cost is O(field size) per changed snapshot, cached between publications; measure actual integration overhead without demanding a new physics solver.

## Shared experimental use

The physical-mass capability is shared by #816 aggregate queries and the centroid/weighted-pivot experiment #823; it does not imply those effects are enabled in production. A query accepts an explicit immutable instance scope, so scored-subset averages can reuse the same recipes without scanning unrelated zones. For a nonempty scope mean mass is total/count; empty means unavailable. Runtime delivery should implement the shared capability in #816 and let #783 consume it, avoiding duplicate implementations. The parked Present contents-plus-wrapping proposal #828 does not change the public wrapper-mass policy here.
