/**
 * Reset facets (#582; doc/clone-reset.md, "Reset and reset-clone"). A card's resolved definition
 * names one reset facet and its configuration; generic code asks `requestReset` and the facet
 * registered under that name answers. It never checks a marker or the card's material.
 *
 * `resettable` runs an ordered **recipe** of registered state handlers on one instance: each
 * handler returns the state with its own component reset to the documented baseline. The card
 * keeps its identity, rank/suit and owner; acquired modifier registers are untouched unless a
 * recipe step names them (their lifetimes clear them independently). No handler draws on the
 * random stream or touches rendering. The whole recipe is applied to immutable state, so a
 * failing step returns the original state unchanged.
 *
 * Resolving which facet a definition has (and inheritance) is #504; scheduling resets at stage
 * and round boundaries is #506; `nonResettable` is #583.
 */
import type { BlockMaterial } from "./materials";
import type { CardBlock } from "./cards";
import { changeCardMaterial } from "./card-material";
import { materialOf } from "./materials";
import { withoutDoneness } from "./cooking";
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";

export type ResetStep = { handler: string; config?: unknown };
export type ResetRequest = { facet: string; config?: unknown };

/** The outcome of a reset request: the new state, or why nothing changed. */
export type ResetResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string; state: GameState };

export type ResetFacet = (state: GameState, cardId: string, config: unknown) => ResetResult;
export const resetFacets = new Registry<ResetFacet>("reset facet");

/** One component's reset for one card: the new state, or null if it can't be applied. */
export type ResetStateHandler = (
  state: GameState,
  cardId: string,
  config: unknown,
) => GameState | null;
export const resetStateHandlers = new Registry<ResetStateHandler>("reset state handler");

/** Ask the card's configured facet to reset it. */
export function requestReset(state: GameState, cardId: string, request: ResetRequest): ResetResult {
  return resetFacets.get(request.facet)(state, cardId, request.config);
}

/** Every card the run holds now, wherever it is. */
const cardsOf = (state: GameState): CardBlock[] => [
  ...state.hand,
  ...state.field.map(({ block }) => block),
  ...state.deck,
  ...state.discardPile,
];

/** `state` with one card replaced by `change(card)`, wherever it is. */
function changeCard(
  state: GameState,
  cardId: string,
  change: (card: CardBlock) => CardBlock,
): GameState {
  const swap = (card: CardBlock) => (card.id === cardId ? change(card) : card);
  return {
    ...state,
    hand: state.hand.map(swap),
    deck: state.deck.map(swap),
    discardPile: state.discardPile.map(swap),
    field: state.field.map((placed) => ({ ...placed, block: swap(placed.block) })),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(swap) } : {}),
  };
}

/** `state` without one saved component for one card in the card-state ledger. */
function withoutLedger(state: GameState, cardId: string, component: string): GameState {
  const entry = state.cardStates?.[cardId];
  if (!entry || !(component in entry)) return state;
  const { [component]: _gone, ...rest } = entry as Record<string, unknown>;
  const { [cardId]: _old, ...others } = state.cardStates!;
  const ledger = Object.keys(rest).length ? { ...others, [cardId]: rest } : others;
  return {
    ...state,
    cardStates: Object.keys(ledger).length ? (ledger as GameState["cardStates"]) : undefined,
  };
}

resetFacets.register("resettable", (state, cardId, raw) => {
  const { recipe = [] } = (raw ?? {}) as { recipe?: readonly ResetStep[] };
  if (!cardsOf(state).some(({ id }) => id === cardId))
    return { ok: false, reason: `no card ${cardId} in the run`, state };
  let next = state;
  for (const step of recipe) {
    if (!resetStateHandlers.has(step.handler))
      return { ok: false, reason: `no reset handler "${step.handler}"`, state };
    const after = resetStateHandlers.get(step.handler)(next, cardId, step.config);
    if (!after) return { ok: false, reason: `reset step "${step.handler}" could not apply`, state };
    next = after;
  }
  return { ok: true, state: next };
});

// Cooking goes back to raw: the doneness step and its saved entry go (#372).
resetStateHandlers.register("doneness", (state, cardId) =>
  withoutLedger(changeCard(state, cardId, withoutDoneness), cardId, "doneness"),
);

// A countdown goes back to its material's full count: the instance's own count is dropped (#434).
resetStateHandlers.register("countdown", (state, cardId) =>
  withoutLedger(
    changeCard(state, cardId, (card) => {
      const traits = { ...card.traits };
      delete traits.countdown;
      return { ...card, traits };
    }),
    cardId,
    "countdown",
  ),
);

// A reversion to a configured material (Gelato to Custard, #383). Already that material: no-op.
resetStateHandlers.register("material", (state, cardId, raw) => {
  const { to } = (raw ?? {}) as { to?: BlockMaterial };
  if (!to) return null;
  const card = cardsOf(state).find(({ id }) => id === cardId);
  if (card && materialOf(card) === to) return state;
  return changeCardMaterial(state, cardId, to);
});
