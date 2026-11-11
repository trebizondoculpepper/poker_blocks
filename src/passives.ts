import "./visual/chef-toque";
import type { SoundEffectId } from "./audio/sfx-registry";
import { passiveFrequencies } from "./offer-weights";
import type { BlockMaterial } from "./materials";
import { Registry } from "./core/registry";
import { categoryPalette, type PassiveCategoryTraits } from "./passive-categories";
import type { EventRule, HandlerConfig } from "./event-rules";
import type { CardBlock } from "./cards";
import type { Line } from "./scoring";
import type { PassiveFaceDesign, PassiveTokenAppearance } from "./passive-visual";
import type { StageKind } from "./run-rules";
import { inspectable, type InspectableTrait } from "./traits/inspectable";

export type PassiveBlock = {
  id: string;
  definitionId: string;
  traits: Partial<PassiveCategoryTraits> & {
    rackResident?: { zone: "passive-rack" };
    appearance?: PassiveTokenAppearance;
    passive: { traitId: string; eventRules?: readonly EventRule[] };
    inspectable: InspectableTrait;
    /** What it cost in the shop, before modifiers; the resale policy reads it (#103). */
    priced?: { basePrice: number };
    /** Uses left of its total, for an item that wears out (a transmogrifier, #388). */
    limitedUse?: { uses: number; total: number };
    /** The material a transmogrifier turns a card into (#388). */
    transmogrifier?: { material: BlockMaterial };
  };
};

/** What a `score.*` event carries for its rules' selectors. */
export type ScoreEventContext = { line: Line; intersections: number; block?: CardBlock };

/** Which stage a lifecycle event belongs to, so a trait can match a moment by condition. */
export type StageContext = { round: number; kind: StageKind; dealer: string };

/** What a reaction changes about a block: its material and its state bonus, if any. */
export type ReactionState = { material: string; stateBonus?: string; doneness?: string };

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
  /** The blocks the event is about: the discarded blocks, or the hand when a stage is won. */
  blocks?: readonly CardBlock[];
  /** On `stage.won`: which stage of the round was won. */
  stageKind?: StageKind;
  /** On `reaction.applied` (#366): the block's material and state bonus before and after. */
  reaction?: { from: ReactionState; to: ReactionState; sound?: SoundEffectId };
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
export type PassiveShopBalance = {
  basePrice: number;
  unlockRound: number;
  /** The named curve (src/offer-weights.ts) its offers are drawn by from its unlock round (#145). */
  frequency: string;
};

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
  /** A registered visual builder for a token not drawn as a painted shape (#391). */
  visual?: { builder: string; config: unknown };
  /** Its event rules: named, configured handlers from `src/rule-handlers.ts` (#139, #170). */
  eventRules: readonly EventRule[];
  /**
   * Its shop balance (doc/game.md, "Shop rules"): base purchase price in coins and the first
   * round it can be stocked. Absent only on a retired passive.
   */
  shop?: PassiveShopBalance;
  /**
   * Settlement reward modifiers it brings while installed (#373): registered handlers by name
   * (`rewardModifiers` in src/stage-rewards.ts), each with its configuration. Le Chef brings
   * `field-rate`, raising a material's field reward rate.
   */
  rewardModifiers?: readonly { id: string; config: unknown }[];
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

/** `amount` coins for each of the event's blocks matching `where` (none, no activation). */
const coinsPerBlock = (on: string, where: HandlerConfig, amount: number): EventRule => ({
  on,
  select: { id: "event-blocks", config: { where } },
  where: { id: "count-at-least", config: { minimum: 1 } },
  effects: [{ id: "add-coins-per-selected", config: { amount } }],
});

/**
 * A die (#97): a scoring passive whose amount is a registered `roll` value source, added to every
 * scored line after the zero clamp. Faces read 1 to `sides` (pips on a six-sided die), so
 * opposite faces sum to `sides + 1`.
 */
function die(options: {
  id: string;
  name: string;
  sides: number;
  shape: string;
  unlockRound: number;
  basePrice: number;
  pips?: boolean;
}): PassiveDefinition {
  const { id, name, sides, shape, unlockRound, basePrice, pips } = options;
  return {
    id,
    shop: { basePrice, unlockRound, frequency: "additiveScoring" },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name,
    symbol: name,
    description: `Rolls 1–${sides} once each time lines score, and adds the roll to every scored line. Unlimited use.`,
    traitId: "passive.event-rules",
    shape,
    faces: Array.from({ length: sides }, (_, index) =>
      pips ? { label: String(index + 1), pips: index + 1 } : { label: String(index + 1) },
    ),
    eventRules: [
      {
        on: "score.afterLineClamp",
        select: { id: "scored-line", config: {} },
        where: { id: "always", config: {} },
        effects: [{ id: "add-line-score", config: { amount: { valueSource: "roll", sides } } }],
      },
    ],
  };
}

