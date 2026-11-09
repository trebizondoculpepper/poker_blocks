/**
 * Console host service: adapts the running game to the developer console's `ConsoleHost`.
 * It owns the console's view of rooms (names, resets, switching in place and the URL that
 * records the room), and reaches music through the audio service. Everything that changes
 * the run is asked of the game through the narrow `ConsoleApp` interface.
 */
import type { AudioService } from "./audio-service";
import type { ConsoleHost } from "./console/commands";
import { createConsole, type GameConsole } from "./console/console-view";
import type { GameSession } from "./game-session";
import { consoleNames, devRooms, roomLink, roomRegistry, type Room } from "./rooms";

/** What the console may ask of the running game. */
export type ConsoleApp = {
  game(): GameSession;
  screen(): string;
  /** Press the HUD's next-action button. */
  next(): void;
  /** Start a new run in the current room and close any menu. */
  newRun(): void;
  /** Go to the title screen. */
  home(): void;
  /** The room playing now. */
  room(): Room;
  /** Make `room` the active mode and start a fresh run there, without reloading the page. */
  openRoom(room: Room): void;
  forceOutcome(outcome: "won" | "lost"): boolean;
  adjustCoins(delta: number): number;
};

/** Where the room is recorded so a reload reopens it (the page URL). */
export type RoomAddress = {
  href(): string;
  replace(url: URL): void;
};

export type ConsoleHostOptions = Omit<ConsoleHost, "clear" | "history">;

export function consoleHostFor(
  app: ConsoleApp,
  audio: Pick<AudioService, "music">,
  address: RoomAddress,
): ConsoleHostOptions {
  const roomName = () => consoleNames(app.room())[0] ?? null;
  return {
    game: () => app.game(),
    screen: () => app.screen(),
    next: () => app.next(),
    newGame: () => app.newRun(),
    home: () => app.home(),
    room: roomName,
    rooms: () => devRooms(),
    resetRoom(room) {
      if (!room || room === roomName()) {
        app.newRun();
        return;
      }
      const next = roomRegistry.get(room);
      address.replace(roomLink(next, address.href()));
      app.openRoom(next);
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
