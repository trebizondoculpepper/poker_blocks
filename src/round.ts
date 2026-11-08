export type Round = {
  score: number;
  targetScore: number;
  movesLeft: number;
  discardsLeft: number;
};

export const initialRound: Round = {
  score: 0,
  targetScore: 100,
  movesLeft: 6,
  discardsLeft: 4,
};

export function recordPlay(round: Round): Round | null {
  return round.movesLeft > 0 ? { ...round, movesLeft: round.movesLeft - 1 } : null;
}

export function recordDiscard(round: Round): Round | null {
  return round.discardsLeft > 0 ? { ...round, discardsLeft: round.discardsLeft - 1 } : null;
}
