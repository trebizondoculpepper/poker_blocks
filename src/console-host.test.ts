import { describe, expect, it } from "vite-plus/test";
import type { MusicController } from "./audio/music-controller";
import { consoleHostFor, type ConsoleApp } from "./console-host";
import { gameModeFor, type GameMode } from "./game-modes";

function setup(start: string | null, href = "http://localhost/?restart=true") {
  const calls: string[] = [];
  let mode: GameMode = gameModeFor(start);
  let address = href;
  const app: ConsoleApp = {
    game: () => {
      throw new Error("not needed");
    },
    screen: () => "game",
    next: () => calls.push("next"),
    newRun: () => calls.push("newRun"),
    home: () => calls.push("home"),
    mode: () => mode,
    openMode(next) {
      mode = next;
      calls.push(`open ${next.id}`);
    },
    forceOutcome: (outcome) => calls.push(`force ${outcome}`) > 0,
    adjustCoins: (delta) => delta,
  };
  const music = {
    tracks: ["a", "b"],
    current: "a",
    unlock: () => calls.push("unlock"),
    play: (id: string) => calls.push(`play ${id}`),
    stop: () => calls.push("stop"),
  } as unknown as MusicController;
  const host = consoleHostFor(
    app,
    { music },
    {
      href: () => address,
      replace(url) {
        address = url.href;
        calls.push(`url ${url.search}`);
      },
    },
  );
  return { host, calls, address: () => address };
}

describe("console host", () => {
  it("names only dev modes", () => {
    expect(setup("dev2").host.mode()).toBe("dev2");
    expect(setup(null).host.mode()).toBeNull();
  });

  it("restarts the current mode in place", () => {
    const { host, calls } = setup("dev2");
    host.resetMode("dev2");
    host.resetMode(null);
    expect(calls).toEqual(["newRun", "newRun"]);
  });

  it("opens another dev mode in place and records it in the URL, dropping restart", () => {
    const { host, calls, address } = setup("dev2", "http://localhost/?mode=dev2&restart=true&x=1");
    host.resetMode("dev3");
    expect(calls).toEqual(["url ?x=1&mode=dev3", "open dev3"]);
    expect(address()).toBe("http://localhost/?x=1&mode=dev3");
    expect(host.mode()).toBe("dev3");
  });

  it("unlocks audio before playing a track for the music command", () => {
    const { host, calls } = setup(null);
    host.playMusic("b");
    host.stopMusic();
    expect(calls).toEqual(["unlock", "play b", "stop"]);
    expect(host.musicTracks()).toEqual(["a", "b"]);
    expect(host.musicNow()).toBe("a");
  });
});
