/**
 * Which music plays where. Track ids are loop file stems in music/loops/ without the
 * "-loop" suffix (for example "style-noir"). Pure and testable; the player and the game
 * screens ask this module what to play.
 */

export type MusicScene = "title" | "settings" | "stage" | "boss";

export type MusicPlan = {
  /** One of these, chosen at random, plays on the title screen. */
  title: readonly string[];
  /** Reserved for the settings screen. */
  settings: string;
  /** Reserved for boss stages. */
  boss: string;
};

export const defaultMusicPlan: MusicPlan = {
  title: ["blaxploitation-horns", "stripped-sleaze"],
  settings: "style-ambient-lounge",
  boss: "solitaire-boss",
};

/** Tracks a normal stage may use: everything except the reserved boss and settings loops. */
export function stagePool(all: readonly string[], plan: MusicPlan = defaultMusicPlan): string[] {
  return all.filter((id) => id !== plan.boss && id !== plan.settings);
}

/**
 * Pick the track for a scene. Stages get a random vibe, avoiding an immediate repeat of
 * `previous` when there is any choice.
 */
export function pickTrack(
  scene: MusicScene,
  all: readonly string[],
  random: () => number = Math.random,
  previous: string | null = null,
  plan: MusicPlan = defaultMusicPlan,
): string | null {
  const pickFrom = (ids: readonly string[]): string | null => {
    const available = ids.filter((id) => all.includes(id));
    const fresh = available.length > 1 ? available.filter((id) => id !== previous) : available;
    return fresh.length ? fresh[Math.floor(random() * fresh.length)] : null;
  };
  switch (scene) {
    case "title":
      return pickFrom(plan.title);
    case "settings":
      return all.includes(plan.settings) ? plan.settings : null;
    case "boss":
      return all.includes(plan.boss) ? plan.boss : null;
    case "stage":
      return pickFrom(stagePool(all, plan));
  }
}
