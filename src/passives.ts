import { Registry } from "./core/registry";
import { categoryPalette, type PassiveCategoryTraits } from "./passive-categories";
import type { EventRule } from "./event-rules";
import type { BlockMaterial } from "./materials";
import type { StageKind } from "./run-rules";
import { inspectable, type InspectableTrait } from "./traits/inspectable";
import type { PassiveFaceDesign, PassiveShape } from "./passive-visual";

/** Serializable block data. Behavior lives in the referenced trait definition. */
export type PassiveRule = {
  on: "score.beforeBlockValue" | "score.beforeLineFinalized" | "discard.completed" | "stage.won";
  condition?:
    | { kind: "material"; value: BlockMaterial }
    | { kind: "suit"; values: readonly ("hearts" | "diamonds")[] }
    | { kind: "line-length"; minimum?: number; maximum?: number }
    | { kind: "intersection" }
    | { kind: "rank-count"; rank: "A"; minimum: number }
    /** Only at these stages, e.g. a reward paid for boss wins alone (issue #13). */
    | { kind: "stage"; kinds: readonly StageKind[] };
  effect:
    | { kind: "multiply-value"; factor: number }
    | { kind: "add-value"; amount: number }
    | { kind: "multiply-line"; factor: number }
    | { kind: "add-line"; amount: number; perIntersection?: boolean }
    | { kind: "add-coins"; amount: number; perMatch?: boolean }
    | { kind: "grant-unowned-passive" };
};

export type PassiveBlock = {
  id: string;
  definitionId: string;
  traits: Partial<PassiveCategoryTraits> & {
    rackResident?: { zone: "passive-rack" };
    appearance?: {
      symbol: string;
      palette: PassivePalette;
      shape?: PassiveShape;
      faces?: readonly PassiveFaceDesign[];
    };
    passive: { traitId: string; rules?: readonly PassiveRule[]; eventRules?: readonly EventRule[] };
    inspectable: InspectableTrait;
    /** What it cost in the shop, before modifiers; the resale policy reads it (#103). */
    priced?: { basePrice: number };
  };
};

/** Which stage a lifecycle event belongs to, so a trait can match a moment by condition. */
export type StageContext = { round: number; kind: StageKind; dealer: string };

export type GameEvent = {
  type: string;
  blockId?: string;
  cardIds?: readonly string[];
  /** On stage and shop lifecycle events: the stage they belong to. */
  stage?: StageContext;
  /** On `reward.finalized`: the coins paid, and the balance before and after. */
  reward?: { coins: number; balanceBefore: number; balance: number };
};

export type PassiveTraitDefinition = {
  id: string;
  listensTo: readonly string[];
  respond?: (block: PassiveBlock, event: Readonly<GameEvent>) => readonly GameEvent[];
};

export type PassivePalette = { face: string; ink: string; edge: string };

/** A passive's shop balance: fixed data; price modifiers apply on top, never here. */
export type PassiveShopBalance = { basePrice: number; unlockRound: number };

export type PassiveDefinition = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  traitId: string;
  /**
   * Exactly one trait from the category facet (#81), naming its primary purpose. It brings
   * presentation defaults only and is never read by gameplay rules.
   */
  categoryTrait: Partial<PassiveCategoryTraits>;
  /** Overrides the category's default colours; only where an explicit design calls for it. */
  palette?: PassivePalette;
  /** Optional polyhedral token definition. Dice are rolled once per scoring resolution. */
  shape?: PassiveShape;
  faces?: readonly PassiveFaceDesign[];
  diceSides?: number;
  unlockRound?: number;
  rules: readonly PassiveRule[];
  /**
   * Its shop balance (doc/game.md, "Shop rules"): base purchase price in coins and the first
   * round it can be stocked. Absent only on a retired passive.
   */
  shop?: PassiveShopBalance;
  /** Excluded from new draws; kept so a save that names it still resolves. */
  retired?: boolean;
};

export const passiveTraits = new Registry<PassiveTraitDefinition>("passive trait");
export const passiveDefinitions = new Registry<PassiveDefinition>("passive");

passiveTraits.register("passive.event-rules", {
  id: "passive.event-rules",
  listensTo: [],
});

const dieFaces = (sides: number): PassiveFaceDesign[] =>
  Array.from({ length: sides }, (_, i) => ({ label: String(i + 1) }));
