/**
 * Which music plays where. Track ids are loop file stems in music/loops/ without the
 * "-loop" suffix (for example "style-noir"). Pure and testable; the player and the game
 * screens ask this module what to play.
 */

export type MusicScene = "title" | "stage" | "boss";

export type MusicPlan = {
  /** One of these, chosen at random, plays on the title screen. */
  title: readonly string[];
  /**
   * Loops kept out of the stage rotation. The Settings screen once had its own track; it now
   * filters whatever is playing (#87, #89), and its old loop stays out of the rotation.
   */
  reserved: readonly string[];
  /** Reserved for boss stages. */
  boss: string;
};

export const defaultMusicPlan: MusicPlan = {
  title: ["blaxploitation-horns", "stripped-sleaze"],
  reserved: ["style-ambient-lounge"],
  boss: "solitaire-boss",
};

/** Tracks a normal stage may use: everything except the boss loop and the reserved loops. */
export function stagePool(all: readonly string[], plan: MusicPlan = defaultMusicPlan): string[] {
  return all.filter((id) => id !== plan.boss && !plan.reserved.includes(id));
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
    case "boss":
      return all.includes(plan.boss) ? plan.boss : null;
    case "stage":
      return pickFrom(stagePool(all, plan));
  }
}
