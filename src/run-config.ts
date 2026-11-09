import type { CardBlock } from "./cards";
import type { SessionSnapshot } from "./game-session";
import type { SessionConfig } from "./session-config";

export type RunTransformerConfigs = {
  sandbox: Record<never, never>;
  materialDeck: { reshuffle: "each-run" | "new-game" };
  materialSample: Record<never, never>;
  shopPreview: { coins: number };
};

export type RunTransformer = {
  [Name in keyof RunTransformerConfigs]: { type: Name } & RunTransformerConfigs[Name];
}[keyof RunTransformerConfigs];

export type RunPrepareContext<Services> = {
  config: SessionConfig;
  deck: readonly CardBlock[];
  runSeed?: number;
  services: Services;
};

export type RunStartContext<Services> = RunPrepareContext<Services> & {
  snapshot: SessionSnapshot;
};

export type RunTransformerBehaviour<Services, Config extends object> = {
  prepare?(context: RunPrepareContext<Services>, config: Config): RunPrepareContext<Services>;
  start?(context: RunStartContext<Services>, config: Config): RunStartContext<Services>;
};

/** Typed, ordered behavior registry for transformations applied only to a fresh run. */
export class RunTransformerRegistry<Services> {
  private readonly behaviours = new Map<string, RunTransformerBehaviour<Services, object>>();

  register<Name extends keyof RunTransformerConfigs>(
    name: Name,
    behaviour: RunTransformerBehaviour<Services, RunTransformerConfigs[Name]>,
  ): void {
    if (this.behaviours.has(name))
      throw new Error(`Run transformer "${name}" is already registered`);
    this.behaviours.set(name, behaviour as RunTransformerBehaviour<Services, object>);
  }

  has(name: string): boolean {
    return this.behaviours.has(name);
  }

  prepare(
    transformers: readonly RunTransformer[],
    context: RunPrepareContext<Services>,
  ): RunPrepareContext<Services> {
    return transformers.reduce((current, transformer) => {
      const behaviour = this.get(transformer.type);
      return behaviour.prepare?.(current, transformer) ?? current;
    }, context);
  }

  start(
    transformers: readonly RunTransformer[],
    context: RunStartContext<Services>,
  ): RunStartContext<Services> {
    return transformers.reduce((current, transformer) => {
      const behaviour = this.get(transformer.type);
      return behaviour.start?.(current, transformer) ?? current;
    }, context);
  }

  private get<Name extends keyof RunTransformerConfigs>(
    name: Name,
  ): RunTransformerBehaviour<Services, RunTransformerConfigs[Name]> {
    const behaviour = this.behaviours.get(name);
    if (!behaviour) throw new Error(`Unknown run transformer "${name}"`);
    return behaviour as RunTransformerBehaviour<Services, RunTransformerConfigs[Name]>;
  }
}
