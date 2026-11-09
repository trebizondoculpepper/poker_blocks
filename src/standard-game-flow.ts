/**
 * The shared default game flow: which scene each run position puts in front. Modes can supply a
 * different graph without changing the runner. Its own module, with only type imports, so the
 * save format can read it without importing the mode catalogue (which imports the save key).
 */
import type { GameFlow } from "./game-flow";
import type { SceneName } from "./game-modes";
import type { RunFlowOutcome } from "./game-run";

export const standardGameFlow: GameFlow<RunFlowOutcome, SceneName> = {
  "run.position.stage-1": { operation: "replace", scene: "stage-1" },
  "run.position.stage-2": { operation: "replace", scene: "stage-2" },
  "run.position.boss": { operation: "replace", scene: "boss" },
  "run.position.shop": { operation: "replace", scene: "shop" },
  "run.position.over": { operation: "replace", scene: "game-over" },
  // A won stage's rewards are shown over it; Visit shop then moves the run on (#91).
  "run.stage.won": { operation: "push", scene: "stage-won" },
};
