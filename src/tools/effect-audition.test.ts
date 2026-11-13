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
    const { devEffectAudition } = await import("./effect-audition");
    const appended: { remove(): void; removed?: boolean }[] = [];
    const host = {
      append: (node: { remove(): void }) => appended.push(node),
    } as unknown as HTMLElement;
    const element = {
      remove() {
        this.removed = true;
      },
      removed: false,
    } as { remove(): void; removed: boolean; className?: string; textContent?: string };
    (globalThis as { document?: unknown }).document ??= { createElement: () => element };
    const trait = devEffectAudition<{ host: HTMLElement }>();
    trait.enter!({ host }, { hint: "note" });
    expect(appended).toHaveLength(1);
    trait.exit!({ host }, { hint: "note" });
    expect((appended[0] as { removed?: boolean }).removed).toBe(true);
  });
});
