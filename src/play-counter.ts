/**
 * A per-instance play counter and the random field conversion it can trigger (#988;
 * doc/passive-lifecycle-state.md, doc/experiments/could-it-be-magic-now.md). Reusable pieces:
 *
 * - `playCounter` is instance state on the installed passive (src/passives.ts), saved through
 *   the rack trait persistence registry, so copies count independently and a save restores the
 *   count without replaying plays.
 * - The `advance-play-counter` effect asks for the `advance-play-counter` command. The command
 *   advances the requesting instance (`CommandTarget.source`); on reaching `every` it resets to
 *   zero and commits its configured `onReach` commands, in order, in the same transaction.
 * - `convert-random-field-card` chooses one field card not already of `material`, uniformly with
 *   the run's seeded random stream, and asks the registered `transform-block` command to change
 *   it. With no eligible card it reports `conversion.failed` and changes nothing.
 *
 * Nothing here names a passive or a material: the definition's configuration supplies both.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import type { RuleCommand, RuleFrame } from "./event-rules";
import type { BlockMaterial } from "./materials";
import { materialOf } from "./materials";
import type { PassiveBlock } from "./passives";
import { rackTraitPersistence } from "./rack-trait-persistence";
import { commitCommands, registerRuleCommand } from "./rule-commands";
import { ruleHandlers } from "./rule-handlers";

export type PlayCounter = { count: number; every: number };

const wholeNumber = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("bad play counter");
  return value as number;
};
rackTraitPersistence.register("playCounter", {
  save: (value) => ({ ...(value as PlayCounter) }),
  restore: (saved) => {
    const { count, every } = (saved ?? {}) as Partial<Record<keyof PlayCounter, unknown>>;
    const restored = { count: wholeNumber(count), every: wholeNumber(every) };
    if (restored.every < 1 || restored.count >= restored.every) throw new Error("bad play counter");
    return restored;
  },
});

export type AdvanceCounterConfig = { onReach: readonly RuleCommand[] };

ruleHandlers.registerEffect<AdvanceCounterConfig, unknown>(
  "advance-play-counter",
  (config, _selected, frame): RuleFrame => ({
    ...frame,
    commands: [...frame.commands, { id: "advance-play-counter", config }],
  }),
);

registerRuleCommand<AdvanceCounterConfig>("advance-play-counter", (config, target) => {
  const source = target.source;
  const instance = target.state.passiveRack.find(({ id }) => id === source);
  const counter = instance?.traits.playCounter;
  if (!instance || !counter)
    throw new Error(`advance-play-counter: no counting instance "${source ?? "(none)"}"`);
  const reached = counter.count + 1 >= counter.every;
  const next: PlayCounter = { ...counter, count: reached ? 0 : counter.count + 1 };
  const passiveRack = target.state.passiveRack.map((passive): PassiveBlock =>
    passive.id === source
      ? { ...passive, traits: { ...passive.traits, playCounter: next } }
      : passive,
  );
  target.update({ ...target.state, passiveRack });
  return [
    // The count it now shows; reaching `every` reports the reset instead.
    {
      type: reached ? "passive.counterReset" : "passive.counterAdvanced",
      blockId: source,
      amount: next.count,
    },
    ...(reached ? commitCommands(config.onReach, target) : []),
  ];
});

export type ConvertRandomConfig = { material: BlockMaterial; sound?: SoundEffectId };

registerRuleCommand<ConvertRandomConfig>("convert-random-field-card", (config, target) => {
  if (!target.random) throw new Error("convert-random-field-card: no model random stream");
  // Placement order: the field's stable ownership order, never render order.
  const eligible = target.state.field
    .map(({ block }) => block)
    .filter((block) => materialOf(block) !== config.material);
  if (!eligible.length) return [{ type: "conversion.failed", blockId: target.source, amount: 0 }];
  const chosen = eligible[Math.floor(target.random() * eligible.length)]!;
  const events = commitCommands(
    [
      {
        id: "transform-block",
        config: {
          blockId: chosen.id,
          material: config.material,
          ...(config.sound ? { sound: config.sound } : {}),
        },
      },
    ],
    target,
  );
  return [
    {
      type: "conversion.applied",
      blockId: target.source,
      cardIds: [chosen.id],
      amount: eligible.length,
    },
    ...events,
  ];
});
