import { describe, expect, it } from "vite-plus/test";
import {
  isScreenshotShortcut,
  screenshotHeight,
  screenshotLayout,
  screenshotWidth,
} from "./screenshot";

describe("screenshot layout", () => {
  it("fills a 16:9 UHD image", () => {
    expect(screenshotLayout(1280, 720)).toEqual({
      scale: 3,
      width: 3840,
      height: 2160,
      x: 0,
      y: 0,
    });
  });

  it("fits portrait windows without cropping or stretching", () => {
    const portrait = screenshotLayout(390, 844)!;
    expect(portrait.height).toBe(screenshotHeight);
    expect(portrait.width).toBeLessThan(screenshotWidth);
    expect(portrait.x).toBeGreaterThan(0);
    expect(portrait.y).toBe(0);
  });

  it("limits WebGL resolution while keeping 4K output", () => {
    expect(screenshotLayout(1280, 720, 2048)?.width).toBe(2048);
    expect(screenshotLayout(0, 720)).toBeNull();
  });
});

describe("screenshot shortcut", () => {
  it("uses Command-Shift-K or Control-Shift-K once per press", () => {
    const chord = {
      code: "KeyK",
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      repeat: false,
    };
    expect(isScreenshotShortcut(chord)).toBe(true);
    expect(isScreenshotShortcut({ ...chord, metaKey: false, ctrlKey: true })).toBe(true);
    expect(isScreenshotShortcut({ ...chord, shiftKey: false })).toBe(false);
    expect(isScreenshotShortcut({ ...chord, altKey: true })).toBe(false);
    expect(isScreenshotShortcut({ ...chord, repeat: true })).toBe(false);
  });
});
