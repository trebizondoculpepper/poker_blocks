/**
 * The behaviour of each run setup step (see src/run-setup.ts and doc/game-architecture.md,
 * "Run setup"). Modes declare steps as data; this is the only place a step's meaning lives.
 */
import type { ShopTrait } from "./game-modes";
import type { GameState } from "./game-state";
import { sampleMaterials } from "./material-sampler";
import { makeDevDeck } from "./materials";
import { createPassiveBlock, randomPassiveDefinitions, type PassiveBlock } from "./passives";
import { sandboxRunRules } from "./run-rules";
import { RunSetupRegistry, type RunSetupServices } from "./run-setup";
import { shopPreviewState } from "./shop-stock";
import { withDevDestructibleMix } from "./traits/destructible";

/**
 * Every run setup step, registered against its own config type. `shopOffers` is read when a
 * `shopPreview` step stocks the shop. It is a getter because the developer console can
 * switch modes while the game is running, so the offers are the current mode's, not the
 * ones the registry was built with. A run whose mode has no shop trait offers nothing.
 */
export function createRunSetupRegistry(
  shopOffers: () => Pick<ShopTrait, "passiveOffers" | "cardOffers"> | undefined = () => undefined,
): RunSetupRegistry {
  const registry = new RunSetupRegistry();

  registry.register("sandbox", {
    prepare: (context) => ({ ...context, rules: sandboxRunRules(context.rules) }),
  });

  registry.register("materialDeck", {
    prepare: (context, { reshuffle }, services) => {
      const seed = reshuffle === "each-run" ? randomSeed(services) : services.keptSeed();
      return { ...context, deck: makeDevDeck(seed), seed };
    },
    start: (context) => ({
      ...context,
      snapshot: { ...context.snapshot, seed: context.prepare.seed },
    }),
  });

  registry.register("destructibleMix", {
    // Testing only. Choosing the deck is run setup, so this belongs with the other deck
    // steps: after the deck exists, and before the sample is taken from it.
    prepare: (context, mix) => ({ ...context, deck: withDevDestructibleMix(context.deck, mix) }),
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
      const capacity = context.prepare.rules.rackCapacity ?? Infinity;
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
  services: RunSetupServices,
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

function randomSeed(services: RunSetupServices): number {
  return Math.floor(services.random() * 4294967296);
}
