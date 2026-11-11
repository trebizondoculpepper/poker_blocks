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
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";

/** What the run remembers about a card beyond its definition: its changed material. */
export type CardState = { material?: BlockMaterial; stateBonus?: string; doneness?: number };

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
  const swap = (card: CardBlock) => (card.id === cardId ? rematerial(card, material) : card);
  return {
    ...state,
    hand: state.hand.map(swap),
    field: state.field.map((placed) => ({ ...placed, block: swap(placed.block) })),
    deck: state.deck.map(swap),
    discardPile: state.discardPile.map(swap),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(swap) } : {}),
    cardStates: { ...state.cardStates, [cardId]: { ...state.cardStates?.[cardId], material } },
  };
}

// A changed material is restored first (#387).
cardStateAppliers.register("material", {
  order: 0,
  apply: (card, value) => rematerial(card, value as BlockMaterial),
});
