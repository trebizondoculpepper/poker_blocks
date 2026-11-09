import { describe, expect, it } from "vite-plus/test";
import {
  RunTransformerRegistry,
  type RunPrepareContext,
  type RunTransformerBehaviour,
} from "./run-config";
import { demoSessionConfig } from "./session-config";
import { standardDeck } from "./cards";
import { makeDevDeck, materialOf } from "./materials";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";

type Services = { calls: string[] };

function context(): RunPrepareContext<Services> {
  return { config: demoSessionConfig, deck: standardDeck, services: { calls: [] } };
}

describe("ordered run transformers", () => {
  it("type-checks each behavior against its transformer configuration", () => {
    const registry = new RunTransformerRegistry<Services>();
    const invalidDeckBehaviour: RunTransformerBehaviour<Services, { coins: number }> = {};
    const invalidRegistration = () => {
      // @ts-expect-error materialDeck handlers receive the reshuffle configuration
      registry.register("materialDeck", invalidDeckBehaviour);
    };
    expect(invalidRegistration).toBeTypeOf("function");
  });

  it("composes prepare and start behavior in declared order", () => {
    const registry = new RunTransformerRegistry<Services>();
    registry.register("sandbox", {
      prepare(current) {
        current.services.calls.push("sandbox.prepare");
        return current;
      },
      start(current) {
        current.services.calls.push("sandbox.start");
        return current;
      },
    });
    registry.register("materialSample", {
      prepare(current) {
        current.services.calls.push("sample.prepare");
        return current;
      },
      start(current) {
        current.services.calls.push("sample.start");
        return current;
      },
    });
    const transformers = [{ type: "sandbox" }, { type: "materialSample" }] as const;
    const prepared = registry.prepare(transformers, context());
    const snapshot = new GameSession(
      dealerRegistry,
      prepared.config,
      prepared.deck,
      () => 0,
    ).snapshot();
    registry.start(transformers, { ...prepared, snapshot });

    expect(prepared.services.calls).toEqual([
      "sandbox.prepare",
      "sample.prepare",
      "sandbox.start",
      "sample.start",
    ]);
  });

  it("restores saved material cards and run state without re-running transformers", () => {
    const registry = new RunTransformerRegistry<Services>();
    const calls: string[] = [];
    registry.register("materialDeck", {
      prepare(current) {
        calls.push("fresh-deck");
        return current;
      },
    });
    const original = new GameSession(dealerRegistry, demoSessionConfig, makeDevDeck(4201), () => 0);
    const saved = original.snapshot();
    const restored = GameSession.fromSnapshot(
      dealerRegistry,
      demoSessionConfig,
      standardDeck,
      saved,
      () => 0,
    );

    expect(restored.snapshot()).toEqual(saved);
    expect(restored.state.hand.map(materialOf)).toEqual(saved.state.hand.map(materialOf));
    expect(restored.state.deck.map(materialOf)).toEqual(saved.state.deck.map(materialOf));
    expect(restored.phase).toBe(saved.phase);
    expect(calls).toEqual([]);
  });
});
