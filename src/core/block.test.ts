import { describe, expect, it } from "vite-plus/test";
import { Block } from "./block";
import { defineTrait, trait } from "./trait";

const Loud = defineTrait({
  name: "loud",
  defaults: { volume: 1, label: "x" as string },
});

describe("Block", () => {
  it("attaches a trait and merges settings over its defaults", () => {
    const block = new Block("ace").add(Loud, { volume: 5 });
    expect(block.has(Loud)).toBe(true);
    expect(block.traitNames()).toEqual(["loud"]);
    expect(block.settingsOf(Loud)).toEqual({ volume: 5, label: "x" });
  });

  it("gives each block its own settings object", () => {
    const one = new Block("one").add(Loud);
    const two = new Block("two").add(Loud);
    one.settingsOf(Loud)!.volume = 9;
    expect(two.settingsOf(Loud)!.volume).toBe(1);
  });

  it("rejects attaching the same trait twice", () => {
    const block = new Block("ace").add(Loud);
    expect(() => block.add(Loud)).toThrow(/Trait "loud" is already attached to "ace"/);
  });

  it("attaches a list of trait entries", () => {
    const Quiet = defineTrait({ name: "quiet", defaults: { volume: 0 } });
    const block = new Block("ace").addAll([trait(Loud, { volume: 3 }), trait(Quiet)]);
    expect(block.traitNames()).toEqual(["loud", "quiet"]);
    expect(block.settingsOf(Loud)!.volume).toBe(3);
  });

  it("runs setup with the block and its settings", () => {
    const seen: string[] = [];
    const Sees = defineTrait({
      name: "sees",
      defaults: { note: "" as string },
      setup({ block, settings }) {
        seen.push(`${block.id}:${settings.note}`);
      },
    });
    new Block("ace").add(Sees, { note: "hi" });
    expect(seen).toEqual(["ace:hi"]);
  });

  it("disposes per-attachment state in reverse order on detach", () => {
    const log: string[] = [];
    const Maker = (name: string) =>
      defineTrait({
        name,
        defaults: {},
        setup() {
          return () => log.push(name);
        },
      });
    const first = Maker("first");
    const second = Maker("second");
    const block = new Block("ace").addAll([trait(first), trait(second)]);
    block.dispose();
    expect(log).toEqual(["second", "first"]);
    expect(block.traitNames()).toEqual([]);
  });

  it("updates every attached trait each frame", () => {
    const ticks: number[] = [];
    const Counter = defineTrait({
      name: "counter",
      defaults: {},
      setup() {
        return { update: (dt: number) => ticks.push(dt) };
      },
    });
    const block = new Block("ace").add(Counter);
    block.update(0.5);
    block.update(0.25);
    expect(ticks).toEqual([0.5, 0.25]);
  });

  it("delivers events on the block", () => {
    const block = new Block("ace");
    const seen: unknown[] = [];
    block.on("selected", (payload) => seen.push(payload));
    block.emit("selected", true);
    expect(seen).toEqual([true]);
    expect(block.listens("selected")).toBe(true);
  });
});
