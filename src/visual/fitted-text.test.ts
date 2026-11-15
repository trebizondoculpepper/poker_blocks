import { describe, expect, it, vi } from "vite-plus/test";
import {
  createFittedTextLayout,
  fittedTextProvider,
  invalidateWhenFontsReady,
  narrationTextStyle,
  textLayoutProviders,
  type TextMeasure,
} from "./fitted-text";

/** A proportional font: "i" and "l" narrow, "W" and "M" wide, everything else average. */
const measure: TextMeasure = (text, px) =>
  Array.from(text).reduce(
    (sum, c) => sum + (/[il]/.test(c) ? 0.3 : /[WM]/.test(c) ? 0.9 : 0.55),
    0,
  ) * px;
const fit = (text: string, width = 200, height = 120) =>
  fittedTextProvider.layout({ text, style: narrationTextStyle, width, height }, measure);

describe("fitted narration text (#1156; doc/presentation-contracts.md)", () => {
  it("is registered as a text layout provider", () => {
    expect(textLayoutProviders.get("fitted")).toBe(fittedTextProvider);
  });

  it("prefers two lines and keeps every line within the budget", () => {
    const result = fit("Calm Water doubles this line ×2");
    expect(result.lines).toHaveLength(2);
    for (const line of result.lines) expect(line.width).toBeLessThanOrEqual(200 + 1e-9);
    expect(result.height).toBeLessThanOrEqual(120);
    expect(result.truncated).toBe(false);
  });

  it("measures glyphs, not characters: narrow text gets a larger size than wide text", () => {
    const narrow = fit("illill illill", 120, 80);
    const wide = fit("WMWMWM WMWMWM", 120, 80);
    expect(narrow.lines[0].px).toBeGreaterThan(wide.lines[0].px);
  });

  it("honours supplied breaks and allows more lines when needed", () => {
    const result = fit("Flush\n+40\n×3 from Steel", 200, 200);
    expect(result.lines.map(({ text }) => text)).toEqual(["Flush", "+40", "×3 from Steel"]);
  });

  it("never splits a word that fits whole while balancing lines", () => {
    const result = fit("Extraordinarily big", 200, 200);
    const words = result.lines.flatMap(({ text }) => text.split(" "));
    expect(words).toEqual(["Extraordinarily", "big"]);
  });

  it("splits a token too long for a line between graphemes", () => {
    const result = fit("Supercalifragilisticexpialidocious", 80, 200);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.map(({ text }) => text).join("")).toBe(
      "Supercalifragilisticexpialidocious",
    );
    for (const line of result.lines) expect(line.width).toBeLessThanOrEqual(80 + 1e-9);
  });

  it("fits short lines toward a common width, within bounded growth and spacing", () => {
    const result = fit("A much longer first line\nok", 150, 200);
    const [long, short] = result.lines;
    expect(short.px).toBeGreaterThan(long.px);
    expect(short.px).toBeLessThanOrEqual(long.px * narrationTextStyle.maxLineScale + 1e-9);
    expect(short.letterSpacingPx).toBeLessThanOrEqual(narrationTextStyle.maxLetterSpacingPx);
  });

  it("ellipsizes what can't fit at the minimum size, keeping the full text for announcement", () => {
    const text =
      "This passive multiplies every scoring line by three and adds forty points ".repeat(4);
    const result = fit(text, 100, 30);
    expect(result.truncated).toBe(true);
    expect(result.lines.at(-1)!.text.endsWith("…")).toBe(true);
    expect(result.fullText).toBe(text);
    for (const line of result.lines) {
      expect(line.px).toBeGreaterThanOrEqual(narrationTextStyle.minPx);
      expect(line.width).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("is deterministic", () => {
    expect(fit("Royal flush +100 ×4")).toEqual(fit("Royal flush +100 ×4"));
  });

  it("caches by text, style revision and rectangle, and recomputes after invalidation", () => {
    const counted = vi.fn(measure);
    const layout = createFittedTextLayout(fittedTextProvider, counted);
    const request = { text: "Pair +10", style: narrationTextStyle, width: 200, height: 80 };
    const first = layout.layout(request);
    const calls = counted.mock.calls.length;
    expect(layout.layout(request)).toBe(first);
    expect(counted.mock.calls.length).toBe(calls);
    layout.layout(request, 1);
    expect(counted.mock.calls.length).toBeGreaterThan(calls);
    layout.invalidate();
    expect(layout.layout(request)).not.toBe(first);
  });

  it("invalidates once fonts are ready, and not after unsubscribing", async () => {
    let resolve!: () => void;
    const fonts = { ready: new Promise<void>((r) => (resolve = r)) };
    const layout = { invalidate: vi.fn() };
    const changed = vi.fn();
    invalidateWhenFontsReady(fonts, layout, changed);
    const stop = invalidateWhenFontsReady(fonts, { invalidate: vi.fn() }, vi.fn());
    stop();
    resolve();
    await fonts.ready;
    await Promise.resolve();
    expect(layout.invalidate).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
