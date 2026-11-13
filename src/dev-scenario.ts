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
import { seededRandom } from "./materials";
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
};

export type ScenarioContext = { seed: number; limits: ScenarioLimits; rackCapacity: number };

/** A registered setup capability: what is wrong with its configuration, and how it applies. */
export type ScenarioCapability = {
  /** Problems with the configuration itself, before any allocation (empty when valid). */
  validate(config: unknown, context: ScenarioContext): string[];
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

/** Take the instances at these build indices out of the deck, in the order given. */
function take(draft: ScenarioDraft, indices: readonly number[], zone: string): CardBlock[] {
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
    const built = buildDeck((config as { steps: DeckBuilderStep[] }).steps, seed);
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
    list(config, "indices").every((index) => isWhole(index, limits.deckCards))
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
    const { placements = [] } = (config ?? {}) as Partial<FieldConfig>;
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
    if (new Set(cells.map(cellKey)).size !== cells.length)
      return ["devFieldPattern: two placements share a cell"];
    return (config as FieldConfig).allowDisconnected || faceConnected(cells)
      ? []
      : ["devFieldPattern: cells must join face to face unless allowDisconnected is declared"];
  },
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
    return {
      ...draft,
      field: [
        ...draft.field,
        ...placements.map(({ cell }, i) => ({ block: cards[i]!, cell: { ...cell } })),
      ],
      deck: withoutCards(draft.deck, cards),
    };
  },
});

// Declared ordinary commands, run after the initial snapshot: not part of hydration.
devScenarioCapabilities.register("devReplay", {
  validate: (config, { limits }) => {
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
  apply: (draft, config) => ({
    ...draft,
    replay: [...draft.replay, ...(list(config, "commands") as ReplayCommand[])],
  }),
});

scenarioReplayCommands.register("play", (run, args) => run.play(args as PlayAction) !== null);
scenarioReplayCommands.register(
  "discard",
  (run, args) => run.discard((args as { cardIds: readonly string[] }).cardIds) !== null,
);

/** What building a scenario needs from the game: its dealers and run rules. */
export type ScenarioRuntime = {
  dealers: Registry<Dealer>;
  rules: RunRules;
  limits?: ScenarioLimits;
};

/** A built trial: the run, its hydrated starting snapshot, and the commands replayed after it. */
export type ScenarioTrial = {
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
  return definition.steps.flatMap(({ capability, config }) =>
    devScenarioCapabilities.has(capability)
      ? devScenarioCapabilities.get(capability).validate(config, context)
      : [`unknown scenario capability "${String(capability)}"`],
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
  const problems = definitionProblems(definition, context);
  if (problems.length) return { ok: false, diagnostics: problems };
  try {
    const empty: ScenarioDraft = {
      created: [],
      deck: [],
      hand: [],
      field: [],
      passives: [],
      replay: [],
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
    const run = GameRun.fromSnapshot(
      runtime.dealers,
      runtime.rules,
      draft.created,
      { ...opening.snapshot(), state: hydrated },
      seededRandom(definition.seed),
    );
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
    return { ok: true, trial: { run, initialSnapshot, actionLog: draft.replay } };
  } catch (error) {
    return { ok: false, diagnostics: [(error as Error).message] };
  }
}
