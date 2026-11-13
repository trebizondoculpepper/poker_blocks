import { describe, expect, it } from "vite-plus/test";
import { gameModeRegistry } from "../game-modes";
import {
  experimentalMaterials,
  getMaterialDefinition,
  materialDefinitions,
  materialOf,
  type MaterialDefinition,
} from "../materials";
import { createRunSetupRegistry } from "../run-setup-behaviours";

const definition = (id: string) => getMaterialDefinition(id as never);

describe("smoke and dust audition (#466)", () => {
  it("derives provisional audition looks that keep their parents' gameplay", () => {
    for (const [audition, parent, effect] of [
      ["fireSmokeAudition", "fire", "smoke"],
      ["earthDustAudition", "earth", "dust"],
    ] as const) {
      const look = definition(audition);
      const base = definition(parent);
      expect(look.releaseStatus).toEqual({ provisional: {} });
      expect(look.reactions).toEqual(base.reactions);
      expect(look.scoringModifier).toEqual(base.scoringModifier);
      expect(look.materialFamily).toBe(base.materialFamily);
      expect(look.mass).toEqual(base.mass);
      expect(look.appearance.effects?.map(({ effect: name }) => name)).toContain(effect);
      // The production look is untouched.
      expect((base.appearance.effects ?? []).map(({ effect: name }) => name)).not.toContain(effect);
    }
    expect(experimentalMaterials.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["fireSmokeAudition", "earthDustAudition"]),
    );
    expect(
      (materialDefinitions as readonly MaterialDefinition[]).map(({ id }) => id),
    ).not.toContain("fireSmokeAudition");
  });

  it("deals dev19 only the audition looks, both of them", () => {
    if (!gameModeRegistry.has("dev19")) return; // developer modes exist in development builds only
    const mode = gameModeRegistry.get("dev19");
    const registry = createRunSetupRegistry();
    const deck = registry.deck(mode.runSetup, { deck: [] }, { newSeed: () => 7 } as never).deck;
    const materials = new Set(deck.map(materialOf));
    expect(materials).toEqual(new Set(["fireSmokeAudition", "earthDustAudition"]));
    expect(deck).toHaveLength(52);
  });

  it("shows its note while the scene is up and removes it on exit", async () => {
    const { createEffectAuditionNote } = await import("./effect-audition");
    const appended: { removed?: boolean }[] = [];
    const host = {
      append: (node: { removed?: boolean }) => appended.push(node),
    } as unknown as HTMLElement;
    const make = () => ({
      removed: false,
      remove() {
        this.removed = true;
      },
    });
    (globalThis as { document?: unknown }).document ??= { createElement: make };
    const note = createEffectAuditionNote(host);
    note.show({ hint: "note" });
    expect(appended).toHaveLength(1);
    note.hide();
    expect(appended[0]!.removed).toBe(true);
  });

  it("reacts as its parent substance: Earth audition beside fire audition bakes (#856 review)", async () => {
    const { applyReactions } = await import("../reactions");
    const { standardDeck } = await import("../cards");
    const { withMaterial } = await import("../materials");
    const earth = withMaterial(
      standardDeck[0]!,
      getMaterialDefinition("earthDustAudition" as never),
    );
    const fire = withMaterial(
      standardDeck[1]!,
      getMaterialDefinition("fireSmokeAudition" as never),
    );
    const state = {
      field: [
        { block: earth, cell: { x: 0, y: 0, z: 0 } },
        { block: fire, cell: { x: 1, y: 0, z: 0 } },
      ],
      hand: [],
      deck: [],
      discardPile: [],
      passiveRack: [],
      coins: 0,
      round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    };
    const reacted = applyReactions(state as never).state;
    const baked = reacted.field.find(({ block }) => block.id === earth.id)!.block;
    expect(materialOf(baked)).toBe("terracotta");
  });
});
