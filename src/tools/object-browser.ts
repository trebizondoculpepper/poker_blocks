/**
 * The developer object browser (dev9): every object the game defines, by category, one page
 * each, with a turning preview drawn by the game's own renderer and a table of its properties.
 * A page has its own address (`#materials/wood`), so it can be linked to.
 *
 * Categories are read from the game's registries, so a new material, passive or sound appears
 * here without touching this file. Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { soundEffects } from "../audio/sfx-registry";
import usage from "../audio/sfx-usage.json";
import { standardDeck } from "../cards";
import { gameModeFor, modeLink } from "../game-modes";
import { experimentalMaterials, materialDefinitions, type MaterialDefinition } from "../materials";
import { passiveAppearance, createPassiveBlock, passiveDefinitions } from "../passives";
import { createPassiveVisual } from "../passive-visual";
import { createBlockAppearance, setReflectionEnvironment } from "../visual/block-appearance";
import "./object-browser.css";

export type ObjectBrowser = { show(backTo: string): void; hide(): void; dispose(): void };

/** One object's page: what it is called, what it is made of, and how to draw it. */
type BrowsedObject = {
  id: string;
  name: string;
  /** A note under the name (an experiment, a retired passive). */
  note?: string;
  properties: unknown;
  /** A model to turn in the preview, or nothing for objects without one (a sound). */
  preview?: (size: number) => { object: THREE.Object3D; dispose(): void };
};

type Category = { id: string; label: string; objects: () => BrowsedObject[] };

/** A card to dress in each material: the same card for every page, so only the material differs. */
const sampleCard = standardDeck[0]!;

function materialPage(definition: MaterialDefinition, note?: string): BrowsedObject {
  return {
    id: definition.id,
    name: definition.name,
    note,
    properties: definition,
    preview(size) {
      const appearance = createBlockAppearance(sampleCard.traits.identity, definition, size);
      const cube = new THREE.Mesh(
        appearance.geometry,
        appearance.boardMaterials ?? appearance.materials,
      );
      for (const extra of appearance.extras ?? []) cube.add(extra);
      return {
        object: cube,
        dispose() {
          appearance.geometry.dispose();
          appearance.textures.forEach((texture) => texture.dispose());
          new Set([...appearance.materials, ...(appearance.boardMaterials ?? [])]).forEach(
            (material) => material.dispose(),
          );
          for (const extra of appearance.extras ?? [])
            ([] as THREE.Material[]).concat(extra.material).forEach((m) => m.dispose());
        },
      };
    },
  };
}

/** The categories, each listed from its registry. */
const categories: readonly Category[] = [
  {
    id: "materials",
    label: "Materials",
    objects: () => [
      ...materialDefinitions.map((definition) => materialPage(definition)),
      ...experimentalMaterials.map((definition) =>
        materialPage(definition, "Visual experiment: not dealt in the game"),
      ),
    ],
  },
  {
    id: "passives",
    label: "Passives",
    objects: () =>
      passiveDefinitions.names().map((id) => {
        const definition = passiveDefinitions.get(id);
        return {
          id,
          name: definition.name,
          note: definition.retired ? "Retired: never offered" : undefined,
          properties: definition,
          preview(size) {
            const visual = createPassiveVisual(
              passiveAppearance(createPassiveBlock(id, `browser.${id}`)),
              size,
            );
            return {
              object: new THREE.Mesh(visual.geometry, visual.materials),
              dispose: () => visual.dispose(),
            };
          },
        };
      }),
  },
  {
    id: "sounds",
    label: "Sounds",
    objects: () =>
      soundEffects.map((effect) => ({
        id: effect.id,
        name: effect.name,
        properties: {
          ...effect,
          usage: (usage as Record<string, unknown>)[effect.id] ?? { uses: 0, files: {} },
        },
      })),
  },
];

