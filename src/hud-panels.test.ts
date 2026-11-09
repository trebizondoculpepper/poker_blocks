import { describe, expect, it } from "vite-plus/test";
import { hudDisplay, type HudPanel, type HudView } from "./hud-panels";
import { unlimited } from "./run-rules";

const stageView: HudView = {
  round: 2,
  phase: "boss",
  presenting: false,
  outcome: "playing",
  score: 40,
  targetScore: 300,
  movesLeft: 3,
  discardsLeft: unlimited,
  coins: 7,
  deckSize: 31,
};

const composed = (...panels: HudPanel[]): Record<HudPanel, boolean> => ({
  round: panels.includes("round"),
  deck: panels.includes("deck"),
  coins: panels.includes("coins"),
  shopExit: panels.includes("shopExit"),
});

describe("HUD panels", () => {
  it("shows the round, stage, score and counters, with ∞ for unlimited", () => {
    const display = hudDisplay(stageView, composed("round", "deck"));
    expect(display.stats).toEqual({
      heading: "ROUND 2 · BOSS STAGE",
      score: "40",
      target: "300",
      moves: "3",
      discards: "∞",
      coins: "7",
      "shop-coins": "7",
      deck: "31",
    });
    expect(display.action).toBeNull();
    expect(display.visible).toEqual({ round: true, deck: true, coins: false, shopExit: false });
  });

  it("announces a lost stage and offers to end the game, but not while a play is presenting", () => {
    const lost = hudDisplay({ ...stageView, outcome: "lost" }, composed("round", "deck"));
    expect(lost.stats.heading).toBe("ROUND 2 · BOSS STAGE · LOST");
    expect(lost.action).toBe("End game");

    const presenting = hudDisplay(
      { ...stageView, outcome: "lost", presenting: true },
      composed("round", "deck"),
    );
    expect(presenting.stats.heading).toBe("ROUND 2 · BOSS STAGE");
    expect(presenting.action).toBeNull();
  });

  it("leaves a won stage to its pop-up", () => {
    const won = hudDisplay({ ...stageView, outcome: "won" }, composed("round", "deck"));
    expect(won.stats.heading).toBe("ROUND 2 · BOSS STAGE · WON");
    expect(won.action).toBeNull();
  });

  it("shows only the panels the scene composes, and the shop exit when the shop has one", () => {
    const shop = hudDisplay({ ...stageView, phase: "shop" }, composed("coins", "shopExit"));
    expect(shop.visible).toEqual({ round: false, deck: false, coins: true, shopExit: true });
    expect(shop.action).toBe("Continue / Skip shop");
    expect(shop.stats.heading).toBe("ROUND 2 · SHOP");
  });

  it("offers a new game when the run is over, without a shop exit", () => {
    const over = hudDisplay({ ...stageView, phase: "over" }, composed());
    expect(over.action).toBe("New game");
    expect(over.visible.shopExit).toBe(false);
    expect(over.stats.heading).toBe("ROUND 2 · GAME OVER");
  });

  it("shows each panel independently of the others", () => {
    // A scene may compose any subset: one panel on show leaves the rest off.
    for (const panel of ["round", "deck", "coins"] as const) {
      const display = hudDisplay(stageView, composed(panel));
      expect(display.visible[panel]).toBe(true);
      expect(Object.entries(display.visible).filter(([, on]) => on)).toHaveLength(1);
    }
  });
});
