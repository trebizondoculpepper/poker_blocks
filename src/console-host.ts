/**
 * Console host service: adapts the running game to the developer console's `ConsoleHost`.
 * It owns the console's view of modes (names, resets, switching in place and the URL that
 * records the mode), and reaches music through the audio service. Everything that changes
 * the run is asked of the game through the narrow `ConsoleApp` interface.
 */
import type { AudioService } from "./audio-service";
import type { ConsoleHost } from "./console/commands";
import { createConsole, type GameConsole } from "./console/console-view";
import type { GameRun } from "./game-run";
import {
  modeConsoleNames,
  developerModes,
  modeLink,
  gameModeRegistry,
  type GameMode,
} from "./game-modes";

/** What the console may ask of the running game. */
export type ConsoleApp = {
  game(): GameRun;
  screen(): string;
  /** Press the HUD's next-action button. */
  next(): void;
  /** Reset the current mode (a new run or a fresh developer scene) and close any menu. */
  newRun(): void;
  /** Go to the title screen. */
  home(): void;
  /** Discard the open mode's saved run; the console's `hard reset`. */
  hardReset(): void;
  /** The mode playing now. */
  mode(): GameMode;
  /** Make `mode` active and open its fresh start, without reloading the page. */
  openMode(mode: GameMode): void;
  forceOutcome(outcome: "won" | "lost"): boolean;
  adjustCoins(delta: number): number;
};

/** Where the mode is recorded so a reload reopens it (the page URL). */
export type ModeAddress = {
  href(): string;
  replace(url: URL): void;
};

export type ConsoleHostOptions = Omit<ConsoleHost, "clear" | "history" | "say">;

export function consoleHostFor(
  app: ConsoleApp,
  audio: Pick<AudioService, "music">,
  address: ModeAddress,
): ConsoleHostOptions {
  const modeName = () => modeConsoleNames(app.mode())[0] ?? null;
  return {
    game: () => app.game(),
    screen: () => app.screen(),
    next: () => app.next(),
    newGame: () => app.newRun(),
    home: () => app.home(),
    hardReset: () => app.hardReset(),
    mode: modeName,
    modes: () => developerModes(),
    resetMode(mode) {
      if (!mode || mode === modeName()) {
        app.newRun();
        return;
      }
      const next = gameModeRegistry.get(mode);
      address.replace(modeLink(next, address.href()));
      app.openMode(next);
    },
    forceOutcome: (outcome) => app.forceOutcome(outcome),
    adjustCoins: (delta) => app.adjustCoins(delta),
    musicTracks: () => audio.music.tracks,
    musicNow: () => audio.music.current,
    playMusic(id) {
      audio.music.unlock();
      audio.music.play(id);
    },
    stopMusic: () => audio.music.stop(),
  };
}

/** The developer console (~ or `), wired to the game and the audio service. */
export function createConsoleHost(app: ConsoleApp, audio: AudioService): GameConsole {
  return createConsole(
    consoleHostFor(app, audio, {
      href: () => window.location.href,
      replace: (url) => window.history.replaceState(window.history.state, "", url),
    }),
  );
}
