import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import {
  buildScenario,
  defaultScenarioLimits,
  scenarioVersion,
  type ScenarioDefinition,
  type ScenarioStep,
} from "./dev-scenario";
import type { RunRules } from "./run-rules";
import "./trial-modifiers";

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
const rules: RunRules = {
  stage: () => ({ dealer: "base", targetScore: 1000, plays: 3, discards: 2 }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
  rackCapacity: 4,
};
const runtime = { dealers, rules };

const deck: ScenarioStep = {
  capability: "devDeck",
  config: { steps: [{ operation: "standardTemplates", config: {} }] },
};
const scenario = (...steps: ScenarioStep[]): ScenarioDefinition => ({
  version: scenarioVersion,
  seed: 7,
  steps: [deck, ...steps],
});
const field = (placements: { index: number; cell: { x: number; y: number; z: number } }[]) => ({
  capability: "devFieldPattern",
  config: { placements },
});

describe("Dev scenario setup (#877)", () => {
  it("hydrates hand, field and configured passives without consuming plays or scoring", () => {
    const result = buildScenario(
      scenario(
        { capability: "devHand", config: { indices: [0, 1, 2] } },
        field([
          { index: 10, cell: { x: 0, y: 0, z: 0 } },
          { index: 11, cell: { x: 1, y: 0, z: 0 } },
        ]),
        {
          capability: "devPassives",
          config: {
            passives: [{ definitionId: "trial-dense-packing", overrides: { maximum: 4 } }],
          },
        },
      ),
      runtime,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { run, initialSnapshot, actionLog } = result.trial;
    const { state } = initialSnapshot;
    expect(state.hand.map(({ id }) => id)).toHaveLength(3);
    expect(state.field).toHaveLength(2);
    expect(state.passiveRack[0]!.traits.configurablePassive?.overrides).toEqual({ maximum: 4 });
    expect(state.round.score).toBe(0);
    expect(state.round.movesLeft).toBe(3);
    expect(run.actionFacts).toEqual([]);
    expect(actionLog).toEqual([]);
    // Every created instance is in exactly one zone.
    const ids = [...state.deck, ...state.hand, ...state.field.map(({ block }) => block)].map(
      ({ id }) => id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(52);
  });

  it("builds the same trial from the same definition", () => {
    const definition = scenario(
      { capability: "devHand", config: { indices: [3, 4] } },
      {
        capability: "devReplay",
        config: { commands: [{ command: "discard", args: { cardIds: [] } }] },
      },
    );
    const strip = (definition: ScenarioDefinition) => {
      const result = buildScenario(definition, runtime);
      return result.ok ? JSON.stringify(result.trial.initialSnapshot.state) : result.diagnostics;
    };
    expect(strip(definition)).toEqual(strip(definition));
  });

  it("replays declared commands through the ordinary run, after the initial snapshot", () => {
    const first = buildScenario(
      scenario({ capability: "devHand", config: { indices: [0, 1, 2, 3, 4] } }),
      runtime,
    );
    if (!first.ok) throw new Error(first.diagnostics.join());
    const cardId = first.trial.initialSnapshot.state.hand[0]!.id;
    const result = buildScenario(
      scenario(
        { capability: "devHand", config: { indices: [0, 1, 2, 3, 4] } },
        { capability: "devReplay", config: { commands: [{ command: "play", args: { cardId } }] } },
      ),
      runtime,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { run, initialSnapshot, actionLog } = result.trial;
    expect(initialSnapshot.state.field).toEqual([]);
    expect(run.state.field.map(({ block }) => block.id)).toEqual([cardId]);
    expect(run.state.round.movesLeft).toBe(2);
    expect(actionLog).toEqual([{ command: "play", args: { cardId } }]);
  });

  it("rejects a refused replay command atomically, with a diagnostic", () => {
    const result = buildScenario(
      scenario({
        capability: "devReplay",
        config: { commands: [{ command: "play", args: { cardId: "not-in-hand" } }] },
      }),
      runtime,
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.stringMatching(/replay command 1 \(play\) was refused/)],
    });
  });

  it("rejects invalid definitions before building anything", () => {
    const problems = (definition: ScenarioDefinition) => {
      const result = buildScenario(definition, runtime);
      return result.ok ? [] : result.diagnostics;
    };
    expect(problems({ ...scenario(), version: 99 })).toEqual(["unsupported scenario version 99"]);
    expect(problems(scenario({ capability: "devTeleport", config: {} }))).toEqual([
      'unknown scenario capability "devTeleport"',
    ]);
    expect(
      problems(
        scenario({ capability: "devPassives", config: { passives: [{ definitionId: "nope" }] } }),
      ),
    ).toEqual(['devPassives: unknown passive "nope"']);
    expect(
      problems(
        scenario(
          field([{ index: 0, cell: { x: defaultScenarioLimits.coordinate + 1, y: 0, z: 0 } }]),
        ),
      ),
    ).toHaveLength(1);
    expect(
      problems(
        scenario(
          field([
            { index: 0, cell: { x: 0, y: 0, z: 0 } },
            { index: 1, cell: { x: 0, y: 0, z: 0 } },
          ]),
        ),
      ),
    ).toEqual(["devFieldPattern: two placements share a cell"]);
    expect(
      problems(
        scenario({
          capability: "devReplay",
          config: { commands: [{ command: "teleport", args: {} }] },
        }),
      ),
    ).toEqual(['devReplay: unknown command "teleport"']);
  });

  it("refuses a card in two zones, invalid settings, a full rack and disconnected fields", () => {
    const problems = (...steps: ScenarioStep[]) => {
      const result = buildScenario(scenario(...steps), runtime);
      return result.ok ? [] : result.diagnostics;
    };
    expect(
      problems(
        { capability: "devHand", config: { indices: [0] } },
        field([{ index: 0, cell: { x: 0, y: 0, z: 0 } }]),
      ),
    ).toEqual([expect.stringMatching(/already in another zone/)]);
    expect(
      problems({
        capability: "devPassives",
        config: { passives: [{ definitionId: "trial-dense-packing", overrides: { maximum: 99 } }] },
      }),
    ).toEqual([expect.stringMatching(/maximum/)]);
    expect(
      problems({
        capability: "devPassives",
        config: {
          passives: Array.from({ length: 5 }, () => ({ definitionId: "trial-dense-packing" })),
        },
      }),
    ).toEqual([expect.stringMatching(/capacity/)]);
    const apart = [
      { index: 0, cell: { x: 0, y: 0, z: 0 } },
      { index: 1, cell: { x: 3, y: 0, z: 0 } },
    ];
    expect(problems(field(apart))).toEqual([expect.stringMatching(/face to face/)]);
    expect(
      problems({
        capability: "devFieldPattern",
        config: { placements: apart, allowDisconnected: true },
      }),
    ).toEqual([]);
  });
});

describe("Dev scenario ownership and shape checks (#877 review)", () => {
  const problems = (definition: ScenarioDefinition) => {
    const result = buildScenario(definition, runtime);
    return result.ok ? [] : result.diagnostics;
  };

  it("refuses the same index twice in one transfer", () => {
    expect(problems(scenario({ capability: "devHand", config: { indices: [0, 0] } }))).toEqual([
      expect.stringMatching(/more than once/),
    ]);
    expect(
      problems(
        scenario(
          field([
            { index: 0, cell: { x: 0, y: 0, z: 0 } },
            { index: 0, cell: { x: 1, y: 0, z: 0 } },
          ]),
        ),
      ),
    ).toEqual([expect.stringMatching(/more than once/)]);
  });

  it("refuses rebuilding the deck once it exists", () => {
    expect(problems(scenario({ capability: "devHand", config: { indices: [0] } }, deck))).toEqual([
      expect.stringMatching(/built once/),
    ]);
  });

  it("returns malformed configuration as diagnostics, not exceptions", () => {
    expect(
      problems(scenario({ capability: "devFieldPattern", config: { placements: {} } })),
    ).toEqual(["devFieldPattern: needs a list of placements"]);
    expect(
      problems(scenario({ capability: "devFieldPattern", config: { placements: [null] } })),
    ).toEqual([expect.stringMatching(/index and a cell/)]);
    expect(problems({ version: scenarioVersion, seed: 1, steps: [null as never] })).toEqual([
      expect.stringMatching(/capability and its configuration/),
    ]);
  });

  it("checks connectivity across every field step", () => {
    expect(
      problems(
        scenario(
          field([{ index: 0, cell: { x: 0, y: 0, z: 0 } }]),
          field([{ index: 1, cell: { x: 10, y: 0, z: 0 } }]),
        ),
      ),
    ).toEqual([expect.stringMatching(/face to face/)]);
    expect(
      problems(
        scenario(field([{ index: 0, cell: { x: 0, y: 0, z: 0 } }]), {
          capability: "devFieldPattern",
          config: {
            placements: [{ index: 1, cell: { x: 10, y: 0, z: 0 } }],
            allowDisconnected: true,
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("Dev scenario totals and field normalization (#877 review)", () => {
  it("checks limits against totals across repeated steps", () => {
    const result = buildScenario(
      scenario(
        field([{ index: 0, cell: { x: 0, y: 0, z: 0 } }]),
        field([{ index: 1, cell: { x: 1, y: 0, z: 0 } }]),
      ),
      { ...runtime, limits: { ...defaultScenarioLimits, fieldCells: 1 } },
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.stringMatching(/2 fieldCells, over its limit of 1/)],
    });
  });

  it("hydrates field cards as field cards, not selectable hand cards", () => {
    const result = buildScenario(
      scenario(field([{ index: 0, cell: { x: 0, y: 0, z: 0 } }])),
      runtime,
    );
    if (!result.ok) throw new Error(result.diagnostics.join());
    expect(result.trial.run.state.field[0]!.block.traits.selectable).toBeUndefined();
  });

  it("rewinds the trial's random stream when an action rolls back", () => {
    const result = buildScenario(scenario(), runtime);
    if (!result.ok) throw new Error(result.diagnostics.join());
    const run = result.trial.run as unknown as { random: () => number; randomCheckpoints: unknown };
    expect(run.randomCheckpoints).not.toBeNull();
  });
});

describe("Dev scenario list shapes (#877 review)", () => {
  it("rejects a required list given as something else, rather than setting up nothing", () => {
    const problems = (step: ScenarioStep) => {
      const result = buildScenario(scenario(step), runtime);
      return result.ok ? [] : result.diagnostics;
    };
    expect(problems({ capability: "devHand", config: { indices: {} } })).toEqual([
      "devHand: needs a list of indices",
    ]);
    expect(problems({ capability: "devPassives", config: { passives: {} } })).toEqual([
      "devPassives: needs a list of passives",
    ]);
    expect(problems({ capability: "devReplay", config: { commands: {} } })).toEqual([
      "devReplay: needs a list of commands",
    ]);
  });
});

describe("the deck budget (#877 review)", () => {
  it("stops building as soon as the deck exceeds its card limit", () => {
    const result = buildScenario(
      {
        version: scenarioVersion,
        seed: 1,
        steps: [
          {
            capability: "devDeck",
            config: {
              steps: Array.from({ length: 11 }, () => ({
                operation: "standardTemplates",
                config: {},
              })),
            },
          },
        ],
      },
      runtime,
    );
    expect(result).toEqual({ ok: false, diagnostics: [expect.stringMatching(/512-card budget/)] });
  });
});
