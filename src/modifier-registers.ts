/**
 * Acquired scoring modifiers (#431): what a card gains during a run, kept apart from its
 * material's own add/multiply/exponent values. Every card has one register per lifetime, each a
 * `ScoringModifier` triple, neutral (add 0, multiply 1, exponent 1) when absent:
 *
 * - `stage`: cleared when a stage ends;
 * - `round`: cleared when a round ends;
 * - `run`: kept for the whole run (bomb bonuses belong here, #24).
 *
 * Each lifetime registers its own clearing hook with the run's reset registries, so nothing
 * here or in the run names a lifetime to decide what to clear. Registers combine, within one and
 * across all three, by summing additives, multiplying multipliers and adding exponents'
 * increases above 1: 1.1 and 1.2 make 1.3 (the scorer composes powers the same way). The
 * combined modifier reaches the scorer as the card's own rules (`cardScoringRules`). Saves keep
 * every register in the card-state ledger, so Continue restores them within their lifetime.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import { cardStateAppliers } from "./card-states";
import type { GameState } from "./game-state";
import { roundEndResets } from "./round-end";
import {
  scoringModifierRules,
  validateScoringModifier,
  type ScoringModifier,
} from "./scoring-modifier";
import type { EventRule } from "./event-rules";
import { stageEndResets } from "./stage-end";

/** A lifetime register: how to hook its clearing into the run's boundaries, if it has one. */
export type ModifierLifetime = {
  clearOn: ((name: string, clear: (state: GameState) => GameState) => void) | null;
  /** What inspection calls it, and how long it lasts (#751). */
  label: string;
  expires: string;
};

export const modifierLifetimes = new Registry<ModifierLifetime>("modifier lifetime");
modifierLifetimes.register("stage", {
  clearOn: (name, clear) => stageEndResets.register(name, clear),
  label: "Stage",
  expires: "until the stage ends",
});
modifierLifetimes.register("round", {
  clearOn: (name, clear) => roundEndResets.register(name, clear),
  label: "Round",
  expires: "until the round ends",
});
modifierLifetimes.register("run", {
  clearOn: null,
  label: "Run",
  expires: "for the rest of the run",
});

/** Several modifiers as one: additives summed, multipliers multiplied, exponents' increases summed. */
export function combineModifiers(modifiers: readonly ScoringModifier[]): ScoringModifier {
  const additive = modifiers.reduce((sum, { additive = 0 }) => sum + additive, 0);
  const multiplicative = modifiers.reduce(
    (product, { multiplicative = 1 }) => product * multiplicative,
    1,
  );
  const exponential = 1 + modifiers.reduce((sum, { exponential = 1 }) => sum + exponential - 1, 0);
  return {
    ...(additive !== 0 ? { additive } : {}),
    ...(multiplicative !== 1 ? { multiplicative } : {}),
    ...(exponential !== 1 ? { exponential } : {}),
  };
}

/** A card's acquired modifier: every lifetime register combined. Neutral (`{}`) without any. */
export const acquiredModifier = (card: CardBlock): ScoringModifier =>
  combineModifiers(Object.values(card.traits.modifiers ?? {}));

/** The scoring rules a card's acquired modifiers bring: none when neutral. */
export const acquiredModifierRules = (card: CardBlock): EventRule[] =>
  scoringModifierRules(acquiredModifier(card));

/** The card with `registers` as its acquired modifiers (none left: the trait goes). */
function withRegisters(
  card: CardBlock,
  registers: Readonly<Record<string, ScoringModifier>>,
): CardBlock {
  const traits = { ...card.traits };
  delete traits.modifiers;
  return Object.keys(registers).length
    ? { ...card, traits: { ...traits, modifiers: registers } }
    : { ...card, traits };
}

/** Every card the run holds, changed by `change`, wherever it is. */
function everyCard(state: GameState, change: (card: CardBlock) => CardBlock): GameState {
  return {
    ...state,
    hand: state.hand.map(change),
    deck: state.deck.map(change),
    discardPile: state.discardPile.map(change),
    field: state.field.map((placed) => ({ ...placed, block: change(placed.block) })),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(change) } : {}),
    ...(state.generatedCards ? { generatedCards: state.generatedCards.map(change) } : {}),
  };
}

