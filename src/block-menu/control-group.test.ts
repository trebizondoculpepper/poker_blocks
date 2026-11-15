import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = { style: {}, remove: () => {} };
      setSize() {}
      setPixelRatio() {}
      render() {}
      dispose() {}
    },
  };
});
vi.mock("../visual/attract-look", () => ({ sparkleEnvironment: () => ({ dispose() {} }) }));
const added: string[] = [];
const hidden: [string, boolean][] = [];
let resumed = 0;
let covered = 0;
vi.mock("./control-stage", () => ({
  createControlStage: () =>
    Promise.resolve({
      add: (definition: { id: string }) => (added.push(definition.id), Promise.resolve()),
      remove: (id: string) => void added.splice(added.indexOf(id), 1),
      setHidden: (id: string, value: boolean) => void hidden.push([id, value]),
      hitRegion: () => ({ left: 1, top: 2, width: 3, height: 4 }),
      setReducedMotion: () => {},
      resume: () => void resumed++,
      cover: () => void covered++,
      dispose: () => {},
    }),
}));

describe("one shared control group for the shop's controls (#1078)", () => {
  it("draws Buy and Sell on one stage, running only while some control is shown", async () => {
    const { createControlGroup } = await import("./control-group");
    const overlay = { classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const group = createControlGroup(overlay as never, () => false);
    const slot = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
    const buy = group.place(slot as never, { id: "buy", label: "BUY", description: "" });
    const sell = group.place(slot as never, { id: "sell", label: "SELL", description: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(added).toEqual(["buy", "sell"]);
    expect(resumed).toBeGreaterThan(0);
    buy.setHidden(true);
    sell.setHidden(true);
    expect(covered).toBeGreaterThan(0);
    expect(hidden.filter(([, value]) => value)).toEqual([
      ["buy", true],
      ["sell", true],
    ]);
    expect(sell.hitRegion()).toEqual({ left: 1, top: 2, width: 3, height: 4 });
    sell.remove();
    expect(added).toEqual(["buy"]);
  });

  it("applies a hide asked for before mounting finished, once it lands (#1298)", async () => {
    const { createControlGroup } = await import("./control-group");
    const overlay = { classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const group = createControlGroup(overlay as never, () => false);
    const slot = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
    hidden.length = 0;
    const early = group.place(slot as never, { id: "early", label: "E", description: "" });
    early.setHidden(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hidden.filter(([id]) => id === "early").at(-1)).toEqual(["early", true]);
  });
});
