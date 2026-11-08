import { describe, expect, it } from "vite-plus/test";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import {
  createPassiveBlock,
  PassiveEventQueue,
  passiveTraits,
  type PassiveBlock,
} from "./passives";
import { sandboxSessionConfig, demoSessionConfig } from "./session-config";
import { standardDeck } from "./cards";
import { inspectable } from "./traits/inspectable";

const block = (id: string, traitId: string): PassiveBlock => ({
  id,
  definitionId: "double-line",
  traits: { passive: { traitId }, inspectable: inspectable(id) },
});

describe("passive rack and events", () => {
  it("keeps an installed passive in state across plays", () => {
    const game = new GameSession(
      dealerRegistry,
      sandboxSessionConfig(demoSessionConfig),
      standardDeck,
      () => 0,
    );
    const passive = createPassiveBlock("double-line", "passive.1");
    expect(game.installPassive(passive)).toBe(true);
    expect(game.installPassive(passive)).toBe(false);
    expect(game.state.passiveRack).toEqual([passive]);
    const before = game.state.round;
    game.play({ cardId: game.state.hand[0].id });
    expect(game.state.passiveRack).toEqual([passive]);
    expect(game.state.round.movesLeft).toBe(before.movesLeft - 1);
  });

  it("delivers listeners in rack order, then queues their follow-up events", () => {
    const seen: string[] = [];
    passiveTraits.register("test.passive.left", {
      id: "test.passive.left",
      listensTo: ["play.completed", "bonus"],
      respond: (passive, event) => {
        seen.push(`${passive.id}:${event.type}`);
        return event.type === "play.completed" ? [{ type: "bonus" }] : [];
      },
    });
    passiveTraits.register("test.passive.right", {
      id: "test.passive.right",
      listensTo: ["play.completed"],
      respond: (passive, event) => {
        seen.push(`${passive.id}:${event.type}`);
        return [];
      },
    });
    const queue = new PassiveEventQueue();
    queue.syncRack([block("left", "test.passive.left"), block("right", "test.passive.right")]);
    queue.emit({ type: "play.completed", blockId: "A-spades" });
    expect(queue.drain().map(({ type }) => type)).toEqual(["play.completed", "bonus"]);
    expect(seen).toEqual(["left:play.completed", "right:play.completed", "left:bonus"]);
  });

  it("stops a cyclic event chain with the chain in the error", () => {
    passiveTraits.register("test.passive.loop", {
      id: "test.passive.loop",
      listensTo: ["loop"],
      respond: () => [{ type: "loop" }],
    });
    const queue = new PassiveEventQueue();
    queue.syncRack([block("loop", "test.passive.loop")]);
    queue.emit({ type: "loop" });
    expect(() => queue.drain(3)).toThrow(/Passive event limit exceeded: loop → loop/);
    expect(queue.drain()).toEqual([]);
  });
});
