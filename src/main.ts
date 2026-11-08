import "./style.css";
import * as THREE from "three";
import { cardName, randomCard, type Card } from "./cards";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

const card = randomCard();
const name = cardName(card);
app.innerHTML = `
  <main class="shell">
    <div class="intro">
      <p class="eyebrow">Poker Blocks · first demo</p>
      <h1>One card. One block.</h1>
      <p class="description">Every face shows the same card. Reload for another.</p>
    </div>
    <div class="scene" role="img" aria-label="A cube with the ${name} on every face"></div>
    <p class="card-label">${card.rank}${card.suit.symbol} <span>${name}</span></p>
  </main>
`;

function makeFaceTexture(card: Card): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  context.fillStyle = "#f6f0e3";
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = "#b8b0a2";
  context.lineWidth = 12;
  context.strokeRect(26, 26, 460, 460);
  context.fillStyle = card.suit.color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 164px system-ui, sans-serif";
  context.fillText(card.rank, 256, 205);
  context.font = "188px Georgia, serif";
  context.fillText(card.suit.symbol, 256, 360);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const host = app.querySelector<HTMLDivElement>(".scene")!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111726);

const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
camera.position.set(4, 3, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-3, 6, 7);
scene.add(sun);

const geometry = new THREE.BoxGeometry(2.4, 2.4, 2.4);
const texture = makeFaceTexture(card);
const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const edgeGeometry = new THREE.EdgesGeometry(geometry);
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6b6c73 });
cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

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
  renderer.setSize(width, height);
  renderer.render(scene, camera);
};

const observer = new ResizeObserver(resize);
observer.observe(host);
resize();

let frame = 0;
const animate = (time: number) => {
  cube.rotation.y = time * 0.00025;
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    edgeGeometry.dispose();
    edgeMaterial.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
  });
}
