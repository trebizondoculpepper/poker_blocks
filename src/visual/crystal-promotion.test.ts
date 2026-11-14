import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "../cards";
import { getMaterialDefinition } from "../materials";
import { passRenderer } from "../tools/profiler/fake-pass-renderer";
import { appearancePrepasses, createPrepassContext } from "./appearance-prepass";
import { createBlockAppearance } from "./block-appearance";
import { internalLayer } from "./crystal-internal";
import { cardFaceArt } from "./face-art";
import { opticsBackends } from "./optics-backends";
import type { PassFrame } from "./render-pass";

/** A canvas good enough to paint face art on, with no DOM. */
function withCanvas<T>(run: () => T): T {
  // Every call returns another stub, so gradients and patterns can be painted with too.
  const stub: object = new Proxy(() => stub, { get: () => stub, apply: () => stub });
  const context = stub;
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  try {
    return run();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("Total Internal Reflection Crystal promotion (#971)", () => {
  it("is Prismatic Crystal's look, its bench preset renamed, its handle unchanged", () => {
    expect(getMaterialDefinition("prismatic").appearance.assembly).toBe("crystalInternal");
    expect(opticsBackends.get("internal").label).toBe("Total Internal Reflection Crystal");
    expect(opticsBackends.get("internal").assembly).toBe("crystalInternal");
  });

  it("declares its registered inner capture, and keeps the rear on the capture's own layer", () => {
    expect(appearancePrepasses.has("internalCapture")).toBe(true);
    const appearance = withCanvas(() =>
      createBlockAppearance(
        cardFaceArt(standardDeck[0]!.traits.identity!),
        getMaterialDefinition("prismatic"),
        1,
      ),
    );
    expect(appearance.prepasses).toEqual([{ handler: "internalCapture" }]);
    const rear = (appearance.extras ?? []).find((extra) => extra.layers.isEnabled(internalLayer));
    expect(rear).toBeDefined();
    expect(rear!.layers.isEnabled(0)).toBe(false);
  });

  it("captures into a host's own target and restores the host's render state", () => {
    const context = createPrepassContext();
    const release = context.require([{ handler: "internalCapture" }]);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = passRenderer();
    const frame = {
      delta: 0,
      reducedMotion: false,
      renderer: renderer as unknown as PassFrame["renderer"],
      scene,
      camera,
      hide: scene,
    };
    const mask = camera.layers.mask;
    context.render(frame);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(camera.layers.mask).toBe(mask);
    release();
    expect(context.size).toBe(0);
  });
});
