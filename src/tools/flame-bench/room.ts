/**
 * The Flame Bench (#1025; doc/audition-followups.md, "Flame Bench"): the materials its trait
 * configuration lists, side by side, each built by the real block appearance pipeline from its
 * own tuning of its contents (src/visual/tunable-effects.ts, #1024). No separate flame, shader or
 * simulation.
 *
 * Every preview is drawn with the same camera, lights, backdrop and pose, each in its own
 * viewport of one renderer, so a highlight that appears at some rotation can be compared across
 * them. The pose is the shared preview rotation (#746): a turntable until dragged, arrow keys,
 * Auto rotate and Reset view; the turntable holds still under reduced motion. Each preview owns
 * its tuning: controls come from the effect's registered descriptors, edits rebuild only that
 * preview, and Reset returns it to its material's own values. Container and contents can be shown
 * independently, to isolate which layer shines. Copy settings emits the versioned record, with a
 * selectable fallback when the clipboard refuses; pasted settings are validated through the same
 * descriptors and any problem is listed, changing nothing. Nothing is promoted to production.
 *
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { playSfx } from "../../audio/sfx";
import { Registry } from "../../core/registry";
import { pokerIdentity, standardDeck } from "../../cards";
import { gameModeFor, modeLink, type DevFlameBenchConfig } from "../../game-modes";
import {
  getMaterialDefinition,
  type BlockMaterial,
  type MaterialDefinition,
} from "../../materials";
import type { ParameterSchema } from "../../parameter-schema";
import { createPrepassContext } from "../../visual/appearance-prepass";
import {
  createBlockAppearance,
  setReflectionEnvironment,
  type BlockAppearance,
} from "../../visual/block-appearance";
import { setContainedVisibility } from "../../visual/contained";
import { cardFaceArt } from "../../visual/face-art";
import {
  copyEffectSettings,
  createEffectTuning,
  parseEffectSettings,
  serializeEffectSettings,
  type EffectTuning,
} from "../../visual/tunable-effects";
import { createPreviewRotation } from "../preview-rotation";
import { materialPreset, tunedDefinition } from "./presets";
import "./room.css";

export type FlameBenchRoom = {
  show(config: DevFlameBenchConfig): void;
  hide(): void;
  dispose(): void;
};

/** What the game lends the room: the player's reduced-motion setting, read each frame. */
export type FlameBenchOptions = { reducedMotion: () => boolean };

/** One preview: its material, its own tuning and layer visibility, and what is built from them. */
type Preview = {
  definition: MaterialDefinition;
  tuning: EffectTuning;
  visible: { container: boolean; contents: boolean };
  /** The tuning changed: rebuild before the next draw (at most once a frame). */
  stale: boolean;
  built?: { mesh: THREE.Mesh; appearance: BlockAppearance; releasePrepasses: () => void };
  panel: HTMLElement;
};

/** A parameter's control: built from its descriptor, reading and writing through the tuning. */
type ParameterControl = (
  schema: ParameterSchema,
  value: () => number | string,
  set: (value: number | string) => void,
) => { element: HTMLElement; refresh(): void };

/** Controls by the descriptor's own kind: a number is a slider, a choice a dropdown. */
const parameterControls = new Registry<ParameterControl>("parameter control");

parameterControls.register("number", (raw, value, set) => {
  const schema = raw as Extract<ParameterSchema, { kind: "number" }>;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(schema.min);
  input.max = String(schema.max);
  input.step = String(schema.step ?? (schema.max - schema.min) / 100);
  const shown = document.createElement("output");
  const refresh = () => {
    input.value = String(value());
    shown.textContent = Number(value()).toFixed(2);
  };
  input.addEventListener("input", () => {
    set(Number(input.value));
    refresh();
  });
  const wrapper = document.createElement("span");
  wrapper.append(input, " ", shown);
  refresh();
  return { element: wrapper, refresh };
});

parameterControls.register("choice", (raw, value, set) => {
  const schema = raw as Extract<ParameterSchema, { kind: "choice" }>;
  const select = document.createElement("select");
  for (const option of schema.options) select.append(new Option(option, option));
  const refresh = () => void (select.value = String(value()));
  select.addEventListener("change", () => {
    playSfx("ui.click");
    set(select.value);
  });
  refresh();
  return { element: select, refresh };
});

/** A unit block's bounding sphere at any rotation (half its diagonal), with a little margin. */
const previewRadius = (Math.sqrt(3) / 2) * 1.12;

/**
 * How far the camera stands so a preview fits both ways: the narrower of the vertical field of
 * view (degrees) and the horizontal one this aspect gives, never nearer than the default view.
 */
