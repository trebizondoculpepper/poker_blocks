import * as THREE from "three";
import { expect, it, vi } from "vite-plus/test";
import { writtenBlock } from "./written-block";
import { createBlockAppearance } from "./block-appearance";
import { materialDefinitions } from "../materials";
vi.mock("./block-appearance", () => ({ createBlockAppearance: vi.fn() }));
it("disposes owned face maps once and preserves the scene's shared environment", () => {
  const owned = new THREE.CanvasTexture({} as HTMLCanvasElement);
  const extraMap = new THREE.Texture();
  const environment = new THREE.Texture();
  const ownedDispose = vi.spyOn(owned, "dispose");
  const extraDispose = vi.spyOn(extraMap, "dispose");
  const envDispose = vi.spyOn(environment, "dispose");
  const material = new THREE.MeshStandardMaterial({ map: owned, envMap: environment });
  const extraMaterial = new THREE.MeshStandardMaterial({
    map: extraMap,
    bumpMap: extraMap,
    envMap: environment,
  });
  const geometry = new THREE.BoxGeometry();
  const geometryDispose = vi.spyOn(geometry, "dispose");
  vi.mocked(createBlockAppearance).mockReturnValue({
    geometry,
    materials: [material],
    textures: [owned],
    edgeColor: 0,
    edgeOpacity: 1,
    extras: [new THREE.Mesh(geometry, extraMaterial)],
  });
  const visual = writtenBlock({ seed: "test", paint() {} }, materialDefinitions[0], 1);
  visual.dispose();
  visual.dispose();
  expect(ownedDispose).toHaveBeenCalledTimes(1);
  expect(extraDispose).toHaveBeenCalledTimes(1);
  expect(envDispose).not.toHaveBeenCalled();
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  environment.dispose();
});
