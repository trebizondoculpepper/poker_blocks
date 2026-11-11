/**
 * What happens to card state when a stage's table clears (#372): a registry of resets keyed by
 * the card trait they reset. `GameRun.clearTable` runs every one, after the stage's rewards are
 * read, and never asks which mechanics need resetting. Cooking registers its doneness reset.
 */
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";

export type StageEndReset = (state: GameState) => GameState;

export const stageEndResets = new Registry<StageEndReset>("stage-end reset");

/** The state with every registered stage-scoped card state reset, in registration order. */
export function resetStageState(state: GameState): GameState {
  return stageEndResets.names().reduce((current, name) => stageEndResets.get(name)(current), state);
}
