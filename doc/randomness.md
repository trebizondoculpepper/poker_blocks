# Reproducible runs: the session randomizer

How one seed drives every random choice in a run, and what can and cannot be replayed (#134).

## What it is

A game session owns a **`Randomizer`** (`src/random.ts`): one seeded pseudo-random sequence, with
a position that can be saved and restored. A new session makes a secret seed; every game random
request draws from that sequence.

The seed appears on the **game-over** and **stage-won** screens, with a **Copy** button, so a
player can include it in a bug report.

## The operations

All of these take a **context** — a dotted name for what the roll is for (`die.d20`,
`shop.stock`, `deck.shuffle`, `run.setup.seed`) — and draw from the same stream, incrementing its
position:

| Call                               | Returns                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `int(context, min, max)`           | an integer in the range, both ends included                  |
| `chance(context, probability)`     | `true` at that rate; decimals are fine                       |
| `weighted(context, items, weight)` | one item, in proportion to its weight                        |
| `shuffle(context, items)`          | a shuffled **copy**; the caller's array is untouched         |
| `next()`                           | a raw value in [0, 1); the primitive the rest are built from |

## What replay needs

Replaying a sequence needs **all** of:

1. the same **seed**,
2. the same **software version** — a change to what draws, or in what order, changes the sequence,
3. the same **sequence of requests**, which means the same gameplay actions in the same order.

The third is why this is a debugging aid rather than a replay feature: a run reproduced from a
seed requires the player to act as they did. Starting a run from a **user-supplied** seed is a
separate mode and is not implemented.

## Continue

The run's save records the seed and the sequence position (`random: { seed, position }`). Continue
restores both, so the sequence resumes where it stopped rather than replaying from the start. A
save written before this feature has no cursor; it still loads, and continues on whatever
sequence the session has.

## What is deliberately **not** on the stream

Presentation randomness does **not** draw from the session randomizer:

- the idle wobble of a placed block (`src/motion.ts`),
- which music track plays (`src/audio/music-plan.ts`),
- any sound effect's variation.

Drawing from the session stream for these would make a replay depend on how long someone looked
at the table or what they had muted, which would defeat the purpose. Presentation may use
`Math.random`.

## The extension point for passives

Every request names its context, and `Randomizer.addModifier(context, fn)` maps one context's raw
value to another in [0, 1). A future passive that shifts dice odds registers a modifier for
`die.d20` without touching a caller.

**Nothing registers a modifier in this version.** The hook exists so that adding one later does
not mean re-plumbing every call site. #97 is the ticket that will use it.

## The guardrail

`src/random-guardrail.test.ts` fails if a module outside the allowed list calls `Math.random`,
so new gameplay randomness cannot quietly bypass the session stream. The allowed list is exactly
the presentation and platform code named above, plus the seed's own creation.
