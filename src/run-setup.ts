import type { GameRun } from "./game-run";
import type { ReplayCommand, ScenarioDefinition, ScenarioSession } from "./dev-scenario";
import type { DeckBuilderStep } from "./deck-builder";
/**
 * Run setup: the ordered steps a game mode applies when a game run is created.
 *
 * A step is plain data (`{ step: "sandbox" }`), and its behaviour lives in `RunSetupRegistry`,
 * type-checked against that step's own config. Steps compose in declaration order through four
 * passes, and shared code asks for a pass rather than naming a step:
 *
 * - `policy` — rules the mode always plays under, on a new run and a resumed one alike.
 * - `deck` — the deck a run is played with, dealt fresh or rebuilt from a saved seed.
 * - `start` — what a new run begins holding, once its opening snapshot exists.
 *
 * Run setup applies to a new game run; Continue restores the saved run. The `policy` and `deck`
 * passes are the exception, because those are properties of the run rather than of the deal.
 */
import type { BlockMaterial } from "./materials";
import type { CardBlock } from "./cards";
import type { RunSnapshot } from "./game-run";
import type { RunRules } from "./run-rules";
import type { DevDestructibleMix } from "./traits/destructible";

/** The configuration each run setup step takes. A step with no options takes `{}`. */
export type RunSetupStepConfigs = {
  /** Endless play: unlimited plays and discards, a stage cannot be won or lost by itself. */
  sandbox: Record<never, never>;
  /**
   * Every card gets a random material, dealt from a fresh seed that the run records, so
   * Continue rebuilds the same mix and a new run gets a new one.
   */
  materialDeck: {
    /** The `materialPools` entry to deal from: `gameplay` (the default) or `registered`. */
    pool?: string;
  };
  /** Every card is made of this one material: how a mode shows a visual experiment (#227). */
  uniformMaterialDeck: { material: BlockMaterial };
  /** A mode's own starting deck: ordered deck-builder operations (doc/deck-builders.md, #827). */
  deckBuilder: { operations: readonly DeckBuilderStep[] };
  /**
   * A Dev scenario (#901): prepares a trial session from a scenario definition, off to the side,
   * through buildScenario. The composed mode or controller supplies the definition.
   */
  devScenario: {
    scenario: ScenarioDefinition;
    /** A fresh ID the requesting controller allocated: same-seed trials still differ. */
    trialId: string;
  };
  /** The run begins on a structure holding one block of every material. */
  materialSample: Record<never, never>;
  /** Testing only: about `share` of the deck is destructible by the given causes. */
  destructibleMix: DevDestructibleMix;
  /** The run begins in the shop with this many coins, for shop development. */
  shopPreview: { coins: number };
  /** The passive rack begins holding this many passives (clamped to the rack's capacity). */
  startingPassives: { count: number };
};

/** One ordered run setup step, as a mode declares it. */
export type RunSetupStep = {
  [Name in keyof RunSetupStepConfigs]: { step: Name } & RunSetupStepConfigs[Name];
}[keyof RunSetupStepConfigs];

/**
 * A run's deck and the seed it was dealt from. `seed` is absent for a run whose deck does not
 * depend on one; a `deck` pass that deals a deck sets it so the run can record it.
 */
export type RunDeck = {
  deck: readonly CardBlock[];
  seed?: number;
  /**
   * The deck-builder operations a `deckBuilder` step dealt from (#827). Saved with the run, so
   * Continue rebuilds from these rather than from a mode configuration edited since.
   */
  recipe?: readonly DeckBuilderStep[];
  /** A saved run's recipe, passed back on Continue: restoration input, never another step's output. */
  savedRecipe?: readonly DeckBuilderStep[];
};

/** What a `start` pass hands to the next step: the run's rules, its deck and its snapshot. */
export type RunStartContext = {
  rules: RunRules;
  deck: RunDeck;
  snapshot: RunSnapshot;
  /**
   * A prepared session a step built off to the side (#901;
   * doc/experiments/trial-session-adoption.md): its run, rules, identity universe, own random
   * stream and provenance, to be adopted together. Not flattened to the snapshot alone.
   */
  prepared?: PreparedSession;
};

