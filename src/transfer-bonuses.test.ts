import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { RuleCommand } from "./event-rules";
import "./game-run";
import type { GameState } from "./game-state";
import {
  getMaterialDefinition,
  withMaterial,
  type BlockMaterial,
  type MaterialDefinition,
} from "./materials";
import { addCardModifier } from "./modifier-registers";
import { triggerBlock } from "./triggers";
import type { Cell } from "./traits/attachable";

// No material passes bonuses on yet: these tests lend wood the responses.
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
const lend = (responses: readonly RuleCommand[]) => (wood.triggerable = { responses });
afterEach(() => void delete wood.triggerable);
const neighbours = { id: "face-neighbours", config: {} };
const transfer = (extra: object = {}): RuleCommand => ({
  id: "transfer-bonuses",
  config: { select: neighbours, lifetime: "run", ...extra },
});

const made = (index: number, material: BlockMaterial): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material));
const at = (x: number) => ({ x, y: 0, z: 0 }) as Cell;
const table = (...blocks: CardBlock[]): GameState => ({
  field: blocks.map((block, x) => ({ block, cell: at(x) })),
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});
const blockIn = (state: GameState, id: string) =>
  state.field.find(({ block }) => block.id === id)?.block;

describe("bonus transfer (#436)", () => {
  it("passes the source's acquired bonuses, combined and promoted, to each recipient's run register", () => {
    lend([transfer()]);
    const [left, bomb, right] = [made(0, "paper"), made(1, "wood"), made(2, "steel")];
    let start = table(left, bomb, right);
    start = addCardModifier(start, bomb.id, "stage", { additive: 2, exponential: 1.1 })!;
    start = addCardModifier(start, bomb.id, "round", { additive: 1, multiplicative: 2 })!;
    start = addCardModifier(start, bomb.id, "run", { multiplicative: 3, exponential: 1.2 })!;
    start = addCardModifier(start, right.id, "run", { additive: 1 })!;
    const { state: after, events } = triggerBlock(start, { blockId: bomb.id, cause: "test" });
    const expected = (base: object) => ({ run: expect.objectContaining(base) });
    expect(blockIn(after, left.id)!.traits.modifiers).toEqual(
      expected({ additive: 3, multiplicative: 6 }),
    );
    expect(blockIn(after, left.id)!.traits.modifiers!.run!.exponential).toBeCloseTo(1.3);
    // The recipient's own bonus combines with what it receives.
    expect(blockIn(after, right.id)!.traits.modifiers!.run).toMatchObject({
      additive: 4,
      multiplicative: 6,
    });
    expect(after.cardStates?.[left.id]?.modifiers).toEqual(
      blockIn(after, left.id)!.traits.modifiers,
    );
    expect(
      events.filter(({ type }) => type === "bonus.transferred").map(({ blockId }) => blockId),
    ).toEqual([left.id, right.id]);
  });

  it("never passes the source material's own values", () => {
    lend([transfer()]);
    const magicSource = made(1, "magic");
    // Lend magic the same responses: its own +1 ×2 ^1.2 must not move.
    const magic = getMaterialDefinition("magic") as Lendable;
    magic.triggerable = wood.triggerable;
    const left = made(0, "paper");
    const { state: after, events } = triggerBlock(table(left, magicSource), {
      blockId: magicSource.id,
      cause: "test",
    });
    delete magic.triggerable;
    expect(blockIn(after, left.id)!.traits.modifiers).toBeUndefined();
    expect(events.filter(({ type }) => type === "bonus.transferred")).toEqual([]);
  });

  it("passes only the registers it is configured to take", () => {
    lend([transfer({ from: ["round"] })]);
    const [left, bomb] = [made(0, "paper"), made(1, "wood")];
    let start = table(left, bomb);
    start = addCardModifier(start, bomb.id, "stage", { additive: 5 })!;
    start = addCardModifier(start, bomb.id, "round", { additive: 1 })!;
    const { state: after } = triggerBlock(start, { blockId: bomb.id, cause: "test" });
    expect(blockIn(after, left.id)!.traits.modifiers).toEqual({ run: { additive: 1 } });
  });

  it("still passes what it had after removing itself, from the trigger's snapshot", () => {
    lend([{ id: "self-destruct", config: { removal: "field" } }, transfer()]);
    const [left, bomb] = [made(0, "paper"), made(1, "wood")];
    const start = addCardModifier(table(left, bomb), bomb.id, "run", { additive: 2 })!;
    const { state: after } = triggerBlock(start, { blockId: bomb.id, cause: "test" });
    expect(blockIn(after, bomb.id)).toBeUndefined();
    expect(blockIn(after, left.id)!.traits.modifiers).toEqual({ run: { additive: 2 } });
  });

  it("does nothing when the source has no acquired bonuses", () => {
    lend([transfer()]);
    const [left, bomb] = [made(0, "paper"), made(1, "wood")];
    const start = table(left, bomb);
    const { state: after, events } = triggerBlock(start, { blockId: bomb.id, cause: "test" });
    expect(after).toEqual(start);
    expect(events.map(({ type }) => type)).toEqual(["block.triggered"]);
  });
});
