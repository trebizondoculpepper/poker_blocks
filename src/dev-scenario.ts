/**
 * Dev scenario setup (#877; doc/experiments/passive-test-bench.md, "Scenario composition and
 * controller" and "Hydration is not replay"). A scenario is versioned plain configuration: a seed
 * and an ordered list of registered setup capabilities. Each capability validates its own
 * configuration and applies it to a draft. The whole draft is validated, then a candidate run is
 * built off to the side; only a complete, valid candidate is returned. An invalid scenario
 * returns diagnostics and builds nothing, so the caller's current trial stays as it was.
 *
 * Two different things are kept apart:
 * - **Hydration** places the declared cards and passives straight into their starting zones, like
 *   restore: no plays used, nothing scored, no reactions, no facts published.
 * - **Replay** runs declared, ordinary gameplay commands after the initial snapshot through the
 *   run's normal commands. A refused command rejects the whole candidate.
 *
 * Nothing here knows which room, passive or material a scenario is about: capabilities and
 * replay commands are registries keyed by name.
 */
import type { CardBlock } from "./cards";
import { configurePassive } from "./configurable-passive";
import { Registry } from "./core/registry";
import { buildDeck, type DeckBuilderStep } from "./deck-builder";
import type { Dealer } from "./dealer";
import { GameRun, type RunSnapshot } from "./game-run";
import type { GameState, PlacedBlock, PlayAction } from "./game-state";
import { Randomizer } from "./random";
import { withoutSelectable } from "./traits/selectable";
import { createPassiveBlock, passiveDefinitions, type PassiveBlock } from "./passives";
import type { RunRules } from "./run-rules";
import { cellKey, type Cell } from "./traits/attachable";

/** The scenario format this module reads. */
export const scenarioVersion = 1;

/** One registered setup capability and its configuration, in the scenario's order. */
export type ScenarioStep = { capability: string; config: unknown };

export type ScenarioDefinition = {
  version: number;
  /** The seed the deck is built from and the trial's random stream starts at. */
  seed: number;
  steps: readonly ScenarioStep[];
};

/** Declared input-size limits, checked before anything is allocated or built. */
export type ScenarioLimits = {
  steps: number;
  deckCards: number;
  passives: number;
  fieldCells: number;
  coordinate: number;
  replayCommands: number;
};
export const defaultScenarioLimits: ScenarioLimits = {
  steps: 32,
  deckCards: 512,
  passives: 16,
  fieldCells: 256,
  coordinate: 64,
  replayCommands: 256,
};

/** One declared gameplay command, replayed through the run's ordinary command. */
export type ReplayCommand = { command: string; args: unknown };

/**
 * The scenario's draft: every created card instance in exactly one zone. The deck is the built
 * deck's remaining cards, in order; `created` keeps every instance by its build index.
 */
export type ScenarioDraft = {
  created: readonly CardBlock[];
  deck: readonly CardBlock[];
  hand: readonly CardBlock[];
  field: readonly PlacedBlock[];
  passives: readonly PassiveBlock[];
  replay: readonly ReplayCommand[];
  /** Whether a field step explicitly declared the disconnected-fixture permission. */
  allowDisconnected: boolean;
};

export type ScenarioContext = { seed: number; limits: ScenarioLimits; rackCapacity: number };

/** A registered setup capability: what is wrong with its configuration, and how it applies. */
export type ScenarioCapability = {
  /** Problems with the configuration itself, before any allocation (empty when valid). */
  validate(config: unknown, context: ScenarioContext): string[];
  /**
   * How much of each limited resource this step uses, so the whole scenario's totals are checked
   * against the limits before anything is built, however many steps repeat a capability.
   */
  uses?(config: unknown): Partial<Record<keyof ScenarioLimits, number>>;
  /** The draft with this capability applied; throws ScenarioError when it can't be. */
  apply(draft: ScenarioDraft, config: unknown, context: ScenarioContext): ScenarioDraft;
};
export const devScenarioCapabilities = new Registry<ScenarioCapability>("dev scenario capability");

