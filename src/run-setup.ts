/**
 * Run setup: the ordered steps a game mode applies when a new game run is created.
 *
 * A step is plain data (`{ step: "sandbox" }`), and its behaviour lives in `RunSetupRegistry`,
 * type-checked against that step's own config. Steps compose in declaration order in two
 * passes: `prepare` before the run is dealt (run rules and the deck), then `start` once the
 * opening snapshot exists (what the run begins holding).
 *
 * Run setup applies to a new game run only. Continue restores the saved run as saved.
 */
import type { CardBlock } from "./cards";
import type { RunSnapshot } from "./game-run";
import { sandboxRunRules, type RunRules } from "./run-rules";
import type { DevDestructibleMix } from "./traits/destructible";

/**
 * The rules a mode always plays under, from its baseline rules and the steps that describe a
 * policy rather than a starting state. A sandbox lasts for the whole run, not just the deal, so
 * a resumed run keeps it; a `prepare` step that only shapes the opening deck does not.
 */
export function rulesForRun(steps: readonly RunSetupStep[], base: RunRules): RunRules {
  return steps.some((step) => step.step === "sandbox") ? sandboxRunRules(base) : base;
}

/** The configuration each run setup step takes. A step with no options takes `{}`. */
export type RunSetupStepConfigs = {
  /** Endless play: unlimited plays and discards, a stage cannot be won or lost by itself. */
  sandbox: Record<never, never>;
  /**
   * Every card gets a random material, dealt from a fresh seed that the run records, so
   * Continue rebuilds the same mix and a new run gets a new one.
   */
  materialDeck: Record<never, never>;
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

/** What a `prepare` pass hands to the next step: the rules and deck a run is dealt from. */
export type RunPrepareContext = {
  rules: RunRules;
  deck: readonly CardBlock[];
  /** Recorded in the run, so Continue rebuilds the same deck. */
  seed?: number;
};

/** What a `start` pass hands to the next step: the opening snapshot of the new run. */
export type RunStartContext = {
  prepare: RunPrepareContext;
  snapshot: RunSnapshot;
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
  prepare?(
    context: RunPrepareContext,
    config: Config,
    services: RunSetupServices,
  ): RunPrepareContext;
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

  /** The declared steps' `prepare` handlers, in declaration order. */
  prepare(
    steps: readonly RunSetupStep[],
    context: RunPrepareContext,
    services: RunSetupServices,
  ): RunPrepareContext {
    return steps.reduce((current, step) => {
      const behaviour = this.get(step.step);
      return behaviour.prepare?.(current, step, services) ?? current;
    }, context);
  }

  /** The declared steps' `start` handlers, in declaration order. */
  start(
    steps: readonly RunSetupStep[],
    context: RunStartContext,
    services: RunSetupServices,
  ): RunStartContext {
    return steps.reduce((current, step) => {
      const behaviour = this.get(step.step);
      return behaviour.start?.(current, step, services) ?? current;
    }, context);
  }

  private get<Name extends keyof RunSetupStepConfigs>(
    name: Name,
  ): RunSetupBehaviour<RunSetupStepConfigs[Name]> {
    const behaviour = this.behaviours.get(name);
    if (!behaviour) throw new Error(`Unknown run setup step "${name}"`);
    return behaviour as RunSetupBehaviour<RunSetupStepConfigs[Name]>;
  }
}
