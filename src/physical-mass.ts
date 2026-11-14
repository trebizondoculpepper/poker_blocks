/**
 * Authored physical mass (#816; doc/playfield-rocking.md, "Data, mass query and geometry"). Every
 * block definition declares its own `mass` recipe: physical components (density in kg/m³ and a
 * volume as a fraction of the nominal block, V = 0.001 m³, a 0.1 m cube edge) or an explicit
 * effective mass with its rationale. The shared component presets below are definition
 * configuration, combined on each definition; nothing here is keyed by material.
 *
 * Mass is presentation calibration, not a measurement: it changes no scoring, reaction or rule.
 * Mesh detail, zoom, pulse scale and shader density never change it. The queries are pure and
 * take an explicit scope: a Present's hidden payload is never counted, only its wrapper.
 */

/** The nominal block volume, m³: a 0.1 m cube edge. */
export const nominalVolume = 0.001;

/** One physical component: what it is, its density (kg/m³) and its share of the nominal volume. */
export type MassComponent = { name: string; density: number; volume: number };

export type PhysicalMass =
  | { components: readonly MassComponent[] }
  | { effective: number; rationale: string };

/** A solid block of one substance, filling the whole nominal volume. */
export const solid = (name: string, density: number): MassComponent[] => [
  { name, density, volume: 1 },
];

// Shared component recipes (fractions of V), independently authored from any visual inset.
export const paperShell: MassComponent[] = [{ name: "paper shell", density: 800, volume: 0.02 }];
export const plasticShell: MassComponent[] = [
  { name: "plastic shell", density: 1200, volume: 0.04 },
];
export const stainedLantern: MassComponent[] = [
  { name: "lantern glass", density: 2500, volume: 0.06 },
  { name: "lantern frame (iron proxy)", density: 7850, volume: 0.04 },
];
export const framedGlass: MassComponent[] = [
  { name: "iron frame (proxy)", density: 7850, volume: 0.08 },
  { name: "frame glass", density: 2500, volume: 0.02 },
];
export const waterFill: MassComponent[] = [{ name: "water", density: 1000, volume: 0.55 }];
export const custardFill: MassComponent[] = [{ name: "custard", density: 1050, volume: 0.55 }];
export const soilFill: MassComponent[] = [{ name: "soil", density: 1500, volume: 0.55 }];
export const darkOilFill: MassComponent[] = [
  { name: "dark oily fluid", density: 900, volume: 0.55 },
];
export const gelatoScoops: MassComponent[] = [
  { name: "gelato scoops", density: 700, volume: 0.05 },
];
export const cloudFill: MassComponent[] = [
  { name: "cloud (air/droplets)", density: 1.2, volume: 0.55 },
];
export const flameFill: MassComponent[] = [{ name: "flame (hot gas)", density: 0.3, volume: 0.55 }];
/** An authored fictional density: not a real substance. */
export const magicStarsFill: MassComponent[] = [{ name: "magic stars", density: 50, volume: 0.55 }];
export const giftWrapping: MassComponent[] = [
  { name: "cardboard", density: 700, volume: 0.06 },
  { name: "paper/foil wrap", density: 800, volume: 0.02 },
  { name: "ribbon", density: 1100, volume: 0.005 },
];
export const airFanHousing: MassComponent[] = [
  { name: "fan housing (plastic)", density: 1200, volume: 0.06 },
  { name: "rotor and hardware", density: 7850, volume: 0.01 },
  { name: "air", density: 1.2, volume: 0.8 },
];

/** A recipe from components (shell, then fill). */
export const massOf = (...parts: readonly MassComponent[][]): PhysicalMass => ({
  components: parts.flat(),
});

/** The recipe's mass, kg. */
export function massKg(mass: PhysicalMass): number {
  return "effective" in mass
    ? mass.effective
    : mass.components.reduce(
        (sum, { density, volume }) => sum + density * volume * nominalVolume,
        0,
      );
}

/** Everything wrong with a definition's recipe: a missing, empty or non-positive one. */
export function validatePhysicalMass(owner: string, mass: PhysicalMass | undefined): string[] {
  if (!mass) return [`${owner}: no physical mass recipe`];
  if ("effective" in mass)
    return mass.effective > 0 && Number.isFinite(mass.effective) && mass.rationale
      ? []
      : [`${owner}: an effective mass needs a positive value and a rationale`];
  if (!mass.components.length) return [`${owner}: a mass recipe needs at least one component`];
  return mass.components.flatMap(({ name, density, volume }) =>
    density > 0 && volume > 0 && Number.isFinite(density * volume)
      ? []
      : [`${owner}: component "${name}" needs a positive density and volume`],
  );
}

/** Total mass (kg) and count of a scope of blocks, given each one's recipe. */
export type MassAggregate = { totalKg: number; count: number; meanKg: number | null };

/**
 * Total, count and mean mass over an explicit scope (the field's placed blocks, or a scored
 * subset). An empty scope has no mean: `meanKg` is null, never zero.
 */
export function aggregateMass<T>(
  scope: readonly T[],
  recipeOf: (item: T) => PhysicalMass,
): MassAggregate {
  const totalKg = scope.reduce((sum, item) => sum + massKg(recipeOf(item)), 0);
  return { totalKg, count: scope.length, meanKg: scope.length ? totalKg / scope.length : null };
}
