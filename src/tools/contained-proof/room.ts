/**
 * The contained-components proof room (dev15, #346; contracts in doc/game-architecture.md,
 * "Contained components"). A bounded rendering experiment, not the production fluid: it shows
 * glass + refractive water + a fading wall film together, turning independently, some
 * overlapping, over a patterned backdrop (so refraction shows), and measures them against the
 * custard baseline.
 *
 * - **Vessel:** the custard baseline or the glass/water/film proof.
 * - **Film storage:** per vertex of a subdivided box, or a per-face texture atlas.
 * - **Resolution:** samples per face edge for the film.
 * - **Count:** how many vessels; **Overlap** packs them so they cover one another.
 * - **Measure** records 240 frames: mean and 95th-percentile frame time, update time, draw
 *   calls, triangles and film memory, as a Markdown row to paste into the issue or the doc.
 *
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { playSfx } from "../../audio/sfx";
import { gameModeFor, modeLink } from "../../game-modes";
import { vesselBuilders, type ProofVessel } from "./vessels";
import "./room.css";

export type ContainedProofRoom = { show(backTo: string): void; hide(): void; dispose(): void };

const header =
  "| Vessel | Storage | Resolution | Count | Overlap | Mean ms | p95 ms | Update ms | Calls | Triangles | Film KB/vessel | Samples/vessel |\n|---|---|---|---|---|---|---|---|---|---|---|---|";

export function createContainedProofRoom(host: HTMLElement): ContainedProofRoom {
  const root = document.createElement("section");
  root.className = "contained-proof";
  root.hidden = true;
  root.innerHTML = `
    <header class="contained-proof-header">
      <h1>Contained components proof</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <aside class="contained-proof-controls">
      <label>Vessel <select data-part="vessel">
        <option value="glassWaterFilm">Glass + water + film</option>
        <option value="custard">Custard (baseline)</option>
      </select></label>
      <label>Film storage <select data-part="storage">
        <option value="faceTexture">Per-face texture</option>
        <option value="vertex">Per vertex</option>
      </select></label>
      <label>Resolution <select data-part="resolution">
        <option>8</option><option>16</option><option selected>32</option><option>64</option>
      </select></label>
      <label>Count <input data-part="count" type="number" min="1" max="64" value="8" /></label>
      <label><input data-part="overlap" type="checkbox" checked /> Overlap</label>
      <label><input data-part="tumble" type="checkbox" checked /> Tumble</label>
      <button type="button" data-part="measure">Measure</button>
      <p data-part="live" class="contained-proof-live"></p>
      <textarea data-part="results" readonly rows="10"></textarea>
      <button type="button" data-part="copy">Copy results</button>
    </aside>
    <div class="contained-proof-stage" data-part="stage"></div>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;
  const value = (name: string) => part<HTMLInputElement>(name).value;
  const checked = (name: string) => part<HTMLInputElement>(name).checked;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  part("stage").append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15212c);
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 5, 6);
  scene.add(sun);
  scene.add(backdrop());
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.8, 11);
  camera.lookAt(0, 0, 0);
  const group = new THREE.Group();
  scene.add(group);

  let vessels: ProofVessel[] = [];
  let frame = 0;
  let results: string[] = [];
  let measuring: { frames: number[]; updates: number[]; calls: number; triangles: number } | null =
    null;
  let lastTime: number | null = null;

  function rebuild(): void {
    vessels.forEach((vessel) => vessel.dispose());
    group.clear();
    const build = vesselBuilders.get(value("vessel"))!;
    const count = Math.max(1, Math.min(64, Number(value("count")) || 1));
    const columns = Math.ceil(Math.sqrt(count));
    const spacing = checked("overlap") ? 0.8 : 1.5;
    vessels = Array.from({ length: count }, (_, index) => {
      const vessel = build({
        environment: environment.texture,
        storage: value("storage"),
        coating: {
          seconds: 4,
          opacity: 0.45,
          colour: 0x9ad6f5,
          resolution: Number(value("resolution")),
        },
      });
      const column = index % columns;
      const row = Math.floor(index / columns);
      vessel.object.position.set(
        (column - (columns - 1) / 2) * spacing,
        ((Math.ceil(count / columns) - 1) / 2 - row) * spacing,
        // Overlapping vessels are staggered in depth, so they cover one another.
        checked("overlap") ? (index % 2) * -0.6 : 0,
      );
      group.add(vessel.object);
      return vessel;
    });
    camera.position.z = Math.max(6, columns * spacing * 2.6);
  }

  function tick(time: number): void {
    resize();
    const seconds = time / 1000;
    vessels.forEach((vessel, index) => {
      // Each vessel turns on its own: independent motion is what the proof must survive.
      const turn = checked("tumble") ? 1 : 0.15;
      vessel.object.rotation.set(
        Math.sin(seconds * 0.7 + index * 1.3) * 1.4 * turn,
        seconds * 0.4 + index,
        Math.cos(seconds * 0.5 + index * 0.7) * 1.1 * turn,
      );
    });
    const before = performance.now();
    vessels.forEach((vessel) => vessel.update(seconds));
    const updated = performance.now() - before;
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;
    if (measuring && lastTime !== null) {
      measuring.frames.push(time - lastTime);
      measuring.updates.push(updated);
      measuring.calls = calls;
      measuring.triangles = triangles;
      if (measuring.frames.length >= 240) finishMeasure();
    }
    lastTime = time;
    part("live").textContent =
      `${vessels.length} vessels · ${calls} draw calls · ${Math.round(triangles / 1000)}k triangles · update ${updated.toFixed(2)} ms`;
    frame = requestAnimationFrame(tick);
  }

  function finishMeasure(): void {
    const run = measuring!;
    measuring = null;
    const sorted = [...run.frames].sort((a, b) => a - b);
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const first = vessels[0]!;
    results.push(
      `| ${value("vessel")} | ${first.samples ? value("storage") : "—"} | ${first.samples ? value("resolution") : "—"} | ${vessels.length} | ${checked("overlap") ? "yes" : "no"} | ${mean(run.frames).toFixed(2)} | ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(2)} | ${mean(run.updates).toFixed(3)} | ${run.calls} | ${run.triangles} | ${(first.bytes / 1024).toFixed(1)} | ${first.samples} |`,
    );
    part<HTMLTextAreaElement>("results").value = [environmentLine(), "", header, ...results].join(
      "\n",
    );
    part("measure").textContent = "Measure";
  }

  function environmentLine(): string {
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown GPU";
    const size = renderer.getSize(new THREE.Vector2());
    return `${navigator.userAgent} · ${gpu} · ${size.x}×${size.y} @${renderer.getPixelRatio()}x`;
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

  for (const name of ["vessel", "storage", "resolution", "count", "overlap"])
    part(name).addEventListener("change", () => {
      playSfx("ui.click");
      rebuild();
    });
  part("measure").addEventListener("click", () => {
    playSfx("ui.click");
    measuring = { frames: [], updates: [], calls: 0, triangles: 0 };
    part("measure").textContent = "Measuring…";
  });
  part("copy").addEventListener("click", () => {
    void navigator.clipboard?.writeText(part<HTMLTextAreaElement>("results").value);
    playSfx("ui.click");
  });

  return {
    show(backTo) {
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(backTo),
        window.location.href,
      ).href;
      root.hidden = false;
      rebuild();
      lastTime = null;
      frame = requestAnimationFrame(tick);
    },
    hide() {
      root.hidden = true;
      cancelAnimationFrame(frame);
    },
    dispose() {
      cancelAnimationFrame(frame);
      vessels.forEach((vessel) => vessel.dispose());
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}

/** A bright checked wall behind the vessels, so refraction through the water is visible. */
function backdrop(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#e8d9b0" : "#2f5d7c";
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  wall.position.z = -4;
  return wall;
}
