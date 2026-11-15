import * as THREE from "three";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { graphProducer, type GraphSeries } from "./score-graph-controller";
import {
  createStageScoreGraph,
  stageGraphPlot,
  stageGraphSummary,
  type StageScoreGraphHost,
} from "./stage-score-graph";
import { startStageHistory } from "./stage-score-history";

const series = (points: [number, number][], extra: Partial<GraphSeries> = {}): GraphSeries => ({
  plays: 6,
  targetScore: 300,
  points: points.map(([play, total]) => ({ play, total })),
  growth: 1,
  ...extra,
});

describe("the stage graph's plot data (#1064; doc/line-goes-up.md)", () => {
  it("spans the whole allowance on X from the outset and puts the target at 80% height", () => {
    const plot = stageGraphPlot(series([[0, 0]]));
    expect(plot.x).toMatchObject({ min: 0, max: 6 });
    expect(plot.x.ticks!.map(({ value }) => value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(plot.y.max).toBeCloseTo(300 / 0.8);
    expect(plot.references).toEqual([
      expect.objectContaining({ axis: "y", value: 300, label: "Target 300" }),
    ]);
    // Dotted, so it is told apart by more than colour.
    expect(plot.references![0]!.style.dash).toBeDefined();
  });

  it("follows another allowance and grows upward to keep an overshoot, never cropping it", () => {
    const plot = stageGraphPlot(
      series(
        [
          [0, 0],
          [1, 120],
          [2, 450],
        ],
        { plays: 4 },
      ),
    );
    expect(plot.x.max).toBe(4);
    expect(plot.y.max).toBeCloseTo(450 / 0.8);
    expect(plot.series[0]!.points.at(-1)).toEqual([2, 450]);
  });

  it("draws the newest segment only as far as its growth has reached", () => {
    const plot = stageGraphPlot(
      series(
        [
          [0, 0],
          [1, 100],
          [2, 200],
        ],
        { growth: 0.25 },
      ),
    );
    expect(plot.series[0]!.points).toEqual([
      [0, 0],
      [1, 100],
      [1.25, 125],
    ]);
  });

  it("shows a zero-score play as a point on the axis", () => {
    const plot = stageGraphPlot(
      series([
        [0, 0],
        [1, 0],
      ]),
    );
    expect(plot.series[0]!.points).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("draws no target, and divides by nothing, when the target is unavailable", () => {
    for (const targetScore of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plot = stageGraphPlot(
        series(
          [
            [0, 0],
            [1, 40],
          ],
          { targetScore },
        ),
      );
      expect(plot.references).toEqual([]);
      expect(Number.isFinite(plot.y.max) && plot.y.max > 0).toBe(true);
    }
    expect(stageGraphSummary(series([[0, 0]], { targetScore: 0 }))).toContain("target unavailable");
  });

  it("summarises score, target and plays in words", () => {
    expect(
      stageGraphSummary(
        series([
          [0, 0],
          [1, 80],
          [2, 150],
        ]),
      ),
    ).toBe("Stage score 150, target 300, after 2 of 6 plays.");
  });
});

describe("the stage graph service (#1064)", () => {
  const original = globalThis.document;
  afterEach(() => void (globalThis.document = original));

  function host() {
    const appended: {
      removed: boolean;
      textContent: string;
      attributes: Record<string, string>;
    }[] = [];
    globalThis.document = {
      createElement: () => {
        const element = {
          className: "",
          textContent: "",
          removed: false,
          style: {},
          attributes: {} as Record<string, string>,
          setAttribute(name: string, value: string) {
            element.attributes[name] = value;
          },
          remove() {
            element.removed = true;
          },
        };
        return element;
      },
    } as unknown as Document;
    const composed: string[] = [];
    let listening = 0;
    const room = new THREE.Group();
    const services: StageScoreGraphHost = {
      source: {
        onCommitted: () => {
          listening++;
          return () => void listening--;
        },
      },
      history: () => {
        const history = startStageHistory({ plays: 5, targetScore: 200 });
        return { ...history, entries: [{ actionId: "a", play: 1, delta: 60, total: 60 }] } as never;
      },
      phase: { latest: null, contributionFor: () => null },
      compose(producer) {
        composed.push(producer);
        return () => void composed.splice(composed.indexOf(producer), 1);
      },
      room,
      host: { append: (element: never) => void appended.push(element) } as unknown as HTMLElement,
    };
    return { services, composed, room, appended, listening: () => listening };
  }

  const config = { picture: { size: { width: 3, height: 2 }, position: [5, 1, -9] as const } };

  it("hangs the picture in the room, composes its producer and draws the stage at once", () => {
    const { services, composed, room, appended, listening } = host();
    const graph = createStageScoreGraph(services);
    graph.show(config);
    expect(room.children).toHaveLength(1);
    expect(room.children[0]!.position.toArray()).toEqual([5, 1, -9]);
    expect(composed).toEqual([graphProducer]);
    expect(listening()).toBe(1);
    // Restored without replay: the captured history, drawn at once.
    expect(appended[0]!.textContent).toBe("Stage score 60, target 200, after 1 of 5 plays.");
    // Its accessible name carries the same words, since an image's text is presentational.
    expect(appended[0]!.attributes["aria-label"]).toBe(
      "Stage score graph. Stage score 60, target 200, after 1 of 5 plays.",
    );
  });

  it("releases everything it owns on hide, once, and showing again never doubles up", () => {
    const { services, composed, room, appended, listening } = host();
    const graph = createStageScoreGraph(services);
    graph.show(config);
    graph.show(config);
    expect(room.children).toHaveLength(1);
    expect(composed).toEqual([graphProducer]);
    expect(listening()).toBe(1);
    graph.hide();
    graph.hide();
    expect(room.children).toHaveLength(0);
    expect(composed).toEqual([]);
    expect(listening()).toBe(0);
    expect(appended.every(({ removed }) => removed)).toBe(true);
    expect(graph.picture).toBeNull();
  });
});
