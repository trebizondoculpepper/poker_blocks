import { describe, expect, it } from "vite-plus/test";
import { matchesSearch } from "./object-browser";

const flame = { id: "aggressiveFlame", name: "Aggressive flame" };

describe("object browser search (#1007)", () => {
  it("matches the display name or the opaque ID, case-insensitively", () => {
    expect(matchesSearch(flame, "aggressive")).toBe(true);
    expect(matchesSearch(flame, "FLAME")).toBe(true);
    expect(matchesSearch(flame, "aggressiveFl")).toBe(true);
    expect(matchesSearch(flame, "  flame  ")).toBe(true);
    expect(matchesSearch(flame, "water")).toBe(false);
  });

  it("shows everything for an empty search", () => {
    expect(matchesSearch(flame, "")).toBe(true);
    expect(matchesSearch(flame, "   ")).toBe(true);
  });
});
