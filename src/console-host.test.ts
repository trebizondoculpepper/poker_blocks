import { describe, expect, it } from "vite-plus/test";
import type { MusicController } from "./audio/music-controller";
import { consoleHostFor, type ConsoleApp } from "./console-host";
import { roomFor, type Room } from "./rooms";

function setup(start: string | null, href = "http://localhost/?restart=true") {
  const calls: string[] = [];
  let room: Room = roomFor(start);
  let address = href;
  const app: ConsoleApp = {
    game: () => {
      throw new Error("not needed");
    },
    screen: () => "game",
    next: () => calls.push("next"),
    newRun: () => calls.push("newRun"),
    home: () => calls.push("home"),
    room: () => room,
    openRoom(next) {
      room = next;
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
  it("names only dev rooms", () => {
    expect(setup("dev2").host.room()).toBe("dev2");
    expect(setup(null).host.room()).toBeNull();
  });

  it("restarts the current room in place", () => {
    const { host, calls } = setup("dev2");
    host.resetRoom("dev2");
    host.resetRoom(null);
    expect(calls).toEqual(["newRun", "newRun"]);
  });

  it("opens another dev room in place and records it in the URL, dropping restart", () => {
    const { host, calls, address } = setup("dev2", "http://localhost/?room=dev2&restart=true&x=1");
    host.resetRoom("dev3");
    expect(calls).toEqual(["url ?x=1&room=dev3", "open dev3"]);
    expect(address()).toBe("http://localhost/?x=1&room=dev3");
    expect(host.room()).toBe("dev3");
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
