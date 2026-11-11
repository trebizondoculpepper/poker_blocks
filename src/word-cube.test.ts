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
import { longPressInspect } from "./traits/long-press-inspect";
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
    // Hovering inspects; the press itself doesn't (on touch it is the activating tap, #462).
    expect(inspect).toHaveBeenCalledTimes(1);
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

describe("disabled appearance, production checks (#461)", () => {
  const compiled = (material: THREE.Material) => {
    const shader = { uniforms: {}, fragmentShader: "void main() { gl_FragColor = vec4(0.5); }" };
    material.onBeforeCompile(shader as never, {} as never);
    return shader;
  };
  const disabledOf = (shader: { uniforms: object }) =>
    (shader.uniforms as Record<string, { value: number }>).interactionDisabled!.value;

  it("disabling one block never changes another's look or its materials", () => {
    const [a, b] = [menu(), menu()];
    const [first, second] = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    a.add(disabledAppearance);
    b.add(disabledAppearance);
    a.emit("presentation.mount", { object: new THREE.Group(), materials: [first] });
    b.emit("presentation.mount", { object: new THREE.Group(), materials: [second] });
    const [shaderA, shaderB] = [compiled(first), compiled(second)];
    a.emit("input.enabled", false);
    expect(disabledOf(shaderA)).toBe(1);
    expect(disabledOf(shaderB)).toBe(0);
    // Its definition stays: the colour and map are untouched, only the hook wraps them.
    expect(first.color.getHex()).toBe(0xffffff);
    a.dispose();
    b.dispose();
  });

  it("follows availability back and forth, and restores the original look when enabled", () => {
    const block = menu();
    block.add(disabledAppearance);
    const material = new THREE.MeshBasicMaterial();
    block.emit("presentation.mount", { object: new THREE.Group(), materials: [material] });
    const shader = compiled(material);
    for (const enabled of [false, true, false, true]) {
      block.emit("input.enabled", enabled);
      expect(disabledOf(shader)).toBe(enabled ? 0 : 1);
    }
    block.dispose();
  });

  it("filters a material once however often the block is mounted, and unwraps it fully", () => {
    const block = menu(false);
    block.add(disabledAppearance);
    const material = new THREE.MeshBasicMaterial();
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    const original = material.onBeforeCompile;
    const mount = { object: new THREE.Group(), materials: [material] };
    block.emit("presentation.mount", mount);
    block.emit("presentation.mount", mount);
    expect(compiled(material).fragmentShader.match(/void main\(/g)).toHaveLength(1);
    block.dispose();
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    expect(material.onBeforeCompile).toBe(original);
  });
});

describe("menu block inspection (#462)", () => {
  function inspected(description = "Carry on with your saved game.", disabledReason = "") {
    const block = new Block("menu");
    block.add(menuAction, { action: "continue", enabled: true });
    block.add(inspectableTrait, { description, disabledReason });
    block.add(longPressInspect, { holdSeconds: 0.5 });
    const texts: string[] = [];
    const actions: unknown[] = [];
    block.on("inspection", (text) => texts.push(String(text)));
    block.on("menu.action", (action) => actions.push(action));
    return { block, texts, actions };
  }

  it("describes what choosing it does on hover and keyboard focus", () => {
    const { block, texts } = inspected();
    block.emit("input.enter");
    block.emit("input.focus");
    expect(texts).toEqual(["Carry on with your saved game.", "Carry on with your saved game."]);
    block.dispose();
  });

  it("explains why it is unavailable, live, and re-describes while inspected", () => {
    const { block, texts } = inspected();
    block.emit("input.enter");
    block.emit("input.enabled", { enabled: false, reason: "There is no saved game to continue." });
    expect(texts.at(-1)).toBe(
      "Carry on with your saved game. Unavailable: There is no saved game to continue.",
    );
    block.emit("input.enabled", true);
    expect(texts.at(-1)).toBe("Carry on with your saved game.");
    // Not being inspected: a change says nothing.
    block.emit("input.leave");
    const count = texts.length;
    block.emit("input.enabled", false);
    expect(texts).toHaveLength(count);
    block.dispose();
  });

  it("falls back to its configured reason when the scene sends none", () => {
    const { block, texts } = inspected("Carry on.", "No save.");
    block.emit("input.enabled", false);
    block.emit("inspect.request");
    expect(texts.at(-1)).toBe("Carry on. Unavailable: No save.");
    block.dispose();
  });

  it("a tap activates once and doesn't inspect", () => {
    vi.mocked(playSfx).mockClear();
    const { block, texts, actions } = inspected();
    block.emit("input.press");
    block.update(0.1);
    block.emit("input.release");
    expect(actions).toEqual(["continue"]);
    expect(texts).toEqual([]);
    expect(vi.mocked(playSfx).mock.calls.filter(([id]) => id === "ui.click")).toHaveLength(1);
    block.dispose();
  });

  it("a long-press inspects and suppresses activation on release, with no click", () => {
    vi.mocked(playSfx).mockClear();
    const { block, texts, actions } = inspected();
    block.emit("input.press");
    block.update(0.3);
    block.update(0.3);
    block.emit("input.release");
    expect(texts).toEqual(["Carry on with your saved game."]);
    expect(actions).toEqual([]);
    expect(vi.mocked(playSfx)).not.toHaveBeenCalledWith("ui.click");
    block.dispose();
  });

  it("a disabled block is still inspectable by long-press, and never activates", () => {
    const { block, texts, actions } = inspected("Carry on.", "No save.");
    block.emit("input.enabled", false);
    block.emit("input.press");
    block.update(0.6);
    block.emit("input.release");
    expect(texts).toEqual(["Carry on. Unavailable: No save."]);
    expect(actions).toEqual([]);
    block.dispose();
  });

  it("moving off the block or cancelling stops the hold", () => {
    const { block, texts } = inspected();
    block.emit("input.press");
    block.update(0.3);
    block.emit("input.leave");
    block.update(0.5);
    block.emit("input.press");
    block.emit("input.cancel");
    block.update(0.9);
    expect(texts).toEqual([]);
    block.dispose();
  });

  it("stops listening when disposed", () => {
    const { block, texts } = inspected();
    block.dispose();
    block.emit("input.enter");
    block.update(1);
    expect(texts).toEqual([]);
  });
});
