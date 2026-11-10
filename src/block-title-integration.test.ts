import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { sceneDefinitions, type SceneTraits } from "./game-modes";

describe("block titles in menus", () => {
  it("composes the same title above menu choices, with exactly half the pause scale", () => {
    const title: Partial<SceneTraits> = sceneDefinitions.find(
      (scene) => scene.name === "title",
    )!.traits;
    const pause: Partial<SceneTraits> = sceneDefinitions.find(
      (scene) => scene.name === "pause",
    )!.traits;
    expect(title.blockTitle?.text).toBe("Poker Blocks");
    expect(pause.blockTitle?.text).toBe(title.blockTitle?.text);
    expect(pause.blockTitle!.scale).toBe(title.blockTitle!.scale * 0.5);
    expect(Object.keys(title).indexOf("blockTitle")).toBeGreaterThan(
      Object.keys(title).indexOf("titleScreen"),
    );
    expect(Object.keys(pause).indexOf("blockTitle")).toBeGreaterThan(
      Object.keys(pause).indexOf("menu"),
    );
  });
  it("removes the old DOM title and lets the composed trait supply an accessible heading", () => {
    const menus = readFileSync(new URL("./menus.ts", import.meta.url), "utf8");
    expect(menus).not.toContain('<h1 class="menu-title">POKER BLOCKS</h1>');
    const view = readFileSync(new URL("./block-title-view.ts", import.meta.url), "utf8");
    expect(view).toContain('container.setAttribute("role", "heading")');
    expect(view).toContain('container.setAttribute("aria-label", config.text)');
  });
});
