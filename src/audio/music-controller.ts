/**
 * The music controller: an orchestrator of configured operations (#758; doc/presentation-
 * contracts.md, "Configured music operations"). A cue is an ordered list of registered
 * operations (`selectTrack`, `rememberTrack`, `resumeTrack`, `windDown`, `windUp`, `filter`),
 * each naming a plan entry or memory slot by opaque handle; selectors are registered policies.
 * Nothing here knows a scene. Requests made before the browser allows audio are remembered and
 * played on the first gesture.
 *
 * It remembers the record player's state: once wound down, the next music winds back up
 * from a standstill instead of fading in.
 */
import { Registry } from "../core/registry";
import { defaultMusicPlan, type MusicPlan } from "./music-plan";
import type { MusicPlayer } from "./music-player";

/** One step of a music cue: a registered operation and its configuration. */
export type MusicOperation = { op: string; config?: unknown };

/** A plan entry: the tracks it chooses among, the selector that chooses, and its memory slot. */
export type MusicPlanEntry = {
  tracks: readonly string[];
  selector: string;
  /** Where the chosen track is remembered, for a later `resumeTrack`. */
  slot?: string;
};
export type MusicPlans = Readonly<Record<string, MusicPlanEntry>>;

/**
 * A registered selection policy: the track to play from `tracks` (only those available), or
 * `undefined` to keep what is playing, or null when there is nothing to play.
 */
export type MusicSelector = (
  tracks: readonly string[],
  context: { current: string | null; previous: string | null; random: () => number },
) => string | null | undefined;
export const musicSelectors = new Registry<MusicSelector>("music selector");

const randomFrom = (ids: readonly string[], random: () => number) =>
  ids.length ? ids[Math.floor(random() * ids.length)]! : null;

// A random track, never the slot's previous one when there is any other choice.
musicSelectors.register("randomNoImmediateRepeat", (tracks, { previous, random }) =>
  randomFrom(tracks.length > 1 ? tracks.filter((id) => id !== previous) : tracks, random),
);
// The plan's one track.
musicSelectors.register("fixed", (tracks) => tracks[0] ?? null);
// Keep a track of this selection already playing; otherwise a random one (the title's music).
musicSelectors.register("keepOrRandom", (tracks, { current, random }) =>
  current !== null && tracks.includes(current) ? undefined : randomFrom(tracks, random),
);

/** What an operation may ask of the controller. */
export type MusicOperationApi = {
  select(plan: string): void;
  remember(slot: string): void;
  resume(slot: string, fallbackPlan?: string): void;
  windDown(): void;
  windUp(): void;
  filter(kind: MusicFilter | null): void;
};
export type MusicOperationHandler = (api: MusicOperationApi, config: unknown) => void;
export const musicOperations = new Registry<MusicOperationHandler>("music operation");

musicOperations.register("selectTrack", (api, raw) => api.select((raw as { plan: string }).plan));
musicOperations.register("rememberTrack", (api, raw) =>
  api.remember((raw as { slot: string }).slot),
);
musicOperations.register("resumeTrack", (api, raw) => {
  const { slot, plan } = raw as { slot: string; plan?: string };
  api.resume(slot, plan);
});
musicOperations.register("windDown", (api) => api.windDown());
musicOperations.register("windUp", (api) => api.windUp());
musicOperations.register("filter", (api, raw) =>
  api.filter(((raw ?? {}) as { kind?: MusicFilter | null }).kind ?? null),
);

/** Everything wrong with a cue: unknown operations fail at composition, never fall back. */
export function validateMusicOperations(
  owner: string,
  operations: readonly MusicOperation[],
): string[] {
  return operations
    .filter(({ op }) => !musicOperations.has(op))
    .map(({ op }) => `${owner}: unknown music operation "${op}"`);
}

/**
 * The default plans, resolved once from the available loops: the title's tracks; the ordinary
 * stage plan, every loop except the reserved ones; the boss loop. Both table plans remember their
 * choice in the `tableMusic` slot.
 */
export function composeMusicPlans(
  tracks: readonly string[],
  plan: MusicPlan = defaultMusicPlan,
): MusicPlans {
  const available = (ids: readonly string[]) => ids.filter((id) => tracks.includes(id));
  const reserved = new Set([plan.boss]);
  return {
    title: { tracks: available(plan.title), selector: "keepOrRandom" },
    stage: {
      tracks: tracks.filter((id) => !reserved.has(id)),
      selector: "randomNoImmediateRepeat",
      slot: "tableMusic",
    },
    boss: { tracks: available([plan.boss]), selector: "fixed", slot: "tableMusic" },
  };
}

export type MusicController = {
  /** Run a cue: its operations in order (selection and memory at once, playback on unlock). */
  run(operations: readonly MusicOperation[]): void;
  /**
   * Filter whatever is playing, easing over about 2 s; the track does not change. `lowpass`
   * muffles it (the pause menu), `highpass` thins it (Settings), and null clears both. Setting
   * one replaces the other.
   */
  filter(kind: MusicFilter | null): void;
  /** Wind the music down to silence, like a record player losing power. */
  windDown(): void;
  /** Wind back up whatever was playing before the wind-down. */
  windUp(): void;
  /** Whether the record player is wound down (the next music winds up). */
  readonly woundDown: boolean;
  /** A specific loop, for the console. */
  play(id: string): void;
  stop(): void;
  /** Call on the first user gesture; plays whatever was last asked for. */
  unlock(): void;
  readonly current: string | null;
  readonly tracks: readonly string[];
};

