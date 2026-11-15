/**
 * Delayed, mass-dependent playfield rocking (#783; doc/playfield-rocking.md).
 *
 * The rate the playfield's automatic rocking advances at is the product of independent owned
 * envelopes, each released only by its owner:
 *
 * - **mass:** `r = min(cap, referenceKg / max(M, 0.001 kg))` for the placed field's total mass
 *   M; 0 for an empty field. A change of mass retargets smoothly from the current rate.
 * - **board:** a board turn holds the rate at zero; when it ends the controller schedules a
 *   resume on the shared scheduler after the quiet interval, and the rate then eases in from 0.
 * - **hand drag:** carrying hand blocks damps the rate to a factor, eased.
 * - **suspended / reduced motion:** hold at zero, dominating any pending restart.
 *
 * Pure: time is passed in (presentation-clock milliseconds), so it is tested without a clock.
 * It never changes gameplay; phase stays with the camera, which integrates the rate.
 */
import { unitsToMs, visualHandlers } from "./visual-events/scheduler";

export type PlayfieldRockingConfig = {
  /** The mass rocking at rate 1, kg. */
  referenceKg: number;
  /** The fastest rate a very light stack may reach. */
  cap: number;
  /** Game-time units of stillness after a board turn before rocking restarts. */
  quietUnits: number;
  /** Game-time units the restart eases in over, from rest. */
  rampUnits: number;
  /** Game-time units a mass change retargets over. */
  retargetUnits: number;
  /** The rate factor while hand blocks are carried, and how long it eases (units). */
  handDragFactor: number;
  handDragUnits: number;
};

export const defaultPlayfieldRocking: PlayfieldRockingConfig = {
  referenceKg: 5,
  cap: 1.5,
  quietUnits: 15,
  rampUnits: 15,
  retargetUnits: 15,
  handDragFactor: 0.1,
  handDragUnits: 7.5,
};

