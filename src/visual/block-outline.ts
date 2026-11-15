/**
 * A block's drawn outline (#796): one helper every host uses, so an appearance's outline settings
 * reach the table, the shop, the inspector, developer rooms and the profiler alike. A live outline
 * opacity (`liveEdgeOpacity`) is read each frame; at zero the outline writes nothing, colour or
 * depth, while reflection on the faces is untouched.
 */
import * as THREE from "three";
import type { BlockAppearance } from "./block-appearance";

export function blockOutline(
  appearance: Pick<BlockAppearance, "geometry" | "edgeColor" | "edgeOpacity" | "liveEdgeOpacity">,
): THREE.LineSegments {
  const live = appearance.liveEdgeOpacity;
  const material = new THREE.LineBasicMaterial({
    color: appearance.edgeColor,
    transparent: live !== undefined || appearance.edgeOpacity < 1,
    opacity: live?.value ?? appearance.edgeOpacity,
  });
  // The outline takes part in a paired mask through the chunk adapter (#1209).
  material.userData.maskAdapter = "chunkSurface";
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(appearance.geometry), material);
  if (live)
    outline.onBeforeRender = () => {
      // Whatever material it draws with now, a paired mask's clone included, stays live (#1209).
      const current = outline.material as THREE.LineBasicMaterial;
      // A host showing a selection outline (fully opaque) keeps it while selected.
      if (current.userData.selected === true) {
        current.colorWrite = current.depthWrite = true;
        return;
      }
      current.opacity = live.value;
      current.colorWrite = live.value > 0;
      current.depthWrite = live.value > 0;
    };
  return outline;
}