const d6Faces: PassiveFaceDesign[] = [1, 2, 3, 4, 5, 6].map((pips) => ({
  label: String(pips),
  pips,
}));
const definitions: PassiveDefinition[] = [
  {
    id: "dice-d6",
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "D6",
    symbol: "⚄",
    description:
      "At the start of scoring, roll 1–6. Add the same result to every scored row. Available from round 1.",
    traitId: "passive.event-rules",
    shape: "cube",
    faces: d6Faces,
    diceSides: 6,
    unlockRound: 1,
    rules: [],
  },
  {
    id: "dice-d8",
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "D8",
    symbol: "D8",
    description:
      "At the start of scoring, roll 1–8. Add the same result to every scored row. Available from round 2.",
    traitId: "passive.event-rules",
    shape: "octahedron",
    faces: dieFaces(8),
    diceSides: 8,
    unlockRound: 2,
    rules: [],
  },
  {
    id: "dice-d10",
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "D10",
    symbol: "D10",
    description:
      "At the start of scoring, roll 1–10. Add the same result to every scored row. Available from round 3.",
    traitId: "passive.event-rules",
    shape: "d10",
    faces: dieFaces(10),
    diceSides: 10,
    unlockRound: 3,
    rules: [],
  },
  {
    id: "dice-d20",
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "D20",
    symbol: "D20",
    description:
      "At the start of scoring, roll 1–20. Add the same result to every scored row. Available from round 4.",
    traitId: "passive.event-rules",
    shape: "icosahedron",
    faces: dieFaces(20),
    diceSides: 20,
    unlockRound: 4,
    rules: [],
  },
  {
    id: "do-nothing",
    categoryTrait: { effectCategory: {} },
    name: "Do Nothing",
    symbol: "∅",
    description: "Has no effect. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [],
    retired: true,
  },
  {
    id: "double-line",
    shop: { basePrice: 4, unlockRound: 1 },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "×2",
    symbol: "×2",
    description: "Doubles every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [{ on: "score.beforeLineFinalized", effect: { kind: "multiply-line", factor: 2 } }],
  },
  {
    id: "quad-line",
    shop: { basePrice: 9, unlockRound: 2 },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "×4",
    symbol: "×4",
    description: "Quadruples every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [{ on: "score.beforeLineFinalized", effect: { kind: "multiply-line", factor: 4 } }],
  },
  {
    id: "gold-standard",
    shop: { basePrice: 5, unlockRound: 4 },
    categoryTrait: { economyCategory: {} },
    name: "Gold Standard",
    symbol: "$",
    description: "When you win a stage, +1 coin for each gold block still in your hand.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "stage.won",
        condition: { kind: "material", value: "gold" },
        effect: { kind: "add-coins", amount: 1, perMatch: true },
      },
    ],
  },
  {
    id: "carnivore",
    shop: { basePrice: 3, unlockRound: 3 },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "Carnivore",
    symbol: "◈",
    description: "Doubles the base value of each meat block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "score.beforeBlockValue",
        condition: { kind: "material", value: "meat" },
        effect: { kind: "multiply-value", factor: 2 },
      },
    ],
  },
  {
    id: "woodworker",
    shop: { basePrice: 4, unlockRound: 1 },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Woodworker",
    symbol: "✥",
    description: "Adds 3 to the base value of each wood block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "score.beforeBlockValue",
        condition: { kind: "material", value: "wood" },
        effect: { kind: "add-value", amount: 3 },
      },
    ],
  },
  {
    id: "crossroads",
    shop: { basePrice: 2, unlockRound: 1 },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Crossroads",
    symbol: "✳",
    description:
      "Adds 3 points for each block in a scored line that crosses another line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "score.beforeLineFinalized",
        condition: { kind: "intersection" },
        effect: { kind: "add-line", amount: 3, perIntersection: true },
      },
    ],
  },
  {
    id: "long-haul",
    shop: { basePrice: 4, unlockRound: 1 },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Long Haul",
    symbol: "↗",
    description:
      "Subtracts 5 from two-block lines; adds 5 to lines of three or more. Final scores cannot go below zero. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "score.beforeLineFinalized",
        condition: { kind: "line-length", maximum: 2 },
        effect: { kind: "add-line", amount: -5 },
      },
      {
        on: "score.beforeLineFinalized",
        condition: { kind: "line-length", minimum: 3 },
        effect: { kind: "add-line", amount: 5 },
      },
    ],
  },
  {
    id: "scrapper",
    shop: { basePrice: 8, unlockRound: 2 },
    categoryTrait: { economyCategory: {} },
    name: "Scrapper",
    symbol: "⚙",
    description: "Earns 1 coin for each block discarded. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [{ on: "discard.completed", effect: { kind: "add-coins", amount: 1, perMatch: true } }],
  },
  {
    id: "seeing-red",
    shop: { basePrice: 6, unlockRound: 1 },
    categoryTrait: { economyCategory: {} },
    name: "Seeing Red",
    symbol: "♥♦",
    description: "Earns 1 coin for each Heart or Diamond discarded. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "discard.completed",
        condition: { kind: "suit", values: ["hearts", "diamonds"] },
        effect: { kind: "add-coins", amount: 1, perMatch: true },
      },
    ],
  },
  {
    id: "ace-exchange",
    shop: { basePrice: 5, unlockRound: 2 },
    categoryTrait: { effectCategory: {} },
    name: "Ace Exchange",
    symbol: "AA",
    description:
      "Discard at least two Aces together to gain one random passive you do not own. Triggers once per qualifying discard; unlimited use.",
    traitId: "passive.event-rules",
    rules: [
      {
        on: "discard.completed",
        condition: { kind: "rank-count", rank: "A", minimum: 2 },
        effect: { kind: "grant-unowned-passive" },
      },
    ],
  },
];
for (const definition of definitions) passiveDefinitions.register(definition.id, definition);