/** The mass envelope's target rate for a field of total mass `totalKg` (null: empty). */
export function massRate(totalKg: number | null, config: PlayfieldRockingConfig): number {
  if (totalKg === null) return 0;
  return Math.min(config.cap, config.referenceKg / Math.max(totalKg, 0.001));
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** A value easing from `from` to `to` starting at `at`, over `ms`. */
type Tween = { from: number; to: number; at: number; ms: number };
const valueAt = (tween: Tween, now: number) =>
  tween.from + (tween.to - tween.from) * smooth(tween.ms > 0 ? (now - tween.at) / tween.ms : 1);
const retarget = (tween: Tween, to: number, now: number, ms: number): Tween => ({
  from: valueAt(tween, now),
  to,
  at: now,
  ms,
});

export type RockingEnvelope = {
  /** The field's total mass changed (null: empty). */
  setMass(totalKg: number | null, nowMs: number): void;
  /** A board turn began: hold at zero until it ends and the quiet interval passes. */
  holdForBoard(): void;
  /** The scheduled resume arrived: ease in from rest. */
  resume(nowMs: number): void;
  /** Hand blocks are carried, or no longer. */
  setHandDrag(dragging: boolean, nowMs: number): void;
  /** The scene is covered/paused, or in front again. */
  setSuspended(suspended: boolean): void;
  /** The rate now. */
  rate(nowMs: number, reducedMotion: boolean): number;
};

export function createRockingEnvelope(
  config: PlayfieldRockingConfig,
  initialKg: number | null,
  nowMs: number,
): RockingEnvelope {
  let mass: Tween = { from: 0, to: massRate(initialKg, config), at: nowMs, ms: 0 };
  let hand: Tween = { from: 1, to: 1, at: nowMs, ms: 0 };
  /** Board envelope: held at zero, or easing in from when it resumed. */
  let board: { held: true } | { held: false; from: number } = { held: false, from: -Infinity };
  let suspended = false;
  return {
    setMass(totalKg, now) {
      mass = retarget(mass, massRate(totalKg, config), now, unitsToMs(config.retargetUnits));
    },
    holdForBoard() {
      board = { held: true };
    },
    resume(now) {
      board = { held: false, from: now };
    },
    setHandDrag(dragging, now) {
      hand = retarget(
        hand,
        dragging ? config.handDragFactor : 1,
        now,
        unitsToMs(config.handDragUnits),
      );
    },
    setSuspended(value) {
      suspended = value;
    },
    rate(now, reducedMotion) {
      if (suspended || reducedMotion || board.held) return 0;
      const ramp = smooth((now - board.from) / unitsToMs(config.rampUnits));
      return valueAt(mass, now) * valueAt(hand, now) * ramp;
    },
  };
}

/** The board gesture owner's turn lifecycle (#783). */
export type BoardTurnListener = { began(): void; ended(): void };

/** Where a scheduled resume arrives: the controller attached now, by its generation. */
export type RockingSink = { resume(generation: number, nowMs: number): void };

/** The relay the resume handler reaches through the scheduler's services. */
export function createRockingRelay(): RockingSink & { attach(sink: RockingSink): () => void } {
  let attached: RockingSink | null = null;
  return {
    attach(sink) {
      attached = sink;
      return () => {
        if (attached === sink) attached = null;
      };
    },
    resume: (generation, nowMs) => attached?.resume(generation, nowMs),
  };
}

/** The resume event's registered handler: it presents only its captured generation. */
export const rockingResumeHandler = "playfield.rocking.resume";
visualHandlers.register(rockingResumeHandler, (payload, context) => {
  const { playfieldRocking } = context.services as { playfieldRocking?: RockingSink };
  playfieldRocking?.resume((payload as { generation: number }).generation, context.nowMs);
  return "done";
});

/** What the controller trait is given: narrow capabilities, no identity. */
export type PlayfieldRockingServices = {
  /** The camera's automatic rocking rate, applied as given. */
  setRate(rate: number): void;
  /** The shared presentation clock, ms. */
  nowMs(): number;
  /** Schedule the resume for `generation` after `units`; returns a cancel. */
  scheduleResume(generation: number, units: number): () => void;
  /** The board gesture owner's turn lifecycle. */
  observeBoardTurn(listener: BoardTurnListener): () => void;
  /** Whether hand blocks are being carried. */
  observeCarry(listener: (carrying: boolean) => void): () => void;
  /** Committed facts published: the field may have changed. */
  onCommitted(listener: () => void): () => void;
  /** The committed field's total mass (kg), or null when empty or unresolvable. */
  fieldMassKg(): number | null;
  reducedMotion(): boolean;
  relay: { attach(sink: RockingSink): () => void };
};

/**
 * The `playfieldRockingController` scene trait's lifecycle (#783): owns the envelope, the
 * gesture and carry subscriptions and the resume generation; pushes a rate every frame.
 */
export function createPlayfieldRockingController(
  services: PlayfieldRockingServices,
  settings: Partial<PlayfieldRockingConfig> = {},
) {
  const config = { ...defaultPlayfieldRocking, ...settings };
  let envelope = createRockingEnvelope(config, services.fieldMassKg(), services.nowMs());
  let generation = 0;
  let cancelResume: (() => void) | null = null;
  let stops: (() => void)[] = [];
  const cancelPending = () => {
    generation += 1;
    cancelResume?.();
    cancelResume = null;
  };
  return {
    enter() {
      envelope = createRockingEnvelope(config, services.fieldMassKg(), services.nowMs());
      stops = [
        services.relay.attach({
          resume(of, nowMs) {
            if (of === generation) envelope.resume(nowMs);
          },
        }),
        services.observeBoardTurn({
          began() {
            cancelPending();
            envelope.holdForBoard();
          },
          ended() {
            cancelPending();
            cancelResume = services.scheduleResume(generation, config.quietUnits);
          },
        }),
        services.observeCarry((carrying) => envelope.setHandDrag(carrying, services.nowMs())),
        services.onCommitted(() => envelope.setMass(services.fieldMassKg(), services.nowMs())),
      ];
    },
    update() {
      services.setRate(envelope.rate(services.nowMs(), services.reducedMotion()));
    },
    cover() {
      cancelPending();
      envelope.setSuspended(true);
      services.setRate(0);
    },
    resume() {
      cancelPending();
      envelope.setSuspended(false);
      // A fresh envelope from now, on the current mass: no stale callback from before cover.
      envelope.setMass(services.fieldMassKg(), services.nowMs());
      envelope.resume(services.nowMs());
    },
    exit() {
      cancelPending();
      stops.forEach((stop) => stop());
      stops = [];
      // Scenes that don't compose the controller rock at the camera's plain rate.
      services.setRate(1);
    },
  };
}
