import { Registry } from "./core/registry";
import { categoryPalette, type PassiveCategoryTraits } from "./passive-categories";
import type { EventRule, HandlerConfig } from "./event-rules";
import type { CardBlock } from "./cards";
import type { Line } from "./scoring";
import type { PassiveFaceDesign, PassiveTokenAppearance } from "./passive-visual";
import type { BlockMaterial } from "./materials";
import type { StageKind } from "./run-rules";
import { inspectable, type InspectableTrait } from "./traits/inspectable";

/** Serializable block data. Behavior lives in the referenced trait definition. */
export type PassiveRule = {
  /** Scoring rules are `EventRule` data (#139); these legacy rules await #63 slice 3. */
  on: "discard.completed" | "stage.won";
  condition?:
    | { kind: "material"; value: BlockMaterial }
    | { kind: "suit"; values: readonly ("hearts" | "diamonds")[] }
    | { kind: "rank-count"; rank: "A"; minimum: number }
    /** Only at these stages, e.g. a reward paid for boss wins alone (issue #13). */
    | { kind: "stage"; kinds: readonly StageKind[] };
  effect:
    | { kind: "add-coins"; amount: number; perMatch?: boolean }
    | { kind: "grant-unowned-passive" };
};

export type PassiveBlock = {
  id: string;
  definitionId: string;
  traits: Partial<PassiveCategoryTraits> & {
    rackResident?: { zone: "passive-rack" };
    appearance?: PassiveTokenAppearance;
    passive: { traitId: string; rules?: readonly PassiveRule[]; eventRules?: readonly EventRule[] };
    inspectable: InspectableTrait;
    /** What it cost in the shop, before modifiers; the resale policy reads it (#103). */
    priced?: { basePrice: number };
  };
};

/** What a `score.*` event carries for its rules' selectors. */
export type ScoreEventContext = { line: Line; intersections: number; block?: CardBlock };

/** Which stage a lifecycle event belongs to, so a trait can match a moment by condition. */
export type StageContext = { round: number; kind: StageKind; dealer: string };

export type GameEvent = {
  type: string;
  blockId?: string;
  cardIds?: readonly string[];
  /** On stage and shop lifecycle events: the stage they belong to. */
  stage?: StageContext;
  /**
   * On `score.*` events: the scored line (its maximal, gap-free blocks), how many of its cells
   * cross another line, and on `score.beforeBlockValue` the block being valued.
   */
  score?: ScoreEventContext;
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
  /** The token's registered shape (`src/passive-visual.ts`); a cube when absent. */
  shape?: string;
  /** Artwork per face in logical order: face `i` sits opposite face `count - 1 - i`. */
  faces?: readonly PassiveFaceDesign[];
  /** Legacy discard and stage-won rules (until #63 slice 3). */
  rules: readonly PassiveRule[];
  /** Its event rules: named, configured handlers from `src/rule-handlers.ts` (#139). */
  eventRules?: readonly EventRule[];
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

/** A rule on each contributing block's value as a line scores. */
const blockRule = (where: HandlerConfig, ...effects: HandlerConfig[]): EventRule => ({
  on: "score.beforeBlockValue",
  select: { id: "scored-block", config: {} },
  where,
  effects,
});
/** A rule on a line's score before it is finalized. */
const lineRule = (where: HandlerConfig, ...effects: HandlerConfig[]): EventRule => ({
  on: "score.beforeLineFinalized",
  select: { id: "scored-line", config: {} },
  where,
  effects,
});

const definitions: PassiveDefinition[] = [
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
    rules: [],
    eventRules: [
      lineRule({ id: "always", config: {} }, { id: "multiply-line-score", config: { factor: 2 } }),
    ],
  },
  {
    id: "quad-line",
    shop: { basePrice: 9, unlockRound: 2 },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "×4",
    symbol: "×4",
    description: "Quadruples every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    rules: [],
    eventRules: [
      lineRule({ id: "always", config: {} }, { id: "multiply-line-score", config: { factor: 4 } }),
    ],
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
    rules: [],
    eventRules: [
      blockRule(
        { id: "material-is", config: { material: "meat" } },
        { id: "multiply-block-value", config: { factor: 2 } },
      ),
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
    rules: [],
    eventRules: [
      blockRule(
        { id: "material-is", config: { material: "wood" } },
        { id: "add-block-value", config: { amount: 3 } },
      ),
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
    rules: [],
    eventRules: [
      lineRule(
        { id: "perpendicular-intersection", config: {} },
        { id: "add-line-score", config: { amount: 3, perIntersection: true } },
      ),
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
    rules: [],
    eventRules: [
      lineRule(
        { id: "line-length", config: { maximum: 2 } },
        { id: "add-line-score", config: { amount: -5 } },
      ),
      lineRule(
        { id: "line-length", config: { minimum: 3 } },
        { id: "add-line-score", config: { amount: 5 } },
      ),
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
export function passiveAppearance(block: PassiveBlock): PassiveTokenAppearance {
  const definition = () => passiveDefinitions.get(block.definitionId);
  return (
    block.traits.appearance ?? {
      symbol: definition().symbol,
      palette: passivePalette(definition()),
      shape: definition().shape,
      faces: definition().faces,
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
        shape: definition.shape,
        faces: definition.faces,
      },
      passive: {
        traitId: definition.traitId,
        rules: definition.rules,
        eventRules: definition.eventRules,
      },
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
): PassiveDefinition[] {
  const available = passiveDefinitions
    .names()
    .filter((name) => !excluded.includes(name) && !passiveDefinitions.get(name).retired)
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
