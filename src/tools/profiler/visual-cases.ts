/**
 * Profiling cases for letter blocks, menu word cubes and exit effects (#622), each through its
 * production path:
 *
 * - **Letter blocks:** `createLetterBlock` (the block title's letters), one case per material.
 * - **Menu cubes:** `createWordCube` (the block menus' choices), one case per material.
 * - **Exits:** every material whose look has an exit sequence, in two phases: `idle` (the block
 *   on the table) and `exit` (its sequence played by the shared exit runner, restarted with a
 *   fresh block each time it ends, so a steady stream of exits is sampled). Nothing gameplay is
 *   triggered and no run randomness is drawn.
 *
 * Registered by enumerating the material definitions; coverage sources list every expected case.
 */
import * as THREE from "three";
import { standardDeck } from "../../cards";
import { createLetterBlock } from "../../letter-block";
import {
  experimentalMaterials,
  materialDefinitions,
  type MaterialDefinition,
} from "../../materials";
import { createExitRunner } from "../../visual/exit-effects";
import { createWordCube } from "../../word-cube";
import { tableBlock } from "./block-object";
import { profilingCases, profilingCoverage, type ProfiledObject } from "./cases";

const allMaterials = (): readonly MaterialDefinition[] => [
  ...materialDefinitions,
  ...experimentalMaterials,
];
const withExit = () => allMaterials().filter(({ appearance }) => appearance.exit);

/** A fixed three-quarter turn, so three faces show. */
const turned = (object: THREE.Object3D) => object.rotation.set(0.45, 0.6, 0);

for (const definition of allMaterials()) {
  profilingCases.register(`letter:${definition.id}`, {
    family: "letter block",
    label: `${definition.name} letter`,
    defaultCount: 25,
    async create({ seed }) {
      const letter = await createLetterBlock("ABCDEFGHIJKLMNOPQRSTUVWXYZ"[seed % 26]!, {
        definition,
      });
      turned(letter.object);
      return { object: letter.object, dispose: () => letter.dispose() };
    },
  });
  profilingCases.register(`menu-cube:${definition.id}`, {
    family: "menu cube",
    label: `${definition.name} menu cube`,
    defaultCount: 9,
    async create({ seed }) {
      const cube = await createWordCube("Play", {
        id: `profile-${seed}`,
        action: "profile",
        definition,
      });
      turned(cube.object);
      return {
        object: cube.object,
        update: (dt) => cube.block.update(dt),
        dispose: () => cube.dispose(),
      };
    },
  });
}

/** One block's exit, played over and over: a fresh block starts as soon as the last has gone. */
function repeatingExit(definition: MaterialDefinition, seed: number): ProfiledObject {
  const holder = new THREE.Group();
  const runner = createExitRunner();
  const sequence = definition.appearance.exit!;
  let generation = 0;
  const start = () => {
    const block = tableBlock(standardDeck[(seed + generation) % standardDeck.length]!, definition);
    holder.add(block.object);
    const mesh = block.object as THREE.Mesh;
    runner.start(
      { blockId: `profile-${seed}-${generation++}`, material: definition.id },
      {
        root: mesh,
        shell: [mesh],
        contents: mesh.children.filter((child) => !(child instanceof THREE.LineSegments)),
        release: () => block.dispose(),
      },
      sequence,
    );
  };
  start();
  return {
    object: holder,
    update(dt) {
      runner.update(dt);
      if (runner.active === 0) start();
    },
    dispose: () => runner.dispose(),
  };
}

/** Each phase of an exit case, by name: the block at rest, and its exit played on repeat. */
const exitPhases: Record<string, (definition: MaterialDefinition, seed: number) => ProfiledObject> =
  {
    idle: (definition, seed) => tableBlock(standardDeck[seed % standardDeck.length]!, definition),
    exit: repeatingExit,
  };

for (const definition of withExit())
  profilingCases.register(`exit:${definition.id}`, {
    family: "exit effect",
    label: `${definition.name} exit`,
    defaultCount: 9,
    phases: Object.keys(exitPhases),
    create: ({ seed, phase }) => exitPhases[phase ?? "idle"]!(definition, seed),
  });

profilingCoverage.register("letter block", () => allMaterials().map(({ id }) => `letter:${id}`));
profilingCoverage.register("menu cube", () => allMaterials().map(({ id }) => `menu-cube:${id}`));
profilingCoverage.register("exit effect", () => withExit().map(({ id }) => `exit:${id}`));
