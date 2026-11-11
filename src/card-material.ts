/**
 * Permanent per-card material change (#387, split from #384): the model command a
 * transmogrifier (and later a material reaction, #366) uses to give one card a new material
 * for the rest of the run. The card keeps its id, rank and suit; only its material, and the
 * traits its material brings, change.
 *
 * Saves store card ids and rebuild cards from the starting deck and the bought-card ledger, so a
 * changed material would be lost on Continue. The run therefore keeps a ledger of changed
 * materials, `GameState.cardStates`, which the save writes as an optional record and applies
 * after rebuilding the cards (src/save.ts). Older saves without it stay readable.
 */
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { cardStateAppliers } from "./card-states";
import { Registry } from "./core/registry";
import { roundEndResets } from "./round-end";

/**
 * Card states that belong to a card's material (#372, doneness), by trait name: a material
 * change clears them from the card and its saved ledger. Each owning module registers its own.
 */
export const materialScopedStates = new Registry<true>("material-scoped card state");
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";

/** What the run remembers about a card beyond its definition: its changed material. */
export type CardState = {
  material?: BlockMaterial;
  stateBonus?: string;
  doneness?: number;
  /** Plays left before its countdown triggers it (#434). */
  countdown?: number;
};

/**
 * The card with `material` in place of its current one: the traits its old material brought are
 * removed before the new material's are added, so nothing of the old material lingers (a
 * transparent card turned to wood is no longer transparent).
 */
export function rematerial(card: CardBlock, material: BlockMaterial): CardBlock {
  const old = getMaterialDefinition(materialOf(card));
  const traits = { ...card.traits } as Record<string, unknown>;
  for (const name of Object.keys(old.traits)) delete traits[name];
  return withMaterial(
    { ...card, traits: traits as CardBlock["traits"] },
    getMaterialDefinition(material),
  );
}

/**
 * Change one card's material wherever it is (hand, field, deck, discard pile; the bought-card
 * ledger too), and record it so a save keeps it. Null when no card has that id, or when it is
 * already made of `material`: such a change is refused rather than spending anything.
 */
export function changeCardMaterial(
  state: GameState,
  cardId: string,
  material: BlockMaterial,
): GameState | null {
  const current = [
    ...state.hand,
    ...state.field.map(({ block }) => block),
    ...state.deck,
    ...state.discardPile,
  ].find(({ id }) => id === cardId);
  if (!current || materialOf(current) === material) return null;
  // State that belongs to the old material (doneness, #372) goes with it: from the card and
  // from the saved ledger, so the inspector and later reactions agree.
  const scoped = materialScopedStates.names();
  const forget = (card: CardBlock) => {
    const traits = { ...card.traits } as Record<string, unknown>;
    for (const name of scoped) delete traits[name];
    return { ...card, traits: traits as CardBlock["traits"] };
  };
  const swap = (card: CardBlock) =>
    card.id === cardId ? rematerial(forget(card), material) : card;
  const entry = { ...state.cardStates?.[cardId] } as Record<string, unknown>;
  for (const name of scoped) delete entry[name];
  return {
    ...state,
    hand: state.hand.map(swap),
    field: state.field.map((placed) => ({ ...placed, block: swap(placed.block) })),
    deck: state.deck.map(swap),
    discardPile: state.discardPile.map(swap),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(swap) } : {}),
    cardStates: { ...state.cardStates, [cardId]: { ...(entry as CardState), material } },
  };
}

// A changed material is restored first (#387).
cardStateAppliers.register("material", {
  order: 0,
  apply: (card, value) => rematerial(card, value as BlockMaterial),
});

// Cards of a material with a `roundEndMaterial` become it when the round ends: gelato back to
// custard (#383). Read uniformly from each card's own material definition.
roundEndResets.register("roundEndMaterial", (state) =>
  [
    ...state.hand,
    ...state.field.map(({ block }) => block),
    ...state.deck,
    ...state.discardPile,
  ].reduce((current, card) => {
    const target = getMaterialDefinition(materialOf(card)).roundEndMaterial;
    return [target ?? []]
      .flat()
      .reduce(
        (next, kind) => changeCardMaterial(next, card.id, kind as BlockMaterial) ?? next,
        current,
      );
  }, state),
);
