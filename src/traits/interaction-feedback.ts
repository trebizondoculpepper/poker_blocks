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

/** A reusable post-lighting saturation filter; material textures and scene state stay intact. */
export const disabledAppearance = defineTrait({
  name: "disabledAppearance",
  defaults: { saturation: 0 },
  setup({ block, settings }) {
    const uniform = { value: 1 };
    const restore: (() => void)[] = [];
    const stopState = block.on("interaction.state", (payload) => {
      uniform.value = (payload as InteractionState).enabled ? 1 : settings.saturation;
    });
    const stopMount = block.on("presentation.mount", (payload) => {
      for (const material of (payload as PresentationMount).materials) {
        const compile = material.onBeforeCompile;
        const cache = material.customProgramCacheKey;
        const key = cache.call(material);
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer);
          shader.uniforms.interactionSaturation = uniform;
          shader.fragmentShader =
            "uniform float interactionSaturation;\n" +
            shader.fragmentShader.replace(
              /}\s*$/,
              "gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.65 + 0.12), gl_FragColor.rgb, interactionSaturation);\n}",
            );
        };
        material.customProgramCacheKey = () => key + "|interaction-saturation";
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
