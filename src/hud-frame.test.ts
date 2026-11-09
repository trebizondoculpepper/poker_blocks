import { describe, expect, it } from "vite-plus/test";
import { frameZones } from "./hud-frame";
import frameSource from "./hud-frame.ts?raw";
import { readFileSync } from "node:fs";

// Stylesheets are read from disk: Vite doesn't hand CSS text to tests through `?raw`.
const css = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const styles = css("./style.css");
const rackStyles = css("./passive-rack.css");

/** The z-index a CSS rule for `selector` sets, from a stylesheet's text. */
function zIndex(css: string, selector: string): number {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  const rule = css.slice(start, css.indexOf("}", start));
  const match = /z-index:\s*(\d+)/.exec(rule);
  expect(match, `${selector} sets a z-index`).not.toBeNull();
  return Number(match![1]);
}

describe("the shared HUD frame (#116)", () => {
  it("has edge zones, a top centre for the rack and a bottom centre for the hand", () => {
    expect(frameZones).toEqual([
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]);
  });

  it("knows nothing of scenes, modes or game state: it imports nothing", () => {
    expect(frameSource).not.toMatch(/^import /m);
    expect(frameSource).not.toMatch(/\bphase\b|GameRun|gameMode|SceneName/);
  });

  it("layers backgrounds < frame and HUD < front canvas < passive rack", () => {
    // The back canvas sits inside the background layers (#189), so their order is what counts.
    const back = zIndex(styles, ".scene .background-layers");
    const frame = zIndex(styles, ".hud-frame");
    const front = zIndex(styles, ".scene .table-canvas-front");
    const rack = zIndex(rackStyles, ".passive-rack");
    expect(back).toBeLessThan(frame);
    expect(frame).toBeLessThan(front);
    // The rack is created after the canvases, so an equal z-index still puts it on top.
    expect(rack).toBeGreaterThanOrEqual(front);
  });

  it("lets pointers through the front canvas and the frame, to the controls and the table", () => {
    const front = styles.slice(styles.indexOf(".scene .table-canvas-front {"));
    expect(front.slice(0, front.indexOf("}"))).toMatch(/pointer-events:\s*none/);
    const frame = styles.slice(styles.indexOf(".hud-frame {"));
    expect(frame.slice(0, frame.indexOf("}"))).toMatch(/pointer-events:\s*none/);
  });

  it("passes pointers through information panels, taking them only on controls (#117)", () => {
    expect(styles).not.toMatch(/\.hud-zone > \*\s*\{\s*pointer-events:\s*auto/);
    expect(styles).toMatch(
      /\.hud-zone :is\(button, \[data-interactive\]\)\s*\{\s*pointer-events:\s*auto/,
    );
  });
});
