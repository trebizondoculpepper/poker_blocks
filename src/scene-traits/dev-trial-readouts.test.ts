import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import type { GameState, PlacedBlock } from "../game-state";
import { getMaterialDefinition, withMaterial } from "../materials";
import type { PassiveScoredLine } from "../passive-effects";
import { devTrialReadouts, readoutHtml, trialReadout } from "./dev-trial-readouts";

const round: GameState["round"] = { score: 42, targetScore: 100, movesLeft: 3, discardsLeft: 2 };
const placed = (index: number, x: number, material = "wood"): PlacedBlock => ({
  block: withMaterial(standardDeck[index]!, getMaterialDefinition(material as never)),
  cell: { x, y: 0, z: 0 },
});
const field = [placed(0, 0), placed(13, 1, "steel")];
const line = (points: number, outcomes: { operation: string; operand?: number }[] = []) =>
  ({
    blockIds: field.map(({ block }) => block.id),
    points,
    activations: outcomes.length ? [{ outcomes }] : [],
  }) as unknown as PassiveScoredLine;

const values = (rows: readonly { label: string }[]) =>
  Object.fromEntries(
    rows.map((row) => [
      row.label,
      "value" in row ? row.value : `(${(row as unknown as { unavailable: string }).unavailable})`,
    ]),
  );

describe("trial readouts (#904)", () => {
  it("measures the current field's geometry and mass", () => {
    const readout = trialReadout({ field, round }, []);
    const geometry = values(readout.geometry);
    expect(geometry.Occupied).toBe("2");
    expect(geometry.Bounds).toBe("2×1×1");
    expect(geometry.Capacity).toBe("2");
    expect(geometry.Packing).toBe("100.0%");
    expect(geometry["Total mass"]).toMatch(/kg$/);
    expect(readout.score).toBe(42);
    expect(readout.scored).toEqual([]);
  });

  it("shows an empty field's measures as unavailable, never zero", () => {
    const geometry = values(trialReadout({ field: [], round }, []).geometry);
    expect(geometry.Occupied).toBe("0");
    expect(geometry.Packing).toMatch(/^\(/);
    expect(geometry["Mean mass"]).toMatch(/^\(/);
  });

  it("reports each scored row's families, mass and applied contributions", () => {
    const readout = trialReadout({ field, round }, [
      line(30, [{ operation: "multiply-line-score-by-query", operand: 2 }]),
      line(10),
    ]);
    const [first, second] = readout.scored.map(({ rows }) => values(rows));
    expect(first!.Points).toBe("30");
    expect(first!.Families).toBe("2");
    expect(first!.Applied).toBe("multiply-line-score-by-query 2");
    expect(second!.Applied).toBe("(no contributions)");
    expect(readoutHtml(readout)).toContain("Last scored rows");
  });
});

describe("the devTrialReadouts trait (#904)", () => {
  const original = globalThis.document;
  afterEach(() => {
    globalThis.document = original;
  });

  it("subscribes once on enter, renders each commit, and unsubscribes on exit", () => {
    const panels: { innerHTML: string; removed: boolean }[] = [];
    globalThis.document = {
      createElement: () => {
        const panel = {
          innerHTML: "",
          removed: false,
          className: "",
          setAttribute: () => {},
          remove() {
            panel.removed = true;
          },
        };
        panels.push(panel);
        return panel;
      },
    } as unknown as Document;
    const listeners = new Set<(facts: readonly { type: string }[]) => void>();
    let state = { field: [] as PlacedBlock[], round };
    const context = {
      host: { append: () => {} } as unknown as HTMLElement,
      services: {
        run: {
          committedState: () => state,
          lastScoredLines: () => [line(30)],
          onCommitted(listener: (facts: readonly { type: string }[]) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    };
    const trait = devTrialReadouts<never>();
    trait.enter!(context as never, {});
    expect(listeners.size).toBe(1);
    expect(panels[0]!.innerHTML).toContain("No rows scored yet");
    state = { field, round };
    for (const listener of listeners) listener([{ type: "x", payload: { score: {} } }] as never);
    expect(panels[0]!.innerHTML).toContain("Row 1");
    // A discard scores nothing: the panel stops claiming the old rows as this action's.
    for (const listener of listeners) listener([{ type: "x", payload: {} }] as never);
    expect(panels[0]!.innerHTML).toContain("No rows scored yet");
    // Re-entering rebinds without a second subscription.
    trait.enter!(context as never, {});
    expect(listeners.size).toBe(1);
    trait.exit!(context as never, {});
    expect(listeners.size).toBe(0);
    expect(panels.every(({ removed }) => removed)).toBe(true);
  });
});
