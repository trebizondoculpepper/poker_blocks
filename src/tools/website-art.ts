/** Local asset preparation only (#1457; doc/game-website.md). Not a deployed website entry. */
import * as THREE from "three";
import { createWord } from "../letter-block";
import { materialPools, getMaterialDefinition, type BlockMaterial } from "../materials";
import { writtenBlock, boardFinish } from "../visual/written-block";
import {
  addAttractLighting,
  configureAttractRenderer,
  sparkleEnvironment,
} from "../visual/attract-look";
import { createPrepassContext } from "../visual/appearance-prepass";

import { suits, type IdentityTrait } from "../cards";
import { cardFaceArt } from "../visual/face-art";
import { loadLettering, defaultLettering } from "../visual/lettering";

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
configureAttractRenderer(renderer);
renderer.setPixelRatio(1);
renderer.setClearColor(0, 0);
const environment = sparkleEnvironment(renderer, 0);
const materials: BlockMaterial[] = [
  "wood",
  "prismatic",
  "paper",
  "ice",
  "steel",
  "gold",
  "paper",
  "wood",
  "gold",
  "steel",
  "terracotta",
];
async function title() {
  const root = new THREE.Group();
  const pool = materialPools.get("registered")();
  let at = 0;
  const words = await Promise.all(
    ["Poker", "Blocks"].map(async (text, row) => {
      // Reserve the word's material choices before awaiting fonts, keeping composition deterministic.
      const choices = materials.slice(at, at + text.length);
      at += text.length;
      let next = 0;
      const made = await createWord(text, {
        finish: boardFinish,
        random: () => {
          const selected = choices[next++];
          return (pool.findIndex((d) => d.id === selected) + 0.5) / pool.length;
        },
      });
      made.object.position.y = 0.78 - row * 1.56;
      made.object.rotation.set(-0.1, 0.14, 0);
      root.add(made.object);
      return made;
    }),
  );
  return {
    object: root,
    surfaces: words.flatMap((w) => w.letters.flatMap((l) => l.surfaces)),
    prepasses: words.flatMap((w) => w.letters.flatMap((l) => l.prepasses)),
    dispose: () => words.forEach((w) => w.dispose()),
  };
}
const cards: {
  name: string;
  material: BlockMaterial;
  rank: IdentityTrait["rank"];
  suit: IdentityTrait["suit"];
}[] = [
  { name: "paper", material: "paper", rank: "A", suit: suits[0] },
  { name: "wood", material: "wood", rank: "K", suit: suits[1] },
  { name: "gold", material: "gold", rank: "Q", suit: suits[2] },
  { name: "steel", material: "steel", rank: "J", suit: suits[3] },
  { name: "ice", material: "ice", rank: "10", suit: suits[0] },
  { name: "terracotta", material: "terracotta", rank: "9", suit: suits[1] },
  ...(["10", "J", "Q", "K"] as const).map((rank) => ({
    name: `paper-${rank.toLowerCase()}`,
    material: "paper" as const,
    rank,
    suit: suits[0],
  })),
];
const jobs = [
  { name: "title", width: 1600, height: 720, make: title },
  ...cards.map(({ name, material, rank, suit }) => ({
    name,
    width: 512,
    height: 512,
    make: async () => {
      await loadLettering(defaultLettering, rank + suit.symbol);
      const definition = getMaterialDefinition(material);
      const made = writtenBlock(
        cardFaceArt({ rank, suit }, { face: definition.cardFace }),
        definition,
        1,
        boardFinish,
      );
      made.object.rotation.set(0.28, -0.48, 0.04);
      return made;
    },
  })),
];
const host = document.getElementById("exports")!;
host.replaceChildren();
try {
  for (const job of jobs) {
    const made = await job.make();
    const scene = new THREE.Scene();
    scene.environment = environment;
    addAttractLighting(scene);
    scene.add(made.object);
    const prepasses = createPrepassContext();
    prepasses.require(made.prepasses);
    for (const surface of made.surfaces) {
      (surface as THREE.MeshStandardMaterial).envMap = environment;
      surface.needsUpdate = true;
    }
    const box = new THREE.Box3().setFromObject(made.object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = job.width / job.height;
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    const distance =
      ((Math.max(size.y, size.x / aspect) * 0.5) / Math.tan(THREE.MathUtils.degToRad(25))) * 1.14 +
      size.z / 2;
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);
    renderer.setSize(job.width, job.height, false);
    prepasses.render({ renderer, scene, camera, hide: scene, delta: 0, reducedMotion: true });
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = data;
    link.download = `poker-site-${job.name}.png`;
    link.textContent = `Download ${job.name}`;
    link.style.cssText = "display:inline-block;margin:16px;color:white";
    const image = document.createElement("img");
    image.src = data;
    image.alt = job.name;
    image.style.cssText = "display:block;width:240px;max-height:160px;object-fit:contain";
    link.prepend(image);
    host.append(link);
    made.dispose();
    prepasses.dispose();
  }
} catch (error) {
  host.append(String(error));
  throw error;
} finally {
  environment.dispose();
  renderer.dispose();
}
