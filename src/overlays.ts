/**
 * Overlays and menus service: the menu screens (title, settings, game over and the
 * stage-won pop-up), which scene each screen puts in front, the music cue that goes with
 * it, the block inspection tooltip and the "refused" flash on drop targets.
 *
 * The game supplies what the menus act on (`MenuCallbacks`) and how to move between
 * scenes (`ScreenScenes`); this service decides which happens when a screen changes.
 */
import type { AudioService } from "./audio-service";
import { createMenus, type MenuCallbacks, type MenuChoice, type Menus, type Screen } from "./menus";
import type { SceneName } from "./game-modes";
import type { RunStats } from "./run-stats";
import type { Settings } from "./settings";
import type { StageReward } from "./stage-rewards";

/** How the overlays move the scene stack. */
export type ScreenScenes = {
  /** Put a scene over the current one (a menu or pop-up). */
  push(scene: SceneName): void;
  /** Replace the whole stack with one scene. */
  replace(scene: SceneName): void;
  /** Close the top pop-up and show the scene for the game's current phase. */
  resumeGame(): void;
};

export type Overlays = {
  /** The screen in front: a menu, or the game. */
  readonly screen: Screen;
  /** Whether a menu screen covers the game. */
  readonly isOpen: boolean;
  showTitle(): void;
  closeAll(): void;
  /** The pause menu's panel and the Settings panel, shown by their scenes' traits. */
  showMenu(label: string, choices: readonly MenuChoice[]): void;
  hideMenu(): void;
  showSettings(): void;
  hideSettings(): void;
  showGameOver(stats: RunStats): void;
  /** The stage-won pop-up, pushed over the stage; its button runs `onContinue`. */
  showStageWon(reward: StageReward, action: string, onContinue: () => void): void;
  /** Show the inspection tooltip near a pointer, or hide it with a null label. */
  inspect(label: string | null, clientX?: number, clientY?: number): void;
  hideTooltip(): void;
  /** Flash a drop target's red X, shaking it unless motion is reduced. */
  flashRefused(target: HTMLElement): void;
  dispose(): void;
};

/**
 * How menus move a scene stack. Closing menus pops only the scenes a menu pushed, so a scene
 * the game flow pushed (for example a mode's opening transition) survives a menu closing.
 */
export function menuScreenScenes(stack: {
  current(): string | undefined;
  push(id: string): void;
  pop(): boolean;
  replace(scene: SceneName): void;
  idFor(scene: SceneName): string;
}): ScreenScenes {
  const menuPushed: string[] = [];
  return {
    push(name) {
      const id = stack.idFor(name);
      if (stack.current() === id) return;
      stack.push(id);
      menuPushed.push(id);
    },
    replace(name) {
      menuPushed.length = 0;
      stack.replace(name);
    },
    resumeGame() {
      while (menuPushed.length && stack.current() === menuPushed.at(-1) && stack.pop()) {
        menuPushed.pop();
      }
      menuPushed.length = 0;
    },
  };
}

/** Which scene each menu screen puts in front. */
export const screenScenes: Record<Screen, (scenes: ScreenScenes) => void> = {
  title: (scenes) => scenes.replace("title"),
  game: (scenes) => scenes.resumeGame(),
  // The game over screen is presentation only: the mode's game flow has already placed the
  // scene for a lost run (`run.position.over`), so this screen must not move the stack.
  over: () => undefined,
};

export function createOverlays(
  host: HTMLElement,
  options: {
    settings: Settings;
    menus: MenuCallbacks;
    scenes: ScreenScenes;
    audio: Pick<AudioService, "showScreen">;
    reducedMotion(): boolean;
  },
): Overlays {
  const { scenes, audio } = options;
  const tooltip = document.createElement("div");
  tooltip.className = "inspect-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  host.append(tooltip);

  let screen: Screen = "title";
  const menus: Menus = createMenus(host, options.settings, {
    ...options.menus,
    onScreen(next) {
      screen = next;
      screenScenes[next](scenes);
      audio.showScreen(next);
      options.menus.onScreen?.(next);
    },
  });
  const timers = new Set<number>();

  return {
    get screen() {
      return screen;
    },
    get isOpen() {
      return menus.isOpen;
    },
    showTitle: () => menus.showTitle(),
    closeAll: () => menus.closeAll(),
    showMenu: (label, choices) => menus.showMenu(label, choices),
    hideMenu: () => menus.hideMenu(),
    showSettings: () => menus.showSettings(),
    hideSettings: () => menus.hideSettings(),
    showGameOver: (stats) => menus.showGameOver(stats),
    showStageWon(reward, action, onContinue) {
      scenes.push("stage-won");
      menus.showStageWon(reward, action, onContinue);
    },
    inspect(label, clientX = 0, clientY = 0) {
      if (!label) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = label;
      tooltip.hidden = false;
      const bounds = host.getBoundingClientRect();
      const left = clientX - bounds.left + 14;
      const top = clientY - bounds.top + 14;
      tooltip.style.left = `${Math.max(8, Math.min(left, bounds.width - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(top, bounds.height - tooltip.offsetHeight - 8))}px`;
    },
    hideTooltip() {
      tooltip.hidden = true;
    },
    flashRefused(target) {
      target.classList.remove("refused-flash", "refused-shake");
      void target.offsetWidth; // restart the animation
      target.classList.add("refused-flash");
      if (!options.reducedMotion()) target.classList.add("refused-shake");
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        target.classList.remove("refused-flash", "refused-shake");
      }, 700);
      timers.add(timer);
    },
    dispose() {
      timers.forEach((timer) => window.clearTimeout(timer));
      tooltip.remove();
    },
  };
}
