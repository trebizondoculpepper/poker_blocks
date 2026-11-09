import type { GameState } from "./game-state";
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
export type RuleFrame = {
  event: Readonly<GameEvent>;
  state: Readonly<GameState>;
  workingValue?: number;
  commands: readonly RuleCommand[];
};

type Selector = (config: unknown, frame: Readonly<RuleFrame>) => unknown;
type Condition = (config: unknown, selected: unknown, frame: Readonly<RuleFrame>) => boolean;
type Effect = (config: unknown, selected: unknown, frame: Readonly<RuleFrame>) => RuleFrame;

/**
 * The runner never interprets handler IDs. Registrations own selection, matching and effects.
 * Each registration is type-checked against its own config and selected value.
 */
export class EventRuleRegistry {
  private readonly selectors = new Map<string, Selector>();
  private readonly conditions = new Map<string, Condition>();
  private readonly effects = new Map<string, Effect>();

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

  /** The event queue chooses subscribed rules; this applies one rule in effect order. */
  evaluate(rule: EventRule, frame: Readonly<RuleFrame>): RuleFrame {
    const selected = get(this.selectors, rule.select.id, "selector")(rule.select.config, frame);
    const matched = get(this.conditions, rule.where.id, "condition")(
      rule.where.config,
      selected,
      frame,
    );
    if (!matched) return { ...frame };
    return rule.effects.reduce<RuleFrame>(
      (working, effect) => get(this.effects, effect.id, "effect")(effect.config, selected, working),
      { ...frame },
    );
  }
}

function register<T>(registry: Map<string, T>, id: string, handler: T, what: string): void {
  if (registry.has(id)) throw new Error(`${what} already registered: ${id}`);
  registry.set(id, handler);
}

function get<T>(registry: Map<string, T>, id: string, what: string): T {
  const handler = registry.get(id);
  if (!handler) throw new Error(`Unknown ${what}: ${id}`);
  return handler;
}
