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
        // Identities per zone, so a duplicated, lost or left-over card shows (bounded by the
        // snapshot's item limit, which reports any cut).
        hand: state.hand.map(card),
        deck: state.deck.map(({ id }) => id),
        discardPile: state.discardPile.map(({ id }) => id),
        field: state.field.map(({ block, cell }) => ({ ...card(block), cell: { ...cell } })),
        removedCards: [...(state.removedCards ?? [])],
      };
    }),
    registry.register("passives", () =>
      sources.state().passiveRack.map((passive) => ({
        id: passive.id,
        definition: passive.definitionId,
        // The bounded serializer replaces callbacks (an inspector's `inspect`) with a marker.
        traits: passive.traits,
      })),
    ),
    registry.register("titles", () => sources.titles()),
    registry.register("actions", () => {
      const { recording, entries } = sources.actions();
      // Newest first: the bounded serializer keeps the most recent and reports how many it cut.
      return { recording, newestFirst: [...entries].reverse() };
    }),
  ];
  return () => leave.forEach((unregister) => unregister());
}
