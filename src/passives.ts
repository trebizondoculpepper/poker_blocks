import { Registry } from "./core/registry";
import { inspectable, type InspectableTrait } from "./traits/inspectable";

/** Serializable block data. Behavior lives in the referenced trait definition. */
export type PassiveBlock = {
  id: string;
  definitionId: string;
  traits: { passive: { traitId: string }; inspectable: InspectableTrait };
};

export type GameEvent = { type: string; blockId?: string };

export type PassiveTraitDefinition = {
  id: string;
  listensTo: readonly string[];
  respond?: (block: PassiveBlock, event: Readonly<GameEvent>) => readonly GameEvent[];
};

export type PassiveDefinition = {
  id: string;
  name: string;
  symbol: string;
  traitId: string;
};

export const passiveTraits = new Registry<PassiveTraitDefinition>("passive trait");
export const passiveDefinitions = new Registry<PassiveDefinition>("passive");

passiveTraits.register("passive.do-nothing", {
  id: "passive.do-nothing",
  listensTo: [],
});
passiveDefinitions.register("do-nothing", {
  id: "do-nothing",
  name: "Do Nothing",
  symbol: "∅",
  traitId: "passive.do-nothing",
});

export function createPassiveBlock(definitionId: string, id: string): PassiveBlock {
  const definition = passiveDefinitions.get(definitionId);
  passiveTraits.get(definition.traitId);
  return {
    id,
    definitionId,
    traits: {
      passive: { traitId: definition.traitId },
      inspectable: inspectable(definition.name),
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
      for (const type of trait.listensTo) {
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
  drain(limit = 128): GameEvent[] {
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
      }
    }
    return delivered;
  }
}
