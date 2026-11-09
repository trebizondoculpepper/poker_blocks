/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("scene architecture guardrails", () => {
  it("switches rooms without navigating or reloading the document", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toContain("window.history.replaceState");
    expect(main).not.toMatch(/window\.location\.(assign|reload)\s*\(/);
  });

  it("keeps camera construction, framing, and resizing in the camera-view service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const cameraView = readFileSync(new URL("./camera-view.ts", import.meta.url), "utf8");

    expect(main).toContain("createCameraViewService");
    expect(main).toContain("services: { cameraView: CameraViewService }");
    expect(main).toMatch(/services:\s*\{\s*cameraView\s*\}/);
    expect(main).not.toMatch(/new THREE\.(PerspectiveCamera|OrthographicCamera)/);
    expect(main).not.toMatch(/new ResizeObserver/);
    expect(main).not.toMatch(/function (desiredCamera|minimumCameraDistance|applyCamera)\s*\(/);
    expect(cameraView).toContain("new THREE.PerspectiveCamera");
    expect(cameraView).toContain("new ResizeObserver");
  });
});
