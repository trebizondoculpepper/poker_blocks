import { describe, expect, it } from "vite-plus/test";
import {
  composeMusicPlans,
  createMusicController,
  validateMusicOperations,
} from "./music-controller";
import { defaultMusicPlan } from "./music-plan";

const tracks = [
  "take2",
  "blaxploitation-horns",
  "stripped-sleaze",
  "style-noir",
  "style-ambient-lounge",
  "solitaire-boss",
];

function setup() {
  const log: string[] = [];
  let current: string | null = null;
  const player = {
    get current() {
      return current;
    },
    play: async (id: string) => {
      current = id;
      log.push(`play ${id}`);
    },
    stop: () => {
      current = null;
      log.push("stop");
    },
    windDown: (seconds?: number) => {
      current = null;
      log.push(`windDown ${seconds}`);
    },
    windUp: async (id: string) => {
      current = id;
      log.push(`windUp ${id}`);
    },
    unlock: () => log.push("unlock"),
    setLowPass: (hz: number, seconds?: number) => log.push(`lowpass ${hz} ${seconds}`),
    clearLowPass: (seconds?: number) => log.push(`lowpass open ${seconds}`),
    setHighPass: (hz: number, seconds?: number) => log.push(`highpass ${hz} ${seconds}`),
    clearHighPass: (seconds?: number) => log.push(`highpass open ${seconds}`),
  };
  const music = createMusicController(
    player,
    tracks,
    composeMusicPlans(tracks, defaultMusicPlan),
    () => 0,
  );
  // The cues the game's scenes configure (src/game-modes.ts), run through the operations.
  const select = (plan: string) => () => music.run([{ op: "selectTrack", config: { plan } }]);
  const title = select("title");
  const stage = select("stage");
  const boss = select("boss");
  const resume = () =>
    music.run([{ op: "resumeTrack", config: { slot: "tableMusic", plan: "stage" } }]);
  return { music, log, title, stage, boss, resume };
}

/** The track a log line started, whether it crossfaded in (play) or spun up from silence. */
const started = (line: string) => line.replace(/^(play|windUp) /, "");
const isStart = (line: string) => /^(play|windUp) /.test(line);

