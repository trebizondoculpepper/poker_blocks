import { describe, expect, it, vi } from "vite-plus/test";
import { Block } from "../core/block";
import { menuAction } from "../traits/menu-action";
import { inspectableTrait } from "../traits/inspectable";
import { longPressInspect } from "../traits/long-press-inspect";
import { createPointerRouter } from "./pointer-router";
vi.mock("../audio/sfx", () => ({ playSfx: vi.fn() }));

function cube(id: string) {
  const block = new Block(id);
  block.add(menuAction, { action: id, enabled: true });
  block.add(inspectableTrait, { description: `${id} does a thing` });
  block.add(longPressInspect, { holdSeconds: 0.5 });
  const texts: string[] = [];
  const actions: unknown[] = [];
  block.on("inspection", (text) => texts.push(String(text)));
  block.on("menu.action", (action) => actions.push(action));
  return { block, texts, actions };
}

describe("the cube stages' pointer routing (#462 review)", () => {
  it("a touch tap activates without an explanation popping up first", () => {
    const one = cube("one");
    const router = createPointerRouter(() => [one]);
    router.down(one, "touch");
    one.block.update(0.1);
    router.up(one, "touch");
    expect(one.actions).toEqual(["one"]);
    expect(one.texts).toEqual([]);
  });

  it("a touch long-press inspects and activates nothing", () => {
    const one = cube("one");
    const router = createPointerRouter(() => [one]);
    router.down(one, "touch");
    one.block.update(0.6);
    router.up(one, "touch");
    expect(one.texts).toEqual(["one does a thing"]);
    expect(one.actions).toEqual([]);
  });

  it("a mouse hovers to inspect, and clicks to activate", () => {
    const one = cube("one");
    const router = createPointerRouter(() => [one]);
    router.move(one, "mouse");
    router.down(one, "mouse");
    router.up(one, "mouse");
    expect(one.texts).toEqual(["one does a thing"]);
    expect(one.actions).toEqual(["one"]);
  });

  it("leaving the stage cancels, so a departed cube stops publishing live descriptions", () => {
    const [one, two] = [cube("one"), cube("two")];
    const router = createPointerRouter(() => [one, two]);
    router.move(one, "mouse");
    router.leave();
    router.move(two, "mouse");
    one.block.emit("input.enabled", false);
    two.block.emit("input.enabled", false);
    expect(one.texts).toEqual(["one does a thing"]);
    expect(two.texts.at(-1)).toBe("two does a thing");
    expect(two.texts).toHaveLength(2);
  });
});
