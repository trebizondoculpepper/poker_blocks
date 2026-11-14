import { describe, expect, it } from "vite-plus/test";
import { createRenderGate } from "./render-gate";

describe("the render gate (#735 review)", () => {
  it("stays closed while any pause is held, and each resume counts once", () => {
    const gate = createRenderGate();
    expect(gate.open).toBe(true);
    const first = gate.pause();
    const second = gate.pause();
    first();
    first();
    expect(gate.open).toBe(false);
    second();
    expect(gate.open).toBe(true);
  });

  it("runs a frame step only while open", () => {
    const gate = createRenderGate();
    const ran: number[] = [];
    gate.run(1, (time) => ran.push(time));
    const resume = gate.pause();
    gate.run(2, (time) => ran.push(time));
    resume();
    gate.run(3, (time) => ran.push(time));
    expect(ran).toEqual([1, 3]);
  });
});
