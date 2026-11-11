import { describe, expect, it, vi } from "vite-plus/test";

describe("transmogrifier look (#391)", () => {
  it("draws a charge dial for uses left: a half-moon after one of two uses", async () => {
    const element = () => {
      const style = new Map<string, string>();
      const attributes = new Map<string, string>();
      return {
        className: "",
        title: "",
        style: { setProperty: (name: string, value: string) => style.set(name, value) },
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        styleMap: style,
        attributes,
      };
    };
    vi.stubGlobal("document", { createElement: element });
    try {
      const { rackBadges } = await import("./passive-rack");
      const dial = rackBadges.get("limitedUse")({ uses: 1, total: 2 }) as unknown as ReturnType<
        typeof element
      >;
      expect(dial.styleMap.get("--charge")).toBe("180deg");
      expect(dial.attributes.get("aria-label")).toBe("1 of 2 uses left");
      expect(rackBadges.has("transmogrifier")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the material-block visual, registered alongside the transmogrifiers", async () => {
    await import("./transmogrifiers");
    const { passiveVisualBuilders } = await import("./passive-visual");
    const { passiveDefinitions } = await import("./passives");
    expect(passiveVisualBuilders.has("materialBlock")).toBe(true);
    expect(passiveDefinitions.get("transmogrifier.steel").visual).toEqual({
      builder: "materialBlock",
      config: { material: "steel" },
    });
  });
});
