import { Registry } from "./core/registry";
/**
 * Stage rewards (issue #12): what a won stage pays, as an itemised ledger. Pure: the
 * session applies the coins once per stage, and the stage-won screen shows the rows.
 */
import { donenessSteps } from "./cooking";
import type { GameState } from "./game-state";
import { passiveActivations } from "./passive-effects";
import type { RuleCommand } from "./event-rules";
import { commitCommands, ruleCommands } from "./rule-commands";
import type { GameEvent, PassiveBlock, StageContext } from "./passives";
import { passiveDefinitions } from "./passives";
import type { StageKind } from "./run-rules";
import { getMaterialDefinition, materialOf, materialDefinitions } from "./materials";

/**
 * What one ledger row does, as a registered effect and its configuration (#729; doc/presents.md,
 * "Mixed reward ledger and sound"). Coins are the first effect; an object grant is another (#730).
 */
export type RewardEffect = { id: string; config: unknown };

/**
 * One line of the ledger: where it comes from, what to call it, its typed effects, and the
 * registered presentation that formats it and plays its cue. A non-cash row is never a
 * zero-coin row: it has no coin effect at all.
 */
export type RewardEntry = {
  source: string;
  label: string;
  effects: readonly RewardEffect[];
  presentation: string;
};

/**
 * A registered reward effect: how many coins it adds to the financial total (zero for a
 * non-cash effect), and how a saved configuration is validated (throwing when it is malformed,
 * so a bad receipt can never authorise a second payout).
 */
export type RewardEffectHandler = {
  coins(config: unknown): number;
  validate(config: unknown): unknown;
  /**
   * The commands this effect commits when the stage is settled (#730), through the shared
   * command path and inside the settlement's transaction. None for a coin effect.
   */
  commands?(config: unknown): readonly RuleCommand[];
  /** The finalized configuration the receipt keeps, given the events its commands caused. */
  receipt?(config: unknown, events: readonly GameEvent[]): unknown;
};

export const rewardEffects = new Registry<RewardEffectHandler>("reward effect");

rewardEffects.register("coins", {
  coins: (config) => (config as { amount: number }).amount,
  validate(config) {
    const amount = (config as { amount?: unknown } | null)?.amount;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
      throw new Error("bad coin reward");
    return { amount };
  },
});

/**
 * An object grant (#730; doc/presents.md, "Mixed reward ledger and sound"): it commits the
 * registered command its configuration names, and its receipt records the IDs of the objects that
 * command reported. It adds no coins. The receipt is the proof of the grant: settling again,
 * Continue or reopening the ledger never runs the command again, wherever the object has moved.
 */
type GrantConfig = { command: RuleCommand; granted?: readonly string[] };
const isText = (value: unknown): value is string => typeof value === "string";
rewardEffects.register("grant", {
  coins: () => 0,
  commands: (config) => [(config as GrantConfig).command],
  receipt: (config, events) => {
    const granted = events.flatMap(({ blockId }) => (blockId ? [blockId] : []));
    // A grant that produced nothing (a full rack, say) is a failure, never a paid receipt: the
    // settlement rolls back and the stage stays eligible to settle again (#740 review).
    if (!granted.length) throw new Error("the grant produced no object");
    return { ...(config as GrantConfig), granted };
  },
  validate(config) {
    const { command, granted } = (config ?? {}) as Partial<GrantConfig>;
    if (!command || !isText(command.id) || !ruleCommands.has(command.id))
      throw new Error("bad grant reward");
    // Saved effects are receipts: a grant's must record what it granted (#740 review). The IDs
    // stay valid wherever those objects have since moved.
    if (
      !Array.isArray(granted) ||
      !granted.length ||
      granted.some((id) => typeof id !== "string" || !id)
    )
      throw new Error("bad grant receipt");
    return { command: { id: command.id, config: command.config }, granted: [...granted] };
  },
});

/** A coin row: the usual ledger line, presented as coins. */
export function coinEntry(source: string, label: string, coins: number): RewardEntry {
  return {
    source,
    label,
    effects: [{ id: "coins", config: { amount: coins } }],
    presentation: "coins",
  };
}

/** The coins one row adds to the balance: the sum its effects declare. */
export function entryCoins(entry: RewardEntry): number {
  return entry.effects.reduce(
    (total, { id, config }) => total + rewardEffects.get(id).coins(config),
    0,
  );
}

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
    coinEntry("stage.complete", "Stage complete bonus", bonus),
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
    entries.push(coinEntry(`passive.${passive.definitionId}`, name, coins));
  }
  return entries;
}

/** A coin for each play the stage was won with to spare; no row when none are left. */
export function unusedPlayEntries(state: GameState): RewardEntry[] {
  const unused = Math.max(0, state.round.movesLeft);
  return unused > 0
    ? [coinEntry("stage.unusedPlays", `Unused plays (${unused})`, unused * coinsPerUnusedPlay)]
    : [];
}

/** Rewards configured on materials held at settlement, on wins and losses alike. */
export function materialHandRewardEntries(state: GameState): RewardEntry[] {
  return materialDefinitions.flatMap(({ id, name }) => {
    const rate = getMaterialDefinition(id).handReward?.coinsPerCard ?? 0;
    const count = state.hand.filter((card) => materialOf(card) === id).length;
    return rate && count ? [coinEntry(`material.${id}`, `${name} held in hand`, count * rate)] : [];
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
      ? [coinEntry(`material.${id}.field`, `${reward.label} (${count})`, count * rate)]
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
  // Only what effects declare as coins: a non-cash row adds nothing and is still a row.
  return entries.reduce((total, entry) => total + entryCoins(entry), 0);
}
