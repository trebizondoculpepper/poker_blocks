import { describe, expect, it } from "vite-plus/test";
import { createVisualScheduler } from "../visual-events/scheduler";
import { shopExitResponse } from "./shop-leave-response";

/** A burn that finishes after `frames` updates, or when cancelled. */
function harness(frames = 3) {
  const log: string[] = [];
  let left = frames;
  const shopBurn = {
    effect: () => ({
      update: () => (--left <= 0 ? ("finished" as const) : ("running" as const)),
      cancel: () => void log.push("burn cancelled"),
      dispose: () => {},
    }),
  };
  const visualEvents = createVisualScheduler({ services: { shopBurn } });
  let publish: (facts: readonly { payload: unknown }[]) => void = () => {};
  const context = {
    services: {
      run: {
        onCommitted(listener: (facts: readonly { payload: unknown }[]) => void) {
          publish = listener;
          return () => void (publish = () => {});
        },
        reducedMotion: false,
      },
      shop: { startBurn: () => void log.push("burn started") },
      visualEvents,
      sound: (id: string) => void log.push(`sound ${id}`),
    },
  };
  const config = { burnSound: "shop.stock.burn", leaveSound: "shop.leave" } as const;
  const trait = shopExitResponse<never>();
  trait.enter!(context as never, config);
  let now = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) visualEvents.update((now += 16), true);
  };
  return {
    log,
    run,
    leave: (outgoing: string[]) =>
      publish([
        {
          payload: {
            type: "shop.left",
            outgoingStock: outgoing.map((blockId) => ({ kind: "card", blockId })),
          },
        },
      ]),
    exit: () => trait.exit!(context as never, config),
  };
}

describe("shopExitResponse on the shared scheduler (#880)", () => {
  it("starts the burn at once, cues it, and cues the leave when the scheduled burn finishes", () => {
    const h = harness();
    h.leave(["a", "b"]);
    expect(h.log).toEqual(["burn started", "sound shop.stock.burn"]);
    h.run(10);
    expect(h.log.at(-1)).toBe("sound shop.leave");
    expect(h.log.filter((line) => line === "sound shop.leave")).toHaveLength(1);
  });

  it("plays no burn cue when nothing left, still the leave cue", () => {
    const h = harness(1);
    h.leave([]);
    h.run(5);
    expect(h.log).not.toContain("sound shop.stock.burn");
    expect(h.log).toContain("sound shop.leave");
  });

  it("cancels the burn on exit, and plays no stale leave cue", () => {
    const h = harness(100);
    h.leave(["a"]);
    h.run(2);
    h.exit();
    h.run(200);
    expect(h.log).toContain("burn cancelled");
    expect(h.log).not.toContain("sound shop.leave");
  });

  it("presents nothing for other facts", () => {
    const h = harness();
    h.run(1);
    expect(h.log).toEqual([]);
  });
});