/** A registered replay command: runs one ordinary run command, reporting whether it resolved. */
export type ReplayHandler = (run: GameRun, args: unknown) => boolean;
export const scenarioReplayCommands = new Registry<ReplayHandler>("scenario replay command");

/** A scenario that cannot be built. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

const isWhole = (value: unknown, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const list = (config: unknown, field: string): unknown[] => {
  const value = (config as Record<string, unknown> | null)?.[field];
  return Array.isArray(value) ? value : [];
};
/** A required list that is missing or not a list: a diagnostic, never an empty setup. */
const notAList = (config: unknown, field: string, owner: string): string[] =>
  Array.isArray((config as Record<string, unknown> | null)?.[field])
    ? []
    : [`${owner}: needs a list of ${field}`];

/** Take the instances at these build indices out of the deck, in the order given. */
function take(draft: ScenarioDraft, indices: readonly number[], zone: string): CardBlock[] {
  // One instance, one owner: the same index twice in one transfer is refused too.
  if (new Set(indices).size !== indices.length)
    throw new ScenarioError(`${zone}: the same card index is given more than once`);
  return indices.map((index) => {
    const card = draft.created[index];
    if (!card) throw new ScenarioError(`${zone}: no created card at index ${index}`);
    if (!draft.deck.includes(card))
      throw new ScenarioError(`${zone}: card at index ${index} is already in another zone`);
    return card;
  });
}
const withoutCards = (deck: readonly CardBlock[], taken: readonly CardBlock[]) =>
  deck.filter((card) => !taken.includes(card));

// The deck, through the shared deck builder (doc/deck-builders.md): no second deck factory.
devScenarioCapabilities.register("devDeck", {
  validate: (config, { limits }) =>
    Array.isArray((config as { steps?: unknown })?.steps) &&
    (config as { steps: unknown[] }).steps.length <= limits.steps
      ? []
      : [`devDeck: needs a list of at most ${limits.steps} deck builder steps`],
  apply: (draft, config, { seed, limits }) => {
    // The deck is built once, before anything is moved out of it: a rebuild would leave cards
    // already placed in other zones beside fresh copies with the same IDs.
    if (draft.created.length)
      throw new ScenarioError("devDeck: the deck is built once, before any other zone");
    const built = buildDeck((config as { steps: DeckBuilderStep[] }).steps, seed, limits.deckCards);
    if (built.length > limits.deckCards)
      throw new ScenarioError(
        `devDeck: ${built.length} cards exceeds the ${limits.deckCards} limit`,
      );
    return { ...draft, created: built, deck: built };
  },
});

// The starting hand: created instances by build index, in order.
devScenarioCapabilities.register("devHand", {
  validate: (config, { limits }) =>
    notAList(config, "indices", "devHand").length
      ? notAList(config, "indices", "devHand")
      : list(config, "indices").every((index) => isWhole(index, limits.deckCards))
        ? []
        : ["devHand: indices must be whole numbers within the deck limit"],
  apply: (draft, config) => {
    const hand = take(draft, list(config, "indices") as number[], "devHand");
    return { ...draft, hand: [...draft.hand, ...hand], deck: withoutCards(draft.deck, hand) };
  },
});

type PassiveDescriptor = { definitionId: string; overrides?: Record<string, number | string> };

