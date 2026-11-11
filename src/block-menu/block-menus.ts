/**
 * Block menus (#528, part of #463): a dialog's choices as springy word cubes over the game, with
 * the keyboard and screen-reader path built in. Production menu screens show a `DialogConfig`
 * through `show` and get back a handle; the developer dialog room uses the same layer, so there is
 * one implementation. It names no menu, scene or action: actions are opaque data handed back.
 *
 * - **Drawing:** a cube stage (src/block-menu/cube-stage.ts), one centred row, each cube on a
 *   `springAnchor`, kicked on its beat a little after its left neighbour when a dance floor is
 *   given. Inspection text goes to a caption under the row.
 * - **Pointer:** the stage's router (mouse hover inspects; a touch tap activates, a long-press
 *   inspects).
 * - **Keyboard and screen readers:** each choice also has a visually hidden real `<button>`, so
 *   Tab order and screen-reader semantics are native without drawing a second text menu. Focusing
 *   one focuses its cube (`input.focus`, which describes it); activating one presses and releases
 *   its cube, so activation, sounds and refusals are the cube's own. Arrow keys move between them.
 *   While a menu is shown, Escape anywhere calls its `onBack`, when it has one.
 * - **Availability** comes from the caller's own conditions, live: `setAvailability(action,
 *   { enabled, reason })` updates the cube (`input.enabled`) and its button (`aria-disabled`).
 * - **Lifecycle:** `hide` (or showing another dialog) disposes the cubes, listeners and dancers;
 *   `dispose` frees the stage.
 */
import * as THREE from "three";
import type { DanceFloor } from "../dance/dance-floor";
import type { DialogConfig, MenuBlockItem } from "../game-modes";
import { springAnchor, type SpringAnchorSettings } from "../traits/spring-anchor";
import type { Availability } from "../traits/availability";
import { createCubeStage, type StageCube, type StageOptions } from "./cube-stage";
import { choiceActions, focusAfter, isBackKey } from "./choice-keys";

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

export type BlockMenuOptions = StageOptions & {
  spring: Partial<SpringAnchorSettings>;
  /** The beat kick: a registered dance cycle, how hard, and beats between neighbours. */
  beat?: { cycle: string; kick: number; stagger: number };
  floor?: Pick<DanceFloor, "join">;
};

export type ShowOptions = {
  /** A choice was activated: its opaque action. */
  onAction(action: string): void;
  /** Escape (or a platform back gesture) was used; omitted, Escape does nothing here. */
  onBack?(): void;
  /** Inspection text for a caption, if the screen shows one elsewhere. */
  onInspect?(text: string): void;
};

export type ShownMenu = {
  /** Change one choice's availability, live. */
  setAvailability(action: string, availability: Availability): void;
  /** Move keyboard focus to the first available choice. */
  focusFirst(): void;
  hide(): void;
};

/** Visually hidden but available to keyboards and screen readers. */
const hiddenStyle =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

export function createBlockMenus(host: HTMLElement, options: BlockMenuOptions) {
  const stage = createCubeStage(host, options);
  const caption = document.createElement("p");
  caption.className = "block-menu-caption";
  caption.setAttribute("aria-live", "polite");
  host.append(caption);
  const list = document.createElement("div");
  list.setAttribute("role", "group");
  list.setAttribute("style", hiddenStyle);
  host.append(list);
  let current: (() => void) | null = null;
  let token = 0;

  function show(dialog: DialogConfig, handlers: ShowOptions): ShownMenu {
    current?.();
    const mine = ++token;
    const stops: (() => void)[] = [];
    const buttons: HTMLButtonElement[] = [];
    /** Choices activated before their cube was ready. */
    const pending = new Set<number>();
    let cubes: StageCube[] = [];
    list.replaceChildren();
    list.setAttribute("aria-label", dialog.title);
    caption.textContent = "";
    const byAction = new Map<
      string,
      { button: HTMLButtonElement; cube?: StageCube; latest?: Availability }
    >();

    dialog.items.forEach((item: MenuBlockItem, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      if (item.description) button.title = item.description;
      button.setAttribute("aria-disabled", String(item.enabled === false));
      const cube = () => cubes[index]?.block;
      button.addEventListener("focus", () => choiceActions.focus(cube()));
      button.addEventListener("blur", () => choiceActions.blur(cube()));
      button.addEventListener("click", () => {
        // Activated while its cube is still loading (fonts loading cold): kept and played once
        // the cube is ready, so a keyboard or screen-reader choice is never dropped (#532 review).
        if (cube()) choiceActions.activate(cube());
        else pending.add(index);
      });
      button.addEventListener("keydown", (event) => {
        const next = focusAfter(event.key, index, dialog.items.length);
        if (next !== null) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      });
      buttons.push(button);
      byAction.set(item.action, { button });
      list.append(button);
    });

    // Escape goes back while this menu is shown, wherever focus is (a cube clicked, or every
    // choice disabled so none takes focus); removed when the menu hides (#532 review).
    if (handlers.onBack) {
      const onKey = (event: KeyboardEvent) => {
        if (!isBackKey(event.key)) return;
        event.preventDefault();
        handlers.onBack?.();
      };
      window.addEventListener("keydown", onKey);
      stops.push(() => window.removeEventListener("keydown", onKey));
    }
    void stage.show(dialog.items, rowPositions(dialog.items.length)).then((made) => {
      if (mine !== token) return;
      cubes = made;
      for (const { block, object, index } of made) {
        const item = dialog.items[index]!;
        const entry = byAction.get(item.action)!;
        entry.cube = made[index];
        // Availability set while the cubes were still being built applies now.
        if (entry.latest) block.emit("input.enabled", entry.latest);
        block.add(springAnchor, { ...options.spring, reducedMotion: stage.reducedMotion });
        block.emit("anchor.mount", { object });
        stops.push(block.on("menu.action", (action) => handlers.onAction(String(action))));
        stops.push(
          block.on("inspection", (text) => {
            caption.textContent = String(text);
            handlers.onInspect?.(String(text));
          }),
        );
        // A choice focused while its cube was still being built is described now (#532 review).
        if (buttons[index] && buttons[index] === document.activeElement) choiceActions.focus(block);
        const beat = options.beat;
        if (beat && options.floor) {
          let previous = 1;
          stops.push(
            options.floor.join({
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
      }
      // Only once every cube is set up, choices activated while they were being built play now.
      // An action may close or replace this menu: stop as soon as it is no longer the one shown,
      // so a closed menu never sets anything up or replays anything more (#532 review).
      for (const { block, index } of made) {
        if (mine !== token) return;
        if (pending.delete(index)) choiceActions.activate(block);
      }
    });
    stage.start();

    const hide = () => {
      if (current !== hide) return;
      current = null;
      token++;
      stops.forEach((stop) => stop());
      list.replaceChildren();
      caption.textContent = "";
      stage.stop();
      stage.clear();
    };
    current = hide;
    return {
      setAvailability(action, availability) {
        const entry = byAction.get(action);
        if (!entry) return;
        entry.latest = availability;
        entry.button.setAttribute("aria-disabled", String(!availability.enabled));
        entry.cube?.block.emit("input.enabled", availability);
      },
      focusFirst() {
        buttons.find((button) => button.getAttribute("aria-disabled") !== "true")?.focus();
      },
      hide,
    };
  }

  return {
    show,
    get reducedMotion() {
      return stage.reducedMotion;
    },
    dispose() {
      current?.();
      caption.remove();
      list.remove();
      stage.dispose();
    },
  };
}