/** A passive's colours: its own override, or its category's default. */
export function passivePalette(definition: PassiveDefinition): PassivePalette {
  return definition.palette ?? categoryPalette(definition.categoryTrait);
}

/** The look a passive block is drawn with: its own appearance trait, or its definition's. */
export function passiveAppearance(block: PassiveBlock): {
  symbol: string;
  palette: PassivePalette;
  shape?: PassiveShape;
  faces?: readonly PassiveFaceDesign[];
} {
  const definition = () => passiveDefinitions.get(block.definitionId);
  return (
    block.traits.appearance ?? {
      symbol: definition().symbol,
      palette: passivePalette(definition()),
      ...(definition().shape ? { shape: definition().shape } : {}),
      ...(definition().faces ? { faces: definition().faces } : {}),
    }
  );
}

export function createPassiveBlock(definitionId: string, id: string): PassiveBlock {
  const definition = passiveDefinitions.get(definitionId);
  passiveTraits.get(definition.traitId);
  return {
    id,
    definitionId,
    traits: {
      ...definition.categoryTrait,
      rackResident: { zone: "passive-rack" },
      appearance: {
        symbol: definition.symbol,
        palette: passivePalette(definition),
        ...(definition.shape ? { shape: definition.shape } : {}),
        ...(definition.faces ? { faces: definition.faces } : {}),
      },
      passive: { traitId: definition.traitId, rules: definition.rules },
      inspectable: inspectable(`${definition.name} — ${definition.description}`),
      ...(definition.shop ? { priced: { basePrice: definition.shop.basePrice } } : {}),
    },
  };
}

/** FIFO event delivery. Subscription order is the current rack order. */
export class PassiveEventQueue {
  private readonly listeners = new Map<string, PassiveBlock[]>();
  private readonly pending: GameEvent[] = [];

  syncRack(rack: readonly PassiveBlock[]): void {
    this.listeners.clear();
    for (const block of rack) {
      const trait = passiveTraits.get(block.traits.passive.traitId);
      for (const type of new Set([
        ...trait.listensTo,
        ...(block.traits.passive.rules ?? []).map(({ on }) => on),
        ...(block.traits.passive.eventRules ?? []).map(({ on }) => on),
      ])) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(block);
        this.listeners.set(type, listeners);
      }
    }
  }

  emit(event: GameEvent): void {
    this.pending.push(event);
  }

  /** Further events wait until every listener for the current event has responded. */
  drain(
    limit = 128,
    onResponse?: (block: PassiveBlock, event: Readonly<GameEvent>) => readonly GameEvent[],
  ): GameEvent[] {
    const delivered: GameEvent[] = [];
    while (this.pending.length) {
      if (delivered.length >= limit) {
        const chain = [...delivered, ...this.pending].map(({ type }) => type).join(" → ");
        this.pending.length = 0;
        throw new Error(`Passive event limit exceeded: ${chain}`);
      }
      const event = this.pending.shift()!;
      delivered.push(event);
      const listeners = this.listeners.get(event.type)?.slice() ?? [];
      for (const block of listeners) {
        const trait = passiveTraits.get(block.traits.passive.traitId);
        this.pending.push(...(trait.respond?.(block, Object.freeze({ ...event })) ?? []));
        this.pending.push(...(onResponse?.(block, Object.freeze({ ...event })) ?? []));
      }
    }
    return delivered;
  }
}

/** Pick distinct definitions without depending on registry insertion order after each draw. */
export function randomPassiveDefinitions(
  count: number,
  random: () => number,
  excluded: readonly string[] = [],
  round = Number.POSITIVE_INFINITY,
): PassiveDefinition[] {
  const available = passiveDefinitions
    .names()
    .filter(
      (name) =>
        !excluded.includes(name) &&
        !passiveDefinitions.get(name).retired &&
        (passiveDefinitions.get(name).unlockRound ?? 1) <= round,
    )
    .map((name) => passiveDefinitions.get(name));
  const picked: PassiveDefinition[] = [];
  while (picked.length < count && available.length) {
    picked.push(
      available.splice(
        Math.min(available.length - 1, Math.floor(random() * available.length)),
        1,
      )[0],
    );
  }
  return picked;
}
