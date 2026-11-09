import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { handCameraPortraitHalfWidth } from "./camera-view";
import { createHandView, type HandDrag } from "./hand-view";
import type { BlockViews, RenderedBlock } from "./rendered-blocks";

/** Block views without textures: a plain cube per block, enough for layout. */
function fakeViews(): BlockViews {
  const all: RenderedBlock[] = [];
  return {
    all,
    create(block, _size, location) {
      const cube = new THREE.Mesh();
      const rendered = {
        block,
        cube,
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

function setup(handSize = 5) {
  let drag: HandDrag | null = null;
  let layouts = 0;
  const scene = new THREE.Scene();
  const hand = createHandView({
    views: fakeViews(),
    scene,
    cubeSize: 2.4,
    baseY: () => -2,
    handSize: () => handSize,
    reducedMotion: () => true,
    drag: () => drag,
    onLayout: () => layouts++,
  });
  return {
    hand,
    scene,
    setDrag: (next: HandDrag | null) => (drag = next),
    layouts: () => layouts,
  };
}

const cards: readonly CardBlock[] = standardDeck.slice(0, 5);
const xOf = (rendered: RenderedBlock) => rendered.handX!;

describe("hand view", () => {
  it("lays cards out in hand order, centred on the dealer's hand size", () => {
    const { hand, layouts } = setup();
    for (const card of cards) hand.add(card);
    hand.sync([...cards].reverse());
    const bySlot = [...hand.blocks].sort((a, b) => a.handSlot! - b.handSlot!);
    expect(bySlot.map(({ block }) => block)).toEqual([...cards].reverse());
    expect(bySlot.map(xOf)).toEqual([-2.4, -1.2, 0, 1.2, 2.4]);
    expect(bySlot.every(({ cube }) => cube.position.y === -2)).toBe(true);
    expect(layouts()).toBe(1);
  });

  it("centres six blocks within portrait camera bounds, even when rotated", () => {
    const { hand } = setup(6);
    const sixCards = standardDeck.slice(0, 6);
    for (const card of sixCards) hand.add(card);
    hand.sync(sixCards);
    const bySlot = [...hand.blocks].sort((a, b) => a.handSlot! - b.handSlot!);
    for (const [index, x] of [-3, -1.8, -0.6, 0.6, 1.8, 3].entries())
      expect(xOf(bySlot[index])).toBeCloseTo(x);
    // A rotating 0.8-unit cube can reach its half diagonal beyond its slot centre.
    const halfDiagonal = (Math.SQRT2 * (2.4 / 3)) / 2;
    expect(Math.max(...bySlot.map((block) => Math.abs(xOf(block)) + halfDiagonal))).toBeLessThan(
      handCameraPortraitHalfWidth,
    );
  });

  it("opens a gap where a dragged card would drop, without moving the dragged card", () => {
    const { hand, setDrag } = setup();
    for (const card of cards) hand.add(card);
    hand.sync(cards);
    const [first] = [...hand.blocks].sort((a, b) => a.handSlot! - b.handSlot!);
    first.cube.position.set(9, 9, 9);
    setDrag({ source: first, group: [], reorderSlot: 3 });
    hand.layout();
    expect(first.handX).toBe(1.2);
    expect(first.cube.position.toArray()).toEqual([9, 9, 9]);
  });

  it("finds the slot under a point and clamps it to the cards held", () => {
    const { hand } = setup();
    for (const card of cards.slice(0, 3)) hand.add(card);
    hand.sync(cards.slice(0, 3));
    expect(hand.slotAt(-2.4)).toBe(0);
    expect(hand.slotAt(0.1)).toBe(2);
    expect(hand.slotAt(99)).toBe(2);
  });

  it("returns the selected cards in hand order and forgets removed ones", () => {
    const { hand } = setup();
    for (const card of cards) hand.add(card);
    hand.sync(cards);
    const selection = new Set([cards[3].id, cards[1].id]);
    expect(hand.selected(selection).map(({ block }) => block)).toEqual([cards[1], cards[3]]);
    hand.remove(hand.selected(selection));
    expect(hand.blocks.map(({ block }) => block)).toEqual([cards[0], cards[2], cards[4]]);
  });

  it("puts dragged cubes back in the hand scene on the hand's plane", () => {
    const { hand, scene } = setup();
    const rendered = hand.add(cards[0]);
    new THREE.Scene().add(rendered.cube);
    rendered.cube.position.z = 4;
    hand.putBack([rendered]);
    expect(rendered.cube.parent).toBe(scene);
    expect(rendered.cube.position.z).toBe(0);
  });
});
