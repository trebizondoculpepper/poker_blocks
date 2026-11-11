import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "../cards";
import { blockResists } from "../block-trait-behaviours";
import { removeCardForRun } from "../card-ownership";
import { rematerial } from "../card-material";
import type { RuleCommand } from "../event-rules";
import "../game-run";
import type { GameState } from "../game-state";
import {
  getMaterialDefinition,
  withMaterial,
  type BlockMaterial,
  type MaterialDefinition,
} from "../materials";
import { addCardModifier } from "../modifier-registers";
import { triggerBlock } from "../triggers";
import type { Cell } from "./attachable";

// No material blasts yet: these tests lend wood a bomb's blast.
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
const lend = (responses: readonly RuleCommand[]) => (wood.triggerable = { responses });
afterEach(() => void delete wood.triggerable);
const blast: RuleCommand = {
  id: "destroy-targets",
  config: { select: { id: "face-neighbours", config: {} }, cause: "explosion", removal: "field" },
};

const made = (index: number, material: BlockMaterial): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material));
const at = (x: number, y = 0) => ({ x, y, z: 0 }) as Cell;
const table = (...placed: [CardBlock, Cell][]): GameState => ({
  field: placed.map(([block, cell]) => ({ block, cell })),
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});

describe("explosion resistance (#437)", () => {
  it("is composed into steel and gold only, and scoped to explosions", () => {
    expect(blockResists(made(0, "steel"), "explosion")).toBe(true);
    expect(blockResists(made(0, "gold"), "explosion")).toBe(true);
    expect(blockResists(made(0, "paper"), "explosion")).toBe(false);
    expect(blockResists(made(0, "steel"), "manual")).toBe(false);
  });

  it("a blast destroys its unprotected neighbours and leaves steel and gold standing, bonuses and all", () => {
    lend([blast]);
    const bomb = made(0, "wood");
    const [paper, steel, gold] = [made(1, "paper"), made(2, "steel"), made(3, "gold")];
    let start = table([bomb, at(1, 1)], [paper, at(0, 1)], [steel, at(2, 1)], [gold, at(1, 0)]);
    start = addCardModifier(start, steel.id, "run", { additive: 2 })!;
    const { state: after, events } = triggerBlock(start, { blockId: bomb.id, cause: "test" });
    const left = after.field.map(({ block }) => block.id);
    expect(left).not.toContain(paper.id);
    expect(left).toEqual(expect.arrayContaining([bomb.id, steel.id, gold.id]));
    const survivor = after.field.find(({ block }) => block.id === steel.id)!.block;
    expect(survivor.traits.identity).toEqual(steel.traits.identity);
    expect(survivor.traits.modifiers).toEqual({ run: { additive: 2 } });
    expect(
      events
        .filter(({ type }) => type === "block.resisted")
        .map(({ blockId }) => blockId ?? "")
        .toSorted((x, y) => x.localeCompare(y)),
    ).toEqual([steel.id, gold.id].toSorted((x, y) => x.localeCompare(y)));
    expect(events.find(({ type }) => type === "block.removed")).toMatchObject({
      blockId: paper.id,
      cause: "explosion",
    });
  });

  it("doesn't change other removals: the Nothingifier still removes steel", () => {
    const steel = made(2, "steel");
    const removed = removeCardForRun(table([steel, at(0)]), steel.id)!;
    expect(removed.field).toEqual([]);
    expect(removed.removedCards).toEqual([steel.id]);
  });

  it("goes with the material: steel turned to paper no longer resists", () => {
    const turned = rematerial(made(2, "steel"), "paper");
    expect(blockResists(turned, "explosion")).toBe(false);
  });
});
