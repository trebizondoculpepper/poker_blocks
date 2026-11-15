import { describe, expect, it } from "vite-plus/test";
import { leaveShop } from "./shop-leave";

describe("leaving the shop, model first (#880)", () => {
  it("commits and saves before waiting on the outgoing effect, then navigates", async () => {
    const log: string[] = [];
    let release: () => void = () => {};
    const done = leaveShop({
      commit: () => (log.push("commit"), true),
      save: () => void log.push("save"),
      outgoingDone: () => (
        log.push("wait"),
        new Promise<boolean>((r) => (release = () => r(true)))
      ),
      current: () => true,
    });
    await Promise.resolve();
    expect(log).toEqual(["commit", "save", "wait"]);
    release();
    expect(await done).toBe(true);
  });

  it("does nothing more for a refused leave", async () => {
    const log: string[] = [];
    const navigate = await leaveShop({
      commit: () => false,
      save: () => void log.push("save"),
      outgoingDone: () => (log.push("wait"), Promise.resolve(true)),
      current: () => true,
    });
    expect(navigate).toBe(false);
    expect(log).toEqual([]);
  });

  it("does not navigate once a new run has taken over", async () => {
    expect(
      await leaveShop({
        commit: () => true,
        save: () => {},
        outgoingDone: () => Promise.resolve(true),
        current: () => false,
      }),
    ).toBe(false);
  });

  it("does not navigate when the outgoing effect was cut short (the player quit)", async () => {
    expect(
      await leaveShop({
        commit: () => true,
        save: () => {},
        outgoingDone: () => Promise.resolve(false),
        current: () => true,
      }),
    ).toBe(false);
  });
});
