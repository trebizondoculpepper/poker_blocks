# Passive power progression and balance evidence

Owner decisions, 2026-11-13 (#862). This is the design rationale for evaluating new passives and future stock balance. It does not change current prices, unlock rounds, numerical weights, existing instance strength or certification. Runtime rebalancing follows a separate documented decision and implementation PR.

## Progression gives power a context

Passives offered as a run progresses should become more powerful in ways that keep pace with rising score targets. Early rounds 1–2 can offer broadly useful, easy-to-understand unconditional effects such as ×2 and ×4. Early decks are mainly ordinary Paper cards and the player has relatively few ways to specialize. Simple boosts give useful decisions without demanding a strategy the available cards cannot support.

By rounds 6–8, the player is expected to have shaped their deck and acquired a mixture of materials and complementary effects. Late offers should support substantially stronger, more striking and more specific material/deck interactions. A late reward should help the player meet late targets; repeating only early unconditional ×2/×4 offers is not a sufficient late catalogue. Do not assume a single multiplier stays equally valuable throughout the run. This is a progression goal, not proof that every current late passive satisfies it.

This concerns available choices and new definitions; it does not automatically upgrade, replace, delete or weaken owned passives. The exact treatment of weaker late stock (reduced weight versus complete exclusion), new unlocks, prices and weight curves remains a numerical balance decision supported by experiments. Do not invent a blanket cutoff from this rationale or silently alter existing named curves.

## Acquisition rarity and playing difficulty are independent

**Acquisition rarity** describes how often an eligible passive is offered. A powerful rare early find is allowed: an occasional unconditional ×10 could make early play easy, yet be much less decisive later. This is an example of a permissible power spike, not approval of a new ×10 definition, price or stock probability.

**In-use difficulty** describes the objective, restriction, setup cost or continuing tradeoff needed to benefit. It includes constructing a hoop, maintaining packing, or favoring red-suit cards while penalizing black cards. A restriction that makes about half the ordinary cards less useful creates a meaningful strategic cost even when the passive itself is common. Do not call an effect difficult simply because the shop rarely sells it, or reduce its conditional payoff solely because it is easy to obtain.

At a comparable stage of progression, a passive requiring meaningful construction, deck shaping or sacrifice should generally offer a stronger successful payoff than an unconditional peer. Early unconditional ×2 and ×4 establish a baseline: a midgame objective should normally promise something more compelling than ×4 for meeting its condition. This is a design comparison, not a universal minimum multiplier or a formula that makes all restricted effects equivalent. Cheap/reliably maintained conditions deserve less premium than expensive, fragile or mutually conflicting ones.

Evaluate both the payoff when a condition is met and the benefit across complete plays, including non-activations, penalties, sacrificed opportunities and stacking. The owner distinguished the two kinds of rarity; they did not choose one mathematical expected-value metric as the sole balance criterion. A rare trigger with spectacular numbers may feel unrewarding if it seldom matters. A constraint that becomes trivial with a shaped deck may intentionally become part of a strong synergy. Preserve the game's goal of surprising combinations rather than balancing each trait as though it exists alone.

Compare actual score effects at representative baselines. An exponent contribution of 1.2 is not a fixed multiplier: on a positive baseline S with no other changed operands, the ratio S^1.2/S is S^0.2. Existing additive-above-neutral exponent stacking still applies. Record baseline, other modifiers and application scope before comparing exponent and multiplier effects. No exponential reward is automatically appropriate merely because it looks numerically small.

## Bench first, then wider evidence

The [spatial-modifier experiment](experiments/spatial-modifiers.md) and reusable scenario bench (#820) exist so provisional rules can be explored interactively in rather abstract controlled setups. Configure deck properties, installed passives/settings, hand and field patterns, then play and inspect what happens. This helps discover whether the rule feels understandable, achievable and rewarding before treating the numbers as balanced.

Use repeatable initial states, seeds and action logs to compare baseline and directed strategies. Record the stage target, deck/material composition, passive configuration, scored contributors, activation counts, actual score factors/results and missed opportunities. Test an effect alone, alongside compatible effects, and with conflicting objectives. Bench outcomes are observations; record failures and exploits rather than adjusting definitions invisibly until one screenshot looks good. Change settings as a new recorded trial segment.

Abstract scenarios are intentionally useful for isolating causes, but they do not establish full-run balance, acquisition experience or player satisfaction. Follow promising bench results with wider playtesting under real stage/deck/shop constraints. Use those findings to propose numerical balance, unlock/weight and certification changes in a separate design PR. Provisional definitions remain excluded from ordinary catalogues until explicitly certified; a completed experiment does not promote them.

## Current evidence and boundaries

`src/passives.ts` defines certified ×2 (round 1, base price 4) and ×4 (round 2, base price 9), both unconditional line multipliers. These inspectable definitions support the early benchmark; the owner's earlier conversational six-coin example was not an instruction to change the recorded ×4 price. `src/offer-weights.ts:passiveFrequencies` supplies registered round curves; current multiplicativeScoring stays common from round 3, so existing curves do not already implement individualized late-stage replacement. `doc/game.md` records rising stage targets, material unlocks, material-dependent passive eligibility and fixed base prices. `doc/experiments/spatial-modifiers.md` records provisional curves and reproducible evidence exports. These are source/decision evidence, not empirical proof that the current economy is balanced.

No special-case rebalance belongs in a scorer, run controller or shop runner. A future numerical decision lives on definitions and registered configured curves, while objective/reward behavior arrives through composed event rules and queries. New instances, saved instances and catalogue access keep their existing explicit owners. Use the [release-status contract](release-status.md) for certification and [process](process.md) for documentation-before-implementation. The related experiment-results review is #822.
