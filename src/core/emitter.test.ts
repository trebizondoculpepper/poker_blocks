import { describe, expect, it } from "vite-plus/test";
import { Emitter } from "./emitter";

describe("Emitter", () => {
  it("passes payloads to listeners of that type only", () => {
    const emitter = new Emitter();
    const seen: unknown[] = [];
    emitter.on("score", (payload) => seen.push(payload));
    emitter.emit("score", 5);
    emitter.emit("destroy");
    expect(seen).toEqual([5]);
    expect(emitter.listens("score")).toBe(true);
    expect(emitter.listens("destroy")).toBe(false);
  });

  it("stops delivering to an unsubscribed listener", () => {
    const emitter = new Emitter();
    const seen: unknown[] = [];
    const off = emitter.on("score", (payload) => seen.push(payload));
    emitter.emit("score", 1);
    off();
    emitter.emit("score", 2);
    expect(seen).toEqual([1]);
  });

  it("lets a listener unsubscribe during a dispatch", () => {
    const emitter = new Emitter();
    const seen: string[] = [];
    const off = emitter.on("score", () => {
      seen.push("first");
      off();
    });
    emitter.on("score", () => seen.push("second"));
    emitter.emit("score");
    emitter.emit("score");
    expect(seen).toEqual(["first", "second", "second"]);
  });

  it("clears every listener", () => {
    const emitter = new Emitter();
    const seen: unknown[] = [];
    emitter.on("score", (payload) => seen.push(payload));
    emitter.clear();
    emitter.emit("score", 1);
    expect(seen).toEqual([]);
  });
});
