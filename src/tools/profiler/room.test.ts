import { describe, expect, it } from "vite-plus/test";
import { runSettings } from "./room";

describe("profiler room settings (#640 review)", () => {
  it("turns the inputs into bounded positive whole numbers", () => {
    expect(runSettings("1, 10, 50", "120")).toEqual({ counts: [1, 10, 50], frames: 120 });
    // Deduplicated, ascending, bounded; unreadable entries are skipped.
    expect(runSettings("50 10,10, x, 1.5", "40")).toEqual({ counts: [2, 10, 50], frames: 40 });
    expect(runSettings("-3, 0", "-5")).toEqual({ counts: [1, 10, 50], frames: 120 });
    expect(runSettings("", "abc")).toEqual({ counts: [1, 10, 50], frames: 120 });
    expect(runSettings("5000", "99999")).toEqual({ counts: [200], frames: 2000 });
  });
});
