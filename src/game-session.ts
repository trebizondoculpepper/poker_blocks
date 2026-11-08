import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { Dealer } from "./dealer";
import type { GameState, PlayAction } from "./game-state";

/** Keeps the current facts while letting a registered dealer change the rules. */
export class GameSession {
  private readonly dealers: Registry<Dealer>;
  private activeDealer: Dealer;
  private currentState: GameState;

  constructor(
    dealers: Registry<Dealer>,
    dealerName: string,
    cards: readonly CardBlock[],
    random?: () => number,
  ) {
    this.dealers = dealers;
    this.activeDealer = dealers.get(dealerName);
    this.currentState = this.activeDealer.startGame(cards, random);
  }

  get dealer(): Dealer {
    return this.activeDealer;
  }

  get state(): GameState {
    return this.currentState;
  }

  useDealer(name: string): void {
    this.activeDealer = this.dealers.get(name);
  }

  play(action: PlayAction): GameState | null {
    const next = this.activeDealer.play(this.currentState, action);
    if (next) this.currentState = next;
    return next;
  }

  discard(cardId: string): GameState | null {
    const next = this.activeDealer.discard(this.currentState, cardId);
    if (next) this.currentState = next;
    return next;
  }

  refillHand(random?: () => number): CardBlock[] {
    const result = this.activeDealer.refillHand(this.currentState, random);
    this.currentState = result.state;
    return result.drawn;
  }
}
