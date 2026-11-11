/**
 * Points that keep a world size under any camera (#349 review, shared with #353). Three.js
 * attenuates point size by depth only for a perspective projection; under an orthographic one
 * (the hand) `size` is in pixels. Each render this converts the world size with the projection's
 * vertical scale and the renderer's logical height (three.js applies the pixel ratio itself).
 * The projection matrix says which projection it is: its w row is 0 0 -1 0 in perspective.
 */
import * as THREE from "three";

export function keepWorldSize(
  points: THREE.Points,
  material: THREE.PointsMaterial,
  worldSize: number,
  beforeRender: () => void = () => {},
): void {
  const scale = new THREE.Vector3();
  const logical = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    beforeRender();
    const world = worldSize * points.getWorldScale(scale).y;
    const projection = camera.projectionMatrix.elements;
    renderer.getSize(logical);
    material.size = projection[11] !== 0 ? world : (world * projection[5]! * logical.y) / 2;
  };
}
