import { describe, expect, it, vi } from "vite-plus/test";
import type { DropTargetGuide } from "../visual/drop-target-guide";
import { dropTargetGuide } from "./drop-target-guide";

const config = {
  provider: "offers",
  accept: { shape: "rectangle", colour: 1 },
  refuse: { shape: "cross", colour: 2 },
};

describe("dropTargetGuide scene trait (#922)", () => {
  it("mounts on enter, advances on update, disposes on re-entry and exit", () => {
    const created: { frame: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
    const create = vi.fn(() => {
      const guide = { frame: vi.fn(), dispose: vi.fn(), showing: () => [] };
      created.push(guide);
      return guide as unknown as DropTargetGuide;
    });
    const context = {
      services: { dropTargetGuides: { create }, run: { reducedMotion: true } },
    };
    const trait = dropTargetGuide<typeof context>();
    trait.enter!(context, config);
    expect(create).toHaveBeenCalledWith(config);
    trait.update!(context, config, 0.25);
    trait.update!(context, config, 0.5);
    expect(created[0]!.frame).toHaveBeenLastCalledWith(0.75, true);
    trait.enter!(context, config);
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    trait.exit!(context, config);
    expect(created[1]!.dispose).toHaveBeenCalledTimes(1);
    trait.update!(context, config, 1);
    expect(created[1]!.frame).not.toHaveBeenCalled();
  });
});