export function fittingDistance(fov: number, aspect: number): number {
  const vertical = THREE.MathUtils.degToRad(fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return Math.max(4.24, previewRadius / Math.sin(Math.min(vertical, horizontal)));
}

export function createFlameBenchRoom(
  host: HTMLElement,
  options: FlameBenchOptions,
): FlameBenchRoom {
  const root = document.createElement("section");
  root.className = "flame-bench";
  root.hidden = true;
  root.innerHTML = `
    <header class="flame-bench-header">
      <h1>Flame Bench</h1>
      <div class="flame-bench-view" role="group" aria-label="View">
        <button type="button" data-part="auto">Auto rotate</button>
        <button type="button" data-part="reset-view">Reset view</button>
      </div>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <div class="flame-bench-stage" data-part="stage"
      aria-label="Previews: drag or use the arrow keys to turn them"></div>
    <div class="flame-bench-panels" data-part="panels"></div>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string, within: ParentNode = root) =>
    within.querySelector<T>(`[data-part="${name}"]`)!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setScissorTest(true);
  part("stage").append(renderer.domElement);
  // Its own reflections: the game's environment belongs to another WebGL context (#637 review).
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  // One scene, one set of lights and one backdrop for every preview: only the block differs.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14110f);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3330, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const viewDirection = new THREE.Vector3(0, 0.6, 4.2).normalize();
  const prepasses = createPrepassContext();
  const rotation = createPreviewRotation(
    {},
    { turn: () => playSfx("view.rotate"), click: () => playSfx("ui.click") },
    camera,
  );
  part("auto").addEventListener("click", () => rotation.autoRotate());
  part("reset-view").addEventListener("click", () => rotation.reset());
  const unmountRotation = rotation.mount(part("stage"));

  let config: DevFlameBenchConfig | null = null;
  let previews: Preview[] = [];
  let frame = 0;
  let last: number | null = null;

  /** Free one preview's built block and its prepasses. */
  function release(preview: Preview): void {
    if (!preview.built) return;
    const { mesh, appearance, releasePrepasses } = preview.built;
    releasePrepasses();
    mesh.removeFromParent();
    appearance.geometry.dispose();
    appearance.textures.forEach((texture) => texture.dispose());
    new Set([...appearance.materials, ...(appearance.boardMaterials ?? [])]).forEach((each) =>
      each.dispose(),
    );
    for (const extra of appearance.extras ?? [])
      ([] as THREE.Material[]).concat(extra.material).forEach((used) => used.dispose());
    // Extras own geometry of their own too (the flame's box): free each once, never the block's.
    new Set((appearance.extras ?? []).map((extra) => extra.geometry)).forEach(
      (owned) => owned !== appearance.geometry && owned.dispose(),
    );
    preview.built = undefined;
  }

  /** Build one preview's block through the real pipeline from its current tuning. */
  function build(preview: Preview): void {
    release(preview);
    const definition = tunedDefinition(preview.definition, preview.tuning);
    const card = standardDeck[config!.card % standardDeck.length]!;
    const appearance = createBlockAppearance(
      cardFaceArt(pokerIdentity(card), { face: definition.cardFace }),
      definition,
      1,
    );
    const mesh = new THREE.Mesh(
      appearance.geometry,
      appearance.boardMaterials ?? appearance.materials,
    );
    mesh.renderOrder = appearance.faceLayer ?? 0;
    mesh.add(...(appearance.extras ?? []));
    setContainedVisibility(mesh, preview.visible);
    mesh.visible = false;
    scene.add(mesh);
    preview.built = {
      mesh,
      appearance,
      releasePrepasses: prepasses.require(appearance.prepasses ?? []),
    };
    preview.stale = false;
  }

  function panel(preview: Preview): HTMLElement {
    const { tuning } = preview;
    const element = document.createElement("section");
    element.className = "flame-bench-panel";
    element.innerHTML = `
      <h2></h2>
      <fieldset class="flame-bench-layers"><legend>Layers</legend>
        <label><input type="checkbox" data-part="container" checked /> Container</label>
        <label><input type="checkbox" data-part="contents" checked /> Contents</label>
      </fieldset>
      <fieldset class="flame-bench-parameters" data-part="parameters"><legend>Parameters</legend></fieldset>
      <div class="flame-bench-actions">
        <button type="button" data-part="reset">Reset</button>
        <button type="button" data-part="copy">Copy settings</button>
      </div>
      <p data-part="copy-status" role="status"></p>
      <textarea data-part="copy-fallback" readonly hidden rows="8"
        aria-label="Settings JSON: select it and copy"></textarea>
      <details>
        <summary>Paste settings</summary>
        <textarea data-part="paste" rows="6" aria-label="Settings JSON to apply"></textarea>
        <button type="button" data-part="apply">Apply</button>
        <ul data-part="problems" role="alert"></ul>
      </details>`;
    element.querySelector("h2")!.textContent =
      `${preview.definition.name} (${tuning.preset.handle})`;
    const changed = () => void (preview.stale = true);
    const controls = Object.entries(tuning.parameters).map(([name, schema]) => {
      const label = document.createElement("label");
      const control = parameterControls.get(schema.kind)(
        schema,
        () => tuning.values()[name]!,
        (value) => {
          if (!tuning.set(name, value).length) changed();
        },
      );
      label.append(schema.label, " ", control.element);
      part("parameters", element).append(label);
      return control;
    });
    const refresh = () => controls.forEach((control) => control.refresh());
    for (const layer of ["container", "contents"] as const) {
      const box = part<HTMLInputElement>(layer, element);
      box.addEventListener("change", () => {
        playSfx("ui.click");
        preview.visible = { ...preview.visible, [layer]: box.checked };
        if (preview.built) setContainedVisibility(preview.built.mesh, preview.visible);
      });
    }
    part("reset", element).addEventListener("click", () => {
      playSfx("ui.click");
      tuning.reset();
      refresh();
      changed();
    });
    part("copy", element).addEventListener("click", () => {
      playSfx("ui.click");
      const settings = tuning.settings();
      const fallback = part<HTMLTextAreaElement>("copy-fallback", element);
      // The text is shown until the clipboard accepts it, so a clipboard that never answers
      // still leaves the settings selectable.
      fallback.value = serializeEffectSettings(settings);
      fallback.hidden = false;
      part("copy-status", element).textContent = "Copying…";
      void copyEffectSettings(settings).then((result) => {
        part("copy-status", element).textContent = result.copied
          ? "Settings copied"
          : `Clipboard unavailable (${result.reason}): select the settings below and copy them`;
        fallback.hidden = result.copied;
        fallback.value = result.text;
        if (!result.copied) fallback.select();
      });
    });
    part("apply", element).addEventListener("click", () => {
      const parsed = parseEffectSettings(part<HTMLTextAreaElement>("paste", element).value);
      const problems = parsed.settings ? tuning.apply(parsed.settings) : parsed.problems;
      part("problems", element).replaceChildren(
        ...problems.map((problem) => {
          const item = document.createElement("li");
          item.textContent = problem;
          return item;
        }),
      );
      playSfx(problems.length ? "action.denied" : "ui.click");
      if (problems.length) return;
      refresh();
      changed();
    });
    return element;
  }

  let stageSize = "";
  function resize(): void {
    const stage = part("stage");
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    if (`${width}x${height}` === stageSize) return;
    stageSize = `${width}x${height}`;
    renderer.setSize(width, height, false);
  }

  function tick(time: number): void {
    resize();
    const seconds = last === null ? 0 : Math.min((time - last) / 1000, 0.1);
    last = time;
    // The turntable holds still under reduced motion; a drag or key still turns the pose.
    rotation.update(options.reducedMotion() ? 0 : seconds, null);
    previews.filter(({ stale }) => stale).forEach(build);
    const size = renderer.getSize(new THREE.Vector2());
    const width = size.x / Math.max(1, previews.length);
    camera.aspect = width / size.y;
    camera.updateProjectionMatrix();
    // However narrow a preview's viewport, the whole block fits at any rotation (#1025 review).
    camera.position.copy(viewDirection).multiplyScalar(fittingDistance(camera.fov, camera.aspect));
    camera.lookAt(0, 0, 0);
    previews.forEach((preview, index) => {
      const mesh = preview.built!.mesh;
      mesh.quaternion.copy(rotation.pose);
      mesh.visible = true;
      renderer.setViewport(index * width, 0, width, size.y);
      renderer.setScissor(index * width, 0, width, size.y);
      prepasses.render({
        renderer,
        scene,
        camera,
        hide: mesh,
        delta: seconds,
        reducedMotion: options.reducedMotion(),
      });
      renderer.render(scene, camera);
      mesh.visible = false;
    });
    frame = requestAnimationFrame(tick);
  }

  function clear(): void {
    cancelAnimationFrame(frame);
    previews.forEach(release);
    previews = [];
    part("panels").replaceChildren();
  }

  return {
    show(next) {
      clear();
      config = next;
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(next.backTo),
        window.location.href,
      ).href;
      // Blocks built here reflect this room's own environment, as in the object browser.
      setReflectionEnvironment(environment.texture);
      previews = next.previews.map((id) => {
        const definition = getMaterialDefinition(id as BlockMaterial);
        const preview: Preview = {
          definition,
          tuning: createEffectTuning(materialPreset(definition)),
          visible: { container: true, contents: true },
          stale: true,
          panel: document.createElement("section"),
        };
        preview.panel = panel(preview);
        return preview;
      });
      part("panels").replaceChildren(...previews.map(({ panel }) => panel));
      root.hidden = false;
      last = null;
      frame = requestAnimationFrame(tick);
    },
    hide() {
      root.hidden = true;
      clear();
      config = null;
    },
    dispose() {
      clear();
      unmountRotation();
      prepasses.dispose();
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
