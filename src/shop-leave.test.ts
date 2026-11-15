import { describe, expect, it } from "vite-plus/test";
import { leaveShop, type ShopLeaveSteps } from "./shop-leave";

function steps(overrides: Partial<ShopLeaveSteps> & { stock?: number } = {}) {
  const log: string[] = [];
  let release: () => void = () => {};
  const burning = new Promise<void>((resolve) => (release = resolve));
  let current = true;
  const all: ShopLeaveSteps = {
    outgoing: () => overrides.stock ?? 3,
    commit: () => (log.push("commit"), true),
    save: () => void log.push("save"),
    burn: () => (log.push("burn"), burning),
    sound: (id) => void log.push(`sound ${id}`),
    current: () => current,
    ...overrides,
  };
  return { all, log, release, newRun: () => (current = false) };
}

describe("leaving the shop, model first (#880)", () => {
  it("commits and saves before the burn, cues the burn at its start and leave at the end", async () => {
    const s = steps();
    const done = leaveShop(s.all);
    await Promise.resolve();
    // The model has already left, and nothing waits on the burn to commit it.
    expect(s.log).toEqual(["commit", "save", "sound shop.stock.burn", "burn"]);
    s.release();
    expect(await done).toBe(true);
    expect(s.log.at(-1)).toBe("sound shop.leave");
  });

  it("plays no burn cue when nothing was in stock", async () => {
    const s = steps({ stock: 0 });
    s.release();
    await leaveShop(s.all);
    expect(s.log).not.toContain("sound shop.stock.burn");
    expect(s.log).toContain("sound shop.leave");
  });

  it("presents nothing for a refused leave", async () => {
    const s = steps({ commit: () => false });
    expect(await leaveShop(s.all)).toBe(false);
    expect(s.log).toEqual([]);
  });

  it("lets a run started during the burn take over: no leave cue, no navigation", async () => {
    const s = steps();
    const done = leaveShop(s.all);
    await Promise.resolve();
    s.newRun();
    s.release();
    expect(await done).toBe(false);
    expect(s.log).not.toContain("sound shop.leave");
  });
});
