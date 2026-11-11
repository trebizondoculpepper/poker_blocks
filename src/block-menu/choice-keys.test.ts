import { describe, expect, it, vi } from "vite-plus/test";
import { Block } from "../core/block";
import { menuAction } from "../traits/menu-action";
import { inspectableTrait } from "../traits/inspectable";
import { choiceActions, focusAfter, isBackKey } from "./choice-keys";
vi.mock("../audio/sfx", () => ({ playSfx: vi.fn() }));

function cube(enabled = true) {
  const block = new Block("c");
  block.add(menuAction, { action: "go", enabled });
  block.add(inspectableTrait, { description: "Go somewhere." });
  const texts: string[] = [];
  const actions: unknown[] = [];
  block.on("inspection", (text) => texts.push(String(text)));
  block.on("menu.action", (action) => actions.push(action));
  return { block, texts, actions };
}

describe("block menu keyboard and screen-reader path (#528)", () => {
  it("arrow keys move along the row, wrapping; other keys don't move focus", () => {
    expect(focusAfter("ArrowRight", 0, 3)).toBe(1);
    expect(focusAfter("ArrowDown", 2, 3)).toBe(0);
    expect(focusAfter("ArrowLeft", 0, 3)).toBe(2);
    expect(focusAfter("ArrowUp", 1, 3)).toBe(0);
    expect(focusAfter("Enter", 1, 3)).toBeNull();
    expect(focusAfter("ArrowRight", 0, 0)).toBeNull();
  });

  it("focusing a choice describes it; activating it is a complete press on its cube", () => {
    const { block, texts, actions } = cube();
    choiceActions.focus(block);
    expect(texts.at(-1)).toBe("Go somewhere.");
    choiceActions.activate(block);
    expect(actions).toEqual(["go"]);
  });

  it("a disabled choice can still be read by focus, and activating it does nothing", () => {
    const { block, texts, actions } = cube(false);
    choiceActions.focus(block);
    choiceActions.activate(block);
    expect(texts.at(-1)).toBe("Go somewhere.");
    expect(actions).toEqual([]);
  });

  it("tolerates a cube not built yet, and only Escape asks to go back", () => {
    expect(() => choiceActions.activate(undefined)).not.toThrow();
    expect(isBackKey("Escape")).toBe(true);
    expect(isBackKey("Backspace")).toBe(false);
  });

  it("shows keyboard focus on the cube itself: focus lifts it like hover, blur drops it (#532 review)", () => {
    const { block } = cube();
    const states: { hovered: boolean }[] = [];
    block.on("interaction.state", (state) => states.push(state as { hovered: boolean }));
    choiceActions.focus(block);
    expect(states.at(-1)?.hovered).toBe(true);
    choiceActions.blur(block);
    expect(states.at(-1)?.hovered).toBe(false);
  });
});
