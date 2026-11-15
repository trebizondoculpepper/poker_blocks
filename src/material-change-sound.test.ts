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
    expect(committedSounds(facts)).toEqual([transitionSoundOf("steel")]);
  });

  it("commits nothing for a refused change (the card already has that material)", () => {
    const { run, facts } = runWith(createTransmogrifier("paper", "t1", 2));
    // Standard cards start as paper.
    expect(run.applyRackItem("t1", run.state.hand[0]!.id)).toBeNull();
    expect(facts).toEqual([]);
  });
});
