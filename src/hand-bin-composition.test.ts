import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { sceneDefinitions } from "./game-modes";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const sources = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * #185: the hand and the Discard bin are composed by scenes, not owned by the composition
 * root. main.ts may build their services; only the scene traits may show them.
 */
describe("hand and Discard bin composition (#185)", () => {
  it("are shown only by the handView and discardBin scene traits", () => {
    for (const [file, text] of Object.entries(sources)) {
      if (file.endsWith("scene-behaviours.ts")) continue;
      expect(text, file).not.toMatch(/\.(handEntered|discardBinEntered)\(\s*true/);
    }
    const behaviours = read("./scene-behaviours.ts");
    expect(behaviours).toMatch(/register\("handView"[\s\S]*?handEntered\(true\)/);
    expect(behaviours).toMatch(/register\("discardBin"[\s\S]*?discardBinEntered\(true\)/);
  });

  it("guardrail (#278): the input service holds no scene switches or scene counters", () => {
    const input = read("./table-input.ts");
    expect(input).not.toMatch(/\b\w+Entered\s*\(/);
    expect(input).not.toMatch(/\b(let|const)\s+\w+Scenes\b/);
    expect(input).not.toMatch(/\bsetFieldActive\b|\bfieldActive\b/);
  });

  it("start hidden: the bin is built hidden and main.ts never reveals it", () => {
    expect(read("./table-input.ts")).toMatch(
      /function createDiscardTarget[\s\S]*?discardArea\.hidden = true;/,
    );
    expect(read("./main.ts")).not.toMatch(/discardArea\.hidden\s*=\s*false/);
  });

  it("are composed by the play scenes, and omitted by menus and the title", () => {
    const composing = (trait: "handView" | "discardBin") =>
      sceneDefinitions.filter(({ traits }) => trait in traits).map(({ name }) => name);
    expect(composing("handView")).toContain("stage-1");
    expect(composing("discardBin")).toContain("stage-1");
    for (const trait of ["handView", "discardBin"] as const)
      expect(composing(trait)).not.toContain("title");
  });
});
