import { describe, expect, it, vi } from "vite-plus/test";
import { defaultLettering } from "./lettering";
import {
  faceMotifs,
  labelledMotifFaceArt,
  motifFaceLayout,
  withMotif,
  type FaceMotif,
} from "./motif-face-art";

/** A 2D context that records drawing and measures text proportionally to its font size. */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state = { font: "10px x" };
  const context = new Proxy(state, {
    get: (target, name) => {
      if (name === "font") return target.font;
      if (name === "measureText")
        return (text: string) => ({
          width: text.length * 0.6 * Number(/(\d+)px/.exec(target.font)![1]),
        });
      return (...args: unknown[]) => void calls.push({ name: String(name), args });
    },
    set: (target, name, value) => {
      if (name === "font") target.font = value as string;
      calls.push({ name: `set ${String(name)}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls, state };
}

const pen = (tone: string) => (tone === "black" ? "#111" : "#a00");

describe("control face artwork (#1147; doc/shop-control-blocks.md)", () => {
  it("registers code-native coin and dustbin motifs", () => {
    expect(faceMotifs.has("coin")).toBe(true);
    expect(faceMotifs.has("dustbin")).toBe(true);
  });

  for (const [label, motif] of [
    ["BUY", "coin"],
    ["SELL", "dustbin"],
    // Other combinations work through the same provider: no label/motif pairing is assumed.
    ["SELL", "coin"],
    ["CONTINUE", "dustbin"],
  ] as const)
    it(`draws ${motif} above a readable ${label} label within the face`, () => {
      const { context, calls } = recordingContext();
      labelledMotifFaceArt(label, { handler: motif }, defaultLettering).paint(context, pen);
      const texts = calls.filter(({ name }) => name === "fillText");
      expect(texts.map(({ args }) => args[0]).join(" ")).toBe(label);
      const { label: box, motif: area } = motifFaceLayout;
      for (const { args } of texts) {
        const y = args[2] as number;
        expect(y).toBeGreaterThan(area.y + area.size / 2 - 1);
        expect(y).toBeLessThan(256);
      }
      // The motif drew something, in the pen's ink.
      expect(
        calls.some(({ name }) => ["arc", "fillRect", "strokeRect", "lineTo"].includes(name)),
      ).toBe(true);
      expect(calls.some(({ name, args }) => name === "set strokeStyle" && args[0] === "#111")).toBe(
        true,
      );
      // Fitted into the label box, so the label is large enough to read on a small cube.
      const size = Number(
        /(\d+)px/.exec(String(calls.findLast(({ name }) => name === "set font")!.args[0]))![1],
      );
      expect(size * 1.25).toBeLessThanOrEqual(box.height);
      expect(size).toBeGreaterThanOrEqual(label.length > 4 ? 28 : 48);
    });

  it("dispatches to whichever motif the definition names, with its configuration", () => {
    const custom: FaceMotif = vi.fn();
    faceMotifs.register("test.star", custom);
    const { context } = recordingContext();
    withMotif({ handler: "test.star", config: { points: 5 } })("GO", defaultLettering).paint(
      context,
      pen,
    );
    const [g, ink, area, config] = vi.mocked(custom).mock.calls[0]!;
    expect(g).toBe(context);
    expect(ink).toBe(pen);
    expect(area).toEqual(motifFaceLayout.motif);
    expect(config).toEqual({ points: 5 });
  });

  it("gives each label and motif its own stable seed", () => {
    const buy = labelledMotifFaceArt("BUY", { handler: "coin" }, defaultLettering);
    expect(buy.seed).toBe(labelledMotifFaceArt("BUY", { handler: "coin" }, defaultLettering).seed);
    expect(buy.seed).not.toBe(
      labelledMotifFaceArt("SELL", { handler: "dustbin" }, defaultLettering).seed,
    );
  });
});
