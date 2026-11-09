/**
 * A faked jewel effect for prismatic crystal: "fire" and sparkle, without ray tracing.
 *
 * A slightly smaller copy of the block's geometry is drawn inside it, back faces only, and
 * added on top of the crystal. For each facet it bends the view as if through high-index
 * crystal, by a different amount for red, green and blue (dispersion), and looks the result
 * up in a made-up studio of bright lights. Each facet therefore flashes a different colour,
 * and the flashes shift as the block or camera turns, which is what makes a gem read as a
 * gem. A sharp reflected glint adds the sparkle. Nothing here is physically exact.
 */
import * as THREE from "three";
import { additiveLight } from "./additive-light";

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform vec3 ior;
  varying vec3 vWorldPosition;

  // A made-up studio: a dim gradient with a few bright, coloured soft boxes.
  vec3 studio(vec3 d) {
    vec3 colour = mix(vec3(0.03, 0.03, 0.05), vec3(0.35, 0.38, 0.45), d.y * 0.5 + 0.5);
    colour += vec3(1.0, 0.95, 0.85) * pow(max(dot(d, normalize(vec3(0.4, 0.8, 0.45))), 0.0), 40.0) * 3.0;
    colour += vec3(0.7, 0.85, 1.0) * pow(max(dot(d, normalize(vec3(-0.7, 0.4, 0.2))), 0.0), 30.0) * 2.0;
    colour += vec3(1.0, 0.75, 0.9) * pow(max(dot(d, normalize(vec3(0.1, 0.3, -0.95))), 0.0), 50.0) * 2.5;
    colour += vec3(0.9, 1.0, 0.8) * pow(max(dot(d, normalize(vec3(0.8, -0.2, -0.3))), 0.0), 60.0) * 2.0;
    return colour;
  }

  // Bend the view through a facet, or bounce it back when it cannot get out.
  vec3 bend(vec3 view, vec3 normal, float eta) {
    vec3 through = refract(view, normal, eta);
    return dot(through, through) < 1e-4 ? reflect(view, normal) : through;
  }

  void main() {
    vec3 view = normalize(vWorldPosition - cameraPosition);
    // Flat facet normal from screen-space derivatives, turned to face the viewer.
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (dot(normal, view) > 0.0) normal = -normal;
    vec3 fire = vec3(
      studio(bend(view, normal, 1.0 / ior.r)).r,
      studio(bend(view, normal, 1.0 / ior.g)).g,
      studio(bend(view, normal, 1.0 / ior.b)).b
    );
    // Sparkle: a very tight glint off the facet.
    vec3 glint = reflect(view, normal);
    float sparkle = pow(max(dot(glint, normalize(vec3(0.3, 0.9, 0.3))), 0.0), 300.0) * 4.0;
    gl_FragColor = vec4((fire + sparkle) * intensity, 1.0);
  }
`;

/** The fire inside one crystal block; add it as a child of the block's mesh. */
export function createCrystalFire(geometry: THREE.BufferGeometry): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      intensity: { value: 0.55 },
      // Diamond-like, spread wider than real diamond so the colours separate visibly.
      ior: { value: new THREE.Vector3(2.3, 2.42, 2.56) },
    },
    side: THREE.BackSide,
    // Listed with the solid objects (not "transparent"), so glass and crystal on the
    // table, which refract only solid objects, show it bent through them. Additive and
    // drawn last among them (renderOrder), so nothing behind paints over it.
    transparent: false,
    // Additive light, which leaves the canvas's alpha alone: the board is drawn on a transparent
    // canvas over the HUD (#116), and the composited (premultiplied) canvas then adds the glow
    // onto whatever is behind it, rather than painting the empty frame opaque black.
    ...additiveLight,
    depthWrite: false,
  });
  const fire = new THREE.Mesh(geometry, material);
  fire.scale.setScalar(0.97);
  fire.renderOrder = 10;
  return fire;
}
