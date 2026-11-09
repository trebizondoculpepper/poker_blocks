/**
 * The behaviour of each run setup step (see src/run-setup.ts and doc/game-architecture.md,
 * "Run setup"). Modes declare steps as data; this is the only place a step's meaning lives, so
 * no shared code has to name one. `shopOffers` is read when a `shopPreview` step stocks the
 * shop; it is a getter because the developer console can switch modes while the game runs.
 */
import type { ShopTrait } from "./game-modes";
import type { GameState } from "./game-state";
import { sampleMaterials } from "./material-sampler";
import { makeDevDeck } from "./materials";
import { createPassiveBlock, randomPassiveDefinitions, type PassiveBlock } from "./passives";
import { sandboxRunRules } from "./run-rules";
import { RunSetupRegistry } from "./run-setup";
import { shopPreviewState } from "./shop-stock";
import { withDevDestructibleMix } from "./traits/destructible";

export function createRunSetupRegistry(
  shopOffers: () => Pick<ShopTrait, "passiveOffers" | "cardOffers"> | undefined = () => undefined,
): RunSetupRegistry {
  const registry = new RunSetupRegistry();

  registry.register("sandbox", {
    policy: (rules) => sandboxRunRules(rules),
  });

  registry.register("materialDeck", {
    // A new run deals from a fresh seed, which it records; Continue passes that seed back,
    // so a resumed run gets the same mix.
    deck: (context, _config, services) => {
      const seed = context.seed ?? services.newSeed();
      return { deck: makeDevDeck(seed), seed };
    },
  });

  registry.register("destructibleMix", {
    // Testing only: a deck decision, so it contributes in the deck pass rather than the
    // controller applying a mix to a deck behind the registry's back.
    deck: (context, mix) => ({
      deck: withDevDestructibleMix(context.deck, mix),
      seed: context.seed,
    }),
  });

  registry.register("materialSample", {
    start: (context, _config, services) => {
      const { state } = context.snapshot;
      const sample = sampleMaterials(state.deck, services.random);
      return {
        ...context,
        snapshot: {
          ...context.snapshot,
          state: { ...state, field: sample.field, deck: sample.deck },
        },
      };
    },
  });

  registry.register("shopPreview", {
    start: (context, { coins }, services) => ({
      ...context,
      snapshot: {
        ...context.snapshot,
        phase: "shop",
        state: shopPreviewState(context.snapshot.state, coins, services.random, shopOffers()),
      },
    }),
  });

  registry.register("startingPassives", {
    // The rack belongs to the run, so the passives it starts with are part of its snapshot.
    start: (context, { count }, services) => {
      const { state } = context.snapshot;
      // A mode cannot overfill its own rack, whatever it declares.
      const capacity = context.rules.rackCapacity ?? Infinity;
      const room = Math.max(0, capacity - state.passiveRack.length);
      return {
        ...context,
        snapshot: {
          ...context.snapshot,
          state: {
            ...state,
            passiveRack: [
              ...state.passiveRack,
              ...openingPassives(Math.min(count, room), state, services),
            ],
          },
        },
      };
    },
  });

  return registry;
}

/** Up to `count` passives the run does not already own, with rack-unique ids. */
function openingPassives(
  count: number,
  state: GameState,
  services: { random: () => number },
): PassiveBlock[] {
  const owned = state.passiveRack.map(({ definitionId }) => definitionId);
  const used = new Set(state.passiveRack.map(({ id }) => id));
  return randomPassiveDefinitions(count, services.random, owned).map((definition) => {
    let serial = used.size + 1;
    while (used.has(`passive.${serial}`)) serial++;
    used.add(`passive.${serial}`);
    return createPassiveBlock(definition.id, `passive.${serial}`);
  });
}
