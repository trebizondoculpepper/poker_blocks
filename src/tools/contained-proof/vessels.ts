/**
 * The vessels built by the contained-components proof (#346): the custard baseline, made by
 * the game's own `composeContained`, and the proof's glass + refractive water + fading film.
 * Both are registered by name, so the room only looks one up.
 *
 * The proof composes the parts #329 describes, in its render-layer order:
 *   shellBack 1 → contentsOpaque 2 (the water's cut top) → residue 3 (film) →
 *   contentsTransparent 4 (refractive water) → shellFront 5 → gloss 6 → print 20.
 * Each vessel keeps its own surface (its own settler) and its own film history: vessels turn
 * independently here, so a shared simulation would level one vessel with another's motion.
 *
 * Developer-only: nothing in the game imports this.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { materialPools } from "../../materials";
import { composeContained, containedLayers } from "../../visual/contained";
import { createSettler } from "../../visual/filled-vessel";
import { coatingStorages, type CoatingConfig, type LiquidSurface } from "./coating";

export type VesselOptions = {
  environment: THREE.Texture;
  storage: string;
  coating: CoatingConfig;
};

export type ProofVessel = {
  object: THREE.Object3D;
  /** Advance this vessel's own fluid and film to `now` (seconds). */
  update(now: number): void;
  /** Bytes of film history this vessel keeps. */
  readonly bytes: number;
  /** Film samples tested per frame. */
  readonly samples: number;
  dispose(): void;
};

export type VesselBuilder = (options: VesselOptions) => ProofVessel;

const layers = {
  shellBack: 1,
  contentsOpaque: 2,
  residue: 3,
  contentsTransparent: 4,
  shellFront: 5,
  gloss: 6,
  print: 20,
} as const;

/** A shared block shape: one geometry, as every block of a material shares its own. */
const blockGeometry = new RoundedBoxGeometry(1, 1, 1, 4, 0.08);

/** The rank and suit, on a skin just outside the shell, to check writing stays legible. */
function printSkin(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#c0182a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 80px system-ui, sans-serif";
  g.fillText("A", 128, 100);
  g.font = "94px Georgia, serif";
  g.fillText("♥", 128, 180);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const skin = new THREE.Mesh(
    blockGeometry,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  skin.scale.setScalar(1.004);
  skin.renderOrder = layers.print;
  skin.userData.texture = texture;
  return skin;
}

/** The custard baseline: the game's contained block, exactly as the game builds it. */
const custard: VesselBuilder = ({ environment }) => {
  const material = materialPools
    .get("registered")()
    .find(({ appearance }) => appearance.contents !== undefined);
  if (!material?.appearance.container)
    throw new Error("No registered material has contents for the baseline");
  const { faces: shell, extras } = composeContained(
    {
      geometry: blockGeometry,
      size: 1,
      environment,
      // The plastic baseline draws nothing from its material's own artwork.
      faceTexture: () => {
        throw new Error("The proof baseline has no face artwork");
      },
      ownSurface: () => {
        throw new Error("The proof baseline has no face artwork");
      },
    },
    material.appearance.container,
    material.appearance.contents,
  );
  const object = new THREE.Group();
  const outer = new THREE.Mesh(blockGeometry, [...shell]);
  outer.renderOrder = containedLayers.shellFront;
  const print = printSkin();
  object.add(outer, ...extras, print);
  return {
    object,
    update() {},
    bytes: 0,
    samples: 0,
    dispose() {
      new Set(shell).forEach((material) => material.dispose());
      extras.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      (print.material as THREE.Material).dispose();
      (print.userData.texture as THREE.Texture).dispose();
    },
  };
};

/** Glass, refractive water and a fading film, each vessel with its own surface and history. */
const glassWaterFilm: VesselBuilder = ({ environment, storage, coating }) => {
  const object = new THREE.Group();
  const glass = (side: THREE.Side, order: number) => {
    const mesh = new THREE.Mesh(
      blockGeometry,
      new THREE.MeshPhysicalMaterial({
        color: 0xeaf6ff,
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMap: environment,
        envMapIntensity: 1.2,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side,
      }),
    );
    mesh.renderOrder = order;
    return mesh;
  };
  const back = glass(THREE.BackSide, layers.shellBack);
  back.scale.setScalar(0.94);
  const front = glass(THREE.FrontSide, layers.shellFront);

  // The water: clipped to its surface by a world-space plane updated each frame.
  const plane = new THREE.Plane();
  const water = new THREE.Mesh(
    blockGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0xd8f1ff,
      metalness: 0,
      roughness: 0.04,
      transmission: 1,
      ior: 1.33,
      thickness: 0.6,
      attenuationColor: new THREE.Color(0x7fc8ee),
      attenuationDistance: 1.6,
      envMap: environment,
      clippingPlanes: [plane],
      side: THREE.FrontSide,
    }),
  );
  water.scale.setScalar(0.91);
  water.renderOrder = layers.contentsTransparent;
  // Its top, seen through the cut: the back faces, flat and pale.
  const top = new THREE.Mesh(
    blockGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xcfeeff,
      transparent: true,
      opacity: 0.55,
      clippingPlanes: [plane],
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  top.scale.setScalar(0.91);
  top.renderOrder = layers.contentsOpaque;

  const make = coatingStorages.get(storage);
  if (!make) throw new Error(`Unknown coating storage: ${storage}`);
  const film = make(0.935, coating);
  film.mesh.renderOrder = layers.residue;

  const print = printSkin();
  object.add(back, top, film.mesh, water, front, print);

  const level = 0.5;
  const surface: LiquidSurface = { normal: new THREE.Vector3(0, 1, 0), height: (level - 0.5) * 1 };
  const trace = new THREE.Vector3();
  const settle = createSettler({ settleSeconds: 0.9, traceSeconds: 1 });
  const rotation = new THREE.Quaternion();
  const worldNormal = new THREE.Vector3();
  const point = new THREE.Vector3();
  let last: number | null = null;
  return {
    object,
    update(now) {
      object.getWorldQuaternion(rotation);
      settle(rotation, now, surface.normal, trace);
      film.update(surface, last === null ? 0 : Math.min(now - last, 0.1));
      last = now;
      // Keep the water below its surface: clip where dot(p, n) > height, in world space.
      worldNormal.copy(surface.normal).applyQuaternion(rotation);
      object.updateWorldMatrix(true, true);
      water.localToWorld(point.copy(surface.normal).multiplyScalar(surface.height));
      plane.setFromNormalAndCoplanarPoint(worldNormal.negate(), point);
    },
    get bytes() {
      return film.bytes;
    },
    get samples() {
      return film.samples;
    },
    dispose() {
      [back, front, water, top].forEach((mesh) => (mesh.material as THREE.Material).dispose());
      film.dispose();
      (print.material as THREE.Material).dispose();
      (print.userData.texture as THREE.Texture).dispose();
    },
  };
};

/** The vessels under comparison, by name. */
export const vesselBuilders = new Map<string, VesselBuilder>([
  ["custard", custard],
  ["glassWaterFilm", glassWaterFilm],
]);
