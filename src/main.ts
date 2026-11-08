import "./style.css";
import * as THREE from "three";
import { cardName, standardDeck, type CardBlock, type IdentityTrait } from "./cards";
import { drawCards, startingHandSize } from "./deal";
import { toggleBlockSelection, type Selection } from "./traits/selectable";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

const firstDraw = drawCards(standardDeck, 1);
const featured = firstDraw.cards[0];
const { deck, cards: hand } = drawCards(firstDraw.deck, startingHandSize);
const names = hand.map((block) => cardName(block.traits.identity)).join(", ");
app.innerHTML = `
  <main class="scene" role="img" aria-label="A large rotating ${cardName(featured.traits.identity)} block and a five-card hand at the top: ${names}. ${deck.length} cards remain in the deck."></main>
`;

function makeFaceTexture(identity: IdentityTrait): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  context.fillStyle = "#f6f0e3";
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = "#b8b0a2";
  context.lineWidth = 12;
  context.strokeRect(26, 26, 460, 460);
  context.fillStyle = identity.suit.color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 164px system-ui, sans-serif";
  context.fillText(identity.rank, 256, 205);
  context.font = "188px Georgia, serif";
  context.fillText(identity.suit.symbol, 256, 360);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const host = app.querySelector<HTMLDivElement>(".scene")!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111726);

const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
camera.position.set(0, 3, 8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-3, 6, 7);
scene.add(sun);

type RenderedBlock = {
  block: CardBlock;
  cube: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
  baseY: number;
  location: "featured" | "hand";
};

const resources: { dispose(): void }[] = [];
const renderedBlocks: RenderedBlock[] = [];
function createCube(
  block: CardBlock,
  size: number,
  location: RenderedBlock["location"],
): RenderedBlock {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const texture = makeFaceTexture(block.traits.identity);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 });
  const cube = new THREE.Mesh(geometry, material);
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6b6c73 });
  cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  scene.add(cube);
  resources.push(geometry, texture, material, edgeGeometry, edgeMaterial);
  const rendered = { block, cube, material, edgeMaterial, baseY: 0, location };
  renderedBlocks.push(rendered);
  return rendered;
}

const featuredBlock = createCube(featured, 2.4, "featured");
featuredBlock.baseY = -0.45;
const handBlocks = hand.map((block) => createCube(block, 0.8, "hand"));

let selected: Selection = new Set();
const showSelection = () => {
  renderedBlocks.forEach(({ block, cube, material, edgeMaterial, baseY, location }) => {
    const active = selected.has(block.id);
    material.emissive.setHex(0xffffff);
    material.emissiveIntensity = active ? 0.16 : 0;
    edgeMaterial.color.setHex(active ? 0x65f4dd : 0x6b6c73);
    cube.scale.setScalar(active ? (location === "hand" ? 1.08 : 1.03) : 1);
    cube.position.y = baseY + (active ? (location === "hand" ? 0.12 : 0.06) : 0);
  });
  const selectedNames = renderedBlocks
    .filter(({ block }) => selected.has(block.id))
    .map(({ block }) => cardName(block.traits.identity));
  host.setAttribute(
    "aria-label",
    `A large rotating ${cardName(featured.traits.identity)} block and a five-card hand at the top: ${names}. ${deck.length} cards remain in the deck. Selected: ${selectedNames.join(", ") || "none"}.`,
  );
};
showSelection();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickBlock = (event: MouseEvent | PointerEvent): RenderedBlock | undefined => {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    renderedBlocks.map(({ cube }) => cube),
    false,
  )[0];
  return renderedBlocks.find(({ cube }) => cube === hit?.object);
};

const onClick = (event: MouseEvent) => {
  const target = pickBlock(event);
  if (!target) return;
  selected = toggleBlockSelection(selected, target.block);
  showSelection();
};
const onPointerMove = (event: PointerEvent) => {
  renderer.domElement.style.cursor = pickBlock(event)?.block.traits.selectable
    ? "pointer"
    : "default";
};
renderer.domElement.addEventListener("click", onClick);
renderer.domElement.addEventListener("pointermove", onPointerMove);

const resize = () => {
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height) return;
  const aspect = width / height;
  const halfWidth = 3.3 * Math.max(1, aspect);
  const halfHeight = 3.3 * Math.max(1, 1 / aspect);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  handBlocks.forEach((rendered, index) => {
    rendered.baseY = halfHeight - 0.75;
    rendered.cube.position.x = (index - 2) * 1.2;
  });
  showSelection();
  renderer.setSize(width, height);
  renderer.render(scene, camera);
};

const observer = new ResizeObserver(resize);
observer.observe(host);
resize();

let frame = 0;
const animate = (time: number) => {
  renderedBlocks.forEach(({ cube }) => {
    cube.rotation.y = time * 0.00025;
  });
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener("click", onClick);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    resources.forEach((resource) => resource.dispose());
    renderer.dispose();
  });
}
