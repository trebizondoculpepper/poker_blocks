/**
 * The debug snapshot's section providers (#987, doc/debug-snapshot.md). Each reads one owner's
 * state through a narrow source and returns plain data; none mutates, draws RNG or ticks a
 * clock. Identities (mode, scene) are reported as opaque handles, never interpreted.
 */
import { blockName } from "../block-presentation";
import type { ActionEntry } from "../action-log";
import type { CardBlock } from "../cards";
import type { GameState } from "../game-state";
import type { DiagnosticRegistry } from "./debug-snapshot";

/** Every section the snapshot always lists; one without a provider reads `unavailable`. */
export const snapshotSections = [
  "build",
  "mode",
  "scenes",
  "model",
  "passives",
  "scheduler",
  "titles",
  "actions",
] as const;

export type SnapshotSources = {
  version: string;
  mode(): string;
  sceneStack(): readonly string[];
  state(): GameState;
  titles(): unknown;
  actions(): { recording: boolean; entries: readonly ActionEntry[] };
};

const card = (block: CardBlock) => ({ id: block.id, name: blockName(block) });

/** Register the providers these sources supply; returns a function that unregisters them all. */
export function registerSnapshotProviders(
  registry: DiagnosticRegistry,
  sources: SnapshotSources,
): () => void {
  const leave = [
    registry.register("build", () => ({ version: sources.version })),
    registry.register("mode", () => ({ handle: sources.mode() })),
    registry.register("scenes", () => ({ stack: [...sources.sceneStack()] })),
    registry.register("model", () => {
      const state = sources.state();
      return {
        coins: state.coins,
        hand: state.hand.map(card),
        deck: state.deck.length,
        discardPile: state.discardPile.length,
        field: state.field.length,
        removedCards: state.removedCards?.length ?? 0,
      };
    }),
    registry.register("passives", () =>
      sources.state().passiveRack.map((passive) => ({
        id: passive.id,
        definition: passive.definitionId,
        traits: structuredClone(passive.traits),
      })),
    ),
    registry.register("titles", () => sources.titles()),
    registry.register("actions", () => {
      const { recording, entries } = sources.actions();
      // Newest last; the bound keeps the most recent if the log is long.
      return { recording, entries: entries.slice(-50) };
    }),
  ];
  return () => leave.forEach((unregister) => unregister());
}