// Installed passives in order, each a fresh instance with its validated settings (#876).
devScenarioCapabilities.register("devPassives", {
  validate: (config, { limits }) => {
    if (notAList(config, "passives", "devPassives").length)
      return notAList(config, "passives", "devPassives");
    const passives = list(config, "passives") as PassiveDescriptor[];
    return [
      ...(passives.length > limits.passives
        ? [`devPassives: at most ${limits.passives} passives`]
        : []),
      ...passives
        .filter((passive) => !passiveDefinitions.has(passive?.definitionId))
        .map((passive) => `devPassives: unknown passive "${String(passive?.definitionId)}"`),
    ];
  },
  uses: (config) => ({ passives: list(config, "passives").length }),
  apply: (draft, config, { rackCapacity }) => {
    const passives = (list(config, "passives") as PassiveDescriptor[]).map(
      ({ definitionId, overrides = {} }, index) => {
        const id = `scenario-passive-${draft.passives.length + index + 1}`;
        try {
          return configurePassive(createPassiveBlock(definitionId, id), overrides);
        } catch (error) {
          throw new ScenarioError(`devPassives: ${(error as Error).message}`);
        }
      },
    );
    const installed = [...draft.passives, ...passives];
    if (installed.length > rackCapacity)
      throw new ScenarioError(
        `devPassives: ${installed.length} passives exceed the rack's capacity`,
      );
    return { ...draft, passives: installed };
  },
});

type FieldConfig = {
  placements: { index: number; cell: Cell }[];
  /** An explicit, displayed permission for a pattern not joined face to face. */
  allowDisconnected?: boolean;
};

/** Whether these cells form one face-joined group (the ordinary spatial constraint). */
function faceConnected(cells: readonly Cell[]): boolean {
  if (cells.length < 2) return true;
  const keys = new Set(cells.map(cellKey));
  const reached = new Set([cellKey(cells[0]!)]);
  const pending = [cells[0]!];
  for (let i = 0; i < pending.length; i++) {
    const { x, y, z } = pending[i]!;
    for (const next of [
      { x: x + 1, y, z },
      { x: x - 1, y, z },
      { x, y: y + 1, z },
      { x, y: y - 1, z },
      { x, y, z: z + 1 },
      { x, y, z: z - 1 },
    ]) {
      const key = cellKey(next);
      if (keys.has(key) && !reached.has(key)) (reached.add(key), pending.push(next));
    }
  }
  return reached.size === keys.size;
}

// The initial field pattern: created instances placed directly at their cells (hydration).
devScenarioCapabilities.register("devFieldPattern", {
  validate: (config, { limits }) => {
    if (!Array.isArray((config as { placements?: unknown } | null)?.placements))
      return ["devFieldPattern: needs a list of placements"];
    const placements = list(config, "placements") as FieldConfig["placements"];
    if (placements.some((placement) => typeof placement !== "object" || placement === null))
      return ["devFieldPattern: each placement needs an index and a cell"];
    const coordinate = (value: unknown) =>
      Number.isSafeInteger(value) && Math.abs(value as number) <= limits.coordinate;
    const problems = [
      ...(placements.length > limits.fieldCells
        ? [`devFieldPattern: at most ${limits.fieldCells} cells`]
        : []),
      ...placements
        .filter(
          ({ index, cell }) =>
            !isWhole(index, limits.deckCards) ||
            ![cell?.x, cell?.y, cell?.z].every((value) => coordinate(value)),
        )
        .map(
          ({ index }) =>
            `devFieldPattern: placement ${String(index)} needs a whole index and coordinates within ±${limits.coordinate}`,
        ),
    ];
    if (problems.length) return problems;
    const cells = placements.map(({ cell }) => cell);
    return new Set(cells.map(cellKey)).size === cells.length
      ? []
      : ["devFieldPattern: two placements share a cell"];
  },
  uses: (config) => ({ fieldCells: list(config, "placements").length }),
  apply: (draft, config) => {
    const { placements } = config as FieldConfig;
    const cards = take(
      draft,
      placements.map(({ index }) => index),
      "devFieldPattern",
    );
    const occupied = new Set(draft.field.map(({ cell }) => cellKey(cell)));
    if (placements.some(({ cell }) => occupied.has(cellKey(cell))))
      throw new ScenarioError("devFieldPattern: a placement's cell is already occupied");
    const field = [
      ...draft.field,
      // A field card is not a hand card: the same normalization as an ordinary placement.
      ...placements.map(({ cell }, i) => ({
        block: withoutSelectable(cards[i]!),
        cell: { ...cell },
      })),
    ];
    // The ordinary spatial constraint holds for the whole field so far, across every step,
    // unless a step explicitly declares the fixture permission.
    const allowDisconnected =
      draft.allowDisconnected || (config as FieldConfig).allowDisconnected === true;
    if (!allowDisconnected && !faceConnected(field.map(({ cell }) => cell)))
      throw new ScenarioError(
        "devFieldPattern: cells must join face to face unless allowDisconnected is declared",
      );
    return { ...draft, field, allowDisconnected, deck: withoutCards(draft.deck, cards) };
  },
});

