/**
 * Hand service: the cubes in the player's hand. It lays them out in slots (making room for
 * a card dragged to a new position), glides them there, rocks them (a selected card
 * vibrates), and draws dealt and refilled cards in with the materialise effect, one after
 * another. The game decides what the hand holds; this service shows it.
 */
import * as THREE from "three";
import { playSfx } from "./audio/sfx";
import type { CardBlock } from "./cards";
import { stepRock } from "./motion";
import type { RenderedBlock, BlockViews } from "./rendered-blocks";
import type { Selection } from "./traits/selectable";
import { createMaterialise } from "./visual/materialise";

type MaterialiseEffect = ReturnType<typeof createMaterialise>;

/** A card the player is dragging, as far as the hand layout cares. */
export type HandDrag = {
  source: RenderedBlock;
  group: readonly RenderedBlock[];
  /** The slot a drop inside the hand would move the dragged card to. */
  reorderSlot: number | null;
};

export type HandView = {
  /** The hand's cubes (in no particular order; `handSlot` gives the order). */
  readonly blocks: readonly RenderedBlock[];
  /** Add a cube for a card that joined the hand (bought in the shop). */
  add(block: CardBlock): RenderedBlock;
  /** Take cubes out of the hand (played or discarded); they stay on screen. */
  remove(blocks: readonly RenderedBlock[]): void;
  /** Put dragged cubes back in the hand's scene, on the hand's plane. */
  putBack(blocks: readonly RenderedBlock[]): void;
  /** Match the cubes' slots to the hand order, then lay them out. */
  sync(hand: readonly CardBlock[]): void;
  layout(): void;
  /** Deal a new stage's hand, each card drawing in. */
  deal(hand: readonly CardBlock[]): void;
  /** Cards just drawn (left to right): add their cubes, re-slot, and draw them in in turn. */
  drawIn(drawn: readonly CardBlock[], hand: readonly CardBlock[]): void;
  /** Finish any draw-in on these cubes now, before another dissolve takes them over. */
  settle(blocks: readonly RenderedBlock[]): void;
  /** The selected hand cubes, in hand order. */
  selected(selection: Selection): RenderedBlock[];
  /** The slot under a point on the hand's drag plane. */
  slotAt(x: number): number;
  /** Advance the draw-in dissolves by one frame. */
  updateDrawIns(delta: number): void;
  /** Glide cubes to their slots and rock them, by one frame. */
  animate(time: number, delta: number, selection: Selection): void;
  /** Forget every hand cube and draw-in (the cubes themselves are disposed elsewhere). */
  clear(): void;
  dispose(): void;
};

/** Seconds between cards drawn into the hand, one after another. */
const drawStagger = 1 / 3;
/** How far a selected hand cube lifts above the others (#305), in world units. */
const selectedLift = 0.32;
const slotSpacing = 1.2;

