import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createWord } from "./letter-block";
import type { DanceFloor, DanceMove } from "./dance/dance-floor";
import type { BlockTitleConfig, BlockTitles } from "./scene-traits/block-title";

/** A rigid row follows the shared dance floor; no separate clock or music analysis. */
export function danceTitleRow(
  row: THREE.Group,
  restY: number,
  config: BlockTitleConfig,
  move: DanceMove,
): void {
  const wave = Math.sin(move.phase * Math.PI * 2);
  row.position.y = restY + Math.abs(wave) * (config.dance?.bounce ?? 0.08) * move.energy;
  row.rotation.z = wave * THREE.MathUtils.degToRad(config.dance?.tilt ?? 3) * move.energy;
}

type TitleView = { frame(): void; dispose(): void };
/** Reusable view service. The caller supplies its mounting surface, never a scene identity. */
export function createBlockTitles(parent: () => HTMLElement, floor: DanceFloor): BlockTitles {
  const views = new Set<TitleView>();
  return {
    show(config) {
      if (!(config.scale > 0 && Number.isFinite(config.scale)))
        throw new Error("Block title scale must be positive");
      const container = document.createElement("div");
      container.className = "block-title";
      container.setAttribute("role", "heading");
      container.setAttribute("aria-level", "1");
      container.setAttribute("aria-label", config.text);
      container.style.width = "100%";
      container.style.maxWidth = "520px";
      container.style.height = `${240 * config.scale}px`;
      container.style.margin = "0 auto";
      container.style.pointerEvents = "none";
      parent().prepend(container);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
      container.append(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 100);
      camera.position.z = 10;
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 5, 8);
      scene.add(light);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room);
      room.dispose();
      pmrem.dispose();
      scene.environment = environment.texture;
      const title = new THREE.Group();
      title.scale.setScalar(config.scale);
      scene.add(title);
      const rows: Awaited<ReturnType<typeof createWord>>[] = [];
      const leave: (() => void)[] = [];
      let alive = true;
      const words = config.text.trim().split(/\s+/u).filter(Boolean);
      const resize = () => {
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height, false);
        const halfHeight = (4 * height) / width;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const release = () => {
        alive = false;
        observer.disconnect();
        leave.forEach((stop) => stop());
        rows.forEach((row) => row.dispose());
        environment.dispose();
        renderer.dispose();
        title.clear();
        views.delete(view);
      };
      const view: TitleView = {
        frame() {
          if (alive) renderer.render(scene, camera);
        },
        dispose() {
          if (!alive) {
            container.remove();
            return;
          }
          release();
          container.remove();
        },
      };
      views.add(view);
      void Promise.all(
        words.map(async (word, index) => {
          const row = await createWord(word);
          if (!alive) {
            row.dispose();
            return;
          }
          rows.push(row);
          // Material environment textures belong to this renderer, never another WebGL context.
          row.object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            for (const material of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
              (material as THREE.MeshStandardMaterial).envMap = environment.texture;
              material.needsUpdate = true;
            }
          });
          const restY = ((words.length - 1) / 2 - index) * (config.rowSpacing ?? 1.45);
          row.object.position.y = restY;
          title.add(row.object);
          leave.push(
            floor.join({
              cycle: config.dance?.cycle ?? "beat",
              offset: index * (config.dance?.phaseStep ?? 0.12),
              dance: (move) => danceTitleRow(row.object, restY, config, move),
            }),
          );
        }),
      ).catch((error) => {
        if (!alive) return;
        release();
        container.textContent = config.text;
        console.error("Unable to create block title", error);
      });
      return () => view.dispose();
    },
    frame() {
      views.forEach((view) => view.frame());
    },
    dispose() {
      [...views].forEach((view) => view.dispose());
    },
  };
}
