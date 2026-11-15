import { describe, expect, it, vi } from "vite-plus/test";
import { binPresenters, createBinView } from "./bin-view";

function binElement() {
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};
  return {
    hidden: true,
    classList: {
      toggle: (name: string, on?: boolean) => {
        const want = on ?? !classes.has(name);
        if (want) classes.add(name);
        else classes.delete(name);
        return want;
      },
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => void (attributes[name] = value),
    querySelector: () => ({ textContent: "" }),
    classes,
  };
}

describe("bin presenters composed by the sell scene (#1078)", () => {
  it("draws the bin with the scene's presenter while it is on the stack, and only then", () => {
    const dispose = vi.fn();
    const setCovered = vi.fn();
    const mount = vi.fn(() => ({ dispose, setCovered }));
    binPresenters.register("test.block", { mount });
    const element = binElement();
    const bin = createBinView(element as never);
    bin.discardBinEntered(true);
    expect(mount).not.toHaveBeenCalled();
    bin.sellBinEntered(true, "test.block");
    expect(mount).toHaveBeenCalledTimes(1);
    expect(element.classes.has("is-presented")).toBe(true);
    expect(bin.selling).toBe(true);
    // Covered by a menu: the presenter rests, and shows again on resume.
    bin.sellBinCovered(true);
    bin.sellBinCovered(false);
    expect(setCovered.mock.calls).toEqual([[true], [false]]);
    bin.sellBinEntered(false, "test.block");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(element.classes.has("is-presented")).toBe(false);
  });

  it("leaves a sell scene without a presenter on the bin's own label", () => {
    const element = binElement();
    const bin = createBinView(element as never);
    bin.sellBinEntered(true);
    expect(element.classes.has("is-presented")).toBe(false);
    expect(bin.selling).toBe(true);
  });
});
