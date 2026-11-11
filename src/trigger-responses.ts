/**
 * Reusable trigger responses (#435, #437): registered rule commands a material can list in its
 * `triggerable.responses` (src/triggers.ts). Neither knows about bombs.
 *
 * - `self-destruct { removal, sound? }`: the triggered block removes itself. How is a registered
 *   removal mode: `field` takes it off the table into the discard pile (it returns with the deck,
 *   like a destroyed block), `run` removes it from the run for good through the shared card
 *   removal service (`removeCardForRun`, src/card-ownership.ts, as the Nothingifier does). It
 *   emits `block.removed` with the trigger and the configured sound for presentation; removal
 *   itself plays nothing, so no explosion sound is wired into removing.
 * - `trigger-targets { select, cause }`: asks other blocks to run *their own* responses, through
 *   the same `trigger-block` command. Who is a registered selector: `face-neighbours`, the blocks
 *   sharing a face with the source. Selection reads the source's cell from the trigger's snapshot,
 *   so it works after the source has removed itself. Targets go in a fixed order (field order);
 *   each carries the chain's shared record on, so a block is never triggered twice in one chain,
 *   by any route, and chains can't loop.
 *
 * Order within one block's responses is the listed order, so `trigger-targets` before
 * `self-destruct` lets neighbours respond while the source is still on the table, and after it
 * they respond once it has gone; either way they see its snapshot.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import { removeCardForRun } from "./card-ownership";
import type { HandlerConfig } from "./event-rules";
import type { GameState } from "./game-state";
import type { GameEvent } from "./passives";
import { faceNeighbours } from "./reactions";
import { commitCommands, registerRuleCommand } from "./rule-commands";
import { cellKey } from "./traits/attachable";
import { blockResists } from "./block-trait-behaviours";
import { addCombinedModifier, combineModifiers } from "./modifier-registers";
import type { SoundEffectId } from "./audio/sfx-registry";
import type { TriggerContext } from "./triggers";

/** How a block leaves when it removes itself; null when it isn't there to remove. */
export const removalModes = new Registry<(state: GameState, blockId: string) => GameState | null>(
  "removal mode",
);
removalModes.register("field", (state, blockId) => {
  const placed = state.field.find(({ block }) => block.id === blockId);
  return placed
    ? {
        ...state,
        field: state.field.filter((each) => each !== placed),
        discardPile: [...state.discardPile, placed.block],
      }
    : null;
});
removalModes.register("run", (state, blockId) => removeCardForRun(state, blockId));

/** Which blocks a trigger passes to, from the source's snapshot and the current state. */
export const triggerTargetSelectors = new Registry<
  (trigger: TriggerContext, state: GameState, config: unknown) => readonly CardBlock[]
>("trigger target selector");
triggerTargetSelectors.register("face-neighbours", ({ source }, state) => {
  if (!source.cell) return [];
  const byCell = new Map(state.field.map(({ block, cell }) => [cellKey(cell), block]));
  const near = new Set(
    faceNeighbours({ block: source.block, cell: source.cell }, byCell).map(({ id }) => id),
  );
  // Field order, so the same table always triggers in the same order.
  return state.field.flatMap(({ block }) => (near.has(block.id) ? [block] : []));
});

registerRuleCommand<{ trigger: TriggerContext; removal: string; sound?: SoundEffectId }>(
  "self-destruct",
  ({ trigger, removal, sound }, target) => {
    const blockId = trigger.source.block.id;
    const next = removalModes.get(removal)(target.state, blockId);
    if (!next) return [];
    target.update(next);
    const event: GameEvent = {
      type: "block.removed",
      blockId,
      trigger,
      ...(sound ? { sound } : {}),
    };
    return [event];
  },
);

registerRuleCommand<{ trigger: TriggerContext; select: HandlerConfig; cause: string }>(
  "trigger-targets",
  ({ trigger, select, cause }, target) =>
    commitCommands(
      triggerTargetSelectors
        .get(select.id)(trigger, target.state, select.config)
        .map((block) => ({
          id: "trigger-block",
          config: { blockId: block.id, cause, path: trigger.path, visited: trigger.visited },
        })),
      target,
    ),
);

/**
 * `destroy-targets { select, cause, removal, sound? }` (#437): the trigger destroys the selected
 * blocks (a bomb's blast), each through the configured removal mode, unless one of its traits
 * resists `cause` (steel and gold resist `explosion`). Every selected block is accounted for:
 * `block.removed` for one destroyed, `block.resisted` for one left standing, with the trigger and
 * cause, for presentation. Selection reads the source's snapshot, as `trigger-targets` does.
 */
registerRuleCommand<{
  trigger: TriggerContext;
  select: HandlerConfig;
  cause: string;
  removal: string;
  sound?: SoundEffectId;
}>("destroy-targets", ({ trigger, select, cause, removal, sound }, target) =>
  triggerTargetSelectors
    .get(select.id)(trigger, target.state, select.config)
    .flatMap((block): GameEvent[] => {
      if (blockResists(block, cause))
        return [{ type: "block.resisted", blockId: block.id, trigger, cause }];
      const next = removalModes.get(removal)(target.state, block.id);
      if (!next) return [];
      target.update(next);
      return [
        { type: "block.removed", blockId: block.id, trigger, cause, ...(sound ? { sound } : {}) },
      ];
    }),
);

/**
 * `transfer-bonuses { select, lifetime, from? }` (#436): the triggered block passes its acquired
 * bonuses on. Only acquired registers move, never its material's own values. They're read from
 * the trigger's snapshot, so a block that has already removed itself still passes on what it had.
 * The registers named in `from` (default: all of them) are combined with the shared rules (sums,
 * products, exponent increases summed above 1) and added once to each selected recipient's
 * `lifetime` register (e.g. `run`, promoting stage and round bonuses), recorded for saves. Who
 * receives is the configured selector: this chooses no reward policy. Emits `bonus.transferred`
 * per recipient that received something.
 */
registerRuleCommand<{
  trigger: TriggerContext;
  select: HandlerConfig;
  lifetime: string;
  from?: readonly string[];
}>("transfer-bonuses", ({ trigger, select, lifetime, from }, target) => {
  const held = trigger.source.block.traits.modifiers ?? {};
  const passed = combineModifiers(
    Object.entries(held).flatMap(([register, modifier]) =>
      !from || from.includes(register) ? [modifier] : [],
    ),
  );
  if (!Object.keys(passed).length) return [];
  return triggerTargetSelectors
    .get(select.id)(trigger, target.state, select.config)
    .flatMap((recipient): GameEvent[] => {
      const next = addCombinedModifier(target.state, recipient.id, lifetime, passed);
      if (!next) return [];
      target.update(next);
      return [{ type: "bonus.transferred", blockId: recipient.id, trigger }];
    });
});
