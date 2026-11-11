/**
 * Cooking (#372): a cookable material lists its doneness steps (`cookable.steps` on its
 * definition, Raw first). A card's step is its `doneness` trait. Each play, a reaction beside a
 * heat source asks to advance it one step (the `advance-cooking` result and command), stopping
 * at the last; the change is saved with the run's card states. Doneness lasts one stage: when
 * the table clears it returns to the first step (owner's decision on #372), after the stage's
 * rewards are read (#373). Nothing here names a material.
 */
import { cardName, type CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { getMaterialDefinition, materialOf } from "./materials";
import { reactionResults } from "./reactions";
import { registerRuleCommand } from "./rule-commands";
import { stageEndResets } from "./stage-end";
import { cardStateAppliers } from "./card-states";
import { materialScopedStates } from "./card-material";
import { inspectable } from "./traits/inspectable";
import type { SoundEffectId } from "./audio/sfx-registry";

/** The card's doneness step names, from its material, or none if it doesn't cook. */
export const donenessSteps = (card: CardBlock): readonly string[] =>
  getMaterialDefinition(materialOf(card)).cookable?.steps ?? [];

/** The card at doneness `step`, its inspector naming the step. */
export function withDoneness(card: CardBlock, step: number): CardBlock {
  const steps = donenessSteps(card);
  const material = getMaterialDefinition(materialOf(card));
  return {
    ...card,
    traits: {
      ...card.traits,
      doneness: { step },
      inspectable: inspectable(
        `${cardName(card.traits.identity)} · ${material.name} · ${steps.at(step) ?? ""}`,
      ),
    },
  };
}

/** The card back at its first step: its doneness trait and inspector suffix removed. */
export function withoutDoneness(card: CardBlock): CardBlock {
  const traits = { ...card.traits };
  delete traits.doneness;
  const material = getMaterialDefinition(materialOf(card));
  return {
    ...card,
    traits: {
      ...traits,
      // Back at the first step, which the inspector names too ("· Raw").
      inspectable: inspectable(
        [
          cardName(card.traits.identity),
          material.name,
          ...[material.cookable?.steps.at(0) ?? []].flat(),
        ].join(" · "),
      ),
    },
  };
}

// A reaction asks for one or more steps; the command applies them.
reactionResults.register("advance-cooking", (block, config) => [
  { id: "advance-cooking", config: { ...(config as object), blockId: block.id } },
]);

registerRuleCommand<{ blockId: string; steps?: number; sound?: SoundEffectId }>(
  "advance-cooking",
  ({ blockId, steps = 1, sound }, target) => {
    const state = target.state;
    const placed = state.field.find(({ block }) => block.id === blockId);
    if (!placed) return [];
    const names = donenessSteps(placed.block);
    const from = placed.block.traits.doneness?.step ?? 0;
    const to = Math.min(from + steps, names.length - 1);
    if (to <= from) return [];
    const cooked = withDoneness(placed.block, to);
    target.update({
      ...state,
      field: state.field.map((each) =>
        each.block.id === blockId ? { ...each, block: cooked } : each,
      ),
      cardStates: {
        ...state.cardStates,
        [blockId]: { ...state.cardStates?.[blockId], doneness: to },
      },
    });
    const material = materialOf(cooked);
    return [
      {
        type: "reaction.applied",
        blockId,
        reaction: {
          from: { material, doneness: names.at(from) },
          to: { material, doneness: names.at(to) },
          ...(sound ? { sound } : {}),
        },
      },
    ];
  },
);

/**
 * The state with every card back at its first doneness step, for a new stage (#372): the trait
 * and the saved ledger entry both go.
 */
export function resetDoneness(state: GameState): GameState {
  const reset = (card: CardBlock) => withoutDonenessIfCooked(card);
  const cardStates = Object.fromEntries(
    Object.entries(state.cardStates ?? {}).flatMap(([id, entry]) => {
      const { doneness: _gone, ...rest } = entry;
      return Object.keys(rest).length ? [[id, rest]] : [];
    }),
  );
  return {
    ...state,
    hand: state.hand.map(reset),
    deck: state.deck.map(reset),
    discardPile: state.discardPile.map(reset),
    field: state.field.map((placed) => ({ ...placed, block: reset(placed.block) })),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(reset) } : {}),
    ...(Object.keys(cardStates).length ? { cardStates } : { cardStates: undefined }),
  };
}

const withoutDonenessIfCooked = (card: CardBlock): CardBlock =>
  [card.traits.doneness ?? []].flat().reduce((current) => withoutDoneness(current), card);

// Doneness lasts one stage: registered so the run resets it without naming cooking (#372).
stageEndResets.register("doneness", resetDoneness);

// A doneness step is restored last, onto the card's material (#372).
cardStateAppliers.register("doneness", {
  order: 2,
  apply: (card, value) => withDoneness(card, value as number),
});

// Doneness belongs to the meat: a material change clears it (#372, #408 review).
materialScopedStates.register("doneness", true);
