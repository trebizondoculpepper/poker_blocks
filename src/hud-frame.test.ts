import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

describe("HUD frame layout (#119)", () => {
  it("lays each layout out by the setting alone, never by the device's orientation", () => {
    for (const layout of ["landscape", "portrait"]) {
      expect(css).toContain(`.hud-frame[data-layout="${layout}"]`);
    }
    // No frame layout rule sits inside an orientation media query.
    const orientationBlocks = css.split(/@media[^{]*orientation[^{]*\{/).slice(1);
    for (const block of orientationBlocks) {
      const body = block.slice(0, block.indexOf("\n}\n"));
      expect(body).not.toContain("data-layout");
    }
  });
});
