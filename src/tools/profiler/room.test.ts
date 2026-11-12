import { describe, expect, it } from "vite-plus/test";
import { runSettings } from "./room";

describe("profiler room settings (#640 review)", () => {
  it("turns the inputs into bounded positive whole numbers", () => {
    expect(runSettings("1.5", "120")).toEqual({ count: 2, frames: 120 });
    expect(runSettings("-3", "-5")).toEqual({ count: 25, frames: 120 });
    expect(runSettings("", "abc")).toEqual({ count: 25, frames: 120 });
    expect(runSettings("5000", "99999")).toEqual({ count: 200, frames: 2000 });
    expect(runSettings("9", "40")).toEqual({ count: 9, frames: 40 });
  });
});
