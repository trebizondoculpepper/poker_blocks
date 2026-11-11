/**
 * What happens to card state when a round ends (#383): a registry of resets, like the stage-end
 * one (src/stage-end.ts) but run once per round, as the round's last shop is left. The run never
 * asks which mechanics need resetting. Gelato reverting to custard is the first (a material's
 * `roundEndMaterial`, applied to every card of it).
 */
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";

export type RoundEndReset = (state: GameState) => GameState;

export const roundEndResets = new Registry<RoundEndReset>("round-end reset");

/** The state with every registered round-scoped card state reset, in registration order. */
export function resetRoundState(state: GameState): GameState {
  return roundEndResets.names().reduce((current, name) => roundEndResets.get(name)(current), state);
}
