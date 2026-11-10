/**
 * HUD panels service: the round status panel, the deck counter, the shop's coin counter and
 * the shop exit button. A scene shows the panels it composes through `show` and `hide`; the
 * game hands it a snapshot of the numbers, which are the same whatever is on show.
 */
import type { RoundOutcome } from "./dealer";
import { unlimited } from "./run-rules";

/** The independent panels a scene may show. */
export type HudPanel = "round" | "deck" | "coins" | "shopExit";

/**
 * The round panel's config, from the scene that shows it (#180): the stage's name in the
 * heading, and the next-action button's label for each stage outcome (none: no button).
 */
export type RoundPanelConfig = {
  stage: string;
  actions?: Readonly<Partial<Record<RoundOutcome, string>>>;
};
/** The shop exit button's config: its label. */
export type ShopExitConfig = { label: string };

/** What each panel is configured with by the scene showing it. */
export type HudPanelConfigs = {
  round: RoundPanelConfig;
  deck: { opens?: string };
  coins: Record<never, never>;
  shopExit: ShopExitConfig;
};

/** Each panel's config while a scene in front composes it; null while none does. */
export type ComposedPanels = { [Panel in HudPanel]: HudPanelConfigs[Panel] | null };

/** What the HUD shows at one moment. */
export type HudView = {
  round: number;
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
  /** A panel's element, for the HUD frame to place (#117). */
  element(panel: HudPanel): HTMLElement;
  /** A scene composing this panel, with this config, came to the front. */
  show<Panel extends HudPanel>(panel: Panel, config: HudPanelConfigs[Panel]): void;
  /** The scene showing this panel was exited. */
  hide(panel: HudPanel): void;
  render(view: HudView): void;
  /** Run when the player presses the HUD's next-action button or the shop exit. */
  onAction(handler: () => void): void;
  /** Run with a panel's configured action when the player selects that panel (#175). */
  onOpen(handler: (action: string) => void): void;
  dispose(): void;
};

const outcomeSuffixes: Record<RoundOutcome, string> = {
  playing: "",
  won: " · WON",
  lost: " · LOST",
};

const count = (n: number) => (n >= unlimited / 2 ? "∞" : String(n));

/** What each panel shows for a view: pure, so it is tested without a DOM. */
export type HudDisplay = {
  /** Which panels are on show, as composed by the scene in front. */
  visible: Record<HudPanel, boolean>;
  /** The round panel's next-action button label, or null to hide it. */
  action: string | null;
  /** The shop exit button's label, or null to hide it. */
  exit: string | null;
  stats: Record<
    "heading" | "score" | "target" | "moves" | "discards" | "coins" | "shop-coins" | "deck",
    string
  >;
};

export function hudDisplay(view: HudView, composed: Readonly<ComposedPanels>): HudDisplay {
  const outcome = view.presenting ? "playing" : view.outcome;
  // Nothing to press while a play is still landing or being scored.
  const action = view.presenting ? null : (composed.round?.actions?.[outcome] ?? null);
  const exit = view.presenting ? null : (composed.shopExit?.label ?? null);
  const heading = [`ROUND ${view.round}`, composed.round?.stage].filter(Boolean).join(" · ");
  return {
    visible: {
      round: composed.round !== null,
      deck: composed.deck !== null,
      coins: composed.coins !== null,
      shopExit: exit !== null,
    },
    action,
    exit,
    stats: {
      heading: `${heading}${outcomeSuffixes[outcome]}`,
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
  // Selecting the counter opens what its scene configures (the deck view, #175).
  deckHud.dataset.interactive = "";
  deckHud.tabIndex = 0;
  deckHud.setAttribute("role", "button");
  deckHud.setAttribute("aria-label", "View your deck");
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
  const composed: ComposedPanels = { round: null, deck: null, coins: null, shopExit: null };
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
  const openers: ((action: string) => void)[] = [];
  const openDeck = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    for (const action of [composed.deck?.opens ?? []].flat())
      openers.forEach((open) => open(action));
  };
  deckHud.addEventListener("click", openDeck);
  deckHud.addEventListener("keydown", openDeck);

  return {
    element: (panel) => elements[panel],
    show(panel, config) {
      (composed as Record<HudPanel, unknown>)[panel] = config;
      // A panel can arrive before its numbers do; reveal it now so it is not blank.
      elements[panel].hidden = false;
    },
    hide(panel) {
      composed[panel] = null;
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
      shopExitButton.textContent = display.exit ?? "";
      for (const [name, text] of Object.entries(display.stats)) stat(name).textContent = text;
    },
    onAction(handler) {
      handlers.push(handler);
    },
    onOpen(handler) {
      openers.push(handler);
    },
    dispose() {
      actionButton.removeEventListener("click", runAction);
      shopExitButton.removeEventListener("click", runAction);
      for (const element of [...panels, shopExitButton]) element.remove();
    },
  };
}
