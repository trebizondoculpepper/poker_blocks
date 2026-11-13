/**
 * The crystal comparison room (dev17, #524; design in doc/game-architecture.md, "Approximate
 * crystal optics and the comparison room"). A fixed collection of crystal blocks that can be
 * switched as a whole between registered optics backends (#523): only the blocks' appearances
 * are rebuilt, so cards, positions, orientations, camera, lighting and environment stay put.
 *
 * Drag turns the collection, the wheel or a pinch zooms. A panel shows the backend, renderer
 * counts and CPU frame time (median and p95, sampled after a warm-up so shader compilation is
 * excluded), labelled as frame time, never GPU time. It makes no production choice.
 *
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Gesture } from "@use-gesture/vanilla";
import { playSfx } from "../../audio/sfx";
import { standardDeck, pokerIdentity } from "../../cards";
import { gameModeFor, modeLink, type DevCrystalComparisonConfig } from "../../game-modes";
import { getMaterialDefinition, type BlockMaterial } from "../../materials";
import {
  createBlockAppearance,
  setReflectionEnvironment,
  type BlockAppearance,
} from "../../visual/block-appearance";
import { cardFaceArt } from "../../visual/face-art";
import {
  opticsBackends,
  snapshotOptics,
  withOpticsBackend,
  type OpticsControl,
} from "../../visual/optics-backends";
import type { RenderPass } from "../../visual/render-pass";
import { viewControls } from "./view-controls";
import "./room.css";

export type CrystalComparisonRoom = {
  show(config: DevCrystalComparisonConfig): void;
  hide(): void;
  dispose(): void;
};

/** A fixed, seeded pick: the same collection for a seed, whatever the backend. */
export function comparisonLayout(count: number, seed: number) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    card: standardDeck[Math.floor(random() * standardDeck.length)]!,
    position: new THREE.Vector3(
      ((index % columns) - (columns - 1) / 2) * 1.5,
      ((Math.ceil(count / columns) - 1) / 2 - Math.floor(index / columns)) * 1.5,
      0,
    ),
    rotation: new THREE.Euler(random() * 0.9 - 0.45, random() * 1.6 - 0.8, 0),
  }));
}

type Slot = ReturnType<typeof comparisonLayout>[number] & {
  mesh?: THREE.Mesh;
  appearance?: BlockAppearance;
  edges?: THREE.LineSegments;
};

/** Median and 95th percentile (nearest rank) of the sampled frames. */
export function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return { median: rank(0.5), p95: rank(0.95), samples: sorted.length };
}

const warmupFrames = 60;
const sampleFrames = 120;

/** What the game lends the room: the player's reduced-motion setting, read each frame. */
export type CrystalComparisonOptions = { reducedMotion: () => boolean };

