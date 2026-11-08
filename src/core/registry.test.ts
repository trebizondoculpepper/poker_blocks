import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./registry";

describe("Registry", () => {
  it("stores definitions by name", () => {
    const registry = new Registry<number>("thing");
    registry.register("one", 1);
    registry.register("two", 2);
    expect(registry.get("one")).toBe(1);
    expect(registry.has("two")).toBe(true);
    expect(registry.has("three")).toBe(false);
    expect(registry.names()).toEqual(["one", "two"]);
  });

  it("rejects duplicate names", () => {
    const registry = new Registry<number>("thing");
    registry.register("one", 1);
    expect(() => registry.register("one", 2)).toThrow(/thing "one" is already registered/);
    expect(registry.get("one")).toBe(1);
  });

  it("throws for unknown names", () => {
    expect(() => new Registry<number>("thing").get("nope")).toThrow(/Unknown thing "nope"/);
  });
});
