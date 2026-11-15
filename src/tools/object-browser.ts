import { releaseStatusPresentation, type ReleaseStatusPresentation } from "../release-status";
import { playSfx } from "../audio/sfx";
import { createPreviewRotation } from "./preview-rotation";
import { cardFaceArt, type CardFaceOptions } from "../visual/face-art";
import { rankFaceDefinitions } from "../visual/rank-faces";
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
import { standardDeck, pokerIdentity } from "../cards";
import { gameModeFor, modeLink } from "../game-modes";
import {
  experimentalMaterials,
  getMaterialDefinition,
  materialDefinitions,
  type BlockMaterial,
  type MaterialDefinition,
} from "../materials";
import { passiveAppearance, createPassiveBlock, passiveDefinitions } from "../passives";
import { createPassiveVisual } from "../passive-visual";
import { createBlockAppearance, setReflectionEnvironment } from "../visual/block-appearance";
import { createPrepassContext, type PrepassReference } from "../visual/appearance-prepass";
import { massKg, weightLine } from "../physical-mass";
import { cosmeticRandom, createBlockEffects, type BlockEffect } from "../visual/block-effects";
import "./object-browser.css";

export type ObjectBrowser = { show(backTo: string): void; hide(): void; dispose(): void };

/** One object's page: what it is called, what it is made of, and how to draw it. */
type BrowsedObject = {
  id: string;
  name: string;
  /** A note under the name (an experiment, a retired passive). */
  note?: string;
  /** Its release status's public presentation (#813, #923): a list badge and page lines, if any. */
  status?: ReleaseStatusPresentation;
  /** A link to where it can be experienced (#1012), with a short explanation. */
  action?: { label: string; href: string; note: string };
  properties: unknown;
  /** A model to turn in the preview, or nothing for objects without one (a sound). */
  /** A preview, with any prepasses its look declares (#971) for the browser's own renderer. */
  preview?: (size: number) => {
    object: THREE.Object3D;
    prepasses?: readonly PrepassReference[];
    /**
     * Its look's ongoing effects (dust, smoke, #1011), built as the table builds them: they live
     * in the preview's world space and are driven by the preview object's real pose each frame.
     */
    effects?: readonly BlockEffect[];
    dispose(): void;
  };
};

type Category = { id: string; label: string; objects: () => BrowsedObject[] };

/** A card to dress in each material: the same card for every page, so only the material differs. */
const sampleCard = standardDeck[0]!;

