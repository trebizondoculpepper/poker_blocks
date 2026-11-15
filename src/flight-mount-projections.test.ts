import { describe, expect, it } from "vite-plus/test";
import "./flight-mount-projections";
import { createMountRegistry } from "./visual-events/mount-registry";

type Cell = { x: number; y: number; z: number };
type Card = { id: string; material: string };

describe("committed facts on in-flight mounts (#1164; doc/visual-event-interface.md)", () => {
  it("swaps a changed block's appearance, keeping its flight pose", () => {
    const mounts = createMountRegistry<Cell, Card>();
    const cell = { x: 1, y: 0, z: 0 };
    const mount = mounts.create(cell, { id: "7h", material: "paper" });
    const after = { id: "7h", material: "gold" };
    expect(
      mounts.publish(
        {
          handler: "block.materialChanged",
          correlation: 1,
          payload: { blockId: "7h", snapshots: { after } },
        },
        mount,
      ),
    ).toBe(true);
    const resolved = mounts.resolve(mount)!;
    expect(resolved.appearance).toEqual(after);
    expect(resolved.pose).toBe(cell);
    expect(resolved.revisions).toEqual({ pose: 1, appearance: 2 });
  });

  it("invalidates a removed block's mount, so landing omits it", () => {
    const mounts = createMountRegistry<Cell, Card>();
    const mount = mounts.create({ x: 0, y: 0, z: 0 }, { id: "q", material: "wood" });
    mounts.publish({ handler: "block.removed", correlation: 1, payload: { blockId: "q" } }, mount);
    expect(mounts.resolve(mount)).toBeNull();
  });

  it("applies nothing for a fact with no registered projection, and refuses stale order", () => {
    const mounts = createMountRegistry<Cell, Card>();
    const mount = mounts.create({ x: 0, y: 0, z: 0 }, { id: "k", material: "wood" });
    expect(
      mounts.publish({ handler: "score.totalApplied", correlation: 1, payload: {} }, mount),
    ).toBe(false);
    mounts.publish(
      {
        handler: "block.materialChanged",
        correlation: 3,
        payload: { snapshots: { after: { id: "k", material: "steel" } } },
      },
      mount,
    );
    mounts.publish(
      {
        handler: "block.materialChanged",
        correlation: 2,
        payload: { snapshots: { after: { id: "k", material: "tin" } } },
      },
      mount,
    );
    expect(mounts.resolve(mount)!.appearance.material).toBe("steel");
  });
});
