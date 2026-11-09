/**
 * When an offer may appear in, and be bought from, a shop (#165). One rule for stocking and for
 * buying, so an early or stale offer can't slip through: a passive is available from its own
 * unlock round, and never before any material its rules name unlocks.
 */
import { materialDefinitions, type MaterialDefinition } from "./materials";
import type { PassiveDefinition } from "./passives";

/** The first round a material's cards can be offered: its first keyframe with weight (#165). */
export function materialUnlockRound(material: MaterialDefinition): number {
  return material.shop?.weights.find(([, weight]) => weight > 0)?.[0] ?? Number.POSITIVE_INFINITY;
}

/** Every material a passive's rules name anywhere in their configuration. */
export function materialsNamedBy(definition: PassiveDefinition): MaterialDefinition[] {
  const named = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      for (const [key, inner] of Object.entries(value)) {
        if (key === "material" && typeof inner === "string") named.add(inner);
        else visit(inner);
      }
  };
  visit(definition.eventRules);
  return (materialDefinitions as readonly MaterialDefinition[]).filter(({ id }) => named.has(id));
}

/**
 * The first round a passive can be offered or bought (#165): its own unlock round, and never
 * before any material its rules name unlocks.
 */
export function passiveUnlockRound(definition: PassiveDefinition): number {
  return Math.max(
    definition.shop?.unlockRound ?? Number.POSITIVE_INFINITY,
    ...materialsNamedBy(definition).map(materialUnlockRound),
  );
}
