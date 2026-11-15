import { describe, expect, it, vi } from "vite-plus/test";
import {
  booleanOutcome,
  createContinuation,
  createSettlementHandle,
  createTargetLease,
  dispatchDropOutcome,
  dropOutcomeHandlers,
  returnThenAct,
  type ReturnThenActConfig,
} from "./drop-outcomes";

/** A controlled source: it owns a carried group and restores all of it, or none. */
function source(group = ["a", "b", "c"]) {
  const owned = new Set(group);
  const state = { carrying: [...group], restored: [] as string[], generation: 1 };
  const handle = () =>
    createSettlementHandle(state.generation, () => {
      // Validate the whole group before changing anything.
      if (!state.carrying.every((id) => owned.has(id))) return false;
      state.restored.push(...state.carrying);
      state.carrying = [];
      return true;
    });
  return { state, owned, handle };
}

function action(overrides: Partial<ReturnThenActConfig> = {}) {
  const config = {
    lease: createTargetLease(),
    available: vi.fn(() => true),
    invoke: vi.fn(),
    refused: vi.fn(),
    unavailable: vi.fn(),
    ...overrides,
  };
  return config;
}

describe("source-settled drop outcomes (#1203; doc/drop-settlement.md)", () => {
  it("keeps boolean targets working: true transfers, false refuses", () => {
    const { handle } = source();
    expect(dispatchDropOutcome(booleanOutcome(true, 1), handle())).toBe("transferred");
    expect(dispatchDropOutcome(booleanOutcome(false, 1), handle())).toBe("refused");
  });

  it("returns the complete group, then invokes the action once, without refusal", () => {
    const { state, handle } = source();
    const config = action();
    expect(dispatchDropOutcome(returnThenAct(config, 1), handle())).toBe("returned");
    expect(state.restored).toEqual(["a", "b", "c"]);
    expect(state.carrying).toEqual([]);
    expect(config.invoke).toHaveBeenCalledTimes(1);
    expect(config.refused).not.toHaveBeenCalled();
  });

  it("reports refusal once and never acts when the source can't return the whole group", () => {
    const { state, owned, handle } = source();
    owned.delete("b");
    const config = action();
    expect(dispatchDropOutcome(returnThenAct(config, 1), handle())).toBe("refused");
    // No partial transfer.
    expect(state.restored).toEqual([]);
    expect(config.refused).toHaveBeenCalledTimes(1);
    expect(config.invoke).not.toHaveBeenCalled();
  });

  it("leaves the group returned and reports unavailable when the action went away", () => {
    const { state, handle } = source();
    const before = action({ available: vi.fn(() => false) });
    expect(dispatchDropOutcome(returnThenAct(before, 1), handle())).toBe("returned");
    expect(state.restored).toHaveLength(3);
    expect(before.unavailable).toHaveBeenCalledTimes(1);
    expect(before.invoke).not.toHaveBeenCalled();
  });

  it("doesn't act when the target disappears during the synchronous return", () => {
    const lease = createTargetLease();
    const config = action({ lease });
    const handle = createSettlementHandle(1, () => {
      lease.release();
      return true;
    });
    expect(dispatchDropOutcome(returnThenAct(config, 1), handle)).toBe("returned");
    expect(config.invoke).not.toHaveBeenCalled();
    expect(config.unavailable).toHaveBeenCalledTimes(1);
  });

  it("invokes exactly once under re-entry and duplicate release", () => {
    const { handle } = source();
    const invoke = vi.fn();
    const outcome = returnThenAct(action({ invoke }), 1);
    // The command re-enters: it dispatches the same outcome again from inside its own invocation.
    invoke.mockImplementation(() => {
      expect(dispatchDropOutcome(outcome, handle())).toBe("refused");
    });
    expect(dispatchDropOutcome(outcome, handle())).toBe("returned");
    // A duplicate release later can't consume it either.
    expect(dispatchDropOutcome(outcome, handle())).toBe("refused");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale, already-closed settlement without touching the source", () => {
    const { state, handle } = source();
    const stale = handle();
    stale.close();
    const config = action();
    expect(dispatchDropOutcome(returnThenAct(config, 1), stale)).toBe("refused");
    expect(state.restored).toEqual([]);
    expect(config.invoke).not.toHaveBeenCalled();
    // A new gesture's handle has its own generation and works.
    state.generation = 2;
    const fresh = handle();
    expect(fresh.generation).toBe(2);
    expect(fresh.returnToOwner()).toBe(true);
    expect(fresh.returnToOwner()).toBe(false);
  });

  it("never lets a later gesture consume an earlier gesture's outcome (#1239 review)", () => {
    const { state, handle } = source();
    const config = action();
    // Answered for gesture 1, which was then cancelled.
    const old = returnThenAct(config, 1);
    handle().close();
    state.generation = 2;
    const current = handle();
    expect(dispatchDropOutcome(old, current)).toBe("refused");
    // Nothing restored or invoked, and the current gesture keeps its own settlement.
    expect(state.restored).toEqual([]);
    expect(config.invoke).not.toHaveBeenCalled();
    expect(current.closed).toBe(false);
    expect(dispatchDropOutcome(returnThenAct(action(), 2), current)).toBe("returned");
  });

  it("dispatches by registered operation and closes the settlement it was given", () => {
    const custom = vi.fn(() => "transferred" as const);
    dropOutcomeHandlers.register("test.custom", custom);
    const settlement = createSettlementHandle(7, () => true);
    const outcome = {
      operation: "test.custom",
      config: { x: 1 },
      continuation: createContinuation(7),
    };
    expect(dispatchDropOutcome(outcome, settlement)).toBe("transferred");
    expect(custom).toHaveBeenCalledWith(outcome, settlement);
    const closing = createSettlementHandle(8, () => true);
    dispatchDropOutcome(booleanOutcome(true, 8), closing);
    expect(closing.closed).toBe(true);
  });
});
