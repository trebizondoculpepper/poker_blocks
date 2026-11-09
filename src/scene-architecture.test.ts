/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("scene architecture guardrails", () => {
  it("switches rooms without navigating or reloading the document", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toContain("window.history.replaceState");
    expect(main).not.toMatch(/window\.location\.(assign|reload)\s*\(/);
  });
});
