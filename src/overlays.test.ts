import { describe, expect, it } from "vite-plus/test";
import { screenScenes, type ScreenScenes } from "./overlays";
import type { Screen } from "./menus";

describe("overlays: which scene each menu screen puts in front", () => {
  it("pushes settings, replaces for title and game over, and resumes the game", () => {
    const calls: string[] = [];
    const scenes: ScreenScenes = {
      push: (scene) => calls.push(`push ${scene}`),
      replace: (scene) => calls.push(`replace ${scene}`),
      resumeGame: () => calls.push("resume"),
    };
    for (const screen of ["title", "settings", "game", "over"] satisfies Screen[]) {
      screenScenes[screen](scenes);
    }
    expect(calls).toEqual(["replace title", "push settings", "resume", "replace game-over"]);
  });
});
