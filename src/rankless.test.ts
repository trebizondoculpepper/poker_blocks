import { describe, expect, it } from "vite-plus/test";
import { MissingValueProvider, pokerIdentity, standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { devRanklessActive } from "./dev-rankless-active";
import { GameRun } from "./game-run";
import { ruleHandlers } from "./rule-handlers";
import type { RunRules } from "./run-rules";
import { evaluateHand } from "./scoring";

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
const rules: RunRules = {
  stage: () => ({ dealer: "base", targetScore: 1000, plays: 3, discards: 2 }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
};

/** A run whose hand holds a rankless active and an ordinary card. */
function runWithRankless() {
  const rankless = devRanklessActive("dev-rankless-1");
  const opening = new GameRun(dealers, rules, standardDeck, () => 0);
  const hand = [rankless, standardDeck[0]!, standardDeck[1]!];
  const run = GameRun.fromSnapshot(
    dealers,
    rules,
    standardDeck,
    { ...opening.snapshot(), state: { ...opening.state, hand } },
    () => 0,
  );
  return { run, rankless };
}

describe("rankless actives: optional value provider (#892)", () => {
  it("has no rank or suit, and pokerIdentity refuses rather than fabricating one", () => {
    const rankless = devRanklessActive("r");
    expect(rankless.traits.identity).toBeUndefined();
    expect(() => pokerIdentity(rankless)).toThrow(MissingValueProvider);
    expect(pokerIdentity(standardDeck[0]!)).toBe(standardDeck[0]!.traits.identity);
  });

  it("cannot reach poker evaluation", () => {
    expect(() => evaluateHand([standardDeck[0]!, devRanklessActive("r")])).toThrow(
      MissingValueProvider,
    );
  });

  it("matches no rank or suit condition (a no-value behaviour, not a flag)", () => {
    const rankless = devRanklessActive("r");
    const condition = (id: string) =>
      (
        ruleHandlers as unknown as { conditions: Map<string, (...args: unknown[]) => boolean> }
      ).conditions.get(id)!;
    expect(condition("suit-in")({ suits: ["hearts"] }, rankless, {})).toBe(false);
    expect(condition("rank-is")({ rank: "A" }, rankless, {})).toBe(false);
  });

  it("refuses a committed play that would score it, rolling everything back", () => {
    const { run, rankless } = runWithRankless();
    expect(run.play({ cardId: standardDeck[0]!.id })).not.toBeNull();
    const before = run.state;
    const target = run.state.field[0]!.block.id;
    expect(run.play({ cardId: rankless.id, targetId: target, face: "east" })).toBeNull();
    expect(run.actionFailure).toBeInstanceOf(MissingValueProvider);
    expect(run.state).toBe(before);
  });

  it("leaves ordinary scoring unchanged", () => {
    const pair = [standardDeck[0]!, standardDeck[13]!];
    expect(evaluateHand(pair).hand).toBe("pair");
  });
});