const definitions: PassiveDefinition[] = [
  {
    id: "do-nothing",
    categoryTrait: { effectCategory: {} },
    name: "Do Nothing",
    symbol: "∅",
    description: "Has no effect. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [],
    retired: true,
  },
  {
    id: "double-line",
    shop: { basePrice: 4, unlockRound: 1, frequency: "multiplicativeScoring" },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "×2",
    symbol: "×2",
    description: "Doubles every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      lineRule({ id: "always", config: {} }, { id: "multiply-line-score", config: { factor: 2 } }),
    ],
  },
  {
    id: "quad-line",
    shop: { basePrice: 9, unlockRound: 2, frequency: "multiplicativeScoring" },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "×4",
    symbol: "×4",
    description: "Quadruples every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      lineRule({ id: "always", config: {} }, { id: "multiply-line-score", config: { factor: 4 } }),
    ],
  },
  {
    id: "gold-standard",
    shop: { basePrice: 5, unlockRound: 6, frequency: "even" },
    categoryTrait: { economyCategory: {} },
    name: "Gold Standard",
    symbol: "$",
    description: "When you win a stage, +1 coin for each gold block still in your hand.",
    traitId: "passive.event-rules",
    eventRules: [
      coinsPerBlock("stage.won", { id: "material-is", config: { material: "gold" } }, 1),
    ],
  },
  {
    // Le Chef (#104, #373): steak on the table at settlement pays 3 coins each instead of 1.
    id: "le-chef",
    shop: { basePrice: 5, unlockRound: 3, frequency: "even" },
    categoryTrait: { economyCategory: {} },
    name: "Le Chef",
    symbol: "♨",
    description:
      "After each stage, each Bloody, Rare or Medium Rare steak on the table pays 3 coins instead of 1.",
    traitId: "passive.event-rules",
    eventRules: [],
    rewardModifiers: [{ id: "field-rate", config: { material: "meat", coinsPerCard: 3 } }],
    // A chef's toque, the hat alone within a passive cube's bounds (#378).
    visual: { builder: "chefToque", config: {} },
  },
  {
    id: "carnivore",
    shop: { basePrice: 3, unlockRound: 4, frequency: "multiplicativeScoring" },
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    name: "Carnivore",
    symbol: "◈",
    description: "Doubles the base value of each meat block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      blockRule(
        { id: "material-is", config: { material: "meat" } },
        { id: "multiply-block-value", config: { factor: 2 } },
      ),
    ],
  },
  {
    id: "woodworker",
    shop: { basePrice: 4, unlockRound: 1, frequency: "additiveScoring" },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Woodworker",
    symbol: "✥",
    description: "Adds 3 to the base value of each wood block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      blockRule(
        { id: "material-is", config: { material: "wood" } },
        { id: "add-block-value", config: { amount: 3 } },
      ),
    ],
  },
  {
    id: "crossroads",
    shop: { basePrice: 2, unlockRound: 1, frequency: "additiveScoring" },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Crossroads",
    symbol: "✳",
    description:
      "Adds 3 points for each block in a scored line that crosses another line. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      lineRule(
        { id: "perpendicular-intersection", config: {} },
        { id: "add-line-score", config: { amount: 3, perIntersection: true } },
      ),
    ],
  },
  {
    id: "long-haul",
    shop: { basePrice: 4, unlockRound: 1, frequency: "additiveScoring" },
    categoryTrait: { scoringCategory: { operations: ["additive"] } },
    name: "Long Haul",
    symbol: "↗",
    description:
      "Subtracts 5 from two-block lines; adds 5 to lines of three or more. Final scores cannot go below zero. Unlimited use.",
    traitId: "passive.event-rules",
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
    shop: { basePrice: 8, unlockRound: 2, frequency: "even" },
    categoryTrait: { economyCategory: {} },
    name: "Scrapper",
    symbol: "⚙",
    description: "Earns 1 coin for each block discarded. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [coinsPerBlock("discard.completed", { id: "always", config: {} }, 1)],
  },
  {
    id: "seeing-red",
    shop: { basePrice: 6, unlockRound: 1, frequency: "even" },
    categoryTrait: { economyCategory: {} },
    name: "Seeing Red",
    symbol: "♥♦",
    description: "Earns 1 coin for each Heart or Diamond discarded. Unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      coinsPerBlock(
        "discard.completed",
        { id: "suit-in", config: { suits: ["hearts", "diamonds"] } },
        1,
      ),
    ],
  },
  {
    id: "ace-exchange",
    shop: { basePrice: 5, unlockRound: 2, frequency: "even" },
    categoryTrait: { effectCategory: {} },
    name: "Ace Exchange",
    symbol: "AA",
    description:
      "Discard at least two Aces together to gain one random passive you do not own. Triggers once per qualifying discard; unlimited use.",
    traitId: "passive.event-rules",
    eventRules: [
      {
        on: "discard.completed",
        select: { id: "event-blocks", config: { where: { id: "rank-is", config: { rank: "A" } } } },
        where: { id: "count-at-least", config: { minimum: 2 } },
        effects: [{ id: "grant-random-unowned-passive", config: {} }],
      },
    ],
  },
  // Dice (#97): scoring passives whose amount is a roll. Each rolls once per scoring
  // resolution, and the same result is added to every scored line after its zero clamp.
  die({ id: "d6", name: "D6", sides: 6, shape: "cube", unlockRound: 1, basePrice: 4, pips: true }),
  die({ id: "d8", name: "D8", sides: 8, shape: "octahedron", unlockRound: 2, basePrice: 5 }),
  die({ id: "d10", name: "D10", sides: 10, shape: "d10", unlockRound: 3, basePrice: 6 }),
  die({ id: "d20", name: "D20", sides: 20, shape: "icosahedron", unlockRound: 4, basePrice: 9 }),
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
      visual: definition().visual,
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
        visual: definition.visual,
      },
      passive: {
        traitId: definition.traitId,
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
    .map((name) => passiveDefinitions.get(name))
    // Only what the passive shop could ever offer: an item stocked by its own dedicated slots
    // (a transmogrifier, #388) is made complete there, never granted as a bare passive.
    .filter(({ shop }) =>
      [shop ?? []]
        .flat()
        .every(({ frequency }) =>
          passiveFrequencies.get(frequency).some(([, weight]) => weight > 0),
        ),
    );
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
