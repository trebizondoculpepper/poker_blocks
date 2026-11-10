/**
 * Overlays and menus service: the menu screens (title, settings, game over and the
 * stage-won pop-up), which scene each screen puts in front, the music cue that goes with
 * it, the block inspection tooltip and the "refused" flash on drop targets.
 *
 * The game supplies what the menus act on (`MenuCallbacks`) and how to move between
 * scenes (`ScreenScenes`); this service decides which happens when a screen changes.
 */
import { createMenus, type MenuCallbacks, type MenuChoice, type Menus, type Screen } from "./menus";
import type { PanelLink, SceneName } from "./game-modes";
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
  /** The button that opens the pause menu, for the HUD frame to place (#116). */
  readonly menuButton: HTMLElement;
  panelHeadingHost(): HTMLElement;
  /** The screen in front: a menu, or the game. */
  readonly screen: Screen;
  /** Whether a menu screen covers the game. */
  readonly isOpen: boolean;
  /** Show the title screen with these items (its scene trait decided which apply). */
  showTitle(items: readonly MenuChoice[]): void;
  /** The title scene was exited. */
  hideTitle(): void;
  /** The panel's footer: the build version and links out, shown by a `panelFooter` trait. */
  showPanelFooter(links: readonly PanelLink[], version: string): void;
  hidePanelFooter(): void;
  closeAll(): void;
  /** The pause menu's panel and the Settings panel, shown by their scenes' traits. */
  showMenu(label: string, choices: readonly MenuChoice[]): void;
  hideMenu(): void;
  showSettings(): void;
  hideSettings(): void;
  /** The game over screen, shown by the game over scene's `gameOverScreen` trait. */
  showGameOver(stats: RunStats, choices: readonly MenuChoice[], seed: number | null): void;
  hideGameOver(): void;
  /**
   * The stage-won pop-up, shown by the stage-won scene's `stageWonScreen` trait (#91). It
   * shows no seed: the seed belongs to the final result screen only (#164).
   */
  showStageWon(reward: StageReward, next: MenuChoice): void;
  hideStageWon(): void;
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
  // The title scene's own `titleScreen` trait puts it in front (#88), so this screen must not
  // move the stack.
  title: () => undefined,
  game: (scenes) => scenes.resumeGame(),
};

export function createOverlays(
  host: HTMLElement,
  options: {
    settings: Settings;
    menus: MenuCallbacks;
    scenes: ScreenScenes;
    reducedMotion(): boolean;
    /** Other full-screen panels (the deck view, #175) that hold a pending outcome while open. */
    panels?: readonly { readonly isOpen: boolean }[];
  },
): Overlays {
  const { scenes } = options;
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
      options.menus.onScreen?.(next);
    },
  });
  const timers = new Set<number>();

  return {
    menuButton: menus.menuButton,
    get screen() {
      return screen;
    },
    get isOpen() {
      return menus.isOpen || (options.panels ?? []).some((panel) => panel.isOpen);
    },
    showTitle: (items) => menus.showTitle(items),
    hideTitle: () => menus.hideTitle(),
    panelHeadingHost: () => menus.panelHeadingHost(),
    showPanelFooter: (links, version) => menus.showPanelFooter(links, version),
    hidePanelFooter: () => menus.hidePanelFooter(),
    closeAll: () => menus.closeAll(),
    showMenu: (label, choices) => menus.showMenu(label, choices),
    hideMenu: () => menus.hideMenu(),
    showSettings: () => menus.showSettings(),
    hideSettings: () => menus.hideSettings(),
    showGameOver: (stats, choices, seed) => menus.showGameOver(stats, choices, seed),
    hideGameOver: () => menus.hideGameOver(),
    showStageWon: (reward, next) => menus.showStageWon(reward, next),
    hideStageWon: () => menus.hideStageWon(),
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
