import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { BlockAppearance } from "./block-appearance";
import { bindSelectionFeedback, selectedFaceContribution } from "./selection-feedback";

const look = (
  materials: THREE.Material[],
  selectionFeedback?: BlockAppearance["selectionFeedback"],
  boardMaterials?: THREE.Material[],
) =>
  ({
    materials,
    boardMaterials,
    selectionFeedback,
  }) as unknown as BlockAppearance;

describe("appearance-owned selection feedback (#1314; doc/game-architecture.md)", () => {
  it("adds the face contribution over the captured baseline and restores it exactly", () => {
    const hand = new THREE.MeshStandardMaterial({ emissive: 0x112233, emissiveIntensity: 0.4 });
    const board = new THREE.MeshStandardMaterial();
    const binding = bindSelectionFeedback(
      look([hand, hand], { provider: "emissive" }, [board]),
      new THREE.Mesh(),
    );
    binding.setSelected(true);
    binding.setSelected(true);
    expect(hand.emissiveIntensity).toBeCloseTo(0.4 + selectedFaceContribution);
    expect(board.emissiveIntensity).toBeCloseTo(1 + selectedFaceContribution);
    binding.setSelected(false);
    expect(hand.emissive.getHex()).toBe(0x112233);
    expect(hand.emissiveIntensity).toBe(0.4);
    binding.setSelected(true);
    binding.dispose();
    expect(hand.emissiveIntensity).toBe(0.4);
  });

  it("shows a shader look selected with an overlay, never touching its material", () => {
    const shader = new THREE.ShaderMaterial();
    const mount = new THREE.Mesh(new THREE.BoxGeometry(), shader);
    const binding = bindSelectionFeedback(look([shader], { provider: "overlay" }), mount);
    binding.setSelected(true);
    expect(mount.children).toHaveLength(1);
    expect(mount.material).toBe(shader);
    binding.setSelected(false);
    expect(mount.children).toHaveLength(0);
    binding.setSelected(true);
    binding.dispose();
    binding.dispose();
    expect(mount.children).toHaveLength(0);
  });

  it("reports a look that declares no provider, rather than guessing", () => {
    expect(() => bindSelectionFeedback(look([]), new THREE.Mesh())).toThrow(
      /no selection feedback/,
    );
  });
});
