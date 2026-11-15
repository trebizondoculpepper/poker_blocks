/**
 * Retention at lifecycle boundaries (#505; doc/clone-reset.md, "Boundary lifecycle"): every card
 * resolves exactly one retention (stage, round or run) from its definition's lifecycle
 * declaration. When a stage ends, cards retained only for the stage expire; when the round's last
 * stage ends, round-retained cards expire too. Run-retained cards stay. Expiry leaves every zone
 * and forgets the card's saved state, so it never reappears in a later draw, the shop or Continue.
 * It is not destruction: no removal command, transfer, sound or reward runs.
 *
 * Generic: a card's definition is found the way every lifecycle consumer finds it (its active
 * definition, else its material), and nothing here asks what kind of card it is.
 */
import { activeDefinitions } from "./active-objects";
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { lifecycleRoots } from "./lifecycle-roots";
import { resolveLifecycle, type LifecycleDeclaration, type Retention } from "./lifecycle-resolver";
import { getMaterialDefinition, materialOf } from "./materials";

/** A card's own lifecycle declaration and the key it resolves under. */
function declarationOf(card: CardBlock): { key: string; declaration?: LifecycleDeclaration } {
  const active = [card.traits.active ?? []].flat()[0]?.definition;
  if (active && activeDefinitions.has(active))
    return { key: `active:${active}`, declaration: activeDefinitions.get(active).lifecycle };
  const material = materialOf(card);
  return { key: `material:${material}`, declaration: getMaterialDefinition(material).lifecycle };
}

const resolved = new Map<string, Retention>();

/** A card's resolved retention, through its definition's lifecycle parents. */
export function retentionOf(card: CardBlock): Retention {
  const { key, declaration } = declarationOf(card);
  const known = resolved.get(key);
  if (known) return known;
  const roots = lifecycleRoots as Record<string, LifecycleDeclaration>;
  const { retention } = resolveLifecycle(key, (name) => (name === key ? declaration : roots[name]));
  resolved.set(key, retention);
  return retention;
}

/** The retentions that end when a stage ends: the stage's, and the round's at its last stage. */
export function retentionsEndingAfter(stageEndsRound: boolean): readonly Retention[] {
  return stageEndsRound ? ["stage", "round"] : ["stage"];
}

/** The state with every card whose retention has ended removed from every zone. */
export function expireRetained(
  state: GameState,
  ended: readonly Retention[],
  retention: (card: CardBlock) => Retention = retentionOf,
): GameState {
  if (!ended.length) return state;
  const expired = new Set<string>();
  const keep = (card: CardBlock) => {
    if (!ended.includes(retention(card))) return true;
    expired.add(card.id);
    return false;
  };
  const field = state.field.filter(({ block }) => keep(block));
  const hand = state.hand.filter(keep);
  const deck = state.deck.filter(keep);
  const discardPile = state.discardPile.filter(keep);
  if (!expired.size) return state;
  const generated = new Set((state.generatedCards ?? []).map(({ id }) => id));
  const generatedCards = (state.generatedCards ?? []).filter(({ id }) => !expired.has(id));
  // A run card (starting or bought) is accounted for as gone, so a save still finds every card;
  // a card made on the field simply leaves, as it always has.
  const removed = [...expired].filter((id) => !generated.has(id));
  const cardStates = Object.fromEntries(
    Object.entries(state.cardStates ?? {}).filter(([id]) => !expired.has(id)),
  );
  return {
    ...state,
    field,
    hand,
    deck,
    discardPile,
    generatedCards: generatedCards.length ? generatedCards : undefined,
    ...(removed.length ? { removedCards: [...(state.removedCards ?? []), ...removed] } : {}),
    cardStates: Object.keys(cardStates).length ? cardStates : undefined,
  };
}
