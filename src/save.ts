import type { CardBlock } from "./cards";
import type { Registry } from "./core/registry";
import type { Dealer } from "./dealer";
import type { Phase, SessionSnapshot } from "./game-session";
import type { GameState } from "./game-state";
import type { Cell } from "./traits/attachable";
import { withoutSelectable } from "./traits/selectable";

/**
 * Saved runs store card ids, not CardBlock objects: some traits hold functions, and the
 * deck definition is the source of truth for what a card is. Bump the version when the
 * shape changes; older records are then ignored rather than misread.
 */
export const saveVersion = 1;
export const saveKey = "poker-blocks.run";

export type SaveRecord = {
  version: typeof saveVersion;
  round: number;
  phase: Phase;
  dealer: string;
  state: {
    field: { cardId: string; cell: Cell }[];
    hand: string[];
    deck: string[];
    discardPile: string[];
    round: GameState["round"];
  };
};

const phases: readonly Phase[] = ["stage-1", "stage-2", "boss", "shop", "over"];

export function toSaveRecord(snapshot: SessionSnapshot): SaveRecord {
  const ids = (blocks: readonly CardBlock[]) => blocks.map(({ id }) => id);
  const { state } = snapshot;
  return {
    version: saveVersion,
    round: snapshot.round,
    phase: snapshot.phase,
    dealer: snapshot.dealer,
    state: {
      field: state.field.map(({ block, cell }) => ({ cardId: block.id, cell: { ...cell } })),
      hand: ids(state.hand),
      deck: ids(state.deck),
      discardPile: ids(state.discardPile),
      round: { ...state.round },
    },
  };
}

/** Rebuild a snapshot, or null if the record is corrupt, from another version, or inconsistent. */
export function fromSaveRecord(
  value: unknown,
  cards: readonly CardBlock[],
  dealers: Registry<Dealer>,
): SessionSnapshot | null {
  try {
    const record = value as SaveRecord;
    if (record?.version !== saveVersion) return null;
    if (!Number.isInteger(record.round) || record.round < 1) return null;
    if (!phases.includes(record.phase) || record.phase === "over") return null;
    if (!dealers.has(record.dealer)) return null;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const seen = new Set<string>();
    const resolve = (id: unknown): CardBlock => {
      if (typeof id !== "string" || seen.has(id)) throw new Error("bad card");
      const card = byId.get(id);
      if (!card) throw new Error("unknown card");
      seen.add(id);
      return card;
    };
    const { state } = record;
    const field = state.field.map(({ cardId, cell }) => {
      if (![cell?.x, cell?.y, cell?.z].every(Number.isInteger)) throw new Error("bad cell");
      return {
        block: withoutSelectable(resolve(cardId)),
        cell: { x: cell.x, y: cell.y, z: cell.z },
      };
    });
    const restored: GameState = {
      field,
      hand: state.hand.map(resolve),
      deck: state.deck.map(resolve),
      discardPile: state.discardPile.map(resolve),
      round: {
        score: number(state.round.score),
        targetScore: number(state.round.targetScore),
        movesLeft: number(state.round.movesLeft),
        discardsLeft: number(state.round.discardsLeft),
      },
    };
    if (seen.size !== cards.length) return null;
    return { round: record.round, phase: record.phase, dealer: record.dealer, state: restored };
  } catch {
    return null;
  }
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("bad number");
  return value;
}

/** Storage that may be missing or throw (private mode, blocked site data). */
export type SaveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): SaveStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Save a run, or clear the save once the run is over. Returns false if storage failed. */
export function saveRun(
  storage: SaveStorage | null,
  snapshot: SessionSnapshot,
  key = saveKey,
): boolean {
  if (!storage) return false;
  try {
    if (snapshot.phase === "over") storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(toSaveRecord(snapshot)));
    return true;
  } catch {
    return false;
  }
}

export function loadRun(
  storage: SaveStorage | null,
  cards: readonly CardBlock[],
  dealers: Registry<Dealer>,
  key = saveKey,
): SessionSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? fromSaveRecord(JSON.parse(raw), cards, dealers) : null;
  } catch {
    return null;
  }
}

export function clearRun(storage: SaveStorage | null): void {
  try {
    storage?.removeItem(saveKey);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
