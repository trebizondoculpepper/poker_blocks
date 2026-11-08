import { Registry } from "./core/registry";
import { inspectable, type InspectableTrait } from "./traits/inspectable";

/** Serializable block data. Behavior lives in the referenced trait definition. */
export type PassiveRule = {
  on: "score.beforeBlockValue" | "score.beforeLineFinalized" | "discard.completed";
  condition?:
    | { kind: "material"; value: "meat" | "wood" }
    | { kind: "suit"; values: readonly ("hearts" | "diamonds")[] }
    | { kind: "line-length"; minimum?: number; maximum?: number }
    | { kind: "intersection" }
    | { kind: "rank-count"; rank: "A"; minimum: number };
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
  traits: {
    rackResident?: { zone: "passive-rack" };
    appearance?: { symbol: string; palette: PassiveDefinition["palette"] };
    passive: { traitId: string; rules?: readonly PassiveRule[] };
    inspectable: InspectableTrait;
  };
};

export type GameEvent = { type: string; blockId?: string; cardIds?: readonly string[] };

export type PassiveTraitDefinition = {
  id: string;
  listensTo: readonly string[];
  respond?: (block: PassiveBlock, event: Readonly<GameEvent>) => readonly GameEvent[];
};

export type PassiveDefinition = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  traitId: string;
  palette: { face: string; ink: string; edge: string };
  rules: readonly PassiveRule[];
};

export const passiveTraits = new Registry<PassiveTraitDefinition>("passive trait");
export const passiveDefinitions = new Registry<PassiveDefinition>("passive");

passiveTraits.register("passive.event-rules", {
  id: "passive.event-rules",
  listensTo: [],
});

const palette = (face: string, ink: string, edge: string) => ({ face, ink, edge });
const definitions: PassiveDefinition[] = [
  {
    id: "do-nothing",
    name: "Do Nothing",
    symbol: "∅",
    description: "Has no effect. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#f4f0e8", "#28313a", "#4c5158"),
    rules: [],
  },
  {
    id: "double-line",
    name: "×2",
    symbol: "×2",
    description: "Doubles every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#172b50", "#e4e9f1", "#9baec9"),
    rules: [{ on: "score.beforeLineFinalized", effect: { kind: "multiply-line", factor: 2 } }],
  },
  {
    id: "quad-line",
    name: "×4",
    symbol: "×4",
    description: "Quadruples every scored line. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#34205c", "#f4d87f", "#b892e6"),
    rules: [{ on: "score.beforeLineFinalized", effect: { kind: "multiply-line", factor: 4 } }],
  },
  {
    id: "carnivore",
    name: "Carnivore",
    symbol: "◈",
    description: "Doubles the base value of each meat block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#65242a", "#ffe8dc", "#ac6260"),
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
    name: "Woodworker",
    symbol: "✥",
    description: "Adds 3 to the base value of each wood block in a scored line. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#ac7440", "#37231b", "#e0b879"),
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
    name: "Crossroads",
    symbol: "✳",
    description:
      "Adds 3 points for each block in a scored line that crosses another line. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#354951", "#e9f3f2", "#8ba8ae"),
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
    name: "Long Haul",
    symbol: "↗",
    description:
      "Subtracts 5 from two-block lines; adds 5 to lines of three or more. Final scores cannot go below zero. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#292b2d", "#f1e8d4", "#b7aa94"),
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
    name: "Scrapper",
    symbol: "⚙",
    description: "Earns 1 coin for each block discarded. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#5c6267", "#f4cd70", "#b4a28b"),
    rules: [{ on: "discard.completed", effect: { kind: "add-coins", amount: 1, perMatch: true } }],
  },
  {
    id: "seeing-red",
    name: "Seeing Red",
    symbol: "♥♦",
    description: "Earns 1 coin for each Heart or Diamond discarded. Unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#eee2d0", "#b8293b", "#d17a7c"),
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
    name: "Ace Exchange",
    symbol: "AA",
    description:
      "Discard at least two Aces together to gain one random passive you do not own. Triggers once per qualifying discard; unlimited use.",
    traitId: "passive.event-rules",
    palette: palette("#5a397b", "#f0dafa", "#b88cd3"),
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

export function createPassiveBlock(definitionId: string, id: string): PassiveBlock {
  const definition = passiveDefinitions.get(definitionId);
  passiveTraits.get(definition.traitId);
  return {
    id,
    definitionId,
    traits: {
      rackResident: { zone: "passive-rack" },
      appearance: { symbol: definition.symbol, palette: definition.palette },
      passive: { traitId: definition.traitId, rules: definition.rules },
      inspectable: inspectable(`${definition.name} — ${definition.description}`),
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
    .filter((name) => !excluded.includes(name))
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
