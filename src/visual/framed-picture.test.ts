import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createFramedPicture, defaultFrameAppearance } from "./framed-picture";

const photo = () => new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);

describe("framed picture (#1086; doc/line-goes-up.md)", () => {
  it("frames any picture at the position, orientation and size its composer configures", () => {
    const texture = photo();
    const picture = createFramedPicture(
      { size: { width: 2, height: 1 }, position: [3, 2, -5], rotation: [0, Math.PI / 4, 0] },
      texture,
    );
    expect(picture.object.position.toArray()).toEqual([3, 2, -5]);
    expect(picture.object.rotation.y).toBeCloseTo(Math.PI / 4);
    const surface = picture.object.getObjectByName("picture") as THREE.Mesh;
    expect((surface.material as THREE.MeshStandardMaterial).map).toBe(texture);
    // Measured unplaced: the frame's own extent.
    const unplaced = picture.object.clone();
    unplaced.position.set(0, 0, 0);
    unplaced.rotation.set(0, 0, 0);
    unplaced.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(unplaced);
    const size = bounds.getSize(new THREE.Vector3());
    const { border } = defaultFrameAppearance;
    expect(size.x).toBeCloseTo(2 + 2 * border);
    expect(size.y).toBeCloseTo(1 + 2 * border);
  });

  it("places a second picture elsewhere with its own transform, without affecting the first", () => {
    const first = createFramedPicture({ size: { width: 1, height: 1 }, position: [0, 0, 0] });
    const second = createFramedPicture({
      size: { width: 0.5, height: 0.8 },
      position: [-4, 1, 2],
      frame: { colour: "#ffffff", border: 0.02 },
    });
    expect(first.object.position.toArray()).toEqual([0, 0, 0]);
    expect(second.object.position.toArray()).toEqual([-4, 1, 2]);
    const firstBar = first.object.getObjectByName("frame") as THREE.Mesh;
    const secondBar = second.object.getObjectByName("frame") as THREE.Mesh;
    expect(firstBar.material).not.toBe(secondBar.material);
  });

  it("exposes nails at the top corners as local attachment points, or the composer's own", () => {
    const picture = createFramedPicture({ size: { width: 2, height: 1 }, position: [9, 9, 9] });
    const { border, depth } = defaultFrameAppearance;
    expect(picture.attachments.get("left")!.toArray()).toEqual([
      -1 - border / 2,
      0.5 + border / 2,
      depth / 2,
    ]);
    expect(picture.attachments.get("right")!.toArray()).toEqual([
      1 + border / 2,
      0.5 + border / 2,
      depth / 2,
    ]);
    const custom = createFramedPicture({
      size: { width: 1, height: 1 },
      position: [0, 0, 0],
      attachments: { hook: [0, 0.6, 0] },
    });
    expect([...custom.attachments.keys()]).toEqual(["hook"]);
  });

  it("swaps pictures and disposes its own resources, never the supplied texture", () => {
    const texture = photo();
    const dispose = vi.spyOn(texture, "dispose");
    const parent = new THREE.Group();
    const picture = createFramedPicture(
      { size: { width: 1, height: 1 }, position: [0, 0, 0] },
      texture,
    );
    parent.add(picture.object);
    const surface = picture.object.getObjectByName("picture") as THREE.Mesh;
    const material = surface.material as THREE.MeshStandardMaterial;
    const other = photo();
    picture.setPicture(other);
    expect(material.map).toBe(other);
    const geometryDispose = vi.spyOn(surface.geometry, "dispose");
    picture.dispose();
    expect(geometryDispose).toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });

  it("draws with depth testing, so cards and table in front occlude it", () => {
    const picture = createFramedPicture({ size: { width: 1, height: 1 }, position: [0, 0, 0] });
    picture.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        expect((child.material as THREE.Material).depthTest).toBe(true);
        expect((child.material as THREE.Material).depthWrite).toBe(true);
      }
    });
  });
});