/** A menu's music filter: muffled (low-pass) or thinned (high-pass). */
export type MusicFilter = "lowpass" | "highpass";

/** The muffled cut-off, in hertz: the music as if through a wall. */
export const muffledCutoff = 550;
/** Seconds the muffle takes to come on or go off. */
export const muffleSeconds = 2;

export function createMusicController(
  player: Pick<
    MusicPlayer,
    | "play"
    | "stop"
    | "windDown"
    | "windUp"
    | "unlock"
    | "current"
    | "setLowPass"
    | "clearLowPass"
    | "setHighPass"
    | "clearHighPass"
  >,
  tracks: readonly string[],
  plans: MusicPlans = composeMusicPlans(tracks),
  random: () => number = Math.random,
): MusicController {
  let unlocked = false;
  const filters: Record<MusicFilter, { on: () => void; off: () => void }> = {
    lowpass: {
      on: () => player.setLowPass(muffledCutoff, muffleSeconds),
      off: () => player.clearLowPass(muffleSeconds),
    },
    highpass: {
      on: () => player.setHighPass(muffledCutoff, muffleSeconds),
      off: () => player.clearHighPass(muffleSeconds),
    },
  };
  /**
   * Memory slots (`tableMusic`): a track remembered within the session, never saved. A fresh
   * Continue begins with them empty and uses the configured resume path.
   */
  const slots = new Map<string, string>();
  /**
   * The track playing as the cue being run sees it: each operation updates it at once, before its
   * deferred playback, so later operations in the same cue observe earlier ones (#855 review).
   * Null while wound down.
   */
  let logicalCurrent: string | null = null;
  /** What a logical wind-down in the cue stopped, for a later logical wind-up. */
  let logicalBeforeDown: string | null = null;
  /** The last request, replayed on unlock. */
  let wanted: () => void = () => {};
  let woundDown = false;
  /** What was playing when the music wound down, for windUp(). */
  let beforeWindDown: string | null = null;

  const request = (action: () => void) => {
    wanted = action;
    if (unlocked) action();
  };
  /**
   * Start a loop. From silence (nothing playing, as on page load, or after a wind-down) it spins
   * up like a record player coming up to speed; over music already playing it crossfades.
   */
  const start = (id: string | null) => {
    if (!id) return;
    if (woundDown || player.current === null) {
      woundDown = false;
      void player.windUp(id);
    } else {
      void player.play(id);
    }
  };
  const windDown = () => {
    if (woundDown) return;
    beforeWindDown = player.current;
    woundDown = true;
    player.windDown();
  };
  const applyFilter = (kind: MusicFilter | null) => {
    // The filter asked for comes on and every other one goes off.
    for (const [name, filter] of Object.entries(filters)) {
      if (name === kind) filter.on();
      else filter.off();
    }
  };

  /**
   * Choose from a plan entry now (so its slot is set at once), returning the playback to do: a
   * selector that keeps the current track while it plays only spins it back up from a wind-down.
   */
  const choose = (name: string): (() => void) => {
    if (!Object.hasOwn(plans, name)) throw new Error(`no music plan "${name}"`);
    const entry = plans[name]!;
    const previous = entry.slot ? (slots.get(entry.slot) ?? null) : null;
    // Wound down, nothing counts as playing: a keeping selector chooses afresh.
    const chosen = musicSelectors.get(entry.selector)(entry.tracks, {
      current: logicalCurrent,
      previous,
      random,
    });
    if (chosen && entry.slot) slots.set(entry.slot, chosen);
    // A keeping selector leaves the logically playing track as it is.
    if (chosen) logicalCurrent = chosen;
    return chosen === undefined ? () => {} : () => start(chosen);
  };

  const run = (operations: readonly MusicOperation[]) => {
    const playback: (() => void)[] = [];
    // Wound down, nothing counts as playing; otherwise the player's track.
    logicalCurrent = woundDown ? null : player.current;
    logicalBeforeDown = beforeWindDown;
    const api: MusicOperationApi = {
      select: (plan) => playback.push(choose(plan)),
      remember: (slot) => {
        // What the cue has logically made current, not what is still audibly playing.
        if (logicalCurrent) slots.set(slot, logicalCurrent);
      },
      resume: (slot, fallbackPlan) => {
        const remembered = slots.get(slot);
        if (remembered) {
          logicalCurrent = remembered;
          playback.push(() => start(remembered));
        } else if (fallbackPlan) playback.push(choose(fallbackPlan));
      },
      windDown: () => {
        // As the deferred wind-down will: an already wound-down player keeps what it stopped.
        if (logicalCurrent !== null) logicalBeforeDown = logicalCurrent;
        logicalCurrent = null;
        playback.push(windDown);
      },
      windUp: () => {
        logicalCurrent = logicalBeforeDown;
        playback.push(() => start(beforeWindDown));
      },
      // Not playback: a filter applies to whatever plays, so it never replaces a request.
      filter: applyFilter,
    };
    for (const { op, config } of operations) musicOperations.get(op)(api, config);
    if (playback.length) request(() => playback.forEach((step) => step()));
  };

  return {
    run,
    filter: applyFilter,
    windDown: () => request(windDown),
    windUp: () => request(() => start(beforeWindDown)),
    get woundDown() {
      return woundDown;
    },
    play: (id) => request(() => start(id)),
    stop: () => request(() => player.stop()),
    unlock() {
      player.unlock();
      if (unlocked) return;
      unlocked = true;
      wanted();
    },
    get current() {
      return player.current;
    },
    tracks,
  };
}