/** The ledger with one card's registers replaced (an empty set removes the entry). */
function withLedger(
  state: GameState,
  cardId: string,
  registers: Readonly<Record<string, ScoringModifier>>,
): GameState["cardStates"] {
  const { modifiers: _old, ...rest } = state.cardStates?.[cardId] ?? {};
  const entry = Object.keys(registers).length ? { ...rest, modifiers: registers } : rest;
  const { [cardId]: _gone, ...others } = state.cardStates ?? {};
  const ledger = Object.keys(entry).length ? { ...others, [cardId]: entry } : others;
  return Object.keys(ledger).length ? ledger : undefined;
}

/**
 * Add `modifier` to one card's `lifetime` register, combining with what it holds, and record it
 * for saves. Null when no card has that id. Throws on an invalid modifier, or one that would
 * combine into an unstorable register.
 */
export function addCardModifier(
  state: GameState,
  cardId: string,
  lifetime: string,
  modifier: ScoringModifier,
): GameState | null {
  modifierLifetimes.get(lifetime);
  const errors = validateScoringModifier(`${lifetime} modifier`, modifier);
  if (errors.length) throw new Error(errors.join("; "));
  if (!everyCardIn(state).some(({ id }) => id === cardId)) return null;
  const next = addCombinedModifier(state, cardId, lifetime, modifier);
  // Valid parts can combine into an unrepresentable whole (a multiplier underflowing to 0): refuse
  // it before changing the card or its ledger, so every stored register saves and loads.
  if (!next) throw new Error(`${lifetime} modifier combination out of range`);
  return next;
}

/**
 * Combine an already-combined modifier (another register, a transferred bonus, #436) into one
 * card's `lifetime` register. Its exponent may be 0 or below, as any register's may. Null when
 * no card has that id or the result couldn't be stored; nothing changes then.
 */
export function addCombinedModifier(
  state: GameState,
  cardId: string,
  lifetime: string,
  modifier: ScoringModifier,
): GameState | null {
  modifierLifetimes.get(lifetime);
  const card = everyCardIn(state).find(({ id }) => id === cardId);
  if (!card) return null;
  const held = card.traits.modifiers ?? {};
  const combined = combineModifiers([held[lifetime] ?? {}, modifier]);
  if (!storable(combined)) return null;
  const registers = { ...held, [lifetime]: combined };
  const next = everyCard(state, (each) =>
    each.id === cardId ? withRegisters(each, registers) : each,
  );
  return { ...next, cardStates: withLedger(next, cardId, registers) };
}

/**
 * Whether a register (a combination) can be stored and saved: every field finite, the multiplier
 * positive. Its exponent may be 0 or below, being 1 plus summed increases.
 */
function storable({ additive, multiplicative, exponential }: ScoringModifier): boolean {
  const finite = [additive, multiplicative, exponential].every(
    (value) => value === undefined || Number.isFinite(value),
  );
  return finite && (multiplicative === undefined || multiplicative > 0);
}

/** Every card the run holds, wherever it is. */
function everyCardIn(state: GameState): CardBlock[] {
  return [
    ...state.hand,
    ...state.deck,
    ...state.discardPile,
    ...state.field.map(({ block }) => block),
    ...(state.boughtCards ?? []),
    ...(state.generatedCards ?? []),
  ];
}

/** Every card's `lifetime` register cleared, on the cards and in the ledger. */
export function clearModifierLifetime(state: GameState, lifetime: string): GameState {
  const cleared = everyCard(state, (card) => {
    const held = card.traits.modifiers ?? {};
    // A card with nothing in this register is left exactly as it is.
    if (!(lifetime in held)) return card;
    const { [lifetime]: _gone, ...rest } = held;
    return withRegisters(card, rest);
  });
  return Object.entries(state.cardStates ?? {}).reduce<GameState>((current, [id, entry]) => {
    const held = entry.modifiers ?? {};
    if (!(lifetime in held)) return current;
    const { [lifetime]: _gone, ...rest } = held;
    return { ...current, cardStates: withLedger(current, id, rest) };
  }, cleared);
}

