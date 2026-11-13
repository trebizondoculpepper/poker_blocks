import type { GameState } from "./game-state";
import { countOperation } from "./lifecycle/operations";
import type { GameEvent } from "./passives";

/** A serializable reference to a reusable handler and its configuration. */
export type HandlerConfig = { id: string; config: unknown };

/** A block contributes rules; its definition contains data, never behavior code. */
export type EventRule = {
  on: string;
  select: HandlerConfig;
  where: HandlerConfig;
  effects: readonly HandlerConfig[];
};

/** Working values can change during evaluation. Commands are committed only after selection. */
export type RuleCommand = { id: string; config: unknown };
/**
 * What one applied effect did (#483; doc/presentation-contracts.md, "Resolved activation
 * results"): a snapshot for presentation, reported by the effect at the moment it applied, never
 * recomputed. `operation` is the effect's registered name; `operand` its resolved amount (a die's
 * actual roll, not its recipe); `before`/`after` the working value around it; `unit` what it
 * changes (score, coins…); `scope` what it applied to (a block, a line…).
 */
export type ResolvedOutcome = Readonly<{
  operation: string;
  operand?: number;
  before?: number;
  after?: number;
  unit?: string;
  scope?: string;
  targets?: readonly string[];
}>;

export type RuleFrame = {
  event: Readonly<GameEvent>;
  /** The game state, where the event has one; pure scoring evaluates without it. */
  state?: Readonly<GameState>;
  workingValue?: number;
  /**
   * The total exponent the power phase has applied to the working value so far (1 before
   * any): exponents combine by adding their increases above 1 (#431), so ^1.1 and ^1.2 make
   * ^1.3, not ^1.32.
   */
  exponent?: number;
  /** The working value as the power phase began: each power raises it to the new total. */
  powerBase?: number;
  commands: readonly RuleCommand[];
  /** What each effect of the rule being evaluated did, in effect order (#483). */
  outcomes?: readonly ResolvedOutcome[];
  /** Set by `evaluate`: whether the rule's condition matched and its effects ran. */
  fired?: boolean;
};

type Selector = (config: unknown, frame: Readonly<RuleFrame>) => unknown;
type Condition = (config: unknown, selected: unknown, frame: Readonly<RuleFrame>) => boolean;
type Effect = (config: unknown, selected: unknown, frame: Readonly<RuleFrame>) => RuleFrame;
type ValueSource = (config: unknown, random: () => number) => number;

/**
 * A value an effect's configuration can take instead of a fixed number (#97): it names a
 * registered value source and configures it, `{ valueSource: "roll", sides: 6 }`. Rules are
 * resolved once per scoring resolution (`resolveValues`), so every effect sees plain numbers.
 */
export type ValueSourceConfig = { valueSource: string } & Record<string, unknown>;

/**
 * The runner never interprets handler IDs. Registrations own selection, matching and effects.
 * Each registration is type-checked against its own config and selected value.
 */
export class EventRuleRegistry {
  private readonly selectors = new Map<string, Selector>();
  private readonly conditions = new Map<string, Condition>();
  private readonly effects = new Map<string, Effect>();
  private readonly valueSources = new Map<string, ValueSource>();

  registerSelector<Config, Selected>(
    id: string,
    handler: (config: Config, frame: Readonly<RuleFrame>) => Selected,
  ): void {
    register(this.selectors, id, handler as Selector, "selector");
  }

  registerCondition<Config, Selected>(
    id: string,
    handler: (config: Config, selected: Selected, frame: Readonly<RuleFrame>) => boolean,
  ): void {
    register(this.conditions, id, handler as Condition, "condition");
  }

  registerEffect<Config, Selected>(
    id: string,
    handler: (config: Config, selected: Selected, frame: Readonly<RuleFrame>) => RuleFrame,
  ): void {
    register(this.effects, id, handler as Effect, "effect");
  }

  registerValueSource<Config>(
    id: string,
    handler: (config: Config, random: () => number) => number,
  ): void {
    register(this.valueSources, id, handler as ValueSource, "value source");
  }

  /**
   * The rule with every value source in its effects' configuration resolved to a number,
   * drawing from `random` once per value source. A rule with none is returned unchanged and
   * draws nothing, so rules without random amounts never move the run's random sequence.
   */
  resolveValues(rule: EventRule, random: () => number): EventRule {
    if (!rule.effects.some((effect) => hasValueSource(effect.config))) return rule;
    return {
      ...rule,
      effects: rule.effects.map((effect) => ({
        ...effect,
        config: this.resolveConfig(effect.config, random),
      })),
    };
  }

  private resolveConfig(config: unknown, random: () => number): unknown {
    if (isValueSource(config))
      return get(this.valueSources, config.valueSource, "value source")(config, random);
    if (Array.isArray(config)) return config.map((item) => this.resolveConfig(item, random));
    if (config && typeof config === "object")
      return Object.fromEntries(
        Object.entries(config).map(([key, value]) => [key, this.resolveConfig(value, random)]),
      );
    return config;
  }

  /** Whether a configured condition holds for `selected`: for selectors that filter (#170). */
  holds(where: HandlerConfig, selected: unknown, frame: Readonly<RuleFrame>): boolean {
    return get(this.conditions, where.id, "condition")(where.config, selected, frame);
  }

  /** The event queue chooses subscribed rules; this applies one rule in effect order. */
  evaluate(rule: EventRule, frame: Readonly<RuleFrame>): RuleFrame {
    const selected = get(this.selectors, rule.select.id, "selector")(rule.select.config, frame);
    const matched = get(this.conditions, rule.where.id, "condition")(
      rule.where.config,
      selected,
      frame,
    );
    if (!matched) return { ...frame, outcomes: [], fired: false };
    // Each effect reports its own resolved outcome as it applies; one that reports none gets an
    // explicit record of its operation and the working value around it, never an inferred operand.
    const result = rule.effects.reduce<RuleFrame>(
      (working, effect) => {
        const applied = get(this.effects, effect.id, "effect")(effect.config, selected, working);
        const reported = (applied.outcomes?.length ?? 0) > (working.outcomes?.length ?? 0);
        return reported
          ? applied
          : {
              ...applied,
              outcomes: [
                ...(working.outcomes ?? []),
                {
                  operation: effect.id,
                  ...(working.workingValue === undefined ? {} : { before: working.workingValue }),
                  ...(applied.workingValue === undefined ? {} : { after: applied.workingValue }),
                },
              ],
            };
      },
      { ...frame, outcomes: [] },
    );
    return { ...result, fired: true };
  }
}

function register<T>(registry: Map<string, T>, id: string, handler: T, what: string): void {
  if (registry.has(id)) throw new Error(`${what} already registered: ${id}`);
  registry.set(id, handler);
}

/**
 * A registered handler, about to be invoked: each lookup is charged to the resolving action's
 * operation budget (#661 review), so selectors, conditions (nested ones too), effects and value
 * sources all count, however many a single rule holds. Nothing counts outside an action.
 */
function get<T>(registry: Map<string, T>, id: string, what: string): T {
  const handler = registry.get(id);
  if (!handler) throw new Error(`Unknown ${what}: ${id}`);
  countOperation(`${what} ${id}`);
  return handler;
}

function isValueSource(config: unknown): config is ValueSourceConfig {
  return !!config && typeof config === "object" && "valueSource" in config;
}

function hasValueSource(config: unknown): boolean {
  if (isValueSource(config)) return true;
  if (config && typeof config === "object") return Object.values(config).some(hasValueSource);
  return false;
}
