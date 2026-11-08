import * as THREE from "three";
import "./passive-rack.css";
import { passiveDefinitions, type PassiveBlock, type PassiveDefinition } from "./passives";

const slotWidth = 72;
const slotGap = 8;
const canvasHeight = 76;
const cubeSize = 1.45;

type RenderedPassive = {
  id: string;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  texture: THREE.CanvasTexture;
};

/** Each face gets the block's own symbol; this texture is mapped onto all six cube faces. */
function faceTexture(
  appearance: NonNullable<PassiveBlock["traits"]["appearance"]> | PassiveDefinition,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const { face, ink, edge } = appearance.palette;
  context.fillStyle = face;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = edge;
  context.lineWidth = 10;
  context.strokeRect(12, 12, 232, 232);
  context.lineWidth = 2;
  context.strokeRect(24, 24, 208, 208);
  context.fillStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `bold ${appearance.symbol.length > 2 ? 92 : 116}px system-ui, sans-serif`;
  context.fillText(appearance.symbol, 128, 131, 206);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A fixed screen-space rack with one Three.js scene for all rotating passive blocks. */
export function createPassiveRack(
  host: HTMLElement,
  options: {
    /** A pointer went down on an installed passive (the start of a possible drag). */
    onPickUp?(block: PassiveBlock, event: PointerEvent): void;
  } = {},
): {
  element: HTMLElement;
  render(rack: readonly PassiveBlock[]): void;
  /** Hide one passive's cube while it is being dragged (null shows them all). */
  lift(id: string | null): void;
  frame(time: number, reducedMotion: boolean): void;
  dispose(): void;
} {
  const element = document.createElement("aside");
  element.className = "passive-rack";
  element.setAttribute("aria-label", "Passive rack");
  element.innerHTML =
    '<span class="passive-rack-title">PASSIVES</span><div class="passive-rack-slots"></div>';
  host.append(element);
  const slots = element.querySelector<HTMLElement>(".passive-rack-slots")!;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x728091, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(-3, 5, 7);
  scene.add(keyLight);
  // The whole-window screenshot clones this canvas as part of the DOM overlay.
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "passive-rack-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  const camera = new THREE.OrthographicCamera(-1, 1, 1.15, -1.15, 0.1, 30);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  let rendered: RenderedPassive[] = [];

  const clear = () => {
    for (const { mesh, edges, texture } of rendered) {
      scene.remove(mesh);
      mesh.material.dispose();
      edges.material.dispose();
      texture.dispose();
    }
    rendered = [];
  };

  return {
    element,
    render(rack) {
      clear();
      const width = Math.max(
        slotWidth,
        rack.length * slotWidth + Math.max(0, rack.length - 1) * slotGap,
      );
      renderer.setSize(width, canvasHeight, false);
      camera.left = (-width / canvasHeight) * 1.15;
      camera.right = (width / canvasHeight) * 1.15;
      camera.updateProjectionMatrix();
      slots.replaceChildren(renderer.domElement);
      for (const [index, block] of rack.entries()) {
        const definition = passiveDefinitions.get(block.definitionId);
        const appearance = block.traits.appearance ?? definition;
        const texture = faceTexture(appearance);
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.7,
          metalness: 0.12,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x =
          (index - (rack.length - 1) / 2) * ((2.3 * (slotWidth + slotGap)) / canvasHeight);
        const edges = new THREE.LineSegments(
          edgeGeometry,
          new THREE.LineBasicMaterial({ color: appearance.palette.edge }),
        );
        mesh.add(edges);
        scene.add(mesh);
        rendered.push({ id: block.id, mesh, edges, texture });

        const item = document.createElement("div");
        item.className = "passive-item";
        item.setAttribute("role", "img");
        item.setAttribute("aria-label", block.traits.inspectable.inspect());
        item.tabIndex = 0;
        item.dataset.passiveId = block.id;
        item.addEventListener("pointerdown", (event) => options.onPickUp?.(block, event));
        const description = document.createElement("span");
        description.className = "passive-description";
        description.textContent = block.traits.inspectable.inspect();
        item.append(description);
        slots.append(item);
      }
      renderer.render(scene, camera);
    },
    lift(id) {
      for (const passive of rendered) passive.mesh.visible = passive.id !== id;
      renderer.render(scene, camera);
    },
    frame(time, reducedMotion) {
      for (const [index, { mesh }] of rendered.entries()) {
        const angle = reducedMotion ? 0 : time * 0.00028;
        mesh.rotation.set(
          0.28 + (reducedMotion ? 0 : Math.sin(time * 0.00037 + index) * 0.12),
          0.48 + angle,
          0,
        );
      }
      if (rendered.length) renderer.render(scene, camera);
    },
    dispose() {
      clear();
      geometry.dispose();
      edgeGeometry.dispose();
      renderer.dispose();
      element.remove();
    },
  };
}
