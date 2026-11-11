/**
 * The menu block audition room (dev13, #303): the game's menu items as word cubes, made by the
 * real creator (src/word-cube.ts), so their look and feel can be judged before the production
 * menus move to blocks. Hover a cube to lift it, press to push it in, release to activate:
 * the room shows the action it would dispatch, without running it. A disabled cube greys out,
 * refuses activation and explains itself through its inspectable trait.
 *
 * The cubes are drawn with the title screen's look (src/visual/attract-look.ts). Which items
 * appear is the scene's `devWordCubeRoom` configuration; this file names none of them.
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { gameModeFor, modeLink, type SceneTraits } from "../game-modes";
import { createCubeStage } from "./cube-stage";
import "./word-cube-room.css";

export type WordCubeRoomConfig = SceneTraits["devWordCubeRoom"];

export type WordCubeRoom = {
  show(config: WordCubeRoomConfig): void;
  hide(): void;
  dispose(): void;
};

/** Cubes per row, and the distance between neighbouring cube centres. */
const perRow = 4;
const spacing = 1.7;

/** Where each of `count` cubes sits: rows of `perRow`, centred on the origin. */
export function gridPositions(count: number): THREE.Vector3[] {
  const rows = Math.ceil(count / perRow);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const column = index % perRow;
    return new THREE.Vector3(
      (column - (inRow - 1) / 2) * spacing,
      ((rows - 1) / 2 - row) * spacing,
      0,
    );
  });
}

export function createWordCubeRoom(host: HTMLElement): WordCubeRoom {
  const root = document.createElement("section");
  root.className = "word-cube-room";
  root.hidden = true;
  root.innerHTML = `
    <header class="word-cube-room-header">
      <h1>Menu blocks</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <div class="word-cube-room-stage" data-part="stage"></div>
    <footer class="word-cube-room-readout">
      <p>Action: <output data-part="action">none yet</output></p>
      <p>Inspect: <output data-part="inspect">hover or tap a block</output></p>
    </footer>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;
  const stage = createCubeStage(part("stage"));

  return {
    show(config) {
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(config.backTo),
        window.location.href,
      ).href;
      root.hidden = false;
      void stage.show(config.items, gridPositions(config.items.length)).then((cubes) =>
        cubes.forEach(({ block, material }) => {
          block.on("menu.action", (action) => (part("action").textContent = String(action)));
          // Each cube's inspection, plus which material it was made of, so blocks can be told apart.
          block.on(
            "inspection",
            (text) => (part("inspect").textContent = `${String(text)} · ${material.name}`),
          );
        }),
      );
      // The scene's own animation: a gentle sway on each cube's outer group, so its faces catch
      // the light. Interaction feedback moves only the inner group, so the two compose.
      stage.start((cube, seconds) => {
        const sway = stage.reducedMotion ? 0 : seconds + cube.index * 0.7;
        cube.object.rotation.set(Math.sin(sway * 0.6) * 0.18, Math.sin(sway * 0.45) * 0.35, 0);
      });
    },
    hide() {
      root.hidden = true;
      stage.stop();
      stage.clear();
    },
    dispose() {
      stage.dispose();
      root.remove();
    },
  };
}
