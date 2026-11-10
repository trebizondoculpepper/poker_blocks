import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { gameModeRegistry } from "./game-modes";
import { hudStyles } from "./hud-styles";

const sources = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./hud-styles.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const css: Record<string, string> = Object.fromEntries(
  ["./style.css", "./shop-view.css", "./passive-rack.css"].map((file) => [
    file,
    readFileSync(new URL(file, import.meta.url), "utf8"),
  ]),
);

describe("HUD styles (#121)", () => {
  it("are data: every property is a --hud-* custom property the stylesheets read", () => {
    const sheets = Object.values(css).join("\n");
    for (const name of hudStyles.names())
      for (const property of Object.keys(hudStyles.get(name).properties)) {
        expect(property).toMatch(/^--hud-[a-z-]+$/);
        expect(sheets, `${name} sets ${property}, which no rule reads`).toContain(
          `var(${property},`,
        );
      }
  });

  it("restyle only: they never change position, size or layout", () => {
    for (const name of hudStyles.names())
      for (const property of Object.keys(hudStyles.get(name).properties))
        expect(property).not.toMatch(/top|left|right|bottom|width|height|margin|display|position/);
  });

  it("are auditioned in a developer mode, across gameplay and the shop", () => {
    const mode = gameModeRegistry.get("dev5");
    expect(mode.traits.console).toBeDefined();
    const auditioned = mode.scenes.filter(({ traits }) => traits.devHudStyleAudition);
    expect(new Set(auditioned.map(({ id }) => id.split("/").at(-1)))).toEqual(
      new Set(["boss", "shop", "stage-1", "stage-2"]),
    );
    for (const { traits } of auditioned)
      for (const style of traits.devHudStyleAudition!.styles)
        expect(hudStyles.has(style)).toBe(true);
  });

  it("are named nowhere outside their registry and the developer mode", () => {
    for (const [file, text] of Object.entries(sources)) {
      if (file.endsWith("game-modes.ts")) continue;
      for (const name of hudStyles.names()) expect(text, file).not.toContain(`"${name}"`);
    }
    // Nor in any stylesheet: CSS reads properties, never a style's name.
    for (const [file, text] of Object.entries(css))
      for (const name of hudStyles.names()) expect(text, file).not.toContain(name);
  });

  it("are not chosen for players yet: no production mode composes a style", () => {
    for (const id of gameModeRegistry.names()) {
      const mode = gameModeRegistry.get(id);
      if (mode.traits.console) continue;
      expect(mode.scenes.some(({ traits }) => traits.hudStyle || traits.devHudStyleAudition)).toBe(
        false,
      );
    }
  });
});
