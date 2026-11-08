import "./style.css";
import * as THREE from "three";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");

app.innerHTML = `
  <main class="shell">
    <div class="intro">
      <p class="eyebrow">Puzzle game starter</p>
      <h1>Hello World</h1>
      <p class="description">Poker Blocks is ready for the rules.</p>
    </div>
    <div class="scene" aria-label="Animated preview of a board of blocks" role="img"></div>
    <p class="caption">Built with Vite+, TypeScript, and Three.js</p>
  </main>
`;

const host = app.querySelector<HTMLDivElement>(".scene")!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111726);

const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
camera.position.set(8, 10, 12);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdde9ff, 0x314060, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-3, 8, 6);
scene.add(sun);

const geometry = new THREE.BoxGeometry(1, 0.5, 1);
const materials = [0x46c6b1, 0x7a90e2, 0xe9b46a, 0xd778a1].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.48 }),
);
const blocks: THREE.Mesh[] = [];

for (let row = 0; row < 4; row++) {
  for (let column = 0; column < 4; column++) {
    const block = new THREE.Mesh(geometry, materials[(row + column) % materials.length]);
    block.position.set((column - 1.5) * 1.2, 0, (row - 1.5) * 1.2);
    scene.add(block);
    blocks.push(block);
  }
}

const resize = () => {
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height) return;
  const aspect = width / height;
  camera.left = -4.2 * aspect;
  camera.right = 4.2 * aspect;
  camera.top = 4.2;
  camera.bottom = -4.2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};

const observer = new ResizeObserver(resize);
observer.observe(host);
resize();

let frame = 0;
const animate = (time: number) => {
  blocks.forEach((block, index) => {
    block.position.y = Math.sin(time * 0.0015 + index * 0.6) * 0.11;
  });
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    geometry.dispose();
    materials.forEach((material) => material.dispose());
    renderer.dispose();
  });
}
