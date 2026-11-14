/**
 * Could It Be Magic Now? (#988; doc/experiments/could-it-be-magic-now.md): a provisional passive.
 * Each installed copy counts committed plays; every fourth, once the post-score reactions and
 * detonations have drained (`play.afterReactions`, the late rack step), the counter resets and
 * one eligible non-Magic field card, chosen uniformly with the run's seeded stream, turns Magic
 * through the registered material change. With none eligible the conversion fails, the counter
 * still resets and nothing is banked. Artwork and shop availability are out of scope (#989).
 */
import { passiveDefinitions, type PassiveDefinition } from "./passives";
import "./play-counter";

/** The agreed provisional cadence. */
export const magicEvery = 4;

export const couldItBeMagicNow: PassiveDefinition = {
  id: "trial-could-it-be-magic-now",
  // Experimental catalogues only, never normal shops (doc/release-status.md).
  releaseStatus: { provisional: {} },
  lifecycle: { parent: "rackItem" },
  name: "Could It Be Magic Now?",
  symbol: "✦",
  description:
    "Counts your plays. Every fourth play, after reactions, turns one random non-Magic card on the field to Magic. Provisional trial.",
  traitId: "passive.event-rules",
  categoryTrait: { effectCategory: {} },
  instanceState: { playCounter: { count: 0, every: magicEvery } },
  eventRules: [
    {
      on: "play.afterReactions",
      select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
      where: { id: "always", config: {} },
      effects: [
        {
          id: "advance-play-counter",
          config: {
            onReach: [{ id: "convert-random-field-card", config: { material: "magic" } }],
          },
        },
      ],
    },
  ],
};
passiveDefinitions.register(couldItBeMagicNow.id, couldItBeMagicNow);
