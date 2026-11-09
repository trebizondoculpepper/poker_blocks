/**
 * HUD panels service: the round status panel, the deck counter, the shop's coin counter and
 * the shop exit button. A scene shows the panels it composes through `show` and `hide`; the
 * game hands it a snapshot of the numbers, which are the same whatever is on show.
 */
import type { RoundOutcome } from "./dealer";
import type { RunPhase } from "./game-run";
import { unlimited } from "./run-rules";

/** The independent panels a scene may show. */
export type HudPanel = "round" | "deck" | "coins" | "shopExit";

/** What the HUD shows at one moment. */
export type HudView = {
  round: number;
  phase: RunPhase;
  /** A play is still landing or being scored: hide outcomes and the next-action button. */
  presenting: boolean;
  /** The stage outcome to announce ("playing" while undecided or outside a stage). */
  outcome: RoundOutcome;
  /** The score shown, which lags the state until the placed card lands. */
  score: number;
  targetScore: number;
  movesLeft: number;
  discardsLeft: number;
  coins: number;
  deckSize: number;
};

export type HudPanels = {
  /** A scene composing this panel came to the front. */
  show(panel: HudPanel): void;
  /** The scene showing this panel was exited. */
  hide(panel: HudPanel): void;
  render(view: HudView): void;
  /** Run when the player presses the HUD's next-action button or the shop exit. */
  onAction(handler: () => void): void;
  dispose(): void;
};

const phaseNames: Record<RunPhase, string> = {
  "stage-1": "STAGE 1",
  "stage-2": "STAGE 2",
  boss: "BOSS STAGE",
  shop: "SHOP",
  over: "GAME OVER",
};

const outcomeSuffixes: Record<RoundOutcome, string> = {
  playing: "",
  won: " · WON",
  lost: " · LOST",
};

/** A lost stage can be ended from the HUD; a won one moves on from its Stage Won pop-up. */
const stageActionLabels: Record<RoundOutcome, string | null> = {
  playing: null,
  won: null,
  lost: "End game",
};

/** The HUD button's label for the current moment, or null when there is nothing to do. */
const nextActionLabels: Record<RunPhase, (outcome: RoundOutcome) => string | null> = {
  "stage-1": (outcome) => stageActionLabels[outcome],
  "stage-2": (outcome) => stageActionLabels[outcome],
  boss: (outcome) => stageActionLabels[outcome],
  shop: () => "Continue / Skip shop",
  over: () => "New game",
};

const count = (n: number) => (n >= unlimited / 2 ? "∞" : String(n));

/** What each panel shows for a view: pure, so it is tested without a DOM. */
export type HudDisplay = {
  /** Which panels are on show, as composed by the scene in front. */
  visible: Record<HudPanel, boolean>;
  /** The next-action button's label, or null to hide it. */
  action: string | null;
  stats: Record<
    "heading" | "score" | "target" | "moves" | "discards" | "coins" | "shop-coins" | "deck",
    string
  >;
};

export function hudDisplay(
  view: HudView,
  composed: Readonly<Record<HudPanel, boolean>>,
): HudDisplay {
  const outcome = view.presenting ? "playing" : view.outcome;
  const action = view.presenting ? null : nextActionLabels[view.phase](outcome);
  return {
    visible: {
      round: composed.round,
      deck: composed.deck,
      coins: composed.coins,
      shopExit: composed.shopExit && action !== null,
    },
    action,
    stats: {
      heading: `ROUND ${view.round} · ${phaseNames[view.phase]}${outcomeSuffixes[outcome]}`,
      score: String(view.score),
      target: count(view.targetScore),
      moves: count(view.movesLeft),
      discards: count(view.discardsLeft),
      coins: String(view.coins),
      "shop-coins": String(view.coins),
      deck: String(view.deckSize),
    },
  };
}

export function createHudPanels(host: HTMLElement): HudPanels {
  const roundHud = document.createElement("aside");
  roundHud.className = "round-hud";
  roundHud.setAttribute("aria-label", "Round status");
  roundHud.innerHTML = `
  <div class="hud-heading" data-stat="heading">ROUND</div>
  <div class="hud-row"><span>Score</span><strong data-stat="score"></strong></div>
  <div class="hud-row"><span>Target</span><strong data-stat="target"></strong></div>
  <div class="hud-divider"></div>
  <div class="hud-row"><span>Moves</span><strong data-stat="moves"></strong></div>
  <div class="hud-row"><span>Discards</span><strong data-stat="discards"></strong></div>
  <div class="hud-divider"></div>
  <div class="hud-row"><span>Coins</span><strong data-stat="coins"></strong></div>
  <button class="hud-action" type="button" data-stat="action" hidden></button>
`;
  host.append(roundHud);
  const deckHud = document.createElement("aside");
  deckHud.className = "deck-hud";
  deckHud.innerHTML =
    '<span>DECK</span><strong data-stat="deck"></strong><small>cards left</small>';
  host.append(deckHud);
  const coinHud = document.createElement("aside");
  coinHud.className = "coin-hud";
  coinHud.setAttribute("aria-label", "Coins");
  coinHud.innerHTML = '<span>COINS</span><strong data-stat="shop-coins"></strong>';
  coinHud.hidden = true;
  host.append(coinHud);
  const shopExitButton = document.createElement("button");
  shopExitButton.className = "hud-action shop-exit";
  shopExitButton.type = "button";
  shopExitButton.hidden = true;
  host.append(shopExitButton);

  const panels = [roundHud, deckHud, coinHud];
  /** Which panels the scene in front composes; `render` applies it to the DOM. */
  const composed: Record<HudPanel, boolean> = {
    round: false,
    deck: false,
    coins: false,
    shopExit: false,
  };
  const elements: Record<HudPanel, HTMLElement> = {
    round: roundHud,
    deck: deckHud,
    coins: coinHud,
    shopExit: shopExitButton,
  };
  const stat = (name: string) =>
    panels
      .map((panel) => panel.querySelector<HTMLElement>(`[data-stat="${name}"]`))
      .find((found) => found !== null)!;
  const actionButton = stat("action") as HTMLButtonElement;
  const handlers: (() => void)[] = [];
  const runAction = () => handlers.forEach((handler) => handler());
  actionButton.addEventListener("click", runAction);
  shopExitButton.addEventListener("click", runAction);

  return {
    show(panel) {
      composed[panel] = true;
      // A panel can arrive before its numbers do; reveal it now so it is not blank.
      elements[panel].hidden = false;
    },
    hide(panel) {
      composed[panel] = false;
      elements[panel].hidden = true;
    },
    render(view) {
      const display = hudDisplay(view, composed);
      roundHud.hidden = !display.visible.round;
      deckHud.hidden = !display.visible.deck;
      coinHud.hidden = !display.visible.coins;
      actionButton.hidden = display.action === null;
      actionButton.textContent = display.action ?? "";
      shopExitButton.hidden = !display.visible.shopExit;
      shopExitButton.textContent = display.action ?? "";
      for (const [name, text] of Object.entries(display.stats)) stat(name).textContent = text;
    },
    onAction(handler) {
      handlers.push(handler);
    },
    dispose() {
      actionButton.removeEventListener("click", runAction);
      shopExitButton.removeEventListener("click", runAction);
      for (const element of [...panels, shopExitButton]) element.remove();
    },
  };
}
