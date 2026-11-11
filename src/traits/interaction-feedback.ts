import * as THREE from "three";
import { defineTrait } from "../core/trait";
import type { InteractionState } from "./menu-action";

export type PresentationMount = { object: THREE.Group; materials: THREE.Material[] };
/** Own only an inner transform. Scene traits remain free to animate the outer group. */
export const interactionFeedback = defineTrait({
  name: "interactionFeedback",
  defaults: {
    hoverScale: 1.04,
    hoverLift: 0.06,
    pressDepth: 0.05,
    response: 18,
    reducedMotion: false,
  },
  setup({ block, settings }) {
    let target: THREE.Group | undefined;
    let state: InteractionState = { enabled: true, hovered: false, pressed: false };
    const stopMount = block.on("presentation.mount", (payload) => {
      target = (payload as PresentationMount).object;
    });
    const stopState = block.on("interaction.state", (payload) => {
      state = payload as InteractionState;
    });
    return {
      update(dt) {
        if (!target) return;
        const active = state.enabled && !settings.reducedMotion;
        const hovered = active && state.hovered;
        const pressed = active && state.pressed;
        const blend = settings.reducedMotion
          ? 1
          : 1 - Math.exp(-settings.response * Math.max(0, dt));
        const scale = hovered ? settings.hoverScale : 1;
        target.scale.lerp({ x: scale, y: scale, z: scale } as THREE.Vector3, blend);
        target.position.y += ((hovered ? settings.hoverLift : 0) - target.position.y) * blend;
        target.position.z += ((pressed ? -settings.pressDepth : 0) - target.position.z) * blend;
      },
      dispose() {
        stopMount();
        stopState();
      },
    };
  },
});

/**
 * A reusable post-lighting filter for a disabled block: its final colour is dithered to pure
 * black and white, one-bit, like an old screen. Floyd–Steinberg's error diffusion is serial
 * (each pixel's error passes to the next), so it can't run per pixel on the GPU; instead each
 * pixel's brightness is compared with a threshold from interleaved gradient noise, a fine,
 * irregular pattern that reads like error diffusion with no visible grid. The pattern is fixed
 * to the screen in cells of `pixelSize` device pixels. Material textures and scene state stay
 * intact.
 */
export const disabledAppearance = defineTrait({
  name: "disabledAppearance",
  defaults: { pixelSize: 2 },
  setup({ block, settings }) {
    const disabled = { value: 0 };
    const pixel = { value: settings.pixelSize };
    const restore: (() => void)[] = [];
    const stopState = block.on("interaction.state", (payload) => {
      disabled.value = (payload as InteractionState).enabled ? 0 : 1;
    });
    // Each material is filtered once, however often the block is mounted: wrapping it twice
    // would nest the filter and leave a stale hook behind on disposal.
    const filtered = new Set<THREE.Material>();
    const stopMount = block.on("presentation.mount", (payload) => {
      for (const material of (payload as PresentationMount).materials) {
        if (filtered.has(material)) continue;
        filtered.add(material);
        // oxlint-disable-next-line typescript/unbound-method -- explicitly called with material and restored on disposal
        const compile = material.onBeforeCompile;
        // oxlint-disable-next-line typescript/unbound-method -- explicitly called with material and restored on disposal
        const cache = material.customProgramCacheKey;
        const key = cache.call(material);
        // Glow layers (fire, crystal fire) write premultiplied light: their colour is already
        // scaled by their coverage. They are dithered on their unscaled brightness and scaled
        // back, so a faint glow stays faint instead of turning into full-strength white specks.
        const premultiplied = premultipliedOutput(material);
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer);
          shader.uniforms.interactionDisabled = disabled;
          shader.uniforms.interactionDitherPixel = pixel;
          // Wrap main rather than appending to it: shader returns must still reach the filter.
          shader.fragmentShader =
            shader.fragmentShader.replace(
              /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/,
              "void interactionOriginalMain()",
            ) +
            `
            uniform float interactionDisabled;
            uniform float interactionDitherPixel;
            const float interactionPremultiplied = ${premultiplied ? "1.0" : "0.0"};
            void main() {
              interactionOriginalMain();
              // Interleaved gradient noise: a threshold per screen cell, in [0, 1).
              vec2 cell = floor(gl_FragCoord.xy / interactionDitherPixel);
              float threshold = fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715))));
              // Premultiplied colour is judged unscaled, then scaled back by its coverage.
              float coverage = mix(1.0, gl_FragColor.a, interactionPremultiplied);
              float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(coverage, 1e-4);
              // One bit: white where the brightness clears the threshold, black elsewhere.
              vec3 bit = vec3(step(threshold, luma)) * coverage;
              gl_FragColor.rgb = mix(gl_FragColor.rgb, bit, interactionDisabled);
            }
          `;
        };
        material.customProgramCacheKey = () =>
          key + (premultiplied ? "|interaction-dither-premultiplied" : "|interaction-dither");
        material.needsUpdate = true;
        restore.push(() => {
          material.onBeforeCompile = compile;
          material.customProgramCacheKey = cache;
          material.needsUpdate = true;
        });
      }
    });
    return () => {
      stopMount();
      stopState();
      restore.forEach((reset) => reset());
    };
  },
});

/**
 * Whether a material's shader writes premultiplied colour: three.js's own premultiplied mode,
 * or a custom blend that adds its colour unscaled (source factor one), as the glow layers do.
 */
export function premultipliedOutput(material: THREE.Material): boolean {
  return (
    material.premultipliedAlpha ||
    (material.blending === THREE.CustomBlending && material.blendSrc === THREE.OneFactor)
  );
}