function materialPage(
  definition: MaterialDefinition,
  note?: string,
  page: {
    card?: typeof sampleCard;
    options?: CardFaceOptions;
    id?: string;
    name?: string;
    properties?: unknown;
  } = {},
): BrowsedObject {
  const { card = sampleCard, options = {}, id = definition.id, name = definition.name } = page;
  // Every material sheet shows its authored mass (#1069), from the definition's own recipe.
  // An instance-derived recipe (a Present's, #1068) states its rule: a definition has no instance.
  const weight =
    "provider" in definition.mass
      ? `Weight: ${definition.mass.rule}`
      : weightLine(massKg(definition.mass));
  return {
    id,
    name,
    note: note ? `${note}\n${weight}` : weight,
    status: releaseStatusPresentation(definition.id, definition.releaseStatus),
    // The caller says what the page shows: the material's definition unless told otherwise.
    properties: page.properties ?? definition,
    preview(size) {
      const appearance = createBlockAppearance(
        cardFaceArt(pokerIdentity(card), { face: definition.cardFace, ...options }),
        definition,
        size,
      );
      const cube = new THREE.Mesh(
        appearance.geometry,
        appearance.boardMaterials ?? appearance.materials,
      );
      for (const extra of appearance.extras ?? []) cube.add(extra);
      const effects = previewEffects(definition, size);
      return {
        object: cube,
        prepasses: appearance.prepasses,
        effects,
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
/**
 * Rank glyph styles (#489): every rank that carries a style, in it and plain, on a few
 * representative materials, so the combining marks can be judged in the real canvas fonts.
 */
function rankStylePages(): BrowsedObject[] {
  const auditioned = ["paper", "wood", "steel", "ice", "gold"].map((id) =>
    getMaterialDefinition(id as BlockMaterial),
  );
  return rankFaceDefinitions.flatMap(({ rank, styles }) =>
    Object.keys(styles ?? {}).flatMap((style) => {
      const card = standardDeck.find((card) => pokerIdentity(card).rank === rank)!;
      return auditioned.flatMap((definition) =>
        [undefined, style].map((rankStyle) =>
          materialPage(
            definition,
            rankStyle ? `Rank style: ${rankStyle}` : "Plain glyph, for comparison",
            {
              card,
              options: { rankStyle },
              id: `${rank}-${definition.id}-${rankStyle ?? "plain"}`,
              name: `${rank} ${rankStyle ?? "plain"} · ${definition.name}`,
              properties: { rank, rankStyle: rankStyle ?? null, material: definition.id },
            },
          ),
        ),
      );
    }),
  );
}

const categories: readonly Category[] = [
  { id: "rank-glyphs", label: "Rank glyphs", objects: rankStylePages },
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
          status: releaseStatusPresentation(definition.id, definition.releaseStatus),
          properties: definition,
          preview(size) {
            const visual = createPassiveVisual(
              passiveAppearance(createPassiveBlock(id, `browser.${id}`)),
              size,
            );
            const object = new THREE.Mesh(visual.geometry, visual.materials);
            object.add(...(visual.extras ?? []));
            return { object, prepasses: visual.prepasses, dispose: () => visual.dispose() };
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
        // The browser shows a sound's record; the listening room plays it (#1012).
        action: {
          label: "Open in listening room",
          href: listeningRoomLink(effect.id),
          note: "Opens the sound's row in the listening room, ready to play. Nothing plays until you press it.",
        },
        properties: {
          ...effect,
          usage: (usage as Record<string, unknown>)[effect.id] ?? { uses: 0, files: {} },
        },
      })),
  },
];

/** The same-origin listening room, opened at one registered sound (#1012). */
export function listeningRoomLink(id: string): string {
  return `/sfx.html?sound=${encodeURIComponent(id)}`;
}

/**
 * Whether an entry matches a search (#1007; doc/audition-followups.md): a case-insensitive
 * substring of its display name or its opaque ID. The ID is searched as text, never interpreted.
 */
export function matchesSearch(object: { id: string; name: string }, search: string): boolean {
  const wanted = search.trim().toLocaleLowerCase();
  return (
    !wanted ||
    object.name.toLocaleLowerCase().includes(wanted) ||
    object.id.toLocaleLowerCase().includes(wanted)
  );
}

/**
 * A preview's ongoing appearance effects (#1011): built from the definition's own `effects`
 * through the shared registry, exactly as the table builds them. Nothing here names an effect.
 */
export function previewEffects(definition: MaterialDefinition, size: number): BlockEffect[] {
  return createBlockEffects(definition.appearance.effects ?? [], { random: cosmeticRandom, size });
}

export function createObjectBrowser(
  host: HTMLElement,
  /** The player's reduced-motion preference: preview effects emit nothing new under it (#1011). */
  reducedMotion: () => boolean = () => false,
): ObjectBrowser {
  const root = document.createElement("section");
  root.className = "object-browser";
  root.hidden = true;
  root.innerHTML = `
    <header class="object-browser-header">
      <h1>Object browser</h1>
      <a class="object-browser-back" data-browser="back">Back to the game</a>
    </header>
    <nav class="object-browser-categories" data-browser="categories"></nav>
    <div class="object-browser-index">
    <div class="object-browser-search" role="search">
      <label for="object-browser-search">Search this category</label>
      <input id="object-browser-search" type="search" autocomplete="off" spellcheck="false"
        placeholder="Name or ID" data-browser="search" />
      <button type="button" data-browser="clear">Clear</button>
    </div>
    <p class="object-browser-empty" data-browser="empty" role="status" hidden></p>
    <ol class="object-browser-list" data-browser="list"></ol>
    </div>
    <article class="object-browser-page" data-browser="page">
      <h2 data-browser="name"></h2>
      <p class="object-browser-id" data-browser="id"></p>
      <p class="object-browser-note" data-browser="note"></p>
      <p class="object-browser-status-line" data-browser="status"></p>
      <p class="object-browser-action" data-browser="action-row">
        <a data-browser="action" target="_blank" rel="noopener"></a>
        <span data-browser="action-note"></span>
      </p>
      <div class="object-browser-preview" data-browser="preview"></div>
      <div class="object-browser-view" data-browser="view">
        <button type="button" data-browser="auto">Auto rotate</button>
        <button type="button" data-browser="reset">Reset view</button>
      </div>
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
  let shown: ReturnType<NonNullable<BrowsedObject["preview"]>> | null = null;
  // The preview's prepasses, on this renderer's own targets (#971).
  const prepasses = createPrepassContext();
  let releasePrepasses = () => {};
  let frame = 0;

  // The preview's pose (#746): turntable until dragged, then wherever the drag leaves it. It
  // belongs to the browser, not the entry, so switching entries keeps the view.
  const rotation = createPreviewRotation(
    {},
    { turn: () => playSfx("view.rotate"), click: () => playSfx("ui.click") },
    camera,
  );
  part("auto").addEventListener("click", () => rotation.autoRotate());
  part("reset").addEventListener("click", () => rotation.reset());
  let unmountRotation: (() => void) | null = null;
  let lastTime: number | null = null;

  function spin(time: number): void {
    const seconds = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    rotation.update(seconds, shown?.object ?? null);
    // Ongoing effects read the preview's actual world pose, so turning it releases dust (#1011).
    if (shown) {
      shown.object.updateWorldMatrix(true, false);
      const reduced = reducedMotion();
      for (const effect of shown.effects ?? []) effect.update(seconds, shown.object, reduced);
    }
    prepasses.render({
      renderer,
      scene,
      camera,
      hide: scene,
      delta: seconds,
      reducedMotion: false,
    });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(spin);
  }

  /** Release the shown preview: its prepasses, its effects and its own resources. */
  function releasePreview(): void {
    if (!shown) return;
    releasePrepasses();
    releasePrepasses = () => {};
    scene.remove(shown.object);
    for (const effect of shown.effects ?? []) {
      effect.object.removeFromParent();
      effect.dispose();
    }
    shown.dispose();
    shown = null;
  }

  function showPreview(object: BrowsedObject): void {
    releasePreview();
    part("preview").hidden = !object.preview;
    part("view").hidden = !object.preview;
    if (!object.preview) return;
    const preview = object.preview(2.2);
    shown = preview;
    releasePrepasses = prepasses.require(preview.prepasses ?? []);
    scene.add(shown.object);
    for (const effect of shown.effects ?? []) scene.add(effect.object);
    // A new entry: any drag in progress ends (its handlers are replaced), the pose stays.
    if (unmountRotation) {
      unmountRotation();
      unmountRotation = rotation.mount(part("preview"));
    }
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

  /** The category's list, narrowed by the search; the open page and its preview stay put. */
  let current: { category: Category; objects: BrowsedObject[]; selected: string } | null = null;
  function renderList(): void {
    if (!current) return;
    const { category, objects, selected } = current;
    const search = part<HTMLInputElement>("search").value;
    const shown = objects.filter((entry) => matchesSearch(entry, search));
    part("empty").hidden = shown.length > 0;
    part("empty").textContent = shown.length
      ? ""
      : `No ${category.label.toLowerCase()} match “${search.trim()}”.`;
    part("clear").hidden = !search;
    part("list").replaceChildren(
      ...shown.map(({ id, name, status }) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${category.id}/${id}`;
        link.textContent = name;
        if (status?.badge) {
          const badge = document.createElement("span");
          badge.className = "object-browser-status";
          badge.textContent = status.badge;
          link.append(" ", badge);
        }
        link.classList.toggle("is-current", id === selected);
        item.append(link);
        return item;
      }),
    );
  }
  part("search").addEventListener("input", renderList);
  part("search").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    part<HTMLInputElement>("search").value = "";
    renderList();
  });
  part("clear").addEventListener("click", () => {
    part<HTMLInputElement>("search").value = "";
    renderList();
    part("search").focus();
  });

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
    // A search narrows one category: opening another starts it afresh.
    if (current && current.category !== category) part<HTMLInputElement>("search").value = "";
    current = { category, objects, selected: object.id };
    renderList();
    part("name").textContent = object.name;
    part("id").textContent = `${category.id}/${object.id}`;
    part("note").textContent = object.note ?? "";
    part("note").hidden = !object.note;
    part("status").textContent = (object.status?.lines ?? []).join("\n");
    part("status").hidden = !object.status?.lines.length;
    part("action-row").hidden = !object.action;
    part<HTMLAnchorElement>("action").href = object.action?.href ?? "";
    part("action").textContent = object.action?.label ?? "";
    part("action-note").textContent = object.action?.note ?? "";
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
      unmountRotation?.();
      unmountRotation = rotation.mount(part("preview"));
      lastTime = null;
      frame = requestAnimationFrame(spin);
    },
    hide() {
      root.hidden = true;
      window.removeEventListener("hashchange", route);
      cancelAnimationFrame(frame);
      unmountRotation?.();
      unmountRotation = null;
    },
    dispose() {
      cancelAnimationFrame(frame);
      unmountRotation?.();
      unmountRotation = null;
      window.removeEventListener("hashchange", route);
      releasePrepasses();
      releasePreview();
      prepasses.dispose();
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
