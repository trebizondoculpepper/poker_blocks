import type * as THREE from "three";
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
    const stopMount = block.on("presentation.mount", (payload) => {
      for (const material of (payload as PresentationMount).materials) {
        // oxlint-disable-next-line typescript/unbound-method -- explicitly called with material and restored on disposal
        const compile = material.onBeforeCompile;
        // oxlint-disable-next-line typescript/unbound-method -- explicitly called with material and restored on disposal
        const cache = material.customProgramCacheKey;
        const key = cache.call(material);
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
            void main() {
              interactionOriginalMain();
              // Interleaved gradient noise: a threshold per screen cell, in [0, 1).
              vec2 cell = floor(gl_FragCoord.xy / interactionDitherPixel);
              float threshold = fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715))));
              float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              // One bit: white where the brightness clears the threshold, black elsewhere.
              gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(step(threshold, luma)), interactionDisabled);
            }
          `;
        };
        material.customProgramCacheKey = () => key + "|interaction-dither";
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