// Each lifetime with a boundary clears at it.
for (const name of modifierLifetimes.names())
  modifierLifetimes
    .get(name)
    .clearOn?.(`modifiers.${name}`, (state) => clearModifierLifetime(state, name));

// Saved registers are restored onto the rebuilt card.
cardStateAppliers.register("modifiers", {
  order: 3,
  apply: (card, value) => withRegisters(card, value as Record<string, ScoringModifier>),
});

/** A saved ledger entry's registers, validated: throws on an unknown lifetime or bad numbers. */
export function restoreModifierRegisters(saved: unknown): Record<string, ScoringModifier> {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw new Error("bad card modifiers");
  return Object.fromEntries(
    Object.entries(saved).map(([lifetime, raw]) => {
      if (!modifierLifetimes.has(lifetime)) throw new Error("bad card modifier lifetime");
      // A register is a plain object of known numeric fields; `{}` is a neutral register.
      if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        throw new Error("bad card modifier");
      const fields = raw as Record<string, unknown>;
      if (
        Object.keys(fields).some(
          (key) => !["additive", "multiplicative", "exponential"].includes(key),
        )
      )
        throw new Error("bad card modifier field");
      const { additive, multiplicative, exponential } = fields;
      if (
        ![additive, multiplicative, exponential].every(
          (value) => value === undefined || typeof value === "number",
        )
      )
        throw new Error("bad card modifier");
      const modifier: ScoringModifier = {
        ...(additive === undefined ? {} : { additive: additive as number }),
        ...(multiplicative === undefined ? {} : { multiplicative: multiplicative as number }),
        ...(exponential === undefined ? {} : { exponential: exponential as number }),
      };
      if (!storable(modifier)) throw new Error("bad card modifier");
      return [lifetime, modifier];
    }),
  );
}

/** The acquired bonus a card's face shows (#432): its highest-priority non-neutral modifier. */
export type AcquiredBonusDescriptor = {
  operator: "exponent" | "multiplier" | "additive";
  value: number;
};

/**
 * The compact descriptor for a card's acquired modifiers, every lifetime combined first, by the
 * model's own arithmetic (doc/presentation-contracts.md, "Acquired bonus artwork and inspection").
 * Priority is exponent, then multiplier, then additive; lower ones still score while hidden. Null
 * when the card has no acquired bonus. Base material values are never included.
 */
export function acquiredBonusDescriptor(card: CardBlock): AcquiredBonusDescriptor | null {
  const { additive = 0, multiplicative = 1, exponential = 1 } = acquiredModifier(card);
  if (exponential !== 1) return { operator: "exponent", value: exponential };
  if (multiplicative !== 1) return { operator: "multiplier", value: multiplicative };
  if (additive !== 0) return { operator: "additive", value: additive };
  return null;
}

/** One non-neutral lifetime register, as inspection lists it (#751). */
export type AcquiredBonusRow = {
  lifetime: string;
  label: string;
  expires: string;
  modifier: ScoringModifier;
};

/**
 * Every non-neutral acquired register of a card, in the lifetimes' registered order, and their
 * combination by the model's own arithmetic. Pure: it reads the card, never the run.
 */
export function acquiredBonusBreakdown(card: CardBlock): {
  rows: AcquiredBonusRow[];
  combined: ScoringModifier;
} {
  const registers = card.traits.modifiers ?? {};
  const rows = modifierLifetimes.names().flatMap((lifetime) => {
    const modifier = combineModifiers([registers[lifetime] ?? {}]);
    if (!Object.keys(modifier).length) return [];
    const { label, expires } = modifierLifetimes.get(lifetime);
    return [{ lifetime, label, expires, modifier }];
  });
  return { rows, combined: acquiredModifier(card) };
}
