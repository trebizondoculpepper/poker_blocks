// The card room: a dim, warm backdrop and a green baize table under the floating
// structure, lit by an overhead lamp that casts soft shadows. Presentation only; all
// textures are drawn procedurally here, so there are no external art assets.
import * as THREE from "three";

export type ShadowQuality = "high" | "low" | "off";

export type CardRoom = {
  /** Keep the table under the structure and the shadow camera around it. */
  frame(center: THREE.Vector3, radius: number, delta: number): void;
  /**
   * Fit the room's backdrop to the camera's view, as a screen-filling quad just inside its
   * far plane. A mesh rather than `scene.background`, so it is on the room's layer and glass
   * and crystal can refract it (#116).
   */
  followCamera(camera: THREE.PerspectiveCamera): void;
  setShadowQuality(quality: ShadowQuality): void;
};

const shadowMapSizes: Record<Exclude<ShadowQuality, "off">, number> = { high: 2048, low: 1024 };

/**
 * The card room, drawn on `layer` (the back canvas, #116). Its shadows are set up on every
 * renderer in `renderers`, so blocks drawn on the front canvas shade one another too.
 */
export function createCardRoom(
  scene: THREE.Scene,
  renderers: readonly THREE.WebGLRenderer[],
  layer: number,
): CardRoom {
  // The backdrop: a quad that fills the view behind everything else (see followCamera).
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: roomBackdrop(),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  backdrop.renderOrder = -1;
  backdrop.frustumCulled = false;
  backdrop.layers.set(layer);
  scene.add(backdrop);
  for (const renderer of renderers) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const table = new THREE.Group();
  const baize = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({ map: baizeTexture(), roughness: 0.95, metalness: 0 }),
  );
  baize.rotation.x = -Math.PI / 2;
  baize.receiveShadow = true;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.035, 16, 128),
    new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.55, metalness: 0.05 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.receiveShadow = true;
  table.add(baize, rim);
  for (const part of [table, baize, rim]) part.layers.set(layer);
  scene.add(table);

  // The lamp sits above and slightly in front, so shadows fall back and down onto the
  // baize while the faces turned toward the camera stay well lit.
  const lamp = new THREE.DirectionalLight(0xfff1d6, 1.6);
  lamp.castShadow = true;
  lamp.shadow.bias = -0.0005;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  scene.add(lamp, lamp.target);
  const lampOffset = new THREE.Vector3(-2, 14, 5);

  let tableY: number | null = null;
  let tableRadius: number | null = null;

  return {
    followCamera(camera) {
      const distance = camera.far * 0.95;
      const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      camera.getWorldPosition(backdrop.position);
      camera.getWorldQuaternion(backdrop.quaternion);
      backdrop.translateZ(-distance);
      backdrop.scale.set(height * camera.aspect, height, 1);
    },
    frame(center, radius, delta) {
      const wantY = center.y - radius - 0.5;
      const wantRadius = Math.max(9, radius * 3);
      const ease = tableY === null ? 1 : Math.min(1, delta * 3);
      tableY = tableY === null ? wantY : tableY + (wantY - tableY) * ease;
      tableRadius =
        tableRadius === null ? wantRadius : tableRadius + (wantRadius - tableRadius) * ease;
      table.position.set(center.x, tableY, center.z);
      table.scale.setScalar(tableRadius);

      lamp.target.position.copy(center);
      lamp.position.copy(center).add(lampOffset);
      const shadowCamera = lamp.shadow.camera;
      const extent = radius + 4;
      if (shadowCamera.right !== extent) {
        shadowCamera.left = shadowCamera.bottom = -extent;
        shadowCamera.right = shadowCamera.top = extent;
        shadowCamera.near = 1;
        shadowCamera.far = lampOffset.length() + radius * 2 + 8;
        shadowCamera.updateProjectionMatrix();
      }
    },
    setShadowQuality(quality) {
      const enabled = quality !== "off";
      for (const renderer of renderers) renderer.shadowMap.enabled = enabled;
      lamp.castShadow = enabled;
      if (enabled) {
        const size = shadowMapSizes[quality];
        if (lamp.shadow.mapSize.x !== size) {
          lamp.shadow.mapSize.set(size, size);
          lamp.shadow.map?.dispose();
          lamp.shadow.map = null;
        }
      }
      // Materials compile shadow support in or out, so they must be rebuilt.
      scene.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        for (const item of Array.isArray(material) ? material : material ? [material] : []) {
          item.needsUpdate = true;
        }
      });
    },
  };
}

/** A dim card room: warm panelled walls fading into shadow, with a soft vignette. */
function roomBackdrop(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext("2d")!;
  const wall = g.createLinearGradient(0, 0, 0, 512);
  wall.addColorStop(0, "#2a1a14");
  wall.addColorStop(0.55, "#1d1411");
  wall.addColorStop(1, "#0e0b0b");
  g.fillStyle = wall;
  g.fillRect(0, 0, 512, 512);
  // Wood panelling: faint vertical boards with darker seams in the upper wall.
  for (let x = 0; x < 512; x += 64) {
    g.fillStyle = "rgba(0, 0, 0, 0.18)";
    g.fillRect(x, 0, 2, 300);
    g.fillStyle = "rgba(255, 220, 180, 0.025)";
    g.fillRect(x + 6, 0, 26, 300);
  }
  // A dado rail where the panelling ends.
  g.fillStyle = "rgba(255, 210, 160, 0.06)";
  g.fillRect(0, 298, 512, 4);
  // Lamp glow from above the table, then a vignette toward the corners.
  const glow = g.createRadialGradient(256, 170, 10, 256, 170, 300);
  glow.addColorStop(0, "rgba(255, 214, 160, 0.16)");
  glow.addColorStop(1, "rgba(255, 214, 160, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 512, 512);
  const vignette = g.createRadialGradient(256, 256, 160, 256, 256, 380);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Green baize: a fine felt speckle over a slightly mottled green. */
function baizeTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1f6a3c";
  g.fillRect(0, 0, size, size);
  const image = g.getImageData(0, 0, size, size);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < image.data.length; i += 4) {
    const fleck = (random() - 0.5) * 22;
    image.data[i] += fleck * 0.5;
    image.data[i + 1] += fleck;
    image.data[i + 2] += fleck * 0.6;
  }
  g.putImageData(image, 0, 0);
  // Darken toward the edge so the table reads as lit from above.
  const shade = g.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.2,
    size / 2,
    size / 2,
    size / 2,
  );
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
