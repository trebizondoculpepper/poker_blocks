/**
 * A hollow, clear vessel part-filled with a viscous fluid (#227): a lightweight visual
 * approximation, not a fluid simulation. Configured by a material's `appearance.vessel` data,
 * so any material can be a filled vessel without a branch on its name.
 *
 * - **Shell:** a clear plastic outer skin plus a slightly smaller inner skin drawn from the back,
 *   so the walls show their thickness.
 * - **Fluid:** a copy of the block's shape, smaller again, cut by a flat surface. Fragments
 *   above the surface are discarded; the back faces seen through the cut are shaded flat, so
 *   the cut reads as the fluid's top. The surface's normal eases toward "up" (in the block's
 *   own space) with a time constant of `settleSeconds`, so when the block turns the fluid
 *   levels slowly, with no splash or overshoot.
 * - **Wall trace:** a second, slower-easing surface marks where the fluid was. Inner wall that
 *   is below that old surface but above the current one is tinted faintly; as the old surface
 *   catches up (`traceSeconds`), the tinted band shrinks to nothing, so the trace fades.
 *
 * The surface's height is an approximation: `level` 0.5 puts it through the middle, and other
 * levels move it along its normal in proportion. Exact volume is not kept as the block tilts.
 */
import * as THREE from "three";

export type VesselConfig = {
  /** The fluid's colour (hex). */
  fill: number;
  /** The fluid's top surface, a little lighter where light catches it. */
  surface: number;
  /** How full the vessel is, from 0 (empty) to 1 (full). */
  level: number;
  /** Time constant, in seconds, of the fluid levelling after the block turns. */
  settleSeconds: number;
  /** Time constant, in seconds, of the wall trace fading. */
  traceSeconds: number;
  /** The wall trace's opacity where it is freshest. */
  traceOpacity: number;
  /** The shell's opacity: low for clear plastic. */
  shellOpacity: number;
  /** The inner skin's scale, relative to the outer: the wall's thickness. */
  wall: number;
};

const fluidVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fluidFragment = /* glsl */ `
  uniform vec3 surfaceNormal;
  uniform float height;
  uniform vec3 fill;
  uniform vec3 surfaceColour;
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    if (dot(vLocal, surfaceNormal) > height) discard;
    if (!gl_FrontFacing) {
      // Seen through the cut: the fluid's flat top.
      gl_FragColor = vec4(surfaceColour, 1.0);
      return;
    }
    // A soft, creamy shade: wrapped diffuse from a fixed key light in view space.
    float light = 0.55 + 0.45 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.8, 0.5))), 0.0);
    gl_FragColor = vec4(fill * light, 1.0);
  }
`;

const traceFragment = /* glsl */ `
  uniform vec3 surfaceNormal;
  uniform vec3 traceNormal;
  uniform float height;
  uniform vec3 fill;
  uniform float opacity;
  varying vec3 vLocal;
  void main() {
    float now = dot(vLocal, surfaceNormal) - height;
    float before = dot(vLocal, traceNormal) - height;
    // Wet: under where the fluid was, above where it is now.
    if (before > 0.0 || now <= 0.0) discard;
    // Fades toward the old line and with how far the two surfaces still differ.
    float spread = 1.0 - dot(surfaceNormal, traceNormal);
    float strength = clamp(spread * 12.0, 0.0, 1.0) * smoothstep(0.0, 0.08, -before);
    gl_FragColor = vec4(fill, opacity * strength);
  }
`;

/** The vessel's shell materials and the meshes inside it. */
export function createFilledVessel(
  geometry: THREE.BufferGeometry,
  size: number,
  config: VesselConfig,
  environment: THREE.Texture | null,
): { shell: THREE.MeshPhysicalMaterial; extras: THREE.Mesh[] } {
  const plastic = (side: THREE.Side) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMap: environment,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: config.shellOpacity,
      depthWrite: false,
      side,
    });
  const shell = plastic(THREE.FrontSide);
  const inner = new THREE.Mesh(geometry, plastic(THREE.BackSide));
  inner.scale.setScalar(config.wall);
  inner.renderOrder = 2;

  const fluidScale = config.wall * 0.97;
  const uniforms = {
    surfaceNormal: { value: new THREE.Vector3(0, 1, 0) },
    traceNormal: { value: new THREE.Vector3(0, 1, 0) },
    // In the fluid mesh's own (unscaled) space: half the block is size / 2.
    height: { value: (config.level - 0.5) * size },
    fill: { value: new THREE.Color(config.fill) },
    surfaceColour: { value: new THREE.Color(config.surface) },
    opacity: { value: config.traceOpacity },
  };
  const fluid = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: fluidVertex,
      fragmentShader: fluidFragment,
      side: THREE.DoubleSide,
    }),
  );
  fluid.scale.setScalar(fluidScale);
  fluid.renderOrder = 1;

  const trace = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: fluidVertex,
      fragmentShader: traceFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  // Just inside the inner wall, so the trace sits on it.
  trace.scale.setScalar(config.wall * 0.995);
  trace.renderOrder = 3;

  const settle = createSettler(config);
  const rotation = new THREE.Quaternion();
  fluid.onBeforeRender = () => {
    fluid.getWorldQuaternion(rotation);
    settle(
      rotation,
      performance.now() / 1000,
      uniforms.surfaceNormal.value,
      uniforms.traceNormal.value,
    );
  };
  return { shell, extras: [inner, fluid, trace] };
}

/**
 * Eases the fluid's surface (and, more slowly, its trace) toward level, given the block's world
 * rotation. Pure apart from the vectors it updates, so it can be tested without rendering.
 */
export function createSettler(
  config: Pick<VesselConfig, "settleSeconds" | "traceSeconds">,
): (rotation: THREE.Quaternion, now: number, surface: THREE.Vector3, trace: THREE.Vector3) => void {
  let last: number | null = null;
  const up = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  return (rotation, now, surface, trace) => {
    // "Up" in the block's own space: world up, turned back by the block's rotation.
    up.set(0, 1, 0).applyQuaternion(inverse.copy(rotation).invert());
    if (last === null) {
      // The first frame starts level, with no trace.
      surface.copy(up);
      trace.copy(up);
    } else {
      const delta = Math.min(now - last, 0.1);
      surface.lerp(up, 1 - Math.exp(-delta / config.settleSeconds)).normalize();
      trace.lerp(surface, 1 - Math.exp(-delta / config.traceSeconds)).normalize();
    }
    last = now;
  };
}
