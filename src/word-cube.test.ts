import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { Block } from "./core/block";
import { menuAction } from "./traits/menu-action";
import { interactionFeedback, disabledAppearance } from "./traits/interaction-feedback";
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
  it("desaturates disabled materials through a reusable filter and restores their shader hook", () => {
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
    expect(shader.fragmentShader).toContain("interactionSaturation");
    expect(shader.fragmentShader).toContain("void interactionOriginalMain()");
    expect(shader.fragmentShader).toMatch(/void main\(\)\s*\{\s*interactionOriginalMain\(\);/);
    expect(shader.fragmentShader.match(/void main\(/g)).toHaveLength(1);
    expect(
      (shader.uniforms as Record<string, { value: number }>).interactionSaturation!.value,
    ).toBe(0);
    block.emit("input.enabled", true);
    expect(
      (shader.uniforms as Record<string, { value: number }>).interactionSaturation!.value,
    ).toBe(1);
    block.dispose();
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    expect(material.onBeforeCompile).toBe(original);
    material.dispose();
  });
});
