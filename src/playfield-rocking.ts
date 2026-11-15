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
import { visualHandlers } from "./visual-events/scheduler";
import { createTweenService, type TweenHandle } from "./visual-events/tweens";

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

/**
 * One finite envelope on the shared interpolation service (doc/playfield-rocking.md): a value
 * that eases to each new target from wherever it is, interrupting the previous ease.
 */
function easedValue(tweens: ReturnType<typeof createTweenService>, initial: number) {
  let value = initial;
  let running: TweenHandle | null = null;
  return {
    get value() {
      return value;
    },
    to(target: number, units: number, nowMs: number) {
      running?.cancel();
      running = tweens.start(
        {
          from: { value },
          to: { value: target },
          durationUnits: units,
          easing: "quadInOut",
          apply: (values) => void (value = values.value!),
        },
        nowMs,
      );
    },
    set(target: number) {
      running?.cancel();
      running = null;
      value = target;
    },
  };
}

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
  /** Cancel its eases. */
  dispose(): void;
};

export function createRockingEnvelope(
  config: PlayfieldRockingConfig,
  initialKg: number | null,
  _nowMs: number,
): RockingEnvelope {
  const tweens = createTweenService();
  const mass = easedValue(tweens, massRate(initialKg, config));
  const hand = easedValue(tweens, 1);
  /** The board envelope: 0 while held, easing to 1 after a resume. */
  const board = easedValue(tweens, 1);
  let suspended = false;
  return {
    setMass(totalKg, now) {
      mass.to(massRate(totalKg, config), config.retargetUnits, now);
    },
    holdForBoard() {
      board.set(0);
    },
    resume(now) {
      board.set(0);
      board.to(1, config.rampUnits, now);
    },
    setHandDrag(dragging, now) {
      hand.to(dragging ? config.handDragFactor : 1, config.handDragUnits, now);
    },
    setSuspended(value) {
      suspended = value;
    },
    rate(now, reducedMotion) {
      tweens.update(now);
      if (suspended || reducedMotion) return 0;
      return mass.value * hand.value * board.value;
    },
    dispose: () => tweens.dispose(),
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
      envelope.dispose();
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
      envelope.dispose();
      // Scenes that don't compose the controller rock at the camera's plain rate.
      services.setRate(1);
    },
  };
}
