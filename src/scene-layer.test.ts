import { describe, expect, it } from "vite-plus/test";
import { createSceneLayer } from "./scene-layer";

describe("background traits bring their own layers (#189)", () => {
  it("mounts a layer for the first scene that wants it and removes it after the last", () => {
    const calls: string[] = [];
    const layer = createSceneLayer(
      () => calls.push("mount"),
      () => calls.push("unmount"),
    );
    expect(layer.mounted).toBe(false);
    layer.entered(true); // the stage
    layer.entered(true); // a pop-up pushed over it that also wants the layer
    layer.entered(false);
    expect(calls).toEqual(["mount"]);
    layer.entered(false);
    expect(calls).toEqual(["mount", "unmount"]);
    expect(layer.mounted).toBe(false);
  });
});
