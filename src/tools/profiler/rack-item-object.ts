/** A rack item's token as the rack draws it (#621), for profiling. */
import * as THREE from "three";
import { passiveAppearance, createPassiveBlock } from "../../passives";
import { addExtras, createPassiveVisual } from "../../passive-visual";
import type { ProfiledObject } from "./cases";

export function passiveVisualFor(
  definitionId: string,
  blockId: string,
  rotation: THREE.Euler,
): ProfiledObject {
  const appearance = passiveAppearance(createPassiveBlock(definitionId, blockId));
  const visual = createPassiveVisual(appearance, 1);
  const mesh = new THREE.Mesh(visual.geometry, visual.materials);
  addExtras(mesh, visual.extras);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: appearance.palette.edge });
  mesh.add(new THREE.LineSegments(visual.edges, edgeMaterial));
  mesh.rotation.copy(rotation);
  return {
    object: mesh,
    dispose() {
      visual.dispose();
      edgeMaterial.dispose();
    },
  };
}
