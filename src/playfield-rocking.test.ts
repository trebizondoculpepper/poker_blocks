import { describe, expect, it } from "vite-plus/test";
import {
  createPlayfieldRockingController,
  createRockingEnvelope,
  createRockingRelay,
  defaultPlayfieldRocking as config,
  massRate,
  type BoardTurnListener,
  type PlayfieldRockingServices,
} from "./playfield-rocking";
import { unitsToMs } from "./visual-events/scheduler";

const second = unitsToMs(15);

describe("mass rate (#783; doc/playfield-rocking.md)", () => {
  it("is inverse total mass, rate 1 at 5 kg, capped at 1.5, zero when empty", () => {
    expect(massRate(null, config)).toBe(0);
    expect(massRate(5, config)).toBe(1);
    expect(massRate(6.5, config)).toBeCloseTo(0.769231, 6);
    expect(massRate(22, config)).toBeCloseTo(0.227273, 6);
    expect(massRate(193.2, config)).toBeCloseTo(0.02588, 5);
    expect(massRate(0.016, config)).toBe(1.5);
    // Doubling a stack halves its rate outside the cap.
    expect(massRate(44, config)).toBeCloseTo(massRate(22, config) / 2, 12);
    expect(Number.isFinite(massRate(0, config))).toBe(true);
  });
});

describe("rocking envelope", () => {
  it("holds at zero through a board turn, then eases in from rest once resumed", () => {
    const envelope = createRockingEnvelope(config, 5, 0);
    expect(envelope.rate(0, false)).toBe(1);
    envelope.holdForBoard();
    expect(envelope.rate(10_000, false)).toBe(0);
    envelope.resume(1000);
    expect(envelope.rate(1000, false)).toBe(0);
    const mid = envelope.rate(1000 + second / 2, false);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(envelope.rate(1000 + second, false)).toBe(1);
  });

  it("retargets mass smoothly from the current rate", () => {
    const envelope = createRockingEnvelope(config, 5, 0);
    envelope.setMass(10, 0);
    expect(envelope.rate(0, false)).toBe(1);
    expect(envelope.rate(second / 2, false)).toBeCloseTo(0.75, 6);
    expect(envelope.rate(second, false)).toBe(0.5);
  });

  it("damps for hand carrying independently, and rests under reduced motion or suspension", () => {
    const envelope = createRockingEnvelope(config, 5, 0);
    envelope.setHandDrag(true, 0);
    expect(envelope.rate(10_000, false)).toBeCloseTo(0.1, 12);
    envelope.setHandDrag(false, 10_000);
    expect(envelope.rate(20_000, false)).toBe(1);
    expect(envelope.rate(20_000, true)).toBe(0);
    envelope.setSuspended(true);
    expect(envelope.rate(20_000, false)).toBe(0);
  });
});

function harness(mass: number | null = 5) {
  let now = 0;
  let rate = -1;
  let turn: BoardTurnListener | null = null;
  let carry: ((carrying: boolean) => void) | null = null;
  let committed: (() => void) | null = null;
  const relay = createRockingRelay();
  const pending: { generation: number; at: number; cancelled: boolean }[] = [];
  let kg = mass;
  const services: PlayfieldRockingServices = {
    setRate: (value) => void (rate = value),
    nowMs: () => now,
    scheduleResume(generation, units) {
      const entry = { generation, at: now + unitsToMs(units), cancelled: false };
      pending.push(entry);
      return () => void (entry.cancelled = true);
    },
    observeBoardTurn: (listener) => ((turn = listener), () => void (turn = null)),
    observeCarry: (listener) => ((carry = listener), () => void (carry = null)),
    onCommitted: (listener) => ((committed = listener), () => void (committed = null)),
    fieldMassKg: () => kg,
    reducedMotion: () => false,
    relay,
  };
  const controller = createPlayfieldRockingController(services);
  const advance = (ms: number) => {
    now += ms;
    for (const entry of pending)
      if (!entry.cancelled && entry.at <= now) {
        entry.cancelled = true;
        relay.resume(entry.generation, entry.at);
      }
    controller.update();
    return rate;
  };
  return {
    controller,
    advance,
    turn: () => turn!,
    carry: (value: boolean) => carry!(value),
    commit: (value: number | null) => ((kg = value), committed!()),
    pending,
  };
}

describe("playfieldRockingController", () => {
  it("waits the quiet second after a turn, then ramps over a second", () => {
    const h = harness();
    h.controller.enter();
    expect(h.advance(0)).toBe(1);
    h.turn().began();
    expect(h.advance(500)).toBe(0);
    h.turn().ended();
    expect(h.advance(second - 1)).toBe(0);
    expect(h.advance(second / 2 + 1)).toBeGreaterThan(0);
    expect(h.advance(second)).toBe(1);
  });

  it("a new turn cancels the pending restart, and only the latest one resumes", () => {
    const h = harness();
    h.controller.enter();
    h.turn().began();
    h.turn().ended();
    h.advance(second / 2);
    h.turn().began();
    expect(h.pending[0]!.cancelled).toBe(true);
    expect(h.advance(second * 3)).toBe(0);
    h.turn().ended();
    expect(h.advance(second * 3)).toBe(1);
  });

  it("covers to zero, drops a pending restart, and resumes fresh on the current mass", () => {
    const h = harness();
    h.controller.enter();
    h.turn().began();
    h.turn().ended();
    h.controller.cover();
    expect(h.advance(second * 3)).toBe(0);
    h.commit(10);
    h.controller.resume();
    expect(h.advance(0)).toBe(0);
    expect(h.advance(second * 3)).toBe(0.5);
  });

  it("follows committed field mass and hand carrying; an empty field rests", () => {
    const h = harness();
    h.controller.enter();
    h.commit(22);
    expect(h.advance(second * 2)).toBeCloseTo(0.227273, 6);
    h.carry(true);
    expect(h.advance(second * 2)).toBeCloseTo(0.0227273, 6);
    h.carry(false);
    h.commit(null);
    expect(h.advance(second * 2)).toBe(0);
  });

  it("detaches on exit, so a late resume does nothing", () => {
    const h = harness();
    h.controller.enter();
    h.turn().began();
    h.turn().ended();
    h.controller.exit();
    expect(h.pending[0]!.cancelled).toBe(true);
  });
});
