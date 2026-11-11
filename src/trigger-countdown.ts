/**
 * Trigger countdowns (#434): a block that triggers itself after a number of committed plays.
 * It knows nothing about what the trigger does: at zero it asks the shared contract
 * (`trigger-block`, src/triggers.ts) to trigger the block, which runs whatever responses its
 * material configures.
 *
 * - **Configuration** is data on the material definition: `triggerCountdown: { start,
 *   countPlacement }`. With `countPlacement`, the play that places the block counts: the agreed
 *   sequence is 3 in the hand, 2 once placed, 1 after the next play, 0 (and the trigger) after
 *   the one after.
 * - **Counting** happens only when a play is committed (`commitCountdowns`, from `GameRun.play`),
 *   for blocks on the table. Previews, rendering and reloading never count.
 * - **The count** is the card's `countdown` trait and its card-state ledger entry, so a save keeps
 *   it; `countdownOf` exposes it for presentation. A card never placed shows its start.
 * - **Zero** fires exactly once: the count stays at 0 and is never decremented or fired again.
 * - **Material change** clears the count (trait and ledger), like doneness: a card made a
 *   counting material again starts from its start.
 * - **Reset:** the count belongs to the block on the table; when the table clears at a stage's
 *   end it goes back to its start (a registered stage-end reset).
 */
import type { CardBlock } from "./cards";
import { cardStateAppliers } from "./card-states";
import { materialScopedStates } from "./card-material";
import type { GameState } from "./game-state";
import { getMaterialDefinition, materialOf } from "./materials";
import type { GameEvent } from "./passives";
import { commitCommands, type CommandTarget } from "./rule-commands";
import { stageEndResets } from "./stage-end";

export type TriggerCountdownConfig = { start: number; countPlacement: boolean };

/** A card's countdown configuration, from its material; none when it doesn't count down. */
const countdownConfig = (card: CardBlock): TriggerCountdownConfig[] =>
  [getMaterialDefinition(materialOf(card)).triggerCountdown ?? []].flat();

/** The model count for presentation: its current count, its start before it is placed, or null. */
export function countdownOf(card: CardBlock): number | null {
  const [config] = countdownConfig(card);
  return config ? (card.traits.countdown?.left ?? config.start) : null;
}

const withCount = (card: CardBlock, left: number): CardBlock => ({
  ...card,
  traits: { ...card.traits, countdown: { left } },
});

/**
 * Count down every counting block on the table after a committed play, and trigger each that
 * reaches zero through the shared command path. `placed` are the blocks this play put down: they
 * count only when their configuration says the placement counts. Returns the events caused.
 */
export function commitCountdowns(target: CommandTarget, placed: ReadonlySet<string>): GameEvent[] {
  const reached: string[] = [];
  const state = target.state;
  const counts: Record<string, number> = {};
  const field = state.field.map((entry) => {
    const block = entry.block;
    const config = countdownConfig(block)[0];
    if (!config) return entry;
    const left = block.traits.countdown?.left ?? config.start;
    const counts_this_play = config.countPlacement || !placed.has(block.id);
    if (left <= 0 || !counts_this_play) return entry;
    const next = left - 1;
    counts[block.id] = next;
    if (next === 0) reached.push(block.id);
    return { ...entry, block: withCount(block, next) };
  });
  if (!Object.keys(counts).length) return [];
  const cardStates = { ...state.cardStates };
  for (const [id, left] of Object.entries(counts))
    cardStates[id] = { ...cardStates[id], countdown: left };
  target.update({ ...state, field, cardStates });
  return commitCommands(
    reached.map((blockId) => ({ id: "trigger-block", config: { blockId, cause: "countdown" } })),
    target,
  );
}

/** Every countdown back to its start as the table clears: trait and ledger entry both go. */
export function resetCountdowns(state: GameState): GameState {
  const reset = (card: CardBlock): CardBlock => {
    if (card.traits.countdown === undefined) return card;
    const traits = { ...card.traits };
    delete traits.countdown;
    return { ...card, traits };
  };
  const cardStates = Object.fromEntries(
    Object.entries(state.cardStates ?? {}).flatMap(([id, entry]) => {
      const { countdown: _gone, ...rest } = entry;
      return Object.keys(rest).length ? [[id, rest]] : [];
    }),
  );
  return {
    ...state,
    hand: state.hand.map(reset),
    deck: state.deck.map(reset),
    discardPile: state.discardPile.map(reset),
    field: state.field.map((entry) => ({ ...entry, block: reset(entry.block) })),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(reset) } : {}),
    cardStates: Object.keys(cardStates).length ? cardStates : undefined,
  };
}
stageEndResets.register("countdown", resetCountdowns);

// A saved count is restored onto the rebuilt card.
cardStateAppliers.register("countdown", {
  order: 4,
  apply: (card, value) => withCount(card, value as number),
});

// The count belongs to the material that counts: a material change clears it, so a card turned
// back into a counting material starts again from its start (#487 review).
materialScopedStates.register("countdown", true);