// Declared ordinary commands, run after the initial snapshot: not part of hydration.
devScenarioCapabilities.register("devReplay", {
  validate: (config, { limits }) => {
    if (notAList(config, "commands", "devReplay").length)
      return notAList(config, "commands", "devReplay");
    const commands = list(config, "commands") as ReplayCommand[];
    return [
      ...(commands.length > limits.replayCommands
        ? [`devReplay: at most ${limits.replayCommands} commands`]
        : []),
      ...commands
        .filter((command) => !scenarioReplayCommands.has(command?.command))
        .map((command) => `devReplay: unknown command "${String(command?.command)}"`),
    ];
  },
  uses: (config) => ({ replayCommands: list(config, "commands").length }),
  apply: (draft, config) => ({
    ...draft,
    replay: [...draft.replay, ...(list(config, "commands") as ReplayCommand[])],
  }),
});

// Each replayed command completes as ordinary play does: the hand refills afterward
// (doc/game.md, the after-action refill), so the next command can name a replacement card.
const refilled = (resolved: boolean, run: GameRun) => {
  if (resolved) run.refillHand();
  return resolved;
};
scenarioReplayCommands.register("play", (run, args) =>
  refilled(run.play(args as PlayAction) !== null, run),
);
scenarioReplayCommands.register("discard", (run, args) =>
  refilled(run.discard((args as { cardIds: readonly string[] }).cardIds) !== null, run),
);

/** What building a scenario needs from the game: its dealers and run rules. */
export type ScenarioRuntime = {
  dealers: Registry<Dealer>;
  rules: RunRules;
  limits?: ScenarioLimits;
};

/**
 * The candidate's own session (doc/experiments/trial-session-adoption.md, "Policy, preparation
 * and adoption"): the rules it was built under, every instance it created, and the SAME random
 * stream its run draws from (next, checkpoint, restore, seed, cursor), with any replay's draws
 * already consumed. An adopter installs these together; it never attaches another stream.
 */
export type ScenarioSession = {
  rules: RunRules;
  /** Every card instance the scenario created: its whole identity universe, not just the deck. */
  cards: readonly CardBlock[];
  random: Randomizer;
};

/** A built trial: the run, its hydrated starting snapshot, and the commands replayed after it. */
export type ScenarioTrial = {
  session: ScenarioSession;
  run: GameRun;
  /** The state as hydrated, before any replay: configured fixture state. */
  initialSnapshot: RunSnapshot;
  /** The ordinary commands replayed after it, in order: effects caused by actions. */
  actionLog: readonly ReplayCommand[];
};

export type ScenarioResult =
  | { ok: true; trial: ScenarioTrial }
  | { ok: false; diagnostics: readonly string[] };