export function createObjectBrowser(host: HTMLElement): ObjectBrowser {
  const root = document.createElement("section");
  root.className = "object-browser";
  root.hidden = true;
  root.innerHTML = `
    <header class="object-browser-header">
      <h1>Object browser</h1>
      <a class="object-browser-back" data-browser="back">Back to the game</a>
    </header>
    <nav class="object-browser-categories" data-browser="categories"></nav>
    <ol class="object-browser-list" data-browser="list"></ol>
    <article class="object-browser-page" data-browser="page">
      <h2 data-browser="name"></h2>
      <p class="object-browser-id" data-browser="id"></p>
      <p class="object-browser-note" data-browser="note"></p>
      <div class="object-browser-preview" data-browser="preview"></div>
      <table class="object-browser-properties"><tbody data-browser="properties"></tbody></table>
    </article>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-browser="${name}"]`)!;

  // The preview: the game's own block and token builders, drawn by a small renderer of its own.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(320, 320);
  part("preview").append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3226, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.6, 6.2);
  camera.lookAt(0, 0, 0);
  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  let shown: { object: THREE.Object3D; dispose(): void } | null = null;
  let frame = 0;

  function spin(time: number): void {
    if (shown) {
      shown.object.rotation.y = time / 1600;
      shown.object.rotation.x = -0.35 + Math.sin(time / 2300) * 0.15;
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(spin);
  }

  function showPreview(object: BrowsedObject): void {
    if (shown) {
      scene.remove(shown.object);
      shown.dispose();
      shown = null;
    }
    part("preview").hidden = !object.preview;
    if (!object.preview) return;
    shown = object.preview(2.2);
    scene.add(shown.object);
  }

  /** The properties as rows: nested objects flatten to dotted paths. */
  function showProperties(properties: unknown): void {
    const rows: [string, string][] = [];
    const walk = (value: unknown, path: string) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) rows.push([path, "{}"]);
        for (const [key, inner] of entries) walk(inner, path ? `${path}.${key}` : key);
      } else {
        rows.push([path, JSON.stringify(value)]);
      }
    };
    walk(properties, "");
    const body = part("properties");
    body.replaceChildren(
      ...rows.map(([key, value]) => {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        name.textContent = key;
        const text = document.createElement("td");
        text.textContent = value;
        row.append(name, text);
        return row;
      }),
    );
  }

  /** Show the page for `#category/object`, or the first object of the first category. */
  function route(): void {
    const [categoryId, objectId] = window.location.hash.slice(1).split("/");
    const category = categories.find(({ id }) => id === categoryId) ?? categories[0]!;
    const objects = category.objects();
    const object = objects.find(({ id }) => id === objectId) ?? objects[0]!;
    part("categories").replaceChildren(
      ...categories.map(({ id, label }) => {
        const link = document.createElement("a");
        link.href = `#${id}`;
        link.textContent = label;
        link.classList.toggle("is-current", id === category.id);
        return link;
      }),
    );
    part("list").replaceChildren(
      ...objects.map(({ id, name }) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${category.id}/${id}`;
        link.textContent = name;
        link.classList.toggle("is-current", id === object.id);
        item.append(link);
        return item;
      }),
    );
    part("name").textContent = object.name;
    part("id").textContent = `${category.id}/${object.id}`;
    part("note").textContent = object.note ?? "";
    part("note").hidden = !object.note;
    showPreview(object);
    showProperties(object.properties);
  }

  return {
    show(backTo) {
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(backTo),
        window.location.href,
      ).href;
      // Blocks made while the browser is open reflect its own room; the game draws none here.
      setReflectionEnvironment(environment.texture);
      root.hidden = false;
      window.addEventListener("hashchange", route);
      route();
      frame = requestAnimationFrame(spin);
    },
    hide() {
      root.hidden = true;
      window.removeEventListener("hashchange", route);
      cancelAnimationFrame(frame);
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", route);
      shown?.dispose();
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
