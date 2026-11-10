import { describe, expect, it } from "vite-plus/test";
import { hudDisplay, type ComposedPanels, type HudPanel, type HudView } from "./hud-panels";
import { unlimited } from "./run-rules";

const stageView: HudView = {
  round: 2,
  presenting: false,
  outcome: "playing",
  score: 40,
  targetScore: 300,
  movesLeft: 3,
  discardsLeft: unlimited,
  coins: 7,
  deckSize: 31,
};

/** The configs the scene in front gives its panels: as the boss and shop scenes do. */
const configs: { [Panel in HudPanel]: NonNullable<ComposedPanels[Panel]> } = {
  round: { stage: "BOSS STAGE", actions: { lost: "End game" } },
  deck: {},
  coins: {},
  shopExit: { label: "Continue / Skip shop" },
};
const composed = (...panels: HudPanel[]): ComposedPanels => ({
  round: panels.includes("round") ? configs.round : null,
  deck: panels.includes("deck") ? configs.deck : null,
  coins: panels.includes("coins") ? configs.coins : null,
  shopExit: panels.includes("shopExit") ? configs.shopExit : null,
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

  it("keeps large finite stage targets visible while showing the unlimited sentinel as ∞", () => {
    expect(hudDisplay({ ...stageView, targetScore: 655_897 }, composed("round")).stats.target).toBe(
      "655897",
    );
    expect(
      hudDisplay({ ...stageView, targetScore: unlimited }, composed("round")).stats.target,
    ).toBe("∞");
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

  it("shows only the panels the scene composes, and the shop exit with its own label", () => {
    const shop = hudDisplay(stageView, composed("coins", "shopExit"));
    expect(shop.visible).toEqual({ round: false, deck: false, coins: true, shopExit: true });
    expect(shop.exit).toBe("Continue / Skip shop");
    expect(shop.action).toBeNull();
  });

  it("offers nothing when no scene in front composes a panel (game over)", () => {
    const over = hudDisplay(stageView, composed());
    expect(over.action).toBeNull();
    expect(over.exit).toBeNull();
    expect(over.visible).toEqual({ round: false, deck: false, coins: false, shopExit: false });
  });

  it("shows whatever a scene configures, with no change here (#180)", () => {
    const display = hudDisplay(
      { ...stageView, outcome: "won" },
      { ...composed("round"), round: { stage: "TEST STAGE", actions: { won: "Onward" } } },
    );
    expect(display.stats.heading).toBe("ROUND 2 · TEST STAGE · WON");
    expect(display.action).toBe("Onward");
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
