/**
 * The game's light rigs, built fresh for each scene that uses them (#712): the board's warm
 * card-room fill and the hand's neutral studio light. The table renderer composes them, and so
 * does the profiler's host, so a measured block is lit as it is in play.
 */
import * as THREE from "three";

/**
 * The board's overhead lamp: warm, above and slightly in front, casting soft shadows. The card
 * room places it over the table each frame (`boardLampOffset` from the table's centre).
 */
export function boardLamp(): THREE.DirectionalLight {
  const lamp = new THREE.DirectionalLight(0xfff1d6, 1.6);
  lamp.castShadow = true;
  lamp.shadow.bias = -0.0005;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  return lamp;
}

/** Where the lamp sits relative to the table's centre. */
export const boardLampOffset = new THREE.Vector3(-2, 14, 5);

/** The board: a warm sky and floor, and a white fill from above left. */
export function boardLights(): THREE.Light[] {
  const fill = new THREE.DirectionalLight(0xffffff, 1.3);
  fill.position.set(-3, 6, 7);
  return [new THREE.HemisphereLight(0xfff4e6, 0x3a3226, 2), fill];
}

/** The hand: a neutral studio light. */
export function handLights(): THREE.Light[] {
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 6, 7);
  return [new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4), sun];
}
