import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { frameZones } from "./hud-frame";
import { gameplayHudZones } from "./hud-layout";

// The layout's code, without its comments (which may well mention what it avoids).
const source = readFileSync(new URL("./hud-layout.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("the gameplay HUD in the frame (#117)", () => {
  it("puts stage and score top left, the menu top right, Discard bottom left, the deck bottom right", () => {
    const zoneOf = (element: string) =>
      gameplayHudZones.find((place) => place.element === element)?.zone;
    expect(zoneOf("round")).toBe("top-left");
    expect(zoneOf("coins")).toBe("top-left");
    expect(zoneOf("menu")).toBe("top-right");
    expect(zoneOf("discard")).toBe("bottom-left");
    expect(zoneOf("deck")).toBe("bottom-right");
    expect(zoneOf("shopBuy")).toBe("bottom-left");
    expect(zoneOf("shopExit")).toBe("bottom-right");
  });

  it("places each element once, in a real zone", () => {
    const elements = gameplayHudZones.map(({ element }) => element);
    expect(new Set(elements).size).toBe(elements.length);
    for (const { zone } of gameplayHudZones) expect(frameZones).toContain(zone);
  });

  it("is one table of data, with nothing about scenes, modes or phases", () => {
    expect(source).not.toMatch(/\bphase\b|SceneName|GameMode|gameModeFor|data-scene/);
  });

  it("is placed by the wiring from that table, not by each panel", () => {
    expect(main).toMatch(/for \(const \{ element, zone \} of gameplayHudZones\)/);
  });
});
