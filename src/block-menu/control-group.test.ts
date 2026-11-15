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
const targeted: [string, boolean][] = [];
let resumed = 0;
let covered = 0;
vi.mock("./control-stage", () => ({
  createControlStage: () =>
    Promise.resolve({
      add: (definition: { id: string }) => (added.push(definition.id), Promise.resolve()),
      remove: (id: string) => void added.splice(added.indexOf(id), 1),
      setHidden: (id: string, value: boolean) => void hidden.push([id, value]),
      setTargeted: (id: string, value: boolean) => void targeted.push([id, value]),
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

  it("marks a host as presenting a block while any of its blocks is placed (#1364)", async () => {
    const { createControlGroup } = await import("./control-group");
    const overlay = { classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const group = createControlGroup(overlay as never, () => false);
    const classes = new Set<string>();
    const host = {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    };
    const slot = {
      parentElement: host,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    };
    const first = group.place(slot as never, { id: "a", label: "A", description: "" });
    const second = group.place(slot as never, { id: "b", label: "B", description: "" });
    expect(classes.has("presents-block")).toBe(true);
    first.remove();
    expect(classes.has("presents-block")).toBe(true);
    second.remove();
    expect(classes.has("presents-block")).toBe(false);
  });

  it("forwards its owner's accepted-drop state to the block (#1364 review)", async () => {
    const { createControlGroup } = await import("./control-group");
    const overlay = { classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const group = createControlGroup(overlay as never, () => false);
    const slot = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
    const sell = group.place(slot as never, { id: "sell", label: "SELL", description: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sell.setTargeted(true);
    sell.setTargeted(false);
    expect(targeted).toEqual([
      ["sell", true],
      ["sell", false],
    ]);
  });
});
