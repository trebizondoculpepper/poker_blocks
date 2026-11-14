import { describe, expect, it } from "vite-plus/test";
import { createDiagnosticRegistry } from "./debug-snapshot";
import { registerSnapshotProviders, snapshotSections } from "./providers";
import { GameRun } from "../game-run";
import { dealerRegistry } from "../dealer";
import { demoRunRules } from "../run-rules";
import { standardDeck } from "../cards";

const fixed = () => new Date("2026-11-14T00:00:00Z");

describe("debug snapshot (#987)", () => {
  it("reports a section with no provider as unavailable, not empty", () => {
    const registry = createDiagnosticRegistry(["scheduler", "titles"], fixed);
    registry.register("titles", () => []);
    expect(registry.snapshot().sections).toEqual({
      scheduler: { status: "unavailable" },
      titles: { status: "ok", data: [] },
    });
  });
  it("reports a failing provider without losing the others", () => {
    const registry = createDiagnosticRegistry([], fixed);
    registry.register("bad", () => {
      throw new Error("boom");
    });
    registry.register("good", () => 1);
    const { sections } = registry.snapshot();
    expect(sections.bad).toEqual({ status: "failed", error: "boom" });
    expect(sections.good).toEqual({ status: "ok", data: 1 });
  });
  it("bounds depth, items, strings and bytes, and reports every cut", () => {
    const registry = createDiagnosticRegistry([], fixed);
    registry.register("deep", () => ({ a: { b: { c: 1 } } }));
    registry.register("long", () => ({ list: [1, 2, 3, 4], text: "abcdef" }));
    const snapshot = registry.snapshot({ depth: 2, items: 2, stringLength: 3 });
    expect(snapshot.sections.deep).toEqual({ status: "ok", data: { a: { b: "[…]" } } });
    expect(snapshot.sections.long).toEqual({
      status: "ok",
      data: { list: [1, 2], text: "abc…" },
    });
    expect(snapshot.truncated).toEqual([
      "deep.a.b: depth",
      "long.list: 4 items",
      "long.text: string",
    ]);
  });
  it("drops the largest section to fit the byte limit, keeping the rest", () => {
    const registry = createDiagnosticRegistry([], fixed);
    registry.register("big", () => Array.from({ length: 10 }, () => "x".repeat(300)));
    registry.register("small", () => 1);
    const snapshot = registry.snapshot({ bytes: 1000 });
    expect(snapshot.sections.big).toEqual({ status: "failed", error: "over byte limit" });
    expect(snapshot.sections.small).toEqual({ status: "ok", data: 1 });
    expect(snapshot.truncated).toEqual(["big: bytes"]);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(1000);
  });
  it("keeps the total within the byte limit even when the truncation notices are long", () => {
    const registry = createDiagnosticRegistry([], fixed);
    const wide = () =>
      Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => "x".repeat(401)));
    registry.register("a", wide);
    registry.register("b", wide);
    const snapshot = registry.snapshot();
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(65536);
    expect(snapshot.truncated.at(-1)).toMatch(/more truncations$/);
  });
  it("never serialises callbacks or live objects", () => {
    const registry = createDiagnosticRegistry([], fixed);
    registry.register("live", () => ({ run: () => 1, map: new Map(), n: Number.NaN }));
    expect(registry.snapshot().sections.live).toEqual({
      status: "ok",
      data: { run: "[function]", map: "[unserialisable]", n: "NaN" },
    });
  });
  it("unregisters, after which the section is unavailable again", () => {
    const registry = createDiagnosticRegistry(["titles"], fixed);
    const leave = registry.register("titles", () => []);
    leave();
    expect(registry.snapshot().sections.titles).toEqual({ status: "unavailable" });
  });
  it("shows a leaked title against the scene stack (#985) without touching the model", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck);
    const before = JSON.stringify(game.state);
    const registry = createDiagnosticRegistry(snapshotSections, fixed);
    registerSnapshotProviders(registry, {
      version: "test",
      mode: () => "game",
      sceneStack: () => ["game"],
      state: () => game.state,
      titles: () => [{ text: "Poker Blocks", scale: 1 }],
      actions: () => ({ recording: false, entries: [] }),
    });
    const { sections } = registry.snapshot();
    expect(sections.scenes).toEqual({ status: "ok", data: { stack: ["game"] } });
    expect(sections.titles).toEqual({ status: "ok", data: [{ text: "Poker Blocks", scale: 1 }] });
    expect(sections.scheduler).toEqual({ status: "unavailable" });
    expect(sections.model.status).toBe("ok");
    expect(JSON.stringify(game.state)).toBe(before);
  });
});
