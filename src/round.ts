import type { StageScoreHistory } from "./stage-score-history";

export type Round = {
  score: number;
  targetScore: number;
  movesLeft: number;
  discardsLeft: number;
  /**
   * The stage's committed score history (#1063), set when GameRun starts a stage. Absent in
   * states built outside a run and in saves that could not resolve it.
   */
  history?: StageScoreHistory;
};