/** Every problem with the definition that can be found before anything is built. */
function definitionProblems(definition: ScenarioDefinition, context: ScenarioContext): string[] {
  if (definition?.version !== scenarioVersion)
    return [`unsupported scenario version ${String(definition?.version)}`];
  if (!Number.isSafeInteger(definition.seed)) return ["the seed must be a whole number"];
  if (!Array.isArray(definition.steps) || definition.steps.length > context.limits.steps)
    return [`a scenario needs at most ${context.limits.steps} steps`];
  if (definition.steps.some((step) => typeof step !== "object" || step === null))
    return ["each scenario step needs a capability and its configuration"];
  const problems = definition.steps.flatMap(({ capability, config }) =>
    devScenarioCapabilities.has(capability)
      ? devScenarioCapabilities.get(capability).validate(config, context)
      : [`unknown scenario capability "${String(capability)}"`],
  );
  if (problems.length) return problems;
  // The totals across every step, against the declared limits.
  const totals = new Map<keyof ScenarioLimits, number>();
  for (const { capability, config } of definition.steps)
    for (const [resource, amount] of Object.entries(
      devScenarioCapabilities.get(capability).uses?.(config) ?? {},
    ))
      totals.set(
        resource as keyof ScenarioLimits,
        (totals.get(resource as keyof ScenarioLimits) ?? 0) + amount,
      );
  return [...totals].flatMap(([resource, total]) =>
    total > context.limits[resource]
      ? [`the scenario uses ${total} ${resource}, over its limit of ${context.limits[resource]}`]
      : [],
  );
}

/**
 * Build a scenario's trial atomically: validate everything, apply the capabilities to a draft,
 * hydrate a candidate run with it, then replay its declared commands. Any failure returns
 * diagnostics and nothing else; the same definition always builds the same trial.
 */
export function buildScenario(
  definition: ScenarioDefinition,
  runtime: ScenarioRuntime,
): ScenarioResult {
  const limits = runtime.limits ?? defaultScenarioLimits;
  const context: ScenarioContext = {
    seed: definition?.seed,
    limits,
    rackCapacity: runtime.rules.rackCapacity ?? Infinity,
  };
  try {
    // Validation is inside the boundary too: a malformed configuration is a diagnostic.
    const problems = definitionProblems(definition, context);
    if (problems.length) return { ok: false, diagnostics: problems };
    const empty: ScenarioDraft = {
      created: [],
      deck: [],
      hand: [],
      field: [],
      passives: [],
      replay: [],
      allowDisconnected: false,
    };
    const draft = definition.steps.reduce(
      (current, { capability, config }) =>
        devScenarioCapabilities.get(capability).apply(current, config, context),
      empty,
    );
    // A candidate run, off to the side: its own deal is replaced wholesale by hydration.
    const opening = new GameRun(runtime.dealers, runtime.rules, draft.created, () => 0);
    const hydrated: GameState = {
      ...opening.state,
      deck: draft.deck,
      hand: draft.hand,
      field: draft.field,
      discardPile: [],
      passiveRack: draft.passives,
    };
    // A checkpointable stream, so a failed action rewinds its draws like the normal run.
    const randomizer = new Randomizer(definition.seed);
    const run = GameRun.fromSnapshot(
      runtime.dealers,
      runtime.rules,
      draft.created,
      { ...opening.snapshot(), state: hydrated },
      () => randomizer.next(),
    );
    run.attachRandomCheckpoints({
      checkpoint: () => randomizer.checkpoint(),
      restore: (mark) => randomizer.restore(mark),
    });
    const initialSnapshot = run.snapshot();
    for (const [index, { command, args }] of draft.replay.entries())
      if (!scenarioReplayCommands.get(command)(run, args))
        return {
          ok: false,
          diagnostics: [
            `replay command ${index + 1} (${command}) was refused${
              run.actionFailure ? `: ${run.actionFailure.message}` : ""
            }`,
          ],
        };
    return {
      ok: true,
      trial: {
        session: { rules: runtime.rules, cards: draft.created, random: randomizer },
        run,
        initialSnapshot,
        actionLog: draft.replay,
      },
    };
  } catch (error) {
    return { ok: false, diagnostics: [(error as Error).message] };
  }
}
