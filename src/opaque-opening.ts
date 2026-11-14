/**
 * Opening an opaque container when it is placed (#930, part of #554; doc/opaque-actives.md,
 * "Atomic opening/adoption"; doc/game-events.md, "Resolve opening/replacement").
 *
 * The `opaqueContainer` trait brings its own opening: the generic opening phase (#926) runs this
 * handler for a placed block composing it, never asking what kind of block it is. In one state
 * update the wrapper leaves the run's live ownership and its stored payload takes the same field
 * cell under permanent run ownership (`adoptStoredPayload`, #928). The revealed identity replaces
 * the wrapper in the play's placement order, so before-score, scoring and after-score see it
 * once. It reports `block.opened` with deeply captured wrapper and payload snapshots and the
 * configured opening sound, which committed-event sounds plays once. Opening draws no randomness
 * and places nothing a second time; a refused adoption fails the action, which rolls back whole.
 */
import { adoptStoredPayload } from "./active-adoption";
import type { SoundEffectId } from "./audio/sfx-registry";
import { captured } from "./lifecycle/action";
import { openingHandlers } from "./lifecycle/play-phases";

/** The registered sound every opening reports (doc/sound_design.md; "Every action has a sound"). */
export const openingSound: SoundEffectId = "block.open";

openingHandlers.register("opaqueContainer", (blockId, _config, target) => {
  const adopted = adoptStoredPayload(target.state, blockId);
  if (!adopted.ok) throw new Error(`Cannot open ${blockId}: ${adopted.reason}`);
  target.update(adopted.state);
  return {
    events: [
      {
        type: "block.opened",
        blockId,
        cardIds: captured([blockId, adopted.payload.id]),
        blocks: captured([adopted.wrapper, adopted.payload]),
        sound: openingSound,
      },
    ],
    replacedBy: adopted.payload.id,
  };
});
