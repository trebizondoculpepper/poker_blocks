/**
 * In the Loop (#886; doc/experiments/in-the-loop.md, doc/hoop-query.md): a provisional passive.
 * While the occupied field has at least one face-connected hoop or through-tunnel, each scored
 * row gets an exponent contribution of 1.2, once per installed copy, through the ordinary power
 * phase (increases above 1 add). More holes or a longer tunnel add nothing.
 *
 * Its effect, `power-line-score-if-query`, asks a registered boolean context query about the
 * scoring pass's own snapshot: no topology here. The whole-field query is asked with no scope, so
 * every row of a pass shares one result. An unavailable query contributes the neutral exponent 1,
 * reported with a captured "topology not measured" note, never as "no loop".
 */
import { query } from "./context-queries";
import { outcomeFormatters, formatNumber } from "./activation-descriptor";
import { passiveDefinitions, type PassiveDefinition } from "./passives";
import { raiseLine, ruleHandlers } from "./rule-handlers";
import "./hoop-query";

/** A conditional exponent: `power` when the query's boolean `value` holds, else neutral. */
export type QueryPowerConfig = { query: string; value: string; power: number };

ruleHandlers.registerEffect<QueryPowerConfig, unknown>(
  "power-line-score-if-query",
  (config, _selected, frame) => {
    const snapshot = frame.event.score?.snapshot;
    const result = snapshot ? query<Record<string, unknown>>(config.query, snapshot) : null;
    if (result?.available !== true) {
      const reason = result ? `: ${result.reason}` : "";
      return raiseLine(frame, 1, "power-line-score-if-query", `topology not measured${reason}`);
    }
    return raiseLine(
      frame,
      result.value[config.value] === true ? config.power : 1,
      "power-line-score-if-query",
    );
  },
);

// What it did: its exponent when it applied, its fallback note when unmeasured, else nothing.
outcomeFormatters.register("power-line-score-if-query", (outcome) =>
  (outcome.operand ?? 1) !== 1 ? `^${formatNumber(outcome.operand!)}` : (outcome.note ?? null),
);

/** The agreed initial contribution (owner decision #882). */
export const inTheLoopPower = 1.2;

export const inTheLoop: PassiveDefinition = {
  id: "trial-in-the-loop",
  // Experimental catalogues only, never normal shops (doc/release-status.md).
  releaseStatus: { provisional: {} },
  lifecycle: { parent: "rackItem" },
  name: "In the Loop",
  symbol: "◎",
  description:
    "While the field has a hoop or tunnel (blocks joined face to face), raises each scored row to ^1.2. Provisional trial.",
  traitId: "passive.event-rules",
  categoryTrait: { scoringCategory: { operations: ["exponential"] } },
  eventRules: [
    {
      on: "score.linePower",
      select: { id: "scored-line", config: {} },
      where: { id: "always", config: {} },
      effects: [
        {
          id: "power-line-score-if-query",
          config: { query: "faceHoop", value: "hasLoop", power: inTheLoopPower },
        },
      ],
    },
  ],
};
passiveDefinitions.register(inTheLoop.id, inTheLoop);