export function createCrystalComparisonRoom(
  host: HTMLElement,
  options: CrystalComparisonOptions,
): CrystalComparisonRoom {
  const root = document.createElement("section");
  root.className = "crystal-comparison";
  root.hidden = true;
  root.innerHTML = `
    <header class="crystal-comparison-header">
      <h1>Transparent materials bench</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <aside class="crystal-comparison-controls">
      <div data-part="backends" role="group" aria-label="Renderer"></div>
      <label>Count <input data-part="count" type="number" min="1" max="100" /></label>
      <p data-part="unsupported" class="crystal-comparison-note"></p>
      <fieldset data-part="tuning" class="crystal-comparison-tuning" hidden><legend>Tuning</legend></fieldset>
      <div class="crystal-comparison-copy">
        <button type="button" data-part="copy">Copy settings</button>
        <p data-part="copy-status" role="status"></p>
        <textarea data-part="copy-fallback" readonly hidden rows="10"
          aria-label="Settings JSON: select it and copy"></textarea>
      </div>
      <output data-part="stats" class="crystal-comparison-stats"></output>
    </aside>
    <div class="crystal-comparison-stage" data-part="stage"></div>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  part("stage").append(renderer.domElement);
  // Counted per animation frame across every pass a look draws (its capture and rear passes as
  // well as the main view), not just the last render call (#656 review).
  renderer.info.autoReset = false;
  // Its own reflections: the game's environment belongs to another WebGL context (#637 review).
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10161d);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 6);
  scene.add(sun);
  const backdrop = createBackdrop();
  scene.add(backdrop);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  const group = new THREE.Group();
  scene.add(group);

  let config: DevCrystalComparisonConfig | null = null;
  let backend = "current";
  /** The chosen look's own passes for this room's renderer, if it needs any (a capture). */
  let capture: RenderPass | null = null;
  /** Show the blocks through another backend, with a fresh capture of its own. */
  function choose(name: string): void {
    capture?.dispose();
    backend = name;
    capture = opticsBackends.get(name).capture?.() ?? null;
  }
  let slots: Slot[] = [];
  let frame = 0;
  let last: number | null = null;
  let warm = 0;
  let samples: number[] = [];
  let cpu: number[] = [];

  const view = { distance: 10, turnX: 0, turnY: 0 };
  const gesture = new Gesture(
    renderer.domElement,
    viewControls(
      view,
      () => playSfx("view.zoom"),
      () => playSfx("view.rotate"),
    ),
    {
      drag: { pointer: { capture: true } },
    },
  );

  function material(): BlockMaterial {
    return config!.material as BlockMaterial;
  }

  /** Free one slot's appearance, leaving its card and transform. */
  function release(slot: Slot): void {
    if (!slot.mesh || !slot.appearance) return;
    slot.mesh.removeFromParent();
    const { appearance } = slot;
    appearance.geometry.dispose();
    appearance.textures.forEach((texture) => texture.dispose());
    new Set([...appearance.materials, ...(appearance.boardMaterials ?? [])]).forEach((each) =>
      each.dispose(),
    );
    for (const extra of appearance.extras ?? [])
      for (const used of ([] as THREE.Material[]).concat(extra.material)) {
        (used as THREE.MeshStandardMaterial).map?.dispose();
        used.dispose();
      }
    slot.edges?.geometry.dispose();
    (slot.edges?.material as THREE.Material | undefined)?.dispose();
    slot.mesh = slot.appearance = slot.edges = undefined;
  }

  /** Rebuild every slot's appearance through the chosen backend, keeping its transform. */
  function build(): void {
    const definition = withOpticsBackend(getMaterialDefinition(material()), backend);
    for (const slot of slots) {
      release(slot);
      const appearance = createBlockAppearance(
        cardFaceArt(pokerIdentity(slot.card), { face: definition.cardFace }),
        definition,
        1,
      );
      const mesh = new THREE.Mesh(
        appearance.geometry,
        appearance.boardMaterials ?? appearance.materials,
      );
      mesh.renderOrder = appearance.faceLayer ?? 0;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(appearance.geometry),
        new THREE.LineBasicMaterial({
          color: appearance.edgeColor,
          transparent: appearance.edgeOpacity < 1,
          opacity: appearance.edgeOpacity,
        }),
      );
      mesh.add(edges, ...(appearance.extras ?? []));
      mesh.position.copy(slot.position);
      mesh.rotation.copy(slot.rotation);
      group.add(mesh);
      Object.assign(slot, { mesh, appearance, edges });
    }
    warm = 0;
    samples = [];
    cpu = [];
    part("unsupported").textContent = opticsBackends.get(backend).unsupported ?? "";
    showTuning();
    for (const button of part("backends").querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button.dataset.backend === backend));
  }

  /**
   * Copy the selected backend's complete settings as versioned JSON (#677;
   * doc/refractive-water-prototypes.md, "Copy settings"): reported as copied only once the
   * clipboard accepts it, else shown in a selectable box, so tuned values are never lost.
   */
  async function copySettings(): Promise<void> {
    playSfx("ui.click");
    const json = JSON.stringify(snapshotOptics(backend), null, 2);
    const status = part("copy-status");
    const fallback = part<HTMLTextAreaElement>("copy-fallback");
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(json);
      status.textContent = `${opticsBackends.get(backend).label} settings copied`;
      fallback.hidden = true;
    } catch {
      status.textContent = "Clipboard unavailable: select the settings below and copy them";
      fallback.value = json;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
  }

  /** The chosen backend's live controls, as its registration lists them (none for most). */
  function showTuning(): void {
    const controls = opticsBackends.get(backend).controls ?? [];
    const fieldset = part("tuning");
    fieldset.hidden = controls.length === 0;
    fieldset.querySelectorAll("label").forEach((label) => label.remove());
    for (const control of controls) {
      const label = document.createElement("label");
      // A choice is a dropdown, a number a slider: what each control is, its data says.
      const field = "options" in control ? choiceField(control) : sliderField(control);
      label.append(control.label, " ", ...field);
      fieldset.append(label);
    }
  }

  function choiceField(control: Extract<OpticsControl, { options: readonly string[] }>) {
    const select = document.createElement("select");
    for (const option of control.options) select.append(new Option(option, option));
    select.value = control.value();
    select.addEventListener("change", () => {
      playSfx("ui.click");
      control.set(select.value);
    });
    return [select];
  }

  function sliderField(control: Extract<OpticsControl, { min: number }>) {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(control.value());
    const shown = document.createElement("output");
    shown.textContent = String(control.value());
    input.addEventListener("input", () => {
      control.set(Number(input.value));
      shown.textContent = input.value;
    });
    return [input, " ", shown];
  }

  /** A new collection: only when the count changes, never when the backend does. */
  function layout(count: number): void {
    slots.forEach(release);
    slots = comparisonLayout(count, config!.seed);
    const columns = Math.ceil(Math.sqrt(count));
    view.distance = Math.max(5, columns * 3.2);
    build();
  }

  function tick(time: number): void {
    resize();
    camera.position.set(0, 0, view.distance);
    group.rotation.set(view.turnX, view.turnY, 0);
    camera.lookAt(0, 0, 0);
    renderer.info.reset();
    const start = performance.now();
    // Any passes the chosen look needs first (a background capture), as its backend declares,
    // with the presentation time since the last frame for a look that animates (#674).
    const delta = last === null ? 0 : (time - last) / 1000;
    capture?.render({
      renderer,
      scene,
      camera,
      hide: group,
      delta,
      reducedMotion: options.reducedMotion(),
    });
    renderer.render(scene, camera);
    const submitted = performance.now() - start;
    if (last !== null) {
      if (warm < warmupFrames) warm++;
      else {
        samples.push(time - last);
        cpu.push(submitted);
        if (samples.length > sampleFrames) {
          samples.shift();
          cpu.shift();
        }
      }
    }
    last = time;
    showStats();
    frame = requestAnimationFrame(tick);
  }

  function showStats(): void {
    const info = renderer.info;
    const size = renderer.getSize(new THREE.Vector2());
    const timing =
      warm < warmupFrames
        ? "warming up (shaders compiling)…"
        : (() => {
            const frames = distribution(samples);
            const submit = distribution(cpu);
            return `frame time ${frames.median.toFixed(1)} ms (p95 ${frames.p95.toFixed(1)}, ${frames.samples} frames) · CPU render submit ${submit.median.toFixed(2)} ms · GPU time not measured here`;
          })();
    part("stats").textContent = [
      `${opticsBackends.get(backend).label} · ${slots.length} blocks`,
      `${info.render.calls} draw calls · ${info.render.triangles} triangles · ${info.programs?.length ?? 0} programs`,
      timing,
      `${size.x}×${size.y} @${renderer.getPixelRatio()}x · ${navigator.userAgent}`,
    ].join("\n");
  }

  let stageSize = "";
  function resize(): void {
    const stage = part("stage");
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    if (`${width}x${height}` === stageSize) return;
    stageSize = `${width}x${height}`;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  part("copy").addEventListener("click", () => void copySettings());
  part("count").addEventListener("change", () => {
    playSfx("ui.click");
    layout(Math.max(1, Math.min(100, Number(part<HTMLInputElement>("count").value) || 1)));
  });

  return {
    show(next) {
      config = next;
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(next.backTo),
        window.location.href,
      ).href;
      choose(next.backends[0] ?? "current");
      part("backends").replaceChildren(
        ...next.backends.map((name) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.backend = name;
          button.textContent = opticsBackends.get(name).label;
          button.addEventListener("click", () => {
            playSfx("ui.click");
            choose(name);
            build();
          });
          return button;
        }),
      );
      part<HTMLInputElement>("count").value = String(next.count);
      root.hidden = false;
      // Blocks built here reflect this room's own environment, as in the object browser.
      setReflectionEnvironment(environment.texture);
      layout(next.count);
      last = null;
      frame = requestAnimationFrame(tick);
    },
    hide() {
      root.hidden = true;
      cancelAnimationFrame(frame);
      slots.forEach(release);
      slots = [];
      config = null;
    },
    dispose() {
      cancelAnimationFrame(frame);
      slots.forEach(release);
      gesture.destroy();
      capture?.dispose();
      capture = null;
      environment.dispose();
      (backdrop.material as THREE.MeshBasicMaterial).map?.dispose();
      (backdrop.material as THREE.Material).dispose();
      backdrop.geometry.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}

/** A patterned wall behind the blocks, so seeing through them (or not) is visible. */
function createBackdrop(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#2c5a3e" : "#1d3a2a";
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  wall.position.z = -6;
  return wall;
}
