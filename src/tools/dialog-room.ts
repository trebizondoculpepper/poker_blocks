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
import { setReflectionEnvironment } from "../visual/block-appearance";
import type { DanceFloor } from "../dance/dance-floor";
import { gameModeFor, modeLink, type DevDialogRoomConfig, type DialogConfig } from "../game-modes";
import { createBlockMenus, type ShownMenu } from "../block-menu/block-menus";
import { playSfx } from "../audio/sfx";
import "./dialog-room.css";

export type DialogRoom = {
  /** A dialog to show in turn; returns a function that takes it away. */
  add(dialog: DialogConfig): () => void;
  show(config: DevDialogRoomConfig): void;
  hide(): void;
  dispose(): void;
};

// The row layout and beat helpers live with the production block menus (#528).
export { cycleBegan, rowPositions } from "../block-menu/block-menus";

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
      <p>Inspect: <output data-part="inspect">hover or long-press a block</output></p>
    </footer>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;
  // The production block menus (#528), made when the room opens with its spring and beat.
  let menus: ReturnType<typeof createBlockMenus> | null = null;
  let menu: ShownMenu | null = null;

  const dialogs: DialogConfig[] = [];
  let config: DevDialogRoomConfig | null = null;
  let current = 0;
  let held = false;
  let timer = 0;
  // Whether each shown choice is available now, so availability can be toggled live to
  // audition the disabled look's transitions (#461).
  let shown: { action: string; enabled: boolean }[] = [];

  function present(): void {
    menu?.hide();
    menu = null;
    if (!config || !menus || dialogs.length === 0) {
      part("title").textContent = "No dialogs composed";
      part("count").textContent = "";
      return;
    }
    current = ((current % dialogs.length) + dialogs.length) % dialogs.length;
    const dialog = dialogs[current]!;
    part("title").textContent = dialog.title;
    part("count").textContent = `${current + 1} / ${dialogs.length}`;
    menu = menus.show(dialog, {
      onAction: (action) => (part("action").textContent = action),
      onInspect: (text) => (part("inspect").textContent = text),
    });
    shown = dialog.items.map(({ action, enabled }) => ({ action, enabled: enabled ?? true }));
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
    playSfx("ui.click");
    for (const choice of shown) {
      choice.enabled = !choice.enabled;
      menu?.setAvailability(choice.action, { enabled: choice.enabled });
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
      menus?.dispose();
      menus = createBlockMenus(part("stage"), {
        background: 0x05070b,
        reflect: setReflectionEnvironment,
        spring: next.spring,
        beat: next.beat,
        floor,
      });
      present();
      restartTimer();
    },
    hide() {
      config = null;
      root.hidden = true;
      window.clearInterval(timer);
      menu?.hide();
      menu = null;
      menus?.dispose();
      menus = null;
    },
    dispose() {
      window.clearInterval(timer);
      menus?.dispose();
      root.remove();
    },
  };
}
