import { describe, expect, it } from "vite-plus/test";
import { terminalFieldBurn, type TerminalFieldBurnServices } from "./terminal-field-burn";

function harness() {
  const decided: ((decision: { outcome: string; occurrence: string }) => void)[] = [];
  const holds = new Set<object>();
  const settle: (() => void)[] = [];
  const gates: (() => void)[] = [];
  const log: string[] = [];
  let latest: { generation: number; actionId: string } | null = { generation: 1, actionId: "a1" };
  const services: TerminalFieldBurnServices = {
    run: {
      onDecided(listener) {
        decided.push(listener);
        return () => void decided.splice(decided.indexOf(listener), 1);
      },
      holdResult() {
        const hold = {};
        holds.add(hold);
        log.push("hold");
        return () => {
          if (holds.delete(hold)) log.push("release");
        };
      },
    },
    actionPhase: {
      get latest() {
        return latest;
      },
      observeAction(_key, listener) {
        settle.push(listener);
        return () => {};
      },
    },
    terminalBurn: {
      start(config) {
        log.push(`burn${config ? JSON.stringify(config) : ""}`);
        return {
          onGate(listener) {
            gates.push(() => listener({ state: "finished" }));
            return () => {};
          },
        };
      },
    },
    audio: { playCue: (operations) => log.push(`music ${operations.map(({ op }) => op).join()}`) },
  };
  const trait = terminalFieldBurn<{ services: TerminalFieldBurnServices }>();
  const config = { lost: { music: [{ op: "windDown" }] } } as never;
  trait.enter!({ services } as never, config);
  const decide = (outcome: string, occurrence: string) =>
    decided.slice().forEach((listener) => listener({ outcome, occurrence }));
  return {
    decide,
    holds,
    settle,
    gates,
    log,
    trait,
    services,
    config,
    noRecord: () => (latest = null),
  };
}

describe("terminalFieldBurn (#946)", () => {
  it("holds the result at once, burns after the deciding action settles, releases at the gate", () => {
    const h = harness();
    h.decide("lost", "a1:outcome");
    // Held, but nothing burns while the deciding play's own presentation is still running.
    expect(h.log).toEqual(["hold"]);
    h.settle[0]!();
    // The wind-down goes as the burn starts.
    expect(h.log).toEqual(["hold", "music windDown", "burn"]);
    expect(h.holds.size).toBe(1);
    h.gates[0]!();
    expect(h.holds.size).toBe(0);
    expect(h.log.at(-1)).toBe("release");
  });

  it("presents only configured outcomes, and each occurrence once", () => {
    const h = harness();
    h.decide("won", "a1:outcome");
    expect(h.log).toEqual([]);
    h.decide("lost", "a2:outcome");
    h.decide("lost", "a2:outcome");
    expect(h.log).toEqual(["hold"]);
  });

  it("burns at once when the deciding action has no phase record", () => {
    const h = harness();
    h.noRecord();
    h.decide("lost", "stage:outcome");
    expect(h.log).toEqual(["hold", "music windDown", "burn"]);
  });

  it("stops listening when the scene leaves", () => {
    const h = harness();
    h.trait.exit!({ services: h.services } as never, h.config);
    h.decide("lost", "a1:outcome");
    expect(h.log).toEqual([]);
  });

  it("burns a later run's loss even when its action IDs repeat an earlier run's (#1362 review)", () => {
    const h = harness();
    h.decide("lost", "auto:6:outcome");
    h.settle[0]!();
    // A new run enters its play scene anew; its action IDs restart.
    h.trait.exit!({ services: h.services } as never, h.config);
    h.trait.enter!({ services: h.services } as never, h.config);
    h.decide("lost", "auto:6:outcome");
    expect(h.log.filter((entry) => entry === "hold")).toHaveLength(2);
  });
});
