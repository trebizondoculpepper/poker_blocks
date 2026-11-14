import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../core/registry";
import { passRenderer } from "../tools/profiler/fake-pass-renderer";
import {
  createPrepassContext,
  prepassProblems,
  prepassRequirements,
  type AppearancePrepass,
} from "./appearance-prepass";
import type { PassFrame } from "./render-pass";

/** Stub prepasses with no material identity: each logs what it does, under its config's name. */
function stubs(log: string[]) {
  const registry = new Registry<AppearancePrepass>("test prepass");
  let made = 0;
  const target = new THREE.WebGLRenderTarget(1, 1);
  registry.register("stub", {
    create(config) {
      const name = `${(config as { name: string }).name}#${++made}`;
      log.push(`create ${name}`);
      return {
        render({ renderer, camera, scene }) {
          log.push(`render ${name}`);
          // Changes the state a capture changes; the context must put it back.
          renderer.setRenderTarget(target);
          renderer.setClearColor(0xff0000, 0.25);
          camera.layers.set(8);
          scene.background = new THREE.Color(0x00ff00);
        },
        dispose: () => void log.push(`dispose ${name}`),
      };
    },
  });
  registry.register("broken", {
    create() {
      throw new Error("no target");
    },
  });
  registry.register("throws", {
    create: () => ({
      render() {
        throw new Error("lost context");
      },
      dispose() {},
    }),
  });
  return registry;
}

function frame(): PassFrame {
  const scene = new THREE.Scene();
  return {
    delta: 0,
    reducedMotion: false,
    renderer: passRenderer() as unknown as PassFrame["renderer"],
    scene,
    camera: new THREE.PerspectiveCamera(),
    hide: scene,
  };
}

const stub = (name: string) => ({ handler: "stub", config: { name } });

describe("appearance prepasses (#969)", () => {
  it("makes one pass per distinct reference, held until the last appearance lets go", () => {
    const log: string[] = [];
    const context = createPrepassContext(stubs(log));
    const first = context.require([stub("rear")]);
    const second = context.require([stub("rear"), stub("glow")]);
    expect(log).toEqual(["create rear#1", "create glow#2"]);
    expect(context.size).toBe(2);
    first();
    first(); // Letting go twice changes nothing.
    expect(context.size).toBe(2);
    second();
    expect(log.slice(2)).toEqual(["dispose rear#1", "dispose glow#2"]);
    expect(context.size).toBe(0);
  });

  it("runs its passes in the order first required, then puts the render state back", () => {
    const log: string[] = [];
    const context = createPrepassContext(stubs(log));
    context.require([stub("a"), stub("b")]);
    const now = frame();
    const mask = now.camera.layers.mask;
    now.renderer.setClearColor(0x123456, 0.5);
    context.render(now);
    expect(log.filter((entry) => entry.startsWith("render"))).toEqual(["render a#1", "render b#2"]);
    expect(now.renderer.getRenderTarget()).toBeNull();
    expect(now.renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
    expect(now.renderer.getClearAlpha()).toBe(0.5);
    expect(now.camera.layers.mask).toBe(mask);
    expect(now.scene.background).toBeNull();
  });

  it("does nothing in a frame with no requirements", () => {
    const log: string[] = [];
    const context = createPrepassContext(stubs(log));
    context.require([])();
    context.render(frame());
    expect(log).toEqual([]);
  });

  it("restores the render state even when a pass throws", () => {
    const log: string[] = [];
    const context = createPrepassContext(stubs(log));
    context.require([stub("a"), { handler: "throws" }]);
    const now = frame();
    expect(() => context.render(now)).toThrow("lost context");
    expect(now.renderer.getRenderTarget()).toBeNull();
    expect(now.scene.background).toBeNull();
  });

  it("refuses an unknown prepass, and keeps nothing from a requirement that fails part-way", () => {
    const log: string[] = [];
    const registry = stubs(log);
    expect(prepassProblems([{ handler: "nope" }], registry)).toHaveLength(1);
    const context = createPrepassContext(registry);
    expect(() => context.require([{ handler: "nope" }])).toThrow(/no registered appearance/);
    expect(() => context.require([stub("made"), { handler: "broken" }])).toThrow("no target");
    expect(log).toEqual(["create made#1", "dispose made#1"]);
    expect(context.size).toBe(0);
  });

  it("gives each render context its own passes, and disposes them with it", () => {
    const log: string[] = [];
    const registry = stubs(log);
    const board = createPrepassContext(registry);
    const hand = createPrepassContext(registry);
    const table = prepassRequirements([board, hand]);
    const release = table.require([stub("rear")]);
    // One pass, with its own targets, in each context: neither samples the other's capture.
    expect(log).toEqual(["create rear#1", "create rear#2"]);
    board.render(frame());
    hand.render(frame());
    expect(log.slice(2)).toEqual(["render rear#1", "render rear#2"]);
    board.dispose();
    expect(log.slice(4)).toEqual(["dispose rear#1"]);
    // A disposed context takes no more requirements; the other lives on until released.
    expect(board.require([stub("late")])).toBeTypeOf("function");
    release();
    expect(log.slice(5)).toEqual(["dispose rear#2"]);
  });

  it("holds nothing in any context when a later context can't take a requirement (#1040 review)", () => {
    const log: string[] = [];
    const board = createPrepassContext(stubs(log));
    // The hand's registry can't make the pass: its creation throws.
    const failing = new Registry<AppearancePrepass>("failing prepass");
    failing.register("stub", {
      create() {
        throw new Error("no target");
      },
    });
    const hand = createPrepassContext(failing);
    expect(() => prepassRequirements([board, hand]).require([stub("rear")])).toThrow("no target");
    expect(board.size).toBe(0);
    expect(log).toEqual(["create rear#1", "dispose rear#1"]);
  });
});
