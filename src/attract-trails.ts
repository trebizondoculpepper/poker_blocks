/**
 * Particle trails for the title's attract sequence (#203). A material lists the trails its
 * blocks leave (`appearance.trails`); each names an effect registered here, so the attract
 * scene builds whatever a card's material asks for and never asks which material it is.
 *
 * Presentation only, and cosmetic: the randomness comes from the attract sequence's own source,
 * never the session's seeded stream (#134).
 */
import * as THREE from "three";
import { Registry } from "./core/registry";
import type { AppearanceTrail } from "./materials";
import { starBrightness, starTexture } from "./visual/star-particles";

/** One card's trail: emits behind it as it moves, and is disposed with it. */
export type Trail = {
  /** Per frame: emit at `position` (world space) and age the particles; `opacity` fades all. */
  update(delta: number, position: THREE.Vector3, opacity: number): void;
  dispose(): void;
};

type TrailEffect = (config: AppearanceTrail, scene: THREE.Scene, random: () => number) => Trail;

export const trailEffects = new Registry<TrailEffect>("trail effect");

/**
 * Rainbow stars: glints left behind in world space, each a spectral colour, drifting a little
 * and fading out over its life. Additive, so they glow against the dark and never darken.
 */
trailEffects.register("rainbowStars", ({ rate, life, size, spread }, scene, random) => {
  const capacity = Math.ceil(rate * life) + 4;
  const positions = new Float32Array(capacity * 3);
  const colours = new Float32Array(capacity * 3);
  const particles = Array.from({ length: capacity }, () => ({
    age: Infinity,
    hue: 0,
    drift: new THREE.Vector3(),
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: starTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let owed = 0;
  let next = 0;
  const colour = new THREE.Color();
  return {
    update(delta, position, opacity) {
      owed += rate * delta;
      // Emit what this frame owes, recycling the oldest slots.
      while (owed >= 1) {
        owed -= 1;
        const particle = particles[next]!;
        particle.age = 0;
        particle.hue = random();
        particle.drift.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(0.6);
        positions[next * 3] = position.x + (random() - 0.5) * 2 * spread;
        positions[next * 3 + 1] = position.y + (random() - 0.5) * 2 * spread;
        positions[next * 3 + 2] = position.z + (random() - 0.5) * 2 * spread;
        next = (next + 1) % capacity;
      }
      particles.forEach((particle, index) => {
        particle.age += delta;
        positions[index * 3] += particle.drift.x * delta;
        positions[index * 3 + 1] += particle.drift.y * delta;
        positions[index * 3 + 2] += particle.drift.z * delta;
        // The hue slides a little as it goes; the shared star lifecycle (#349) gives the bright
        // birth, twinkle and squared fade.
        colour.setHSL((particle.hue + particle.age * 0.15) % 1, 1, 0.6);
        colour.multiplyScalar(starBrightness(particle.age, life, index) * opacity);
        colours.set([colour.r, colour.g, colour.b], index * 3);
      });
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.color!.needsUpdate = true;
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
});
