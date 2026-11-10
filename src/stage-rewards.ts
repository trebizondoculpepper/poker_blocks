/**
 * Stage rewards (issue #12): what a won stage pays, as an itemised ledger. Pure: the
 * session applies the coins once per stage, and the stage-won screen shows the rows.
 */
import type { GameState } from "./game-state";
import { passiveActivations } from "./passive-effects";
import { commitCommands } from "./rule-commands";
import type { PassiveBlock } from "./passives";
import { passiveDefinitions } from "./passives";
import type { StageKind } from "./run-rules";
import { getMaterialDefinition, materialOf, materialDefinitions } from "./materials";

/** One line of the ledger: where the coins come from, what to call it, how many. */
export type RewardEntry = { source: string; label: string; coins: number };

/** What a stage win pays out: the rows, and the balance before and after. */
export type StageReward = { entries: RewardEntry[]; balanceBefore: number; balance: number };

/** The default completion reward, in coins. */
export const stageCompleteBonus = 4;

/**
 * The ledger for a won stage: the completion bonus first, then each passive that pays on a
 * stage win, in the rack's left-to-right order. Material hand rewards come before passives.
 */
export function stageRewardLedger(
  state: GameState,
  bonus = stageCompleteBonus,
  stage?: StageKind,
): RewardEntry[] {
  const entries: RewardEntry[] = [
    { source: "stage.complete", label: "Stage complete bonus", coins: bonus },
    ...materialHandRewardEntries(state),
  ];
  for (const passive of state.passiveRack) {
    const coins = stageWonCoins(state, passive, stage);
    if (!coins) continue;
    const name = passiveDefinitions.has(passive.definitionId)
      ? passiveDefinitions.get(passive.definitionId).name
      : passive.definitionId;
    entries.push({ source: `passive.${passive.definitionId}`, label: name, coins });
  }
  return entries;
}

/** Rewards configured on materials held at settlement, on wins and losses alike. */
export function materialHandRewardEntries(state: GameState): RewardEntry[] {
  return materialDefinitions.flatMap(({ id, name }) => {
    const rate = getMaterialDefinition(id).handReward?.coinsPerCard ?? 0;
    const count = state.hand.filter((card) => materialOf(card) === id).length;
    return rate && count
      ? [{ source: `material.${id}`, label: `${name} held in hand`, coins: count * rate }]
      : [];
  });
}

/**
 * The coins one passive's `stage.won` rules pay, judged on the hand still held: its fired
 * rules' commands committed to a copy of the state (#170), so the ledger stays pure.
 */
function stageWonCoins(state: GameState, passive: PassiveBlock, stage?: StageKind): number {
  const commands = passiveActivations(passive, {
    type: "stage.won",
    blocks: state.hand,
    stageKind: stage,
  }).flatMap(({ commands }) => commands);
  let preview = state;
  commitCommands(commands, {
    get state() {
      return preview;
    },
    update: (next) => void (preview = next),
    // A stage-won ledger only pays coins; nothing is installed from it.
    grantUnownedPassive: () => [],
  });
  return preview.coins - state.coins;
}

export function ledgerTotal(entries: readonly RewardEntry[]): number {
  return entries.reduce((total, { coins }) => total + coins, 0);
}
