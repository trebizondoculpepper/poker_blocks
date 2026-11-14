import { describe, expect, it, vi } from "vite-plus/test";
import type { DragLifecycle } from "../drag-drop";

const created: {
  config: unknown;
  frame: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}[] = [];
vi.mock("../visual/drop-target-guide", () => ({
  createDropTargetGuide: (config: unknown, host: { observeDrag(l: unknown): () => void }) => {
    host.observeDrag(() => undefined);
    const guide = { config, frame: vi.fn(), dispose: vi.fn() };
    created.push(guide);
    return guide;
  },
}));
const { dropTargetGuide } = await import("./drop-target-guide");

const config = {
  provider: "offers",
  accept: { shape: "rectangle", colour: 1 },
  refuse: { shape: "cross", colour: 2 },
};

function context(reducedMotion: boolean) {
  const observeDrag = vi.fn((_listener: (event: DragLifecycle) => void) => () => undefined);
  return {
    observeDrag,
    value: {
      host: {} as HTMLElement,
      services: { input: { observeDrag }, run: { reducedMotion } },
    },
  };
}

describe("dropTargetGuide scene trait (#922)", () => {
  it("mounts on enter, advances on update, disposes on re-entry and exit", () => {
    created.length = 0;
    const trait = dropTargetGuide();
    const { value, observeDrag } = context(true);
    trait.enter!(value, config);
    expect(created).toHaveLength(1);
    expect(observeDrag).toHaveBeenCalledTimes(1);
    trait.update!(value, config, 0.25);
    trait.update!(value, config, 0.5);
    expect(created[0]!.frame).toHaveBeenLastCalledWith(0.75, true);
    trait.enter!(value, config);
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    trait.exit!(value, config);
    expect(created[1]!.dispose).toHaveBeenCalledTimes(1);
    trait.update!(value, config, 1);
    expect(created[1]!.frame).not.toHaveBeenCalled();
  });
});
