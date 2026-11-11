import { describe, expect, it, vi } from "vite-plus/test";
import type { SoundEffect } from "./sfx-registry";
import { playRepeated, readinessOf } from "./sfx-readiness";
import "./synth";

const base: SoundEffect = { id: "x.y", name: "X", family: "x", description: "A sound" };

describe("sound readiness for the listening room (#522)", () => {
  it("classifies samples as before: own, stand-in or silent", () => {
    expect(readinessOf(base, { own: 2, placeholder: 0 }).status).toBe("own");
    expect(
      readinessOf({ ...base, placeholder: "ui.click" }, { own: 0, placeholder: 1 }).status,
    ).toBe("stand-in");
    expect(readinessOf(base, { own: 0, placeholder: 0 }).status).toBe("silent");
    expect(readinessOf(base, { own: 1, placeholder: 0 }).repeatable).toBe(false);
  });

  it("never calls a synthesised sound with a valid recipe missing, MP3 or not", () => {
    const pop: SoundEffect = { ...base, source: { provider: "synth", config: { recipe: "pop" } } };
    const ready = readinessOf(pop, { own: 0, placeholder: 0 });
    expect(ready).toEqual({ status: "own", source: "synthesised (pop)", repeatable: true });
  });

  it("falls back for a synthesised sound whose recipe isn't registered", () => {
    const broken: SoundEffect = {
      ...base,
      placeholder: "ui.click",
      source: { provider: "synth", config: { recipe: "nope" } },
    };
    expect(readinessOf(broken, { own: 0, placeholder: 1 }).status).toBe("stand-in");
    expect(
      readinessOf({ ...broken, placeholder: undefined }, { own: 0, placeholder: 0 }).status,
    ).toBe("silent");
  });

  it("rapid audition plays its count, spaced, and cancelling clears every pending play", () => {
    vi.useFakeTimers();
    const play = vi.fn();
    const timers = {
      set: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number,
      clear: (id: number) => clearTimeout(id),
    };
    const cancel = playRepeated(5, 0.1, play, timers);
    vi.advanceTimersByTime(250);
    expect(play).toHaveBeenCalledTimes(3);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(play).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
