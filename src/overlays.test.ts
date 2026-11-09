import { describe, expect, it } from "vite-plus/test";
import { menuScreenScenes, screenScenes, type ScreenScenes } from "./overlays";
import type { Screen } from "./menus";

describe("overlays: which scene each menu screen puts in front", () => {
  it("replaces for title, resumes the game, and leaves game over to the flow", () => {
    const calls: string[] = [];
    const scenes: ScreenScenes = {
      push: (scene) => calls.push(`push ${scene}`),
      replace: (scene) => calls.push(`replace ${scene}`),
      resumeGame: () => calls.push("resume"),
    };
    for (const screen of ["title", "game", "over"] satisfies Screen[]) {
      screenScenes[screen](scenes);
    }
    expect(calls).toEqual(["replace title", "resume"]);
  });
});

describe("menus move only the scenes they pushed (#35)", () => {
  function stackOf(...ids: string[]) {
    const stack = [...ids];
    const scenes = menuScreenScenes({
      current: () => stack.at(-1),
      push: (id) => void stack.push(id),
      pop: () => (stack.length > 1 ? (stack.pop(), true) : false),
      replace: (name) => void stack.splice(0, stack.length, `m/${name}`),
      idFor: (name) => `m/${name}`,
    });
    return { stack, scenes };
  }

  it("closing menus keeps a scene the game flow pushed", () => {
    const { stack, scenes } = stackOf("m/title", "m/stage-1");
    scenes.resumeGame();
    expect(stack).toEqual(["m/title", "m/stage-1"]);
  });

  it("closing menus pops the settings scene a menu pushed", () => {
    const { stack, scenes } = stackOf("m/stage-1");
    scenes.push("settings");
    expect(stack).toEqual(["m/stage-1", "m/settings"]);
    scenes.resumeGame();
    expect(stack).toEqual(["m/stage-1"]);
  });

  it("does not pop a flow scene pushed over a menu's scene", () => {
    const { stack, scenes } = stackOf("m/stage-1");
    scenes.push("settings");
    stack.push("m/stage-won");
    scenes.resumeGame();
    expect(stack).toEqual(["m/stage-1", "m/settings", "m/stage-won"]);
  });
});
