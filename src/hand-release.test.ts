import { describe, expect, it, vi } from "vite-plus/test";
import type { DropHit, DropTarget } from "./drag-drop";
import { createTargetLease, returnThenAct } from "./drop-outcomes";
import { settleHandRelease, type HandReleaseHost } from "./hand-release";
import type { RenderedBlock } from "./rendered-blocks";

const block = (id: string) => ({ block: { id } }) as unknown as RenderedBlock;

function host(owned = true) {
  const log: string[] = [];
  const h: HandReleaseHost = {
    owns: () => owned,
    putBack: (blocks) => void log.push(`putBack ${blocks.length}`),
    layout: () => void log.push("layout"),
    sfx: (id) => void log.push(`sfx ${id}`),
    trace: (event) => void log.push(`trace ${event}`),
    canPlay: () => true,
  };
  return { h, log };
}

const target = (overrides: Partial<DropTarget>): DropHit => ({
  name: "zone",
  verdict: "accept",
  target: {
    canDrop: () => "accept",
    hover: () => {},
    drop: () => true,
    reject: () => {},
    describe: () => "",
    ...overrides,
  },
});

const carried = [block("a"), block("b")];

describe("a released hand drag settles through drop outcomes (#1204; doc/drop-settlement.md)", () => {
  it("keeps a boolean target's transfer and refusal through the compatibility adapter", () => {
    const taken = host();
    expect(
      settleHandRelease(taken.h, {
        carried,
        ordered: carried,
        hit: target({}),
        drop: true,
        generation: 1,
      }),
    ).toBe("transferred");
    expect(taken.log).toEqual(["trace dropped on zone"]);
    const refused = host();
    expect(
      settleHandRelease(refused.h, {
        carried,
        ordered: carried,
        hit: target({ drop: () => false }),
        drop: true,
        generation: 2,
      }),
    ).toBe("refused");
    expect(refused.log).toEqual(["trace refused", "sfx action.denied", "putBack 2", "layout"]);
  });

  it("returns with no target, and denies a rejecting one, as before", () => {
    const empty = host();
    expect(
      settleHandRelease(empty.h, {
        carried,
        ordered: carried,
        hit: null,
        drop: true,
        generation: 1,
      }),
    ).toBe("returned");
    expect(empty.log).toEqual(["trace returned", "sfx card.drag.return", "putBack 2", "layout"]);
    const rejected = host();
    settleHandRelease(rejected.h, {
      carried,
      ordered: carried,
      hit: { ...target({}), verdict: "reject" },
      drop: true,
      generation: 1,
    });
    expect(rejected.log).toContain("sfx action.denied");
  });

  it("returns the whole group before a return-then-act target acts, once, with no denial", () => {
    const { h, log } = host();
    const invoke = vi.fn(() => log.push("act"));
    const lease = createTargetLease();
    const hit = target({
      outcome: (_carried, generation) =>
        returnThenAct(
          { lease, available: () => true, invoke, refused: vi.fn(), unavailable: vi.fn() },
          generation,
        ),
    });
    expect(
      settleHandRelease(h, { carried, ordered: carried, hit, drop: true, generation: 7 }),
    ).toBe("returned");
    expect(log).toEqual(["putBack 2", "layout", "sfx card.drag.return", "act", "trace returned"]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(log).not.toContain("sfx action.denied");
  });

  it("never acts when the hand no longer owns every carried block: the target reports, once", () => {
    const { h, log } = host(false);
    const invoke = vi.fn();
    const refused = vi.fn();
    const hit = target({
      outcome: (_carried, generation) =>
        returnThenAct(
          {
            lease: createTargetLease(),
            available: () => true,
            invoke,
            refused,
            unavailable: vi.fn(),
          },
          generation,
        ),
    });
    expect(
      settleHandRelease(h, { carried, ordered: carried, hit, drop: true, generation: 3 }),
    ).toBe("refused");
    expect(invoke).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledOnce();
    // No second denial or put-back from the hand.
    expect(log).toEqual(["trace refused"]);
  });

  it("leaves the action unavailable after a successful return when the target went away", () => {
    const { h } = host();
    const lease = createTargetLease();
    const unavailable = vi.fn();
    const invoke = vi.fn();
    const hit = target({
      outcome: (_carried, generation) =>
        returnThenAct(
          {
            lease,
            available: () => {
              return true;
            },
            invoke,
            refused: vi.fn(),
            unavailable,
          },
          generation,
        ),
    });
    lease.release();
    settleHandRelease(h, { carried, ordered: carried, hit, drop: true, generation: 4 });
    expect(invoke).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it("refuses an outcome answered for another gesture, returning the blocks the ordinary way", () => {
    const { h, log } = host();
    const invoke = vi.fn();
    const stale = target({
      outcome: () =>
        returnThenAct(
          {
            lease: createTargetLease(),
            available: () => true,
            invoke,
            refused: vi.fn(),
            unavailable: vi.fn(),
          },
          99,
        ),
    });
    expect(
      settleHandRelease(h, { carried, ordered: carried, hit: stale, drop: true, generation: 5 }),
    ).toBe("refused");
    expect(invoke).not.toHaveBeenCalled();
    expect(log).toEqual(["trace refused", "sfx action.denied", "putBack 2", "layout"]);
  });
});
