/**
 * How the title screen looks (#203): the camera, lights, reflections and output the attract
 * sequence's cards are drawn with, shared so anything else drawn over the title (the dancing
 * block title) is lit, reflects and renders exactly as they do.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** The attract camera's vertical field of view, in degrees. */
export const attractFieldOfView = 50;

/** Output settings: sRGB, and no tone mapping, as the game's own renderers. */
export function configureAttractRenderer(
  renderer: Pick<THREE.WebGLRenderer, "outputColorSpace" | "toneMapping">,
): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
}

/**
 * The game's own hand lighting, not an approximation of it. A card is judged against how it
 * looks in play, so the title uses the exact pair `createTableRenderer` lights the hand with: a
 * bright neutral hemisphere and a single white key above and to the left. Anything dimmer reads
 * as grey, however many extra lights are added around it.
 */
export function addAttractLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 6, 7);
  scene.add(key);
}

/** How many points of light the sparkle environment scatters around the room. */
const sparkleCount = 40;

/**
 * What the attract cards reflect (#203): the game's own room environment, as
 * `createTableRenderer` makes for the hand, plus a scatter of small, bright points of light.
 * It is an environment map, so the cards see it and the camera never does: the backdrop on
 * screen stays plain, while crystal, gold and steel catch glints as they tumble.
 *
 * Built by this renderer, so it exists in this WebGL context: a texture prefiltered by the
 * game's renderer would be empty here. The points sit on a fixed golden-angle spiral, so
 * nothing here draws on any randomness.
 */
export function sparkleEnvironment(
  renderer: THREE.WebGLRenderer,
  /** How many coloured points to scatter; the block title asks for none (they read as specks). */
  sparkles = sparkleCount,
): THREE.Texture {
  const room = new RoomEnvironment();
  const geometry = new THREE.SphereGeometry(0.42, 12, 8);
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let index = 0; index < sparkles; index++) {
    // Evenly over a sphere (golden-angle spiral), inside the room around the cards.
    const y = 1 - (2 * (index + 0.5)) / sparkles;
    const ring = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    // Every point a pure spectral colour, the hues spread over the whole rainbow, so crystal
    // catches prismatic fire rather than white glints. Far brighter than 1, so a glint
    // survives the prefilter's blur.
    const colour = new THREE.Color().setHSL((index * 0.381966) % 1, 1, 0.55);
    const material = new THREE.MeshBasicMaterial({ color: colour.multiplyScalar(14) });
    materials.push(material);
    const point = new THREE.Mesh(geometry, material);
    point.position.set(Math.cos(angle) * ring * 6, y * 6, Math.sin(angle) * ring * 6);
    room.add(point);
  }
  // Long bright bars, like a photographer's strip softboxes. Brushed steel stretches a
  // highlight along its brush direction, so it needs a long light to streak across a face;
  // crystal edges and gold catch them as flashes. Placed at a few angles around the cards.
  const strip = new THREE.BoxGeometry(0.35, 7, 0.35);
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffffff).multiplyScalar(9),
  });
  const strips = [
    { position: [-6, 2, 3], rotation: [0, 0, 0.25] },
    { position: [6, 1, 2], rotation: [0, 0, -0.35] },
    { position: [0, 6, -3], rotation: [0, 0, Math.PI / 2] },
    { position: [3, -5, 4], rotation: [0.4, 0, 1.1] },
    { position: [-4, 3, -6], rotation: [0.2, 0.5, -0.8] },
  ] as const;
  for (const { position, rotation } of strips) {
    const bar = new THREE.Mesh(strip, stripMaterial);
    bar.position.set(position[0], position[1], position[2]);
    bar.rotation.set(rotation[0], rotation[1], rotation[2]);
    room.add(bar);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const texture = generator.fromScene(room, 0.04).texture;
  strip.dispose();
  stripMaterial.dispose();
  generator.dispose();
  geometry.dispose();
  for (const material of materials) material.dispose();
  return texture;
}
