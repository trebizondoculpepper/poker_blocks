import { describe, expect, it, vi } from "vite-plus/test";
import { createTargetLease, returnThenAct } from "./drop-outcomes";
import { settleOfferRelease, type OfferReleaseHost } from "./offer-release";

function host(options: { owns?: boolean; buys?: boolean } = {}) {
  const log: string[] = [];
  const h: OfferReleaseHost = {
    owns: () => options.owns ?? true,
    putBack: () => void log.push("putBack"),
    buy: () => (log.push("buy"), options.buys ?? true),
    purchased: () => void log.push("purchased"),
  };
  return { h, log };
}

const release = (over: Partial<Parameters<typeof settleOfferRelease>[1]> = {}) => ({
  generation: 1,
  canceled: false,
  inert: false,
  target: null,
  onPurchaseTarget: true,
  ...over,
});

const continueTarget = (
  generation: number,
  config: Partial<Parameters<typeof returnThenAct>[0]> = {},
) => ({
  contains: () => true,
  outcome: () =>
    returnThenAct(
      {
        lease: createTargetLease(),
        available: () => true,
        invoke: vi.fn(),
        refused: vi.fn(),
        unavailable: vi.fn(),
        ...config,
      },
      generation,
    ),
});

describe("a released shop offer settles through drop outcomes (#1206; doc/drop-settlement.md)", () => {
  it("buys over its purchase target, as before, and returns a refused or stray release", () => {
    const bought = host();
    expect(settleOfferRelease(bought.h, release())).toBe("transferred");
    expect(bought.log).toEqual(["buy", "purchased"]);
    const refused = host({ buys: false });
    expect(settleOfferRelease(refused.h, release())).toBe("refused");
    expect(refused.log).toEqual(["buy", "putBack"]);
    const stray = host();
    expect(settleOfferRelease(stray.h, release({ onPurchaseTarget: false }))).toBe("refused");
    expect(stray.log).toEqual(["putBack"]);
  });

  it("never buys from a cancelled drag or a burning stock", () => {
    for (const over of [{ canceled: true }, { inert: true }]) {
      const { h, log } = host();
      expect(settleOfferRelease(h, release(over))).toBe("returned");
      expect(log).toEqual(["putBack"]);
    }
  });

  it("puts the offer back unsold before a return-then-act target acts, once", () => {
    const { h, log } = host();
    const invoke = vi.fn(() => log.push("continue"));
    expect(settleOfferRelease(h, release({ target: continueTarget(1, { invoke }) }))).toBe(
      "returned",
    );
    expect(log).toEqual(["putBack", "continue"]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(log).not.toContain("buy");
  });

  it("never acts when the shop no longer shows the offer: the target reports it once", () => {
    const { h, log } = host({ owns: false });
    const invoke = vi.fn();
    const refused = vi.fn();
    expect(settleOfferRelease(h, release({ target: continueTarget(1, { invoke, refused }) }))).toBe(
      "refused",
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledOnce();
    expect(log).toEqual([]);
  });

  it("refuses a target's outcome answered for another release, returning the offer", () => {
    const { h, log } = host();
    const invoke = vi.fn();
    expect(
      settleOfferRelease(h, release({ generation: 2, target: continueTarget(1, { invoke }) })),
    ).toBe("refused");
    expect(invoke).not.toHaveBeenCalled();
    expect(log).toEqual(["putBack"]);
  });

  it("leaves the offer returned when the action is no longer available after the return", () => {
    const { h, log } = host();
    const invoke = vi.fn();
    const unavailable = vi.fn();
    settleOfferRelease(
      h,
      release({ target: continueTarget(1, { invoke, unavailable, available: () => false }) }),
    );
    expect(log).toEqual(["putBack"]);
    expect(invoke).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
  });
});
