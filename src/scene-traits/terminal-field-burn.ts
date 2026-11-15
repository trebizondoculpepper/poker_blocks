/**
 * terminalFieldBurn (#946; doc/loss-field-burn.md, doc/outcome-presentation.md): the loss
 * presentation that burns the terminal playfield before Game Over. A configured presentation
 * controller trait: its configuration names, per decided outcome, the response it presents (as
 * `outcomeCues` does); an outcome without one presents nothing here.
 *
 * - **Held, then burnt.** When an outcome with a response is decided it holds the result screen
 *   at once, waits for the deciding action's required presentation to settle (scoring, material
 *   and graph narration, never hidden to reach the burn sooner), then starts the burn and sends
 *   its configured music operations (the wind-down) at the burn's start.
 * - **Gate.** The result screen is released when the burn's gate settles: ceil(80%) of the burns
 *   finished (or failed, or cancelled; it never stays held). The rest burn on behind it.
 * - **Once.** Each decided occurrence is presented at most once.
 * - **Lifecycle.** Leaving the scene stops listening; the burn itself is run-scoped (its service
 *   resets with the table), so the result screen covering this scene doesn't end it.
 *
 * It decides nothing: the model already decided the outcome, and this changes no state.
 */
import type { MusicOperation } from "../audio/music-controller";
import type { PlacementPhase } from "../placement-phase";
import type { SceneTraitBehaviour } from "../scenes";
import type { TerminalBurnConfig } from "../visual/terminal-field-burn";
import type { TerminalBurnHandle } from "../terminal-burn-service";

/** One outcome's response: the burn's tuning and the music operations sent as it starts. */
export type TerminalFieldBurnResponse = {
  burn?: Partial<TerminalBurnConfig>;
  music?: readonly MusicOperation[];
};

/** The responses by decided outcome; an outcome left out presents nothing here. */
export type TerminalFieldBurnConfig = Partial<Record<string, TerminalFieldBurnResponse>>;

export type TerminalFieldBurnServices = {
  run: {
    onDecided(listener: (decision: { outcome: string; occurrence: string }) => void): () => void;
    holdResult(): () => void;
  };
  actionPhase: Pick<PlacementPhase, "latest" | "observeAction">;
  terminalBurn: { start(config?: Partial<TerminalBurnConfig>): TerminalBurnHandle };
  audio: { playCue(operations: readonly MusicOperation[]): void };
};

export function terminalFieldBurn<
  Context extends { services: TerminalFieldBurnServices },
>(): SceneTraitBehaviour<Context, TerminalFieldBurnConfig> {
  const stops = new WeakMap<object, () => void>();
  return {
    enter({ services }, config) {
      stops.get(config)?.();
      // Fresh on each entry: a new run (which enters its play scene anew) restarts action IDs, so
      // an earlier run's occurrence must never suppress its loss (#1362 review).
      const presented = new Set<string>();
      const stop = services.run.onDecided(({ outcome, occurrence }) => {
        const response = config[outcome];
        if (!response || presented.has(occurrence)) return;
        presented.add(occurrence);
        // Bounded: only recent occurrences can be redelivered.
        if (presented.size > 64) presented.delete(presented.values().next().value!);
        const release = services.run.holdResult();
        let begun = false;
        const begin = () => {
          if (begun) return;
          begun = true;
          services.audio.playCue(response.music ?? []);
          services.terminalBurn.start(response.burn).onGate(() => release());
        };
        // After the deciding action's required presentation; at once if it has no record.
        const key = services.actionPhase.latest;
        const observing = key ? services.actionPhase.observeAction(key, begin) : null;
        if (!observing) begin();
      });
      stops.set(config, stop);
    },
    exit(_context, config) {
      stops.get(config)?.();
      stops.delete(config);
    },
  };
}
