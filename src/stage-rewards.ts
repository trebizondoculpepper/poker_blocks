import { Registry } from "./core/registry";
/**
 * Stage rewards (issue #12): what a won stage pays, as an itemised ledger. Pure: the
 * session applies the coins once per stage, and the stage-won screen shows the rows.
 */
import { donenessSteps } from "./cooking";
import type { GameState } from "./game-state";
import { passiveActivations } from "./passive-effects";
import { commitCommands } from "./rule-commands";
import type { PassiveBlock, StageContext } from "./passives";
import { passiveDefinitions } from "./passives";
import type { StageKind } from "./run-rules";
import { getMaterialDefinition, materialOf, materialDefinitions } from "./materials";

/** One line of the ledger: where the coins come from, what to call it, how many. */
export type RewardEntry = { source: string; label: string; coins: number };

/** What a stage win pays out: the rows, and the balance before and after. */
export type StageReward = { entries: RewardEntry[]; balanceBefore: number; balance: number };

/** The default completion reward, in coins. */
export const stageCompleteBonus = 4;

/** What each play left unused when a stage is won pays, in coins. */
export const coinsPerUnusedPlay = 1;

/**
 * The ledger for a won stage: the completion bonus first, then a coin for each play left
 * unused, then each passive that pays on a stage win, in the rack's left-to-right order.
 * Material hand rewards come before passives.
 */
export function stageRewardLedger(
  state: GameState,
  bonus = stageCompleteBonus,
  stage?: StageKind,
  /** The won stage's full context (round, ordinal), for rules that filter on it (#664 review). */
  context?: StageContext,
): RewardEntry[] {
  const entries: RewardEntry[] = [
    { source: "stage.complete", label: "Stage complete bonus", coins: bonus },
    ...unusedPlayEntries(state),
    ...materialHandRewardEntries(state),
    ...materialFieldRewardEntries(state),
  ];
  for (const passive of state.passiveRack) {
    const coins = stageWonCoins(state, passive, stage, context);
    if (!coins) continue;
    const name = passiveDefinitions.has(passive.definitionId)
      ? passiveDefinitions.get(passive.definitionId).name
      : passive.definitionId;
    entries.push({ source: `passive.${passive.definitionId}`, label: name, coins });
  }
  return entries;
}

/** A coin for each play the stage was won with to spare; no row when none are left. */
export function unusedPlayEntries(state: GameState): RewardEntry[] {
  const unused = Math.max(0, state.round.movesLeft);
  return unused > 0
    ? [
        {
          source: "stage.unusedPlays",
          label: `Unused plays (${unused})`,
          coins: unused * coinsPerUnusedPlay,
        },
      ]
    : [];
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

/** A settlement rate a reward modifier may change: what kind of reward, for what, and its rate. */
export type RewardRate = { kind: "field"; material: string; rate: number };

/**
 * Settlement reward modifiers, by handler name (#373): each receives a rate and its configured
 * data and returns the new rate. Passives list the ones they bring (`rewardModifiers`); the
 * ledger runs them without knowing what any one does.
 */
export const rewardModifiers = new Registry<(rate: RewardRate, config: unknown) => number>(
  "reward modifier",
);

// Replaces a material's field reward rate with a higher one (Le Chef: steak at 3, not 1).
rewardModifiers.register("field-rate", (rate, raw) => {
  const { material, coinsPerCard } = raw as { material: string; coinsPerCard: number };
  return rate.material === material ? Math.max(rate.rate, coinsPerCard) : rate.rate;
});

/**
 * Rewards configured on materials left on the field at settlement (#373, steak), on wins and
 * losses alike: cards of the material at a qualifying doneness. An installed passive's
 * reward modifiers (registered handlers, configured on the passive) may change the rate.
 */
export function materialFieldRewardEntries(state: GameState): RewardEntry[] {
  return materialDefinitions.flatMap(({ id }) => {
    const reward = getMaterialDefinition(id).fieldReward;
    if (!reward) return [];
    const count = state.field.filter(
      ({ block }) =>
        materialOf(block) === id &&
        reward.doneness.includes(donenessSteps(block).at(block.traits.doneness?.step ?? 0) ?? ""),
    ).length;
    // Installed passives' reward modifiers, each through its registered handler.
    const rate = state.passiveRack
      .flatMap(({ definitionId }) =>
        [passiveDefinitions.has(definitionId) ? passiveDefinitions.get(definitionId) : []].flat(),
      )
      .flatMap((definition) => definition.rewardModifiers ?? [])
      .reduce(
        (current, { id: handler, config }) =>
          rewardModifiers.get(handler)({ kind: "field", material: id, rate: current }, config),
        reward.coinsPerCard,
      );
    return count && rate
      ? [
          {
            source: `material.${id}.field`,
            label: `${reward.label} (${count})`,
            coins: count * rate,
          },
        ]
      : [];
  });
}

/**
 * The coins one passive's `stage.won` rules pay, judged on the hand still held: its fired
 * rules' commands committed to a copy of the state (#170), so the ledger stays pure.
 */
function stageWonCoins(
  state: GameState,
  passive: PassiveBlock,
  stage?: StageKind,
  context?: StageContext,
): number {
  const commands = passiveActivations(passive, {
    type: "stage.won",
    blocks: state.hand,
    stageKind: stage,
    ...(context ? { stage: context } : {}),
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