describe("music controller", () => {
  it("waits for the first gesture, then plays the last request", () => {
    const { music, log, ...cue } = setup();
    cue.title();
    cue.boss();
    expect(log).toEqual([]);
    music.unlock();
    // From silence, the music spins up.
    expect(log).toEqual(["unlock", "windUp solitaire-boss"]);
  });

  it("spins a title tune up from silence on page load, once audio may play", () => {
    const { music, log, ...cue } = setup();
    cue.title();
    music.unlock();
    expect(log).toEqual(["unlock", "windUp blaxploitation-horns"]);
    // Already playing: a later track crossfades rather than spinning up again.
    cue.boss();
    expect(log.at(-1)).toBe("play solitaire-boss");
  });

  it("plays horns or sleaze on the title, and keeps one already playing", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.title();
    cue.title();
    expect(log.filter((l) => /^(play|windUp) /.test(l))).toEqual(["windUp blaxploitation-horns"]);
  });

  it("switches stages to a fresh random vibe and bosses to the boss loop", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    cue.stage();
    cue.boss();
    const plays = log.filter(isStart).map(started);
    expect(plays[0]).not.toBe(plays[1]);
    expect(plays.slice(0, 2).every((id) => id !== "solitaire-boss")).toBe(true);
    expect(plays[2]).toBe("solitaire-boss");
  });

  it("resumes the same stage track after the title", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    const stage = started(log.at(-1)!);
    cue.title();
    cue.resume();
    expect(started(log.at(-1)!)).toBe(stage);
  });

  it("winds the music down like a record player", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    music.windDown();
    expect(log.at(-1)).toBe("windDown undefined");
    expect(music.current).toBeNull();
    expect(music.woundDown).toBe(true);
  });

  it("remembers it is wound down: the next music winds up, then plays normally", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    music.windDown();
    cue.title();
    expect(log.at(-1)).toBe("windUp blaxploitation-horns");
    expect(music.woundDown).toBe(false);
    cue.boss();
    expect(log.at(-1)).toBe("play solitaire-boss");
  });

  it("winds back up what was playing before", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    const stage = started(log.at(-1)!);
    music.windDown();
    music.windUp();
    expect(log.at(-1)).toBe(`windUp ${stage}`);
  });

  it("filters without changing the track: low-pass or high-pass replaces the other (#87)", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.stage();
    const track = music.current;
    log.length = 0;
    music.filter("lowpass");
    expect(log).toEqual(["lowpass 550 2", "highpass open 2"]);
    log.length = 0;
    music.filter("highpass");
    expect(log).toEqual(["lowpass open 2", "highpass 550 2"]);
    log.length = 0;
    music.filter(null);
    expect(log).toEqual(["lowpass open 2", "highpass open 2"]);
    expect(music.current).toBe(track);
  });

  it("runs any configured plan and slot with no scene names (#758)", () => {
    const log: string[] = [];
    const player = {
      current: null as string | null,
      play: async (id: string) => void log.push(`play ${id}`),
      stop: () => {},
      windDown: () => {},
      windUp: async (id: string) => {
        player.current = id;
        log.push(`windUp ${id}`);
      },
      unlock: () => {},
      setLowPass: () => {},
      clearLowPass: () => {},
      setHighPass: () => {},
      clearHighPass: () => {},
    };
    const music = createMusicController(
      player,
      ["a", "b"],
      { lobby: { tracks: ["b"], selector: "fixed", slot: "lobbyMusic" } },
      () => 0,
    );
    music.unlock();
    music.run([{ op: "selectTrack", config: { plan: "lobby" } }]);
    music.run([{ op: "resumeTrack", config: { slot: "lobbyMusic" } }]);
    expect(log).toEqual(["windUp b", "play b"]);
  });

  it("remembers the cue's selection, not what is still audibly playing (#855 review)", () => {
    const { music, log, ...cue } = setup();
    cue.stage();
    // Not yet unlocked: nothing has played, but the memory follows the selection.
    music.run([
      { op: "selectTrack", config: { plan: "boss" } },
      { op: "rememberTrack", config: { slot: "saved" } },
    ]);
    music.unlock();
    log.length = 0;
    music.run([{ op: "resumeTrack", config: { slot: "saved" } }]);
    expect(log.map(started)).toEqual(["solitaire-boss"]);
  });

  it("lets a selection see a wind-down earlier in the same cue (#855 review)", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.title();
    log.length = 0;
    music.run([{ op: "windDown" }, { op: "selectTrack", config: { plan: "title" } }]);
    expect(log.some(isStart)).toBe(true);
    expect(music.woundDown).toBe(false);
  });

  it("lets a later selection see an earlier one in the same cue (#855 review)", () => {
    const { music, log, ...cue } = setup();
    music.unlock();
    cue.title();
    const title = music.current!;
    log.length = 0;
    // Boss first, then a keep-if-playing title plan: the title is no longer what plays, so it
    // must choose a title track rather than "keep" the boss loop.
    music.run([
      { op: "selectTrack", config: { plan: "boss" } },
      { op: "selectTrack", config: { plan: "title" } },
    ]);
    expect(log.filter(isStart).map(started).at(-1)).toBe(title);
  });

  it("remembers the track a wind-up restores (#855 review)", () => {
    const { music, ...cue } = setup();
    music.unlock();
    cue.stage();
    const stage = music.current!;
    music.run([{ op: "windDown" }]);
    music.run([
      { op: "selectTrack", config: { plan: "boss" } },
      { op: "windDown" },
      { op: "windUp" },
      { op: "rememberTrack", config: { slot: "saved" } },
    ]);
    // The cue's own wind-down stopped the boss loop, so its wind-up restores the boss loop:
    // what plays and what is remembered agree.
    expect(music.current).toBe("solitaire-boss");
    cue.stage();
    music.run([{ op: "resumeTrack", config: { slot: "saved" } }]);
    expect(music.current).toBe("solitaire-boss");
    expect(stage).not.toBe("solitaire-boss");
  });

  it("winds back up to the cue's logical track, even if the player is still loading (#855 review)", () => {
    const log: string[] = [];
    // A player like the real one: \`current\` changes only after a (here, never finished) load.
    const player = {
      current: "a" as string | null,
      play: () => new Promise<void>(() => void log.push("loading")),
      stop: () => {},
      windDown: () => void log.push("windDown"),
      windUp: async (id: string) => void log.push(`windUp ${id}`),
      unlock: () => {},
      setLowPass: () => {},
      clearLowPass: () => {},
      setHighPass: () => {},
      clearHighPass: () => {},
    };
    const music = createMusicController(
      player,
      ["a", "b"],
      { pick: { tracks: ["b"], selector: "fixed" } },
      () => 0,
    );
    music.unlock();
    music.run([
      { op: "selectTrack", config: { plan: "pick" } },
      { op: "windDown" },
      { op: "windUp" },
    ]);
    expect(log.at(-1)).toBe("windUp b");
  });

  it("rejects an unknown operation at composition rather than falling back", () => {
    expect(validateMusicOperations("scene", [{ op: "selectTrack" }, { op: "shuffleAll" }])).toEqual(
      ['scene: unknown music operation "shuffleAll"'],
    );
  });
});

describe("configured music cues (#758)", () => {
  it("every mode's scene cues use registered operations and existing plans", async () => {
    const { gameModeRegistry } = await import("../game-modes");
    const plans = composeMusicPlans(tracks, defaultMusicPlan);
    for (const name of gameModeRegistry.names())
      for (const scene of gameModeRegistry.get(name).scenes as unknown as {
        id: string;
        traits: Record<string, { operations?: readonly { op: string; config?: unknown }[] }>;
      }[])
        for (const trait of ["musicCue", "musicTrack", "musicResume"]) {
          const operations = scene.traits[trait]?.operations ?? [];
          expect(validateMusicOperations(`${name}/${scene.id}`, operations)).toEqual([]);
          for (const { config } of operations) {
            const plan = (config as { plan?: string } | undefined)?.plan;
            if (plan !== undefined) expect(Object.keys(plans)).toContain(plan);
          }
        }
  });
});
