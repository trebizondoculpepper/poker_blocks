/**
 * Paired material masks for optical looks (#1207; doc/presentation-contracts.md, "Committed
 * transition fact and independent responses"): the refractive and internal-reflection crystals
 * draw with their own `ShaderMaterial`s, front and rear, whose rear meshes their registered
 * prepasses capture. These adapters let such a look take part in a paired mask exactly as a
 * chunk-based look does (`paired-mask.ts`): one block-local domain, seed, clock and progress, and
 * complementary coverage, so the outgoing look draws precisely where the incoming one does not.
 *
 * - **Declared per material.** A crystal's tree mixes custom shaders (front, rear) with chunk
 *   materials (its print skin, its hand surface). Its assembly declares `materialDeclared`, and
 *   each material it makes declares its own adapter in `userData.maskAdapter`; the dispatch reads
 *   that declaration, never a material's class. An undeclared material is an explicit error, never
 *   a silently unmasked surface.
 * - **`opticalShader`** patches the custom shader at `main`: the vertex shader passes the world
 *   position, and the fragment shader decides per view ray, as the chunk adapter does, whether
 *   this side draws. Under reduced motion it follows the chunk adapter's crossfade: the outgoing
 *   look stays whole and writes no depth, the incoming one fades in over it, so any pair of
 *   adapters agrees. Its uniforms are the
 *   original's own objects plus the mask's: the renderer-owned capture slots a prepass binds are
 *   shared, never copied, so the masked rear still feeds the registered capture.
 */
import * as THREE from "three";
import { NOISE } from "./materialise";
import { maskAdapters, type MaskAdapter } from "./paired-mask";

/** Dispatch to the adapter each material declares in `userData.maskAdapter`. */
export const materialDeclaredAdapter: MaskAdapter = {
  adapt(material, uniforms, role) {
    const declared = material.userData.maskAdapter as string | undefined;
    if (!declared || !maskAdapters.has(declared))
      throw new Error(
        `material "${material.name || material.uuid}" declares no registered mask adapter`,
      );
    return maskAdapters.get(declared).adapt(material, uniforms, role);
  },
};

/** The mask's decision, at the top of a custom fragment shader's `main`. */
const decide = /* glsl */ `
  {
    vec3 matRay = normalize(matWorld - cameraPosition);
    vec3 matFacing = normalize(cameraPosition - matOrigin);
    float matAlong = dot(matOrigin - cameraPosition, matFacing) / min(dot(matRay, matFacing), -1e-4);
    vec3 matHit = cameraPosition + matRay * matAlong;
    vec3 matLocal = (matFrame * vec4(matHit, 1.0)).xyz;
    // Under reduced motion nothing is cut: the outgoing look stays whole and the incoming one
    // fades over it, exactly as the chunk adapter does, so mixed pairs agree (#1336 review).
    if (matReduced < 0.5) {
      vec3 matAt = matLocal * matFrequency + vec3(0.0, matTime * 0.9, matTime * 0.4);
      float matNoise = clamp(matFbm(matAt) * 1.6 + 0.5, 0.0, 1.0);
      float matCut = mix(-matEdge, 1.0 + matEdge, matProgress);
      if (matOutgoing > 0.5) {
        if (matNoise <= matCut) discard;
      } else if (matNoise > matCut) discard;
    }
  }
`;

/**
 * A custom-shader adapter whose reduced-motion fade scales `fade`: `gl_FragColor.a` for a look
 * blended by its alpha, the whole premultiplied `gl_FragColor` for additive light, whose colour
 * is added whatever its alpha (#1338 review). The provider declares which.
 */
function shaderMaskAdapter(fade: string): MaskAdapter {
  return {
    adapt(original, uniforms, role) {
      const source = original as THREE.ShaderMaterial;
      const made = source.clone();
      made.userData = source.userData;
      // A clone drops the per-draw callback (a face ripple's, which steps its shared uniforms):
      // the masked look keeps it (#1336 review).
      made.onBeforeRender = source.onBeforeRender;
      // The original's own uniform objects (capture slots, tuning, ripple), shared, plus the mask's.
      made.uniforms = {
        ...source.uniforms,
        ...uniforms,
        matOutgoing: { value: role === "outgoing" ? 1 : 0 },
      };
      made.vertexShader = `varying vec3 matWorld;\n${source.vertexShader}`.replace(
        /void main\(\)\s*\{/,
        "void main() {\n  matWorld = (modelMatrix * vec4(position, 1.0)).xyz;",
      );
      made.fragmentShader = `varying vec3 matWorld;
      uniform float matProgress;
      uniform float matTime;
      uniform float matFrequency;
      uniform float matEdge;
      uniform float matReduced;
      uniform float matOutgoing;
      uniform mat4 matFrame;
      uniform vec3 matOrigin;
      ${NOISE}
      ${source.fragmentShader}`.replace(/void main\(\)\s*\{/, `void main() {${decide}`);
      // The reduced-motion crossfade, as the chunk adapter does it: the incoming look's alpha
      // follows progress (its main's last statement), the outgoing look writes no depth under it.
      const end = made.fragmentShader.lastIndexOf("}");
      made.fragmentShader = `${made.fragmentShader.slice(0, end)}
      if (matReduced > 0.5 && matOutgoing < 0.5) ${fade} *= matProgress;
    }${made.fragmentShader.slice(end + 1)}`;
      if (uniforms.matReduced.value > 0.5 && role === "incoming") made.transparent = true;
      if (uniforms.matReduced.value > 0.5 && role === "outgoing") made.depthWrite = false;
      return made;
    },
  };
}

export const opticalShaderAdapter = shaderMaskAdapter("gl_FragColor.a");
/** For premultiplied additive light (`additiveLight`): colour fades with alpha. */
export const additiveShaderAdapter = shaderMaskAdapter("gl_FragColor");

maskAdapters.register("materialDeclared", materialDeclaredAdapter);
maskAdapters.register("opticalShader", opticalShaderAdapter);
// Any other custom ShaderMaterial with a `position` attribute and a `main` (#1209): a laser
// outline, a custom face shader. The same shared-uniform patch.
maskAdapters.register("customShader", opticalShaderAdapter);
maskAdapters.register("additiveShader", additiveShaderAdapter);
