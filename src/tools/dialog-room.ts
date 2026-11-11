/**
 * The dialog room (dev14, #347): the game's dialogs as rows of word cubes, shown in turn. Each
 * dialog is its own scene trait (`newGameDialog`, `pauseDialog`, ...) that hands its data to
 * this room's `add` while its scene is on the stack, so the room shows exactly the dialogs the
 * scene composes and names none of them.
 *
 * The buttons sit side by side, each tied to its own fixed point by a damped spring (the
 * `springAnchor` trait): the beat kicks them, rippling along the row, and hover and press kick
 * them harder. Every kick moves where a cube will settle by a little, so the row never lines up
 * quite the same way twice. Activating a cube shows its action; nothing runs.
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import type { DanceFloor } from "../dance/dance-floor";
import { gameModeFor, modeLink, type DevDialogRoomConfig, type DialogConfig } from "../game-modes";
import { springAnchor } from "../traits/spring-anchor";
import { createCubeStage, type StageCube } from "./cube-stage";
import "./dialog-room.css";

export type DialogRoom = {
  /** A dialog to show in turn; returns a function that takes it away. */
  add(dialog: DialogConfig): () => void;
  show(config: DevDialogRoomConfig): void;
  hide(): void;
  dispose(): void;
};

/** The distance between neighbouring buttons' fixed points. */
const spacing = 1.7;

/** Each button's fixed point: a single centred row. */
export function rowPositions(count: number): THREE.Vector3[] {
  return Array.from(
    { length: count },
    (_, index) => new THREE.Vector3((index - (count - 1) / 2) * spacing, 0, 0),
  );
}

/** Whether a dancer's phase has wrapped round since last frame: its cycle just began. */
export function cycleBegan(previous: number, phase: number): boolean {
  return phase < previous;
}

export function createDialogRoom(host: HTMLElement, floor: Pick<DanceFloor, "join">): DialogRoom {
  const root = document.createElement("section");
  root.className = "dialog-room";
  root.hidden = true;
  root.innerHTML = `
    <header class="dialog-room-header">
      <h1>Dialogs</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <h2 class="dialog-room-title" data-part="title"></h2>
    <div class="dialog-room-stage" data-part="stage"></div>
    <footer class="dialog-room-controls">
      <button type="button" data-part="previous">Previous</button>
      <output data-part="count"></output>
      <button type="button" data-part="next">Next</button>
      <button type="button" data-part="hold">Hold</button>
      <button type="button" data-part="toggle">Toggle availability</button>
      <p>Action: <output data-part="action">none yet</output></p>
      <p>Inspect: <output data-part="inspect">hover or tap a block</output></p>
    </footer>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;
  const stage = createCubeStage(part("stage"));

  const dialogs: DialogConfig[] = [];
  let config: DevDialogRoomConfig | null = null;
  let current = 0;
  let held = false;
  let timer = 0;
  let leaveFloor: (() => void)[] = [];
  // The cubes on show and whether each is available now, so availability can be toggled live
  // to audition the disabled look's transitions (#461).
  let shown: { block: StageCube["block"]; enabled: boolean }[] = [];

  function present(): void {
    leaveFloor.forEach((leave) => leave());
    leaveFloor = [];
    if (!config || dialogs.length === 0) {
      part("title").textContent = "No dialogs composed";
      part("count").textContent = "";
      stage.clear();
      return;
    }
    current = ((current % dialogs.length) + dialogs.length) % dialogs.length;
    const dialog = dialogs[current]!;
    part("title").textContent = dialog.title;
    part("count").textContent = `${current + 1} / ${dialogs.length}`;
    const { spring, beat } = config;
    shown = [];
    void stage.show(dialog.items, rowPositions(dialog.items.length)).then((cubes) => {
      cubes.forEach((cube) => mount(cube, spring, beat));
      shown = cubes.map(({ block, index }) => ({
        block,
        enabled: dialog.items[index]?.enabled ?? true,
      }));
    });
  }

  /** Put a cube on its spring, and kick it on its beat, a little after its left neighbour. */
  function mount(
    { block, object, index }: StageCube,
    spring: DevDialogRoomConfig["spring"],
    beat: DevDialogRoomConfig["beat"],
  ): void {
    block.add(springAnchor, { ...spring, reducedMotion: stage.reducedMotion });
    block.emit("anchor.mount", { object });
    block.on("menu.action", (action) => (part("action").textContent = String(action)));
    block.on("inspection", (text) => (part("inspect").textContent = String(text)));
    let previous = 1;
    leaveFloor.push(
      floor.join({
        cycle: beat.cycle,
        offset: -index * beat.stagger,
        dance: ({ phase, energy }) => {
          if (cycleBegan(previous, phase) && energy > 0)
            block.emit("spring.kick", { y: beat.kick * energy });
          previous = phase;
        },
      }),
    );
  }

  function step(by: number): void {
    current += by;
    present();
    restartTimer();
  }
  function restartTimer(): void {
    window.clearInterval(timer);
    if (!config || held) return;
    timer = window.setInterval(() => step(1), config.seconds * 1000);
  }
  part("previous").addEventListener("click", () => step(-1));
  part("next").addEventListener("click", () => step(1));
  part("toggle").addEventListener("click", () => {
    for (const cube of shown) {
      cube.enabled = !cube.enabled;
      cube.block.emit("input.enabled", cube.enabled);
    }
  });
  part("hold").addEventListener("click", () => {
    held = !held;
    part("hold").textContent = held ? "Cycle" : "Hold";
    restartTimer();
  });

  return {
    add(dialog) {
      dialogs.push(dialog);
      if (config) present();
      return () => {
        const at = dialogs.indexOf(dialog);
        if (at >= 0) dialogs.splice(at, 1);
        if (config) present();
      };
    },
    show(next) {
      config = next;
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(next.backTo),
        window.location.href,
      ).href;
      root.hidden = false;
      current = 0;
      present();
      stage.start();
      restartTimer();
    },
    hide() {
      config = null;
      root.hidden = true;
      window.clearInterval(timer);
      leaveFloor.forEach((leave) => leave());
      leaveFloor = [];
      stage.stop();
      stage.clear();
    },
    dispose() {
      window.clearInterval(timer);
      leaveFloor.forEach((leave) => leave());
      stage.dispose();
      root.remove();
    },
  };
}
