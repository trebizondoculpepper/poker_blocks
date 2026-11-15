import { describe, expect, it } from "vite-plus/test";
import { shopExitResponse } from "./shop-exit-response";

function harness() {
  const log: string[] = [];
  let publish: (facts: readonly { payload: unknown }[]) => void = () => {};
  let release: () => void = () => {};
  const context = {
    services: {
      run: {
        onCommitted(listener: (facts: readonly { payload: unknown }[]) => void) {
          publish = listener;
          return () => void (publish = () => {});
        },
        reducedMotion: false,
      },
      shop: {
        burnUnsold(_reduced: boolean, ids?: readonly string[]) {
          log.push(`burn ${ids?.join(",")}`);
          return new Promise<void>((resolve) => (release = resolve));
        },
      },
      sound: (id: string) => void log.push(`sound ${id}`),
    },
  };
  const config = { burnSound: "shop.stock.burn", leaveSound: "shop.leave" } as const;
  const trait = shopExitResponse<never>();
  trait.enter!(context as never, config);
  return {
    log,
    publish: (f: unknown[]) => publish(f.map((payload) => ({ payload }))),
    release: () => release(),
    trait,
    context,
    config,
  };
}

describe("shopExitResponse (#880)", () => {
  it("burns exactly the receipt's outgoing stock: burn cue at its start, leave cue when done", async () => {
    const h = harness();
    h.publish([
      {
        type: "shop.left",
        outgoingStock: [
          { kind: "card", blockId: "a" },
          { kind: "passive", blockId: "b" },
        ],
      },
    ]);
    expect(h.log).toEqual(["sound shop.stock.burn", "burn a,b"]);
    h.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.log.at(-1)).toBe("sound shop.leave");
  });

  it("plays no burn cue when nothing left, still the leave cue", async () => {
    const h = harness();
    h.publish([{ type: "shop.left", outgoingStock: [] }]);
    expect(h.log).toEqual(["burn "]);
    h.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.log).toContain("sound shop.leave");
  });

  it("presents nothing for other facts, and stops listening on exit", () => {
    const h = harness();
    h.publish([{ type: "coins.gained", amount: 3 }]);
    expect(h.log).toEqual([]);
    h.trait.exit!(h.context as never, h.config);
    h.publish([{ type: "shop.left", outgoingStock: [{ kind: "card", blockId: "a" }] }]);
    expect(h.log).toEqual([]);
  });
});
