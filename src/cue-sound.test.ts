import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const played: string[] = [];
vi.mock("./audio/sfx", () => ({ playSfx: (id: string) => played.push(id) }));

const { createCueSound } = await import("./cue-sound");
const { createVisualScheduler, unitMs } = await import("./visual-events/scheduler");

function harness() {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const sound = createCueSound(scheduler, { sound: "round.picture_smash", delayUnits: 3 });
  return { sound, step };
}

describe("a cue's configured sound (#1080)", () => {
  beforeEach(() => void played.splice(0));

  it("plays once, 3 units after the cue", () => {
    const { sound, step } = harness();
    sound.hear();
    step(3 * unitMs - 20);
    expect(played).toEqual([]);
    step(40);
    expect(played).toEqual(["round.picture_smash"]);
    step(1000);
    expect(played).toEqual(["round.picture_smash"]);
  });

  it("is cancelled by leaving before it plays, and ignores a cue after", () => {
    const { sound, step } = harness();
    sound.hear();
    step(unitMs);
    sound.dispose();
    sound.hear();
    step(1000);
    expect(played).toEqual([]);
  });
});
