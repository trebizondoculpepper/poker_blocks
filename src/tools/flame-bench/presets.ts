/**
 * The Flame Bench's presets (#1025; doc/audition-followups.md, "Flame Bench"): each preview is a
 * registered material whose contents effect is tunable, and its tuning starts from that
 * material's own contents configuration. The material id is the preset's handle, for display and
 * export only. Nothing here knows which materials or effects are offered: the bench's trait
 * configuration lists them.
 */
import type { MaterialDefinition } from "../../materials";
import { tunableEffects, type EffectPreset, type EffectTuning } from "../../visual/tunable-effects";

/** The material's contents as a preset. Throws when it has no tunable contents. */
export function materialPreset(definition: MaterialDefinition): EffectPreset {
  const contents = definition.appearance.contents;
  if (!contents || !tunableEffects.has(contents.effect))
    throw new Error(`"${definition.id}" has no tunable contents to put on the bench`);
  return { handle: definition.id, effect: contents.effect, config: contents.config };
}

/**
 * The material with its contents built from this tuning: a new definition for the real block
 * appearance pipeline. The shared definition is never changed.
 */
export const tunedDefinition = (
  definition: MaterialDefinition,
  tuning: EffectTuning,
): MaterialDefinition => ({
  ...definition,
  appearance: {
    ...definition.appearance,
    contents: { effect: tuning.preset.effect, config: tuning.config() },
  },
});
