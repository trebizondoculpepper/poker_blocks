import { describe, expect, it } from "vite-plus/test";
import { Randomizer, newSeed } from "./random";

describe("the session randomizer (#134)", () => {
  it("repeats a sequence exactly for the same seed and requests", () => {
    const first = new Randomizer(1234);
    const second = new Randomizer(1234);
    const requests = (r: Randomizer) => [
      r.int("die.d6", 1, 6),
      r.chance("shop.rare", 0.25),
      r.weighted("shop.stock", ["a", "b", "c"]),
      r.shuffle("deck.shuffle", [1, 2, 3, 4, 5]),
      r.int("die.d20", 1, 20),
    ];
    expect(requests(first)).toEqual(requests(second));
  });

  it("gives a different sequence for a different seed", () => {
    const values = (seed: number) => Array.from({ length: 12 }, () => new Randomizer(seed).next());
    expect(values(1)).not.toEqual(values(2));
  });

  it("resumes where it left off, not from the start of the sequence", () => {
    const straight = new Randomizer(99);
    straight.next();
    straight.next();
    const afterTwo = straight.int("die.d6", 1, 6);

    // Save the position, continue in a fresh instance, and get the same next value.
    const resumed = new Randomizer(99, 2);
    expect(resumed.cursor).toBe(2);
    expect(resumed.int("die.d6", 1, 6)).toBe(afterTwo);
  });

  it("counts every draw, including the ones a shuffle or weighted choice makes", () => {
    const r = new Randomizer(7);
    expect(r.cursor).toBe(0);
    r.int("die.d6", 1, 6);
    expect(r.cursor).toBe(1);
    r.shuffle("deck.shuffle", [1, 2, 3]);
    // A shuffle of three makes two draws.
    expect(r.cursor).toBe(3);
  });

  it("rolls integers inside their range, both ends included", () => {
    const r = new Randomizer(42);
    const rolls = Array.from({ length: 500 }, () => r.int("die.d6", 1, 6));
    expect(new Set(rolls)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(Math.min(...rolls)).toBe(1);
    expect(Math.max(...rolls)).toBe(6);
  });

  it("takes a chance at about the rate asked for, decimals included", () => {
    const r = new Randomizer(2024);
    const hits = Array.from({ length: 2000 }, () => r.chance("shop.rare", 0.25)).filter(Boolean);
    expect(hits.length).toBeGreaterThan(400);
    expect(hits.length).toBeLessThan(600);
  });

  it("respects weights and never picks something with no weight", () => {
    const r = new Randomizer(5);
    const picks = Array.from({ length: 600 }, () =>
      r.weighted("shop.stock", ["common", "rare", "never"], (item) =>
        item === "common" ? 9 : item === "rare" ? 1 : 0,
      ),
    );
    expect(picks).not.toContain("never");
    expect(picks.filter((p) => p === "common").length).toBeGreaterThan(
      picks.filter((p) => p === "rare").length,
    );
  });

  it("shuffles a copy, leaving the caller's array alone", () => {
    const r = new Randomizer(11);
    const original = [1, 2, 3, 4, 5];
    const shuffled = r.shuffle("deck.shuffle", original);
    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("lets a modifier shift one context without disturbing the others", () => {
    // Force every "die.d20" draw to its top of range, which is how a passive will shift odds.
    const modified = new Randomizer(31);
    modified.addModifier("die.d20", () => 0.999);
    expect(modified.int("die.d20", 1, 20)).toBe(20);

    // A context with no modifier draws the untouched sequence. `modified` has already taken
    // one draw for the d20, so compare against an unmodified randomizer at the same position.
    const samePosition = new Randomizer(31, modified.cursor);
    expect(modified.int("die.d6", 1, 6)).toBe(samePosition.int("die.d6", 1, 6));
  });

  it("rejects a bad range or probability instead of returning nonsense", () => {
    const r = new Randomizer(1);
    expect(() => r.int("die.d6", 6, 1)).toThrow(/bad range/);
    expect(() => r.chance("shop.rare", 1.5)).toThrow(/not in \[0, 1\]/);
    expect(() => r.weighted("shop.stock", [])).toThrow(/nothing to choose/);
    expect(() => r.weighted("shop.stock", ["a"], () => 0)).toThrow(/no weight/);
  });

  it("gives a seed in the 32-bit range", () => {
    for (let i = 0; i < 20; i++) {
      const seed = newSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(4294967296);
    }
  });
});
