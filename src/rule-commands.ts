/**
 * Rule commands (#63 slice 3): what a fired rule asks the game run to do, committed after the
 * rule is evaluated. A rule's effects only collect commands; the handlers registered here are
 * the only code that changes the game, each keyed by its command name. Committing never asks
 * which passive or rule a command came from.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import { Registry } from "./core/registry";
import type { RuleCommand } from "./event-rules";
import type { GameState } from "./game-state";
import type { GameEvent } from "./passives";

/** What a command may change: the state, and the run's own capabilities. */
export type CommandTarget = {
  readonly state: GameState;
  update(state: GameState): void;
  /** Install one random passive the rack doesn't hold; the events it causes. */
  grantUnownedPassive(): readonly GameEvent[];
};

type CommandHandler = (config: unknown, target: CommandTarget) => readonly GameEvent[];

export const ruleCommands = new Registry<CommandHandler>("rule command");

/** Register a command handler, type-checked against its own config. */
export function registerRuleCommand<Config>(
  id: string,
  handler: (config: Config, target: CommandTarget) => readonly GameEvent[],
): void {
  ruleCommands.register(id, handler as CommandHandler);
}

/** Commit commands in order; returns the follow-up events they cause. */
export function commitCommands(
  commands: readonly RuleCommand[],
  target: CommandTarget,
): GameEvent[] {
  return commands.flatMap(({ id, config }) => [...ruleCommands.get(id)(config, target)]);
}

// Each command reports what it committed as an event carrying the sound its configuration names
// (a default when it names none), so presentation plays the outcome instead of inferring it by
// comparing state before and after (#538, "Services and controller traits").
registerRuleCommand<{ amount: number; sound?: SoundEffectId }>(
  "add-coins",
  ({ amount, sound = "passive.coins" }, target) => {
    target.update({ ...target.state, coins: target.state.coins + amount });
    return amount > 0 ? [{ type: "coins.gained", amount, sound }] : [];
  },
);
registerRuleCommand<{ sound?: SoundEffectId } | undefined>(
  "grant-unowned-passive",
  (config, target) =>
    target
      .grantUnownedPassive()
      .map((event) => ({ ...event, sound: config?.sound ?? "passive.granted" })),
);
