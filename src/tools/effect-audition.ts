/**
 * devEffectAudition (#466): a developer scene trait for the smoke and dust audition mode. It only
 * explains the room: a small note over the table, shown while its scene is on the stack and
 * removed when it leaves. The looks themselves come from the mode's deck (experimental
 * definitions with smoke and dust appearance effects), so the host renders them as it would any
 * card; nothing here names a material or a mode.
 */
import type { SceneTraitBehaviour } from "../scenes";

export type DevEffectAuditionConfig = { hint: string };

export function devEffectAudition<Context extends { host: HTMLElement }>(): SceneTraitBehaviour<
  Context,
  DevEffectAuditionConfig
> {
  let note: HTMLElement | null = null;
  return {
    enter({ host }, { hint }) {
      note?.remove();
      note = document.createElement("p");
      note.className = "dev-effect-audition";
      note.textContent = hint;
      host.append(note);
    },
    exit() {
      note?.remove();
      note = null;
    },
  };
}
