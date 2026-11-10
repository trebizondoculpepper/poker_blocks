/**
 * The block design room (dev12, #296): audition letter blocks before choosing each material's
 * lettering font. Type a word; pick a material for each letter and a font for each material; the
 * real letter-block renderer (src/letter-block.ts) draws the result, turning. Nothing here
 * changes the game: choices are a preview, and **Copy config** copies them as JSON shaped like
 * the materials' `lettering` data, to paste into src/materials.ts or hand to an agent.
 *
 * Materials come from the `registered` material pool and fonts from the font catalogue
 * (src/visual/font-catalogue.ts), so new ones appear without touching this file.
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { playSfx } from "../audio/sfx";
import { gameModeFor, modeLink } from "../game-modes";
import { createLetterBlock } from "../letter-block";
import { materialPools, type BlockMaterial, type MaterialDefinition } from "../materials";
import { setReflectionEnvironment } from "../visual/block-appearance";
import { fontCatalogue, type CatalogueFont } from "../visual/font-catalogue";
import { defaultLettering, graphemes, type Lettering } from "../visual/lettering";
import "./block-designer.css";

export type BlockDesigner = { show(backTo: string): void; hide(): void; dispose(): void };

/** The catalogue entry matching a lettering, or a new entry for a font the catalogue lacks. */
function catalogued(lettering: Lettering): CatalogueFont {
  return (
    fontCatalogue.find(({ font }) => font === lettering.font) ?? {
      ...lettering,
      label: `${lettering.font} (current)`,
    }
  );
}

export function createBlockDesigner(host: HTMLElement): BlockDesigner {
  const root = document.createElement("section");
  root.className = "block-designer";
  root.hidden = true;
  root.innerHTML = `
    <header class="block-designer-header">
      <h1>Block design</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <aside class="block-designer-controls">
      <label>Word <input data-part="text" value="POKER" maxlength="12" /></label>
      <h2>Material per letter</h2>
      <ol data-part="letters"></ol>
      <h2>Font per material</h2>
      <ul data-part="fonts"></ul>
      <h2>Export</h2>
      <p class="block-designer-hint">Copies each material's chosen font as <code>lettering</code> data. Paste it into <code>src/materials.ts</code>, or hand it to an agent to apply.</p>
      <textarea data-part="export" readonly rows="10"></textarea>
      <button type="button" data-part="copy">Copy config</button>
    </aside>
    <div class="block-designer-stage" data-part="stage"></div>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;

  const materials = (): readonly MaterialDefinition[] => materialPools.get("registered")();
  /** The font chosen for each material, starting from its own lettering. */
  const fontFor = new Map<string, CatalogueFont>(
    materials().map((material) => [
      material.id,
      catalogued(material.lettering ?? defaultLettering),
    ]),
  );
  /** The material chosen for each letter position; new positions take the materials in turn. */
  const letterMaterials: string[] = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  part("stage").append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15212c);
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 5, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.6, 9);
  camera.lookAt(0, 0, 0);
  const row = new THREE.Group();
  scene.add(row);
  let built: { dispose(): void }[] = [];
  let generation = 0;
  let frame = 0;

  function characters(): string[] {
    return graphemes(part<HTMLInputElement>("text").value).filter((c) => !/\s/u.test(c));
  }

  /** Build the row of letter blocks again from the current choices. */
  async function rebuild(): Promise<void> {
    const mine = ++generation;
    const letters = characters();
    const pool = materials();
    letters.forEach((_, index) => (letterMaterials[index] ??= pool[index % pool.length]!.id));
    const made = await Promise.all(
      letters.map((character, index) => {
        const material = letterMaterials[index]!;
        return createLetterBlock(character, {
          material: material as BlockMaterial,
          lettering: fontFor.get(material),
        });
      }),
    );
    if (mine !== generation) {
      made.forEach((block) => block.dispose());
      return;
    }
    built.forEach((block) => block.dispose());
    row.clear();
    made.forEach((block, index) => {
      block.object.position.x = (index - (made.length - 1) / 2) * 1.25;
      row.add(block.object);
    });
    built = made;
    const width = Math.max(4, made.length * 1.25 + 1);
    camera.position.z = width / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + 1.5;
  }

  function option(value: string, label: string, selected: boolean): HTMLOptionElement {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    element.selected = selected;
    return element;
  }

  /** Redraw the controls (letters, fonts, export) and the blocks. */
  function refresh(): void {
    const letters = characters();
    const pool = materials();
    letters.forEach((_, index) => (letterMaterials[index] ??= pool[index % pool.length]!.id));
    const letterList = part("letters");
    letterList.replaceChildren(
      ...letters.map((character, index) => {
        const item = document.createElement("li");
        const select = document.createElement("select");
        select.append(...pool.map((m) => option(m.id, m.name, m.id === letterMaterials[index])));
        select.addEventListener("change", () => {
          letterMaterials[index] = select.value;
          playSfx("ui.click");
          refresh();
        });
        item.append(`${character} `, select);
        return item;
      }),
    );
    const used = new Set(letters.map((_, index) => letterMaterials[index]!));
    part("fonts").replaceChildren(
      ...pool
        .filter((material) => used.has(material.id))
        .map((material) => {
          const item = document.createElement("li");
          const select = document.createElement("select");
          const current = fontFor.get(material.id)!;
          const choices = fontCatalogue.some(({ font }) => font === current.font)
            ? fontCatalogue
            : [current, ...fontCatalogue];
          select.append(
            ...choices.map((font) => option(font.font, font.label, font.font === current.font)),
          );
          select.addEventListener("change", () => {
            fontFor.set(
              material.id,
              choices.find(({ font }) => font === select.value)!,
            );
            playSfx("ui.click");
            refresh();
          });
          item.append(`${material.name} `, select);
          return item;
        }),
    );
    part<HTMLTextAreaElement>("export").value = exportConfig();
    void rebuild();
  }

  /** Every material's chosen lettering, shaped like `MaterialDefinition["lettering"]`. */
  function exportConfig(): string {
    const lettering = Object.fromEntries(
      materials().map((material) => {
        const { font, fallback, weight } = fontFor.get(material.id)!;
        return [material.id, { font, fallback, weight }];
      }),
    );
    return JSON.stringify({ lettering }, null, 2);
  }

  part<HTMLInputElement>("text").addEventListener("input", refresh);
  part("copy").addEventListener("click", () => {
    void navigator.clipboard?.writeText(exportConfig());
    part("copy").textContent = "Copied";
    playSfx("ui.click");
    window.setTimeout(() => (part("copy").textContent = "Copy config"), 1200);
  });

  function resize(): void {
    const stage = part("stage");
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function spin(time: number): void {
    resize();
    row.children.forEach((block, index) => {
      block.rotation.y = time / 1600 + index * 0.35;
      block.rotation.x = Math.sin(time / 2100 + index) * 0.25;
    });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(spin);
  }

  return {
    show(backTo) {
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(backTo),
        window.location.href,
      ).href;
      // Blocks made in the room reflect its own studio; the game draws none here.
      setReflectionEnvironment(environment.texture);
      root.hidden = false;
      refresh();
      frame = requestAnimationFrame(spin);
    },
    hide() {
      root.hidden = true;
      cancelAnimationFrame(frame);
    },
    dispose() {
      cancelAnimationFrame(frame);
      built.forEach((block) => block.dispose());
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
