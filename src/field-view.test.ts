import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { createFieldView } from "./field-view";
import { getMaterialDefinition, type BlockMaterial, type MaterialDefinition } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { scoringModifierRules } from "./scoring-modifier";
import type { SoundEffectId } from "./audio/sfx-registry";
import { faceFromDirection } from "./traits/attachable";
import type { BlockViews, RenderedBlock } from "./rendered-blocks";

function fakeViews(): BlockViews {
  const all: RenderedBlock[] = [];
  return {
    all,
    create(block, _size, location) {
      const material = new THREE.MeshStandardMaterial();
      const rendered = {
        block,
        cube: new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), material),
        materials: [material],
        location,
        cell: null,
        baseY: 0,
        rock: null,
        handSlot: null,
      } as unknown as RenderedBlock;
      all.push(rendered);
      return rendered;
    },
    dispose(rendered) {
      all.splice(all.indexOf(rendered), 1);
    },
    disposeAll() {
      all.length = 0;
    },
    highlight() {},
  };
}

function setup(
  options: {
    resolveMaterial?: (block: CardBlock) => MaterialDefinition;
    sound?: (id: SoundEffectId) => void;
  } = {},
) {
  const centres: { x: number; y: number; z: number }[] = [];
  const assembly = new THREE.Group();
  const views = fakeViews();
  const field = createFieldView({
    views,
    assembly,
    cubeSize: 2.4,
    onCenter: (center) => centres.push(center),
    ...options,
  });
  return { field, views, assembly, centres };
}

const [first, second, third] = standardDeck;

describe("field view", () => {
  it("uses a test-only material's cue when its scoring rule fires", () => {
    const definition: MaterialDefinition = {
      ...getMaterialDefinition("wood"),
      id: "test-copper",
      scoringModifier: { additive: 2 },
      activation: { effect: { id: "pulse", colour: "#ff5500" }, sfx: "material.activate.wood" },
    };
    const sevenHearts = standardDeck.find(
      ({ traits }) => traits.identity.rank === "7" && traits.identity.suit.name === "hearts",
    )!;
    const sevenClubs = standardDeck.find(
      ({ traits }) => traits.identity.rank === "7" && traits.identity.suit.name === "clubs",
    )!;
    const materialCard: CardBlock = {
      ...sevenHearts,
      traits: { ...sevenHearts.traits, material: { kind: definition.id as BlockMaterial } },
    };
    const sounds: SoundEffectId[] = [];
    const { field } = setup({ resolveMaterial: () => definition, sound: (id) => sounds.push(id) });
    const rendered = field.add(materialCard, { x: 0, y: 0, z: 0 });
    const line = scoreFieldWithPassives(
      [
        { block: materialCard, cell: { x: 0, y: 0, z: 0 } },
        { block: sevenClubs, cell: { x: 1, y: 0, z: 0 } },
      ],
      [],
      (block) =>
        block.id === materialCard.id ? scoringModifierRules(definition.scoringModifier) : [],
    )[0]!;
    expect(line.activations.map(({ sourceId }) => sourceId)).toContain(materialCard.id);
    field.activate(
      line.activations.map(({ sourceId }) => sourceId),
      0,
    );
    expect(sounds).toEqual(["material.activate.wood"]);
    field.update(225);
    expect(rendered.cube.scale.x).toBeGreaterThan(1);
    expect(rendered.materials[0]!.emissive.getHexString()).toBe("ff5500");
    field.update(451);
    expect(rendered.cube.scale.x).toBe(1);
    expect(rendered.materials[0]!.emissiveIntensity).toBe(1);
  });

  it("puts a block in its cell and moves the rotation centre to the structure's centre", () => {
    const { field, centres } = setup();
    const rendered = field.add(first, { x: 0, y: 0, z: 0 });
    field.add(second, { x: 1, y: 0, z: 0 });
    expect(rendered.cube.position.toArray()).toEqual([0, -0.45, 0]);
    expect(field.cells()).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    expect(centres.at(-1)).toEqual({ x: 0.5, y: 0, z: 0 });
  });

  it("adopts a flown hand block as a table block", () => {
    const { field, views } = setup();
    const flown = views.create(third, 0.8, "hand");
    flown.handSlot = 2;
    field.adopt(flown, { x: 0, y: 1, z: 0 });
    expect(flown).toMatchObject({
      location: "board",
      handSlot: null,
      rock: null,
      baseY: 2.4 - 0.45,
    });
    expect(field.blocks()).toEqual([flown]);
  });

  it("finds the placed block and face under a ray", () => {
    const { field, assembly } = setup();
    const rendered = field.add(first, { x: 0, y: 0, z: 0 });
    assembly.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -0.45, 10), new THREE.Vector3(0, 0, -1));
    expect(field.faceAt(ray)).toEqual({
      target: rendered,
      face: faceFromDirection(new THREE.Vector3(0, 0, 1)),
    });
    const miss = new THREE.Raycaster(new THREE.Vector3(9, 9, 10), new THREE.Vector3(0, 0, -1));
    expect(field.faceAt(miss)).toBeNull();
  });

  it("forgets the structure and its centre when cleared", () => {
    const { field } = setup();
    field.add(first, { x: 2, y: 0, z: 0 });
    field.clear();
    expect(field.blocks()).toEqual([]);
    expect(field.massCenter).toEqual({ count: 0, sum: { x: 0, y: 0, z: 0 } });
  });
});
