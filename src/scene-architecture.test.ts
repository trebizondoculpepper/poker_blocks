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
    expect(main).toMatch(/services:\s*\{[^}]*\bcameraView:\s*CameraViewService\b/);
    expect(main).toMatch(/services:\s*\{[^}]*\bcameraView\b[^}]*\}/);
    expect(main).not.toMatch(/new THREE\.(PerspectiveCamera|OrthographicCamera)/);
    expect(main).not.toMatch(/new ResizeObserver/);
    expect(main).not.toMatch(/function (desiredCamera|minimumCameraDistance|applyCamera)\s*\(/);
    expect(cameraView).toContain("new THREE.PerspectiveCamera");
    expect(cameraView).toContain("new ResizeObserver");
  });

  it("keeps music, volume and the view sounds in the audio service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/services:\s*\{[^}]*\baudio:\s*AudioService\b/);
    expect(main).not.toMatch(/\bsilencedAudio\b|createRoomMusicBehaviours|"view\.zoom"/);
    expect(main).not.toMatch(
      /\.(switchToBossTrack|switchToRandomStageTrack|muffle|unmuffle|windDown|playTitle)\(/,
    );
    expect(main).not.toMatch(/musicPlayer\.set(Volume|Muted)\(/);
  });

  it("keeps the HUD panels' markup and labels in the HUD service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/services:\s*\{[^}]*\bhud:\s*HudPanels\b/);
    expect(main).not.toMatch(/data-stat=|round-hud|deck-hud|coin-hud|shop-exit/);
    expect(main).not.toMatch(/Continue \/ Skip shop|"End game"|"BOSS STAGE"/);
  });

  it("keeps the console's room switching and music commands in the console host service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const host = readFileSync(new URL("./console-host.ts", import.meta.url), "utf8");

    expect(main).toContain("createConsoleHost(");
    expect(main).not.toMatch(/\bcreateConsole\(|roomLink\(nextRoom|audio\.music\./);
    expect(host).toContain("window.history.replaceState");
    expect(host).not.toMatch(/window\.location\.(assign|reload)\s*\(/);
  });

  it("keeps menus, screen-to-scene changes, the tooltip and refused flashes in the overlays service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/services:\s*\{[^}]*\boverlays:\s*Overlays\b/);
    expect(main).not.toMatch(/\bcreateMenus\(|inspect-tooltip|refused-flash|\bmenus\./);
    expect(main).not.toMatch(/\bonScreen\(/);
  });
});
