import { buildScenario, ScenarioError } from "./dev-scenario";
import { dealerRegistry } from "./dealer";
/**
 * The behaviour of each run setup step (see src/run-setup.ts and doc/game-architecture.md,
 * "Run setup"). Modes declare steps as data; this is the only place a step's meaning lives, so
 * no shared code has to name one. `shopOffers` is read when a `shopPreview` step stocks the
 * shop; it is a getter because the developer console can switch modes while the game runs.
 */
import type { ShopTrait } from "./game-modes";
import type { GameState } from "./game-state";
import { sampleMaterials } from "./material-sampler";
import { createPassiveBlock, randomPassiveDefinitions, type PassiveBlock } from "./passives";
import { sandboxRunRules } from "./run-rules";
import { RunSetupRegistry } from "./run-setup";
import { shopPreviewState } from "./shop-stock";
import { withDevDestructibleMix } from "./traits/destructible";
import { buildDeck } from "./deck-builder";

export function createRunSetupRegistry(
  shopOffers: () => ShopTrait | undefined = () => undefined,
): RunSetupRegistry {
  const registry = new RunSetupRegistry();

  registry.register("sandbox", {
    policy: (rules) => sandboxRunRules(rules),
  });

  registry.register("materialDeck", {
    requiresSavedSeed: true,
    // A new run deals from a fresh seed, which it records; Continue passes that seed back,
    // so a resumed run gets the same mix.
    deck: (context, { pool }, services) => {
      const seed = context.seed ?? services.newSeed();
      // The balanced builder: the same deck `makeDevDeck` dealt for this seed (#827).
      const deck = buildDeck(
        [{ operation: "standardTemplates" }, { operation: "assignBalanced", config: { pool } }],
        seed,
      );
      return { deck, seed };
    },
  });

  registry.register("uniformMaterialDeck", {
    // No randomness: the seed only satisfies the builder's signature and is not recorded.
    deck: (context, { material }) => ({
      deck: buildDeck(
        [{ operation: "standardTemplates" }, { operation: "assignUniform", config: { material } }],
        0,
      ),
      seed: context.seed,
    }),
  });

  registry.register("deckBuilder", {
    requiresSavedSeed: true,
    // A mode's own ordered builder operations, from a fresh recorded seed. Continue passes back
    // the saved seed and recipe, so an edit to the mode can't change a saved run's cards. One
    // builder per setup: a second would silently replace the first's cards (#848 review).
    deck: (context, { operations }, services) => {
      if (context.recipe) throw new Error("a run setup composes at most one deckBuilder step");
      const seed = context.seed ?? services.newSeed();
      const recipe = context.savedRecipe ?? operations;
      return { ...context, deck: buildDeck(recipe, seed), seed, recipe };
    },
  });

  registry.register("destructibleMix", {
    // Testing only: a deck decision, so it contributes in the deck pass rather than the
    // controller applying a mix to a deck behind the registry's back.
    // A decorator: it changes the cards and keeps everything else, the seed and recipe included.
    deck: (context, mix) => ({ ...context, deck: withDevDestructibleMix(context.deck, mix) }),
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
        state: shopPreviewState(
          context.snapshot.state,
          coins,
          services.random,
          shopOffers(),
          context.snapshot.round,
        ),
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

  // A Dev scenario trial (#901; doc/experiments/trial-session-adoption.md): built and validated
  // off to the side, then handed on whole, with its own stream and provenance, for adoption. An
  // invalid scenario throws its diagnostics; nothing is adopted.
  registry.register("devScenario", {
    start: (context, { scenario, trialId }) => {
      const result = buildScenario(scenario, { dealers: dealerRegistry, rules: context.rules });
      if (!result.ok) throw new ScenarioError(result.diagnostics.join("\n"));
      const { session, run, initialSnapshot, actionLog } = result.trial;
      return {
        ...context,
        snapshot: run.snapshot(),
        prepared: {
          ...session,
          run,
          provenance: {
            trialId: trialId ?? `trial-${scenario.seed}`,
            scenarioVersion: scenario.version,
            seed: scenario.seed,
            initialSnapshot,
            actionLog,
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
