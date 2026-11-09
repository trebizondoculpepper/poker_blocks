/**
 * Stage rewards (issue #12): what a won stage pays, as an itemised ledger. Pure: the
 * session applies the coins once per stage, and the stage-won screen shows the rows.
 */
import type { GameState } from "./game-state";
import { stageWonPassiveCoins } from "./passive-effects";
import { passiveDefinitions } from "./passives";
import type { StageKind } from "./run-rules";

/** One line of the ledger: where the coins come from, what to call it, how many. */
export type RewardEntry = { source: string; label: string; coins: number };

/** What a stage win pays out: the rows, and the balance before and after. */
export type StageReward = { entries: RewardEntry[]; balanceBefore: number; balance: number };

/** The default completion reward, in coins. */
export const stageCompleteBonus = 4;

/**
 * The ledger for a won stage: the completion bonus first, then each passive that pays on a
 * stage win, in the rack's left-to-right order. Passives paying nothing are left out.
 */
export function stageRewardLedger(
  state: GameState,
  bonus = stageCompleteBonus,
  stage?: StageKind,
): RewardEntry[] {
  const entries: RewardEntry[] = [
    { source: "stage.complete", label: "Stage complete bonus", coins: bonus },
  ];
  for (const passive of state.passiveRack) {
    const coins = stageWonPassiveCoins(passive, state.hand, stage);
    if (!coins) continue;
    const name = passiveDefinitions.has(passive.definitionId)
      ? passiveDefinitions.get(passive.definitionId).name
      : passive.definitionId;
    entries.push({ source: `passive.${passive.definitionId}`, label: name, coins });
  }
  return entries;
}

export function ledgerTotal(entries: readonly RewardEntry[]): number {
  return entries.reduce((total, { coins }) => total + coins, 0);
}
