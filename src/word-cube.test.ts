import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { Block } from "./core/block";
import { menuAction } from "./traits/menu-action";
import {
  interactionFeedback,
  disabledAppearance,
  premultipliedOutput,
} from "./traits/interaction-feedback";
import { additiveLight } from "./visual/additive-light";
import { inspectableTrait } from "./traits/inspectable";
import { playSfx } from "./audio/sfx";
vi.mock("./audio/sfx", () => ({ playSfx: vi.fn() }));

function menu(enabled = true) {
  const block = new Block("example");
  block.add(menuAction, { action: "arbitrary.configured.action", enabled });
  return block;
}

describe("wordCube menu traits", () => {
  it("activates once on a completed mouse or touch press, without interpreting the action", () => {
    const block = menu();
    const action = vi.fn();
    block.on("menu.action", action);
    block.emit("input.press");
    expect(action).not.toHaveBeenCalled();
    block.emit("input.release");
    block.emit("input.release");
    expect(action).toHaveBeenCalledExactlyOnceWith("arbitrary.configured.action");
    block.dispose();
  });
  it("does not activate after leaving, cancellation, disabling mid-press, or disposal", () => {
    const block = menu();
    const action = vi.fn();
    block.on("menu.action", action);
    for (const interruption of ["input.leave", "input.cancel"]) {
      block.emit("input.press");
      block.emit(interruption);
      block.emit("input.release");
    }
    block.emit("input.press");
    block.emit("input.enabled", false);
    block.emit("input.release");
    block.dispose();
    block.emit("input.press");
    block.emit("input.release");
    expect(action).not.toHaveBeenCalled();
  });
  it("lets disabled items be inspected while refusing activation", () => {
    const block = menu(false);
    block.add(inspectableTrait, { description: "There is no game in progress" });
    const inspect = vi.fn();
    const action = vi.fn();
    block.on("inspection", inspect);
    block.on("menu.action", action);
    block.emit("input.enter");
    block.emit("input.press");
    block.emit("input.release");
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenLastCalledWith("There is no game in progress");
    expect(action).not.toHaveBeenCalled();
    expect(playSfx).toHaveBeenCalledWith("action.denied");
    block.dispose();
  });
  it("composes hover and press inside an independent scene transform and honors reduced motion", () => {
    const block = menu();
    block.add(interactionFeedback);
    const outer = new THREE.Group();
    outer.position.set(10, 20, 30);
    const inner = new THREE.Group();
    outer.add(inner);
    block.emit("presentation.mount", { object: inner, materials: [] });
    block.emit("input.enter");
    block.emit("input.press");
    block.update(1);
    expect(inner.scale.x).toBeGreaterThan(1);
    expect(inner.position.y).toBeGreaterThan(0);
    expect(inner.position.z).toBeLessThan(0);
    expect(outer.position.toArray()).toEqual([10, 20, 30]);
    block.settingsOf(interactionFeedback)!.reducedMotion = true;
    block.update(1);
    expect(inner.scale.toArray()).toEqual([1, 1, 1]);
    expect(inner.position.toArray()).toEqual([0, 0, 0]);
    block.dispose();
  });
  it("dithers premultiplied glow layers on their unscaled brightness, keeping their coverage", () => {
    const block = menu(false);
    block.add(disabledAppearance);
    const glow = new THREE.ShaderMaterial({ ...additiveLight });
    const plain = new THREE.MeshBasicMaterial();
    expect(premultipliedOutput(glow)).toBe(true);
    expect(premultipliedOutput(plain)).toBe(false);
    block.emit("presentation.mount", { object: new THREE.Group(), materials: [glow, plain] });
    const compiled = (material: THREE.Material) => {
      const shader = { uniforms: {}, fragmentShader: "void main() { gl_FragColor = vec4(0.1); }" };
      material.onBeforeCompile(shader as never, {} as never);
      return shader.fragmentShader;
    };
    expect(compiled(glow)).toContain("interactionPremultiplied = 1.0");
    expect(compiled(plain)).toContain("interactionPremultiplied = 0.0");
    expect(compiled(glow)).toContain("vec3(step(threshold, luma)) * coverage");
    // The two compile to different programs.
    expect(glow.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    block.dispose();
  });

  it("dithers disabled materials to black and white through a reusable filter, and restores their shader hook", () => {
    const block = menu(false);
    block.add(disabledAppearance);
    const material = new THREE.MeshBasicMaterial();
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    const original = material.onBeforeCompile;
    block.emit("presentation.mount", { object: new THREE.Group(), materials: [material] });
    block.emit("input.enabled", false);
    const shader = {
      uniforms: {},
      fragmentShader:
        "void main() { if (!gl_FrontFacing) { gl_FragColor = vec4(1.0); return; } gl_FragColor = vec4(0.5); }",
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain("interactionDisabled");
    expect(shader.fragmentShader).toContain("void interactionOriginalMain()");
    expect(shader.fragmentShader).toMatch(/void main\(\)\s*\{\s*interactionOriginalMain\(\);/);
    expect(shader.fragmentShader.match(/void main\(/g)).toHaveLength(1);
    // One bit: each pixel's brightness against a noise threshold gives pure black or white.
    expect(shader.fragmentShader).toContain("vec3(step(threshold, luma))");
    expect(shader.fragmentShader).toContain("gl_FragCoord.xy / interactionDitherPixel");
    const uniforms = shader.uniforms as Record<string, { value: number }>;
    expect(uniforms.interactionDisabled!.value).toBe(1);
    expect(uniforms.interactionDitherPixel!.value).toBe(2);
    block.emit("input.enabled", true);
    expect(uniforms.interactionDisabled!.value).toBe(0);
    block.dispose();
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    expect(material.onBeforeCompile).toBe(original);
    material.dispose();
  });
});
