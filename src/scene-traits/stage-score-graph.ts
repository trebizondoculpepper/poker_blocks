/**
 * stageScoreGraph (#1064; doc/line-goes-up.md): the stage scene composes its score graph while it
 * is on the stack. Entering shows the graph at the configured room transform, drawn at once from
 * the stage's captured history; leaving hides it and releases everything it owned. The graph
 * service and the committed-score controller own the rest; this trait only decides when.
 */
import type { SceneTraitBehaviour } from "../scenes";
import type { StageScoreGraph, StageScoreGraphConfig } from "../stage-score-graph";

export function stageScoreGraph<
  Context extends { services: { scoreGraph: Pick<StageScoreGraph, "show" | "hide"> } },
>(): SceneTraitBehaviour<Context, StageScoreGraphConfig> {
  return {
    enter({ services }, config) {
      services.scoreGraph.show(config);
    },
    exit({ services }) {
      services.scoreGraph.hide();
    },
  };
}
