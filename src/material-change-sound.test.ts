import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { getMaterialDefinition, materialDefinitions, transitionSoundOf } from "./materials";
import type { GameEvent } from "./passives";
import { demoRunRules } from "./run-rules";
import { committedSounds } from "./scene-traits/committed-event-sounds";
import { soundEffects } from "./audio/sfx-registry";
import { createTransmogrifier } from "./transmogrifiers";

function runWith(item: ReturnType<typeof createTransmogrifier>) {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  const run = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...game.snapshot(),
    state: { ...game.state, passiveRack: [item] },
  });
  const facts: GameEvent[] = [];
  run.onCommitted((batch) => facts.push(...batch.map(({ payload }) => payload as GameEvent)));
  return { run, facts };
}

describe("material-change sound (#539; doc/presentation-contracts.md)", () => {
  it("gives every material a registered transition sound: its own, or its attach sound", () => {
    const ids = new Set(soundEffects.map(({ id }) => id));
    for (const definition of materialDefinitions)
      expect(ids.has(transitionSoundOf(definition.id as never)), definition.id).toBe(true);
    expect(transitionSoundOf("steel")).toBe(getMaterialDefinition("steel").acoustics.attach);
  });

  it("commits one block.materialChanged with the target's sound when a transmogrifier changes a card", () => {
    const { run, facts } = runWith(createTransmogrifier("steel", "t1", 8));
    const card = run.state.hand[0]!;
    expect(run.applyRackItem("t1", card.id)).not.toBeNull();
    const changed = facts.filter(({ type }) => type === "block.materialChanged");
    expect(changed).toHaveLength(1);
    expect(changed[0]!.blockId).toBe(card.id);
    expect(changed[0]!.transition?.to.material).toBe("steel");
    // Both resolved states and both card snapshots are captured at commit.
    expect(changed[0]!.transition?.from.material).toBe("paper");
    expect(changed[0]!.snapshots?.before.id).toBe(card.id);
    expect(changed[0]!.snapshots?.after.traits.material?.kind).toBe("steel");
    // Its cue is the target's, for the scheduled response; nothing plays at commit.
    expect(changed[0]!.transitionSound).toBe(transitionSoundOf("steel"));
    expect(committedSounds(facts)).toEqual([]);
  });

  it("commits nothing for a refused change (the card already has that material)", () => {
    const { run, facts } = runWith(createTransmogrifier("paper", "t1", 2));
    // Standard cards start as paper.
    expect(run.applyRackItem("t1", run.state.hand[0]!.id)).toBeNull();
    expect(facts).toEqual([]);
  });
});

describe("transition audio response (#539)", async () => {
  const { createVisualScheduler } = await import("./visual-events/scheduler");
  const { materialChangeSounds } = await import("./scene-traits/material-change-sounds");
  const { applyReactions, commitReactions } = await import("./reactions");
  const { stateBonuses } = await import("./state-bonuses");

  function harness() {
    const played: string[] = [];
    const visualEvents = createVisualScheduler({
      services: { transitionAudio: { play: (id: string) => void played.push(id) } },
    });
    let publish: (facts: readonly { eventId: string; payload: unknown }[]) => void = () => {};
    const context = {
      services: {
        run: {
          onCommitted(listener: typeof publish) {
            publish = listener;
            return () => void (publish = () => {});
          },
        },
        visualEvents,
      },
    };
    const trait = materialChangeSounds<never>();
    const config = {};
    trait.enter!(context as never, config);
    let now = 0;
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) visualEvents.update((now += 16), true);
    };
    return {
      played,
      publish: (f: { eventId: string; payload: unknown }[]) => publish(f),
      run,
      exit: () => trait.exit!(context as never, config),
      reenter: () => {
        trait.exit!(context as never, config);
        trait.enter!(context as never, config);
      },
    };
  }

  it("plays each committed transition's sound once, on the scheduler", () => {
    const h = harness();
    const fact = {
      eventId: "a:1",
      payload: { type: "block.materialChanged", transitionSound: "material.attach.steel" },
    };
    h.publish([fact]);
    expect(h.played).toEqual([]);
    h.run(3);
    expect(h.played).toEqual(["material.attach.steel"]);
    // Redelivered: nothing more.
    h.publish([fact]);
    h.run(3);
    expect(h.played).toHaveLength(1);
  });

  it("hears a new run's transitions after re-entry, though their event IDs repeat", () => {
    const h = harness();
    const fact = {
      eventId: "auto:1:1",
      payload: { type: "block.materialChanged", transitionSound: "material.attach.steel" },
    };
    h.publish([fact]);
    h.run(3);
    h.reenter();
    h.publish([fact]);
    h.run(3);
    expect(h.played).toEqual(["material.attach.steel", "material.attach.steel"]);
  });

  it("cancels what has not played when the scene exits", () => {
    const h = harness();
    h.publish([
      {
        eventId: "b:1",
        payload: { type: "block.materialChanged", transitionSound: "reaction.boil" },
      },
    ]);
    h.exit();
    h.run(5);
    expect(h.played).toEqual([]);
  });

  it("forwards a reaction's material transition fact, with the target's cue and none on the reaction", () => {
    // Ice beside a heat source melts to Water: the materials' own reaction (src/materials.ts).
    const ice = withMaterialCard("ice", 0);
    const fire = withMaterialCard("fire", 1);
    const facts: GameEvent[] = [];
    let state = {
      ...emptyField(),
      field: [
        { block: ice, cell: { x: 0, y: 0, z: 0 } },
        { block: fire, cell: { x: 1, y: 0, z: 0 } },
      ],
    };
    const target = {
      get state() {
        return state;
      },
      update: (next: typeof state) => void (state = next),
      grantUnownedPassive: () => [],
    };
    const applied = commitReactions(target as never, undefined, facts);
    // The reaction itself carries no cue for the transition: the response plays the target's.
    expect(applied.find(({ blockId }) => blockId === standardDeck[0]!.id)?.sound).toBeUndefined();
    const changed = facts.find(({ type }) => type === "block.materialChanged");
    expect(changed?.transitionSound).toBe(transitionSoundOf("water"));
    void applyReactions;
  });

  it("treats becoming Hot or Boiling Water as a transition with its own cue", () => {
    expect(stateBonuses.get("heated").transitionSound).toBe("reaction.heat");
    expect(stateBonuses.get("boiled").transitionSound).toBe("reaction.boil");
    expect(stateBonuses.get("aggressive").transitionSound).toBeUndefined();
  });
});

function withMaterialCard(material: string, index: number) {
  return {
    ...standardDeck[index]!,
    traits: { ...standardDeck[index]!.traits, material: { kind: material } },
  } as never;
}
function emptyField() {
  return {
    field: [],
    hand: [],
    deck: [],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
  } as never as { field: { block: unknown; cell: unknown }[] };
}