/** A prepared trial session and its provenance, as a setup step hands it to the adopting host. */
export type PreparedSession = ScenarioSession & {
  run: GameRun;
  provenance: {
    trialId: string;
    scenarioVersion: number;
    seed: number;
    /** The hydrated starting state: configured fixture state. */
    initialSnapshot: RunSnapshot;
    /** The ordinary commands replayed after it: effects caused by actions. */
    actionLog: readonly ReplayCommand[];
  };
};

/**
 * What a step's behaviour may read beyond its config. `random` and `newSeed` are injected so a
 * test can pin the material mix and the shop's stock.
 */
export type RunSetupServices = {
  /** The deck the run would have without a material step. */
  standardDeck: readonly CardBlock[];
  /** A fresh seed for a deck this step deals. */
  newSeed(): number;
  random: () => number;
};

export type RunSetupBehaviour<Config extends object> = {
  /** This step cannot reconstruct a saved deck without its original seed. */
  requiresSavedSeed?: boolean;
  policy?(rules: RunRules, config: Config, services: RunSetupServices): RunRules;
  deck?(context: RunDeck, config: Config, services: RunSetupServices): RunDeck;
  start?(context: RunStartContext, config: Config, services: RunSetupServices): RunStartContext;
};

/** Type-checked registry: each step name is paired with its own config type. */
export class RunSetupRegistry {
  private readonly behaviours = new Map<string, RunSetupBehaviour<object>>();

  register<Name extends keyof RunSetupStepConfigs>(
    name: Name,
    behaviour: RunSetupBehaviour<RunSetupStepConfigs[Name]>,
  ): void {
    if (this.behaviours.has(name))
      throw new Error(`Run setup step "${name}" is already registered`);
    this.behaviours.set(name, behaviour as RunSetupBehaviour<object>);
  }

  has(name: string): boolean {
    return this.behaviours.has(name);
  }

  /** Whether the mode's saved deck needs a seed to preserve card identities. */
  requiresSavedSeed(steps: readonly RunSetupStep[]): boolean {
    return steps.some((step) => this.get(step.step).requiresSavedSeed === true);
  }

  /** The rules every run in this mode plays under, new or resumed. */
  policy(steps: readonly RunSetupStep[], rules: RunRules, services: RunSetupServices): RunRules {
    return this.pass("policy", steps, rules, services);
  }

  /**
   * The deck a run is played with. Pass a `seed` to rebuild a saved run's deck; leave it out to
   * deal a new one, and each step that deals a deck chooses a fresh seed and records it.
   */
  deck(steps: readonly RunSetupStep[], context: RunDeck, services: RunSetupServices): RunDeck {
    return this.pass("deck", steps, context, services);
  }

  /** The opening snapshot of a new run, after its deck is decided. */
  start(
    steps: readonly RunSetupStep[],
    context: RunStartContext,
    services: RunSetupServices,
  ): RunStartContext {
    const result = this.pass("start", steps, context, services);
    // A prepared session is adopted whole (#901): a later start step that changed the snapshot
    // would be silently lost, so that composition is a configuration error.
    const prepared = [result.prepared ?? []].flat();
    if (
      prepared.some(({ run }) => JSON.stringify(result.snapshot) !== JSON.stringify(run.snapshot()))
    )
      throw new Error(
        "a start step after a prepared session changed the run's start and would be lost",
      );
    return result;
  }

  /** Apply one pass over the declared steps, in declaration order. */
  private pass<Value>(
    name: "policy" | "deck" | "start",
    steps: readonly RunSetupStep[],
    value: Value,
    services: RunSetupServices,
  ): Value {
    return steps.reduce((current, step) => {
      const behaviour = this.get(step.step) as RunSetupBehaviour<object> & {
        [Key in typeof name]?: (current: Value, config: object, s: RunSetupServices) => Value;
      };
      return behaviour[name]?.(current, step, services) ?? current;
    }, value);
  }

  private get<Name extends keyof RunSetupStepConfigs>(
    name: Name,
  ): RunSetupBehaviour<RunSetupStepConfigs[Name]> {
    const behaviour = this.behaviours.get(name);
    if (!behaviour) throw new Error(`Unknown run setup step "${name}"`);
    return behaviour as RunSetupBehaviour<RunSetupStepConfigs[Name]>;
  }
}
