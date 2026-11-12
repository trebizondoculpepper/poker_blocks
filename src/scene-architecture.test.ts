/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("scene architecture guardrails", () => {
  it("switches modes without navigating or reloading the document", () => {
    for (const file of ["./main.ts", "./game-run-controller.ts", "./console-host.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/window\.location\.(assign|reload)\s*\(/);
    }
    const run = readFileSync(new URL("./game-run-controller.ts", import.meta.url), "utf8");
    expect(run).toContain("window.history.replaceState");
    // The page's mode comes from ?mode= with the ?room= alias (tested in game-modes.test.ts).
    expect(run).toContain("gameModeFromParams(options.params)");
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
    expect(main).not.toMatch(/\bsilencedAudio\b|createModeMusicBehaviours|"view\.zoom"/);
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

  it("keeps the console's mode switching and music commands in the console host service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const host = readFileSync(new URL("./console-host.ts", import.meta.url), "utf8");

    expect(main).toContain("createConsoleHost(");
    expect(main).not.toMatch(/\bcreateConsole\(|modeLink\(nextGameMode|audio\.music\./);
    expect(host).toContain("window.history.replaceState");
    expect(host).not.toMatch(/window\.location\.(assign|reload)\s*\(/);
  });

  it("keeps menus, screen-to-scene changes, the tooltip and refused flashes in the overlays service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/services:\s*\{[^}]*\boverlays:\s*Overlays\b/);
    expect(main).not.toMatch(/\bcreateMenus\(|inspect-tooltip|refused-flash|\bmenus\./);
    expect(main).not.toMatch(/\bonScreen\(/);
  });

  it("keeps hand layout, draw-ins and rocking in the hand service, and cube building in rendered-blocks", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/\bhand:\s*HandView\b/);
    expect(main).not.toMatch(/\bhandBlocks\b|\bappearing\b|\bstepRock\(|\brandomRock\(/);
    expect(main).not.toMatch(/createBlockAppearance\(|new THREE\.EdgesGeometry\(geometry\)/);
    expect(main).not.toMatch(
      /function (glideHand|handSlotX|visibleHandSlots|createCube|disposeCube)\s*\(/,
    );
  });

  it("keeps placed blocks, drop previews, the first-play prompt and row tints in the field service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/\bfield:\s*FieldView\b/);
    expect(main).not.toMatch(
      /\bplaced\b\.|(?<!\.)\bmassCenter\b|\bghost\b|faceHighlight|\btints\b/,
    );
    expect(main).not.toMatch(/\bfaceFromDirection\(|new THREE\.PlaneGeometry\(/);
    expect(main).not.toMatch(
      /function (addToBoard|landing|showCandidate|tintRow|updateRotationCenter)\s*\(/,
    );
  });

  it("keeps pointer gestures, selection and the discard target in the input service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/\binput:\s*TableInput\b/);
    expect(main).not.toMatch(/addEventListener\("pointer(down|move|up|cancel)"/);
    expect(main).not.toMatch(/\bpointRay\(|\bpassiveDrag\b|\bboardDrag\b|\bpinch\b/);
    expect(main).not.toMatch(/toggleBlockSelection\(|discard-count|\bsuppressClickUntil\b/);
  });

  it("keeps the WebGL renderer, scenes, lights and frame drawing in the renderer service", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/\brenderer:\s*TableRenderer\b/);
    expect(main).not.toMatch(/new THREE\.(WebGLRenderer|Scene|HemisphereLight|DirectionalLight)\(/);
    expect(main).not.toMatch(/\bcreateCardRoom\(|\bsetReflectionEnvironment\(|renderer\.render\(/);
  });

  it("keeps play and discard animations and the scoring presentation in the play presenter", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toMatch(/\bpresenter:\s*PlayPresenter\b/);
    expect(main).not.toMatch(
      /\bpendingAction\b|\bscoreSteps\b|\boutcomeAt\b|(?<!\.)\bshownScore\b/,
    );
    expect(main).not.toMatch(/createMaterialise\(|presentationOrder\(|magnitudeSfxFor\(/);
    expect(main).not.toMatch(
      /function (startPlacement|startDiscard|updateAction|announceScore)\s*\(/,
    );
  });

  it("leaves main.ts only constructing services, the scene manager and the start scene", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(main).toContain("new SceneManager(");
    expect(main).toContain("run.open()");
    // No behaviour of its own: no named functions, no game state, no decisions beyond setup.
    expect(main).not.toMatch(/^(async )?function /m);
    expect(main).not.toMatch(/\bGameRun\b|\bgame\.(state|phase|play|advance)\b/);
    expect(main.match(/\bif \(/g) ?? []).toHaveLength(2);
  });

  it("keeps mode-level panel and placement flags from returning (#53)", () => {
    const modes = readFileSync(new URL("./game-modes.ts", import.meta.url), "utf8");
    const run = readFileSync(new URL("./game-run-controller.ts", import.meta.url), "utf8");

    // Which panels show, and where blocks may be played, is the scene's business now: a scene
    // composes `roundPanel`, `deckPanel`, `coinsPanel`, `shopExit`, `fieldPlacement` or
    // `shopStock`. Nothing may ask a mode for an overlay set or a placement flag again.
    expect(modes).not.toMatch(/\bSceneOverlays\b|\boverlaysForPhase\b|\bfieldPlacementActive\b/);
    expect(modes).not.toMatch(/traits\.\w*overlays|overlays\s*:/);
    expect(run).not.toMatch(/overlaysForPhase|fieldPlacementActive|\bfieldActive\b/);
    // The HUD is shown and hidden by traits, not by handing it a set of overlays to render.
    expect(run).not.toMatch(/hud\.render\(\{[^}]*overlays/);
  });

  it("keeps run setup off the mode traits, and out of the Continue path (#34)", () => {
    const modes = readFileSync(new URL("./game-modes.ts", import.meta.url), "utf8");
    const run = readFileSync(new URL("./game-run-controller.ts", import.meta.url), "utf8");

    // Run setup is ordered data on the mode: steps, not flags a controller branches on.
    expect(modes).toContain("runSetup:");
    // Each mode's `traits` block holds configuration only; the setup words appear in `runSetup`.
    for (const [, block] of modes.matchAll(/traits:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      for (const flag of [
        "sandbox",
        "materialDeck",
        "materialSample",
        "shopPreview",
        "skipTitle",
      ]) {
        expect(block).not.toMatch(new RegExp(`\\b${flag}\\b`));
      }
    }
    // Continue restores the saved run; only a new run goes through the setup registry.
    expect(run).toContain("runSetup.policy(");
    expect(run).toContain("runSetup.deck(");
    expect(run).toContain("runSetup.start(");
    // The controller names no setup step of its own; it asks the registry for a pass.
    expect(run).not.toMatch(/\bskipTitle\b/);
    expect(run).not.toMatch(/step\.step\s*===/);
    expect(run.match(/\bshopPreview\b/g) ?? []).toEqual([]);
  });

  it("configures outbound links in one place, not in the menu code (#129)", () => {
    const menus = readFileSync(new URL("./menus.ts", import.meta.url), "utf8");
    const modes = readFileSync(new URL("./game-modes.ts", import.meta.url), "utf8");
    // A footer's destinations are configuration in game-modes, not literals in the renderer.
    expect(menus).not.toMatch(/https?:\/\//);
    expect(modes).toContain("projectLinks");
    // Nor does the menu decide which panels show a footer: the `panelFooter` trait does.
    expect(menus).not.toMatch(/panelFooter/);
  });

  it("dispatches a page load through configuration, not a scene or mode check", () => {
    const run = readFileSync(new URL("./game-run-controller.ts", import.meta.url), "utf8");
    // `onLoad` is one configured value looked up in a handler table. Reading startScene by
    // value would be a scene-identity branch, and a presence check on a marker trait would be
    // a trait read as a flag; the guardrail sees neither when they sit on the mode.
    expect(run).not.toMatch(/startScene\s*[!=]==?\s*["'`]/);
    expect(run).not.toMatch(/["'`]title["'`]\s*[!=]==?\s*\w*startScene/);
    expect(run).toContain("onLoadHandlers[currentMode.traits.onLoad]");
    // No mode marker is checked for presence.
    expect(run).not.toMatch(/currentMode\.(opensInPlay|resumeSavedRun)/);
  });
});
