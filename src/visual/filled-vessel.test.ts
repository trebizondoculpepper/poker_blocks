import { readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { experimentalMaterials, materialDefinitions } from "../materials";
import { createSettler } from "./filled-vessel";

const config = { settleSeconds: 1, traceSeconds: 4 };
const tilted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const level = new THREE.Quaternion();

describe("filled vessel (#227)", () => {
  it("starts level, then eases slowly toward the new level after a turn", () => {
    const settle = createSettler(config);
    const surface = new THREE.Vector3();
    const trace = new THREE.Vector3();
    settle(level, 0, surface, trace);
    expect(surface.y).toBeCloseTo(1);
    // Turned a quarter about z: "up" in the block's own space is now along +x.
    settle(tilted, 0.1, surface, trace);
    expect(surface.x).toBeGreaterThan(0);
    expect(surface.x).toBeLessThan(0.2);
    for (let t = 0.2; t < 10; t += 0.05) settle(tilted, t, surface, trace);
    expect(surface.x).toBeCloseTo(1, 2);
  });

  it("leaves a trace that lags the surface and catches up, so it fades", () => {
    const settle = createSettler(config);
    const surface = new THREE.Vector3();
    const trace = new THREE.Vector3();
    settle(level, 0, surface, trace);
    for (let t = 0.05; t < 1; t += 0.05) settle(tilted, t, surface, trace);
    const gap = 1 - surface.dot(trace);
    expect(gap).toBeGreaterThan(0.01);
    for (let t = 1; t < 30; t += 0.05) settle(tilted, t, surface, trace);
    expect(1 - surface.dot(trace)).toBeLessThan(1e-4);
  });

  it("is configured as data: no generic code names an experimental material", () => {
    const names = experimentalMaterials.map(({ id }) => id);
    const visual = new URL(".", import.meta.url);
    for (const file of readdirSync(visual).filter((name) => !name.endsWith(".test.ts"))) {
      const source = readFileSync(new URL(file, visual), "utf8").toLowerCase();
      for (const name of names) expect(source, file).not.toContain(name);
    }
  });

  it("keeps experiments out of gameplay: no shop, scoring or rewards, and not a gameplay material", () => {
    const gameplay = new Set<string>(materialDefinitions.map(({ id }) => id));
    for (const material of experimentalMaterials) {
      expect(gameplay.has(material.id)).toBe(false);
      expect(material).not.toHaveProperty("shop");
      expect(material).not.toHaveProperty("scoringModifier");
      expect(material).not.toHaveProperty("handReward");
    }
  });
});

describe("experimental materials in developer decks", () => {
  it("are dealt from the registered pool (dev0), never from the gameplay pool", async () => {
    const { makeDevDeck } = await import("../materials");
    const { gameModeFor } = await import("../game-modes");
    const kinds = (deck: readonly { traits: { material?: { kind: string } } }[]) =>
      new Set(deck.map(({ traits }) => traits.material?.kind));
    expect(kinds(makeDevDeck(7)).has("custard")).toBe(false);
    const registered = kinds(makeDevDeck(7, "registered"));
    for (const { id } of [...materialDefinitions, ...experimentalMaterials])
      expect(registered.has(id), id).toBe(true);
    expect(gameModeFor("dev0").runSetup).toContainEqual({
      step: "materialDeck",
      pool: "registered",
    });
    // The normal game deals no developer deck at all.
    expect(gameModeFor("game").runSetup.some(({ step }) => step === "materialDeck")).toBe(false);
  });
});