export function createHandView(options: {
  views: BlockViews;
  /** The hand's scene: dragged cubes return to it. */
  scene: THREE.Object3D;
  cubeSize: number;
  /** The hand's resting height in the hand camera's view. */
  baseY(): number;
  /** How many slots the dealer's hand has. */
  handSize(): number;
  reducedMotion(): boolean;
  /** The card being dragged, if a drag is active. */
  drag(): HandDrag | null;
  /** Run after each layout (the selection highlight and screen-reader label). */
  onLayout(): void;
}): HandView {
  const { views, cubeSize } = options;
  const blocks: RenderedBlock[] = [];
  /**
   * Cubes dissolving into view. `wait` holds one back (still invisible) so refills draw in
   * one after another; a sound plays as each starts.
   */
  const appearing: {
    effect: MaterialiseEffect;
    edges: THREE.Object3D[];
    cube: THREE.Object3D;
    wait?: number;
    sound?: boolean;
  }[] = [];

  const create = (block: CardBlock) => views.create(block, cubeSize / 3, "hand");
  const slotX = (slot: number, visibleSlots: number) =>
    (slot - (visibleSlots - 1) / 2) * slotSpacing;
  const visibleSlots = () =>
    Math.max(options.handSize(), ...blocks.map(({ handSlot }) => (handSlot ?? -1) + 1));
  const isDragged = (rendered: RenderedBlock) => {
    const drag = options.drag();
    return Boolean(drag && (drag.source === rendered || drag.group.includes(rendered)));
  };

  function drawInEffect(rendered: RenderedBlock, wait?: number, sound?: boolean): void {
    const edges = [...rendered.cube.children];
    edges.forEach((edge) => (edge.visible = false));
    rendered.cube.updateWorldMatrix(true, true);
    appearing.push({
      effect: createMaterialise(rendered.cube, {
        seconds: 0.9,
        reduced: options.reducedMotion(),
      }),
      edges,
      cube: rendered.cube,
      wait,
      sound,
    });
  }

  function layout(): void {
    const slots = visibleSlots();
    const drag = options.drag();
    const preview = drag && drag.reorderSlot !== null ? drag : null;
    const order = [...blocks].sort((a, b) => a.handSlot! - b.handSlot!);
    if (preview) {
      order.splice(order.indexOf(preview.source), 1);
      order.splice(preview.reorderSlot!, 0, preview.source);
    }
    const baseY = options.baseY();
    blocks.forEach((rendered) => {
      rendered.baseY = baseY;
      const slot = preview ? order.indexOf(rendered) : rendered.handSlot!;
      const firstLayout = rendered.handX === undefined;
      rendered.handX = slotX(slot, slots);
      if (isDragged(rendered)) return;
      rendered.cube.position.y = baseY;
      rendered.cube.position.z = 0;
      if (firstLayout) rendered.cube.position.x = rendered.handX;
    });
    options.onLayout();
  }

  function sync(hand: readonly CardBlock[]): void {
    blocks.forEach((rendered) => (rendered.handSlot = hand.indexOf(rendered.block)));
    layout();
  }

  return {
    blocks,
    add(block) {
      const rendered = create(block);
      blocks.push(rendered);
      return rendered;
    },
    remove(removed) {
      for (const rendered of removed) blocks.splice(blocks.indexOf(rendered), 1);
    },
    putBack(returned) {
      for (const rendered of returned) {
        options.scene.add(rendered.cube);
        rendered.cube.position.z = 0;
      }
    },
    sync,
    layout,
    deal(hand) {
      hand.forEach((block, slot) => {
        const rendered = create(block);
        rendered.handSlot = slot;
        blocks.push(rendered);
        drawInEffect(rendered);
      });
      layout();
    },
    drawIn(drawn, hand) {
      const replacements = drawn.map((block) => {
        const rendered = create(block);
        blocks.push(rendered);
        return rendered;
      });
      // Also closes the gap when the deck has run out and nothing was drawn.
      sync(hand);
      // Drawn left to right, one after another.
      replacements
        .sort((a, b) => a.handSlot! - b.handSlot!)
        .forEach((rendered, index) => drawInEffect(rendered, index * drawStagger, true));
    },
    settle(settled) {
      const cubes = new Set<THREE.Object3D>(settled.map(({ cube }) => cube));
      for (let index = appearing.length - 1; index >= 0; index--) {
        const entry = appearing[index];
        if (!cubes.has(entry.cube)) continue;
        entry.effect.finish();
        entry.edges.forEach((edge) => (edge.visible = true));
        appearing.splice(index, 1);
      }
    },
    selected(selection) {
      return blocks
        .filter(({ block }) => selection.has(block.id))
        .sort((a, b) => a.handSlot! - b.handSlot!);
    },
    slotAt(x) {
      const slot = Math.round(x / slotSpacing + (visibleSlots() - 1) / 2);
      return Math.max(0, Math.min(blocks.length - 1, slot));
    },
    updateDrawIns(delta) {
      for (let index = appearing.length - 1; index >= 0; index--) {
        const entry = appearing[index];
        // Not its turn yet: it stays invisible (the dissolve has not started).
        if (entry.wait && entry.wait > 0) {
          entry.wait -= delta;
          continue;
        }
        if (entry.sound) {
          entry.sound = false;
          playSfx("card.deal");
        }
        if (entry.effect.update(delta)) continue;
        entry.edges.forEach((edge) => (edge.visible = true));
        appearing.splice(index, 1);
      }
    },
    animate(time, delta, selection) {
      // Ease cubes toward their layout positions so reordering animates.
      const step = Math.min(1, delta * 14);
      for (const rendered of blocks) {
        if (isDragged(rendered) || rendered.handX === undefined) continue;
        rendered.cube.position.x += (rendered.handX - rendered.cube.position.x) * step;
      }
      // A selected hand cube lifts a little above the rest (#305), easing up and back down.
      for (const rendered of blocks) {
        if (isDragged(rendered)) continue;
        const target = rendered.baseY + (selection.has(rendered.block.id) ? selectedLift : 0);
        rendered.cube.position.y += (target - rendered.cube.position.y) * step;
      }
      // Hand cubes rock gently; a selected one eases into a quick, small vibration.
      for (const rendered of blocks) {
        if (!rendered.rock) continue;
        const rocked = stepRock(
          rendered.rock,
          rendered.rockState ?? { angle: time / 1000, excitement: 0 },
          selection.has(rendered.block.id),
          Math.min(delta, 0.1),
        );
        rendered.rockState = rocked.state;
        rendered.cube.rotation.z = rocked.angle;
      }
    },
    clear() {
      blocks.length = 0;
      appearing.length = 0;
    },
    dispose() {
      appearing.forEach(({ effect }) => effect.finish());
      appearing.length = 0;
    },
  };
}
