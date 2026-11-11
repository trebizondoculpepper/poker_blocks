import { describe, expect, it } from "vite-plus/test";
// Only the run, as the game loads it: no direct import of src/triggers.ts (#475 review).
import "./game-run";
import { ruleCommands } from "./rule-commands";

describe("trigger dispatch in the game's module graph (#433)", () => {
  it("registers trigger-block wherever the run is loaded", () => {
    expect(ruleCommands.has("trigger-block")).toBe(true);
  });
});
