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

it("draws a live outline opacity each frame, writing nothing at zero (#796)", () => {
  const live = { value: 0.08 };
  vi.mocked(createBlockAppearance).mockReturnValue({
    geometry: new THREE.BoxGeometry(),
    materials: [new THREE.MeshStandardMaterial()],
    textures: [],
    edgeColor: 0,
    edgeOpacity: 1,
    liveEdgeOpacity: live,
  });
  const visual = writtenBlock({ seed: "test", paint() {} }, materialDefinitions[0], 1);
  const outline = visual.object.children.find(
    (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
  )!;
  const material = outline.material as THREE.LineBasicMaterial;
  const draw = () =>
    outline.onBeforeRender(
      {} as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.Camera(),
      outline.geometry,
      material,
      new THREE.Group(),
    );
  draw();
  expect([material.opacity, material.colorWrite, material.depthWrite]).toEqual([0.08, true, true]);
  live.value = 0;
  draw();
  expect([material.opacity, material.colorWrite, material.depthWrite]).toEqual([0, false, false]);
  visual.dispose();
});
