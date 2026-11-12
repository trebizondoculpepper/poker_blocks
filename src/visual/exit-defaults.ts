/**
 * Default exit recipes supplied by a look's composition (#638; doc/game-architecture.md, "Default
 * destruction of contained blocks"). An appearance assembly may register the exit its blocks use
 * when their definition gives none; an explicit `appearance.exit` always wins. Whoever plays a
 * block's exit asks `resolvedExit` and hands the result to the generic exit runner, which never
 * learns where the recipe came from. A presentation default only: it plays after an authoritative
 * destruction, never because a block left the scene.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import type { ExitSequence } from "./exit-presentation";

type Appearance = MaterialDefinition["appearance"];

/** Default exits, keyed by the appearance assembly that composes them. */
export const appearanceExitDefaults = new Registry<(appearance: Appearance) => ExitSequence>(
  "appearance exit default",
);

/** The exit a look plays: its own recipe, else its composition's default, else none. */
export function resolvedExit(appearance: Appearance): ExitSequence | undefined {
  if (appearance.exit) return appearance.exit;
  return appearanceExitDefaults.has(appearance.assembly)
    ? appearanceExitDefaults.get(appearance.assembly)(appearance)
    : undefined;
}

/**
 * The shared container breakup (#438): the shell cracks, then falls to shards that scatter and
 * fade while the contents fade away, overlapping. Contents never inspect what shell they were in.
 */
export const containerBreak = (shell: { colour: number; opacity: number }): ExitSequence => ({
  steps: [
    { effects: [{ effect: "crack", target: "shell", config: { seconds: 0.2, colour: 0x1a1a1a } }] },
    {
      effects: [
        {
          effect: "fracture",
          target: "shell",
          config: {
            pieces: "shards",
            colour: shell.colour,
            opacity: shell.opacity,
            speed: [0.6, 1.5],
            life: 0.9,
            fade: 0.4,
          },
        },
        { effect: "fade", target: "contents", config: { seconds: 0.8 } },
      ],
    },
  ],
});

// A contained block's default (#632): its own shell breaks up, in its edge colour, as its contents
// fade. Registered by the composition's name, as its assembly is.
appearanceExitDefaults.register("contained", (appearance) =>
  containerBreak({
    colour: appearance.edge.color,
    opacity: Math.max(0.35, appearance.edge.opacity),
  }),
);
