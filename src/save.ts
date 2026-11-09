import type { CardBlock } from "./cards";
import type { Registry } from "./core/registry";
import type { Dealer } from "./dealer";
import type { RunPhase, RunSnapshot } from "./game-run";
import type { GameState } from "./game-state";
import type { Cell } from "./traits/attachable";
import { withoutSelectable } from "./traits/selectable";
import { parseRunStats, type RunStats } from "./run-stats";
import { createPassiveBlock } from "./passives";
import { stageKinds, type StageKind } from "./run-rules";

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
  phase: RunPhase;
  /** Stage immediately before this shop; absent in older boss-only shop saves. */
  shopAfter?: StageKind;
  dealer: string;
  state: {
    field: { cardId: string; cell: Cell }[];
    hand: string[];
    deck: string[];
    discardPile: string[];
    /** Optional to keep previously saved runs readable. */
    passiveRack?: { id: string; definitionId: string }[];
    shopStock?: (
      | { kind: "card"; cardId: string }
      | { kind: "passive"; id: string; definitionId: string }
    )[];
    /** Optional so runs saved before the economy was added begin with zero coins. */
    coins?: number;
    round: GameState["round"];
  };
  /** Added after version 1 shipped; optional so older saves still load. */
  stats?: RunStats;
  /** The last stage paid out and its ledger, so a reload never pays it twice. */
  rewarded?: RunSnapshot["rewarded"];
};

const phases: readonly RunPhase[] = ["stage-1", "stage-2", "boss", "shop", "over"];

export function toSaveRecord(snapshot: RunSnapshot): SaveRecord {
  const ids = (blocks: readonly CardBlock[]) => blocks.map(({ id }) => id);
  const { state } = snapshot;
  return {
    version: saveVersion,
    round: snapshot.round,
    phase: snapshot.phase,
    ...(snapshot.shopAfter ? { shopAfter: snapshot.shopAfter } : {}),
    dealer: snapshot.dealer,
    state: {
      field: state.field.map(({ block, cell }) => ({ cardId: block.id, cell: { ...cell } })),
      hand: ids(state.hand),
      deck: ids(state.deck),
      discardPile: ids(state.discardPile),
      passiveRack: state.passiveRack.map(({ id, definitionId }) => ({ id, definitionId })),
      ...(state.shopStock
        ? {
            shopStock: state.shopStock.map((offer) =>
              offer.kind === "card"
                ? { kind: "card" as const, cardId: offer.block.id }
                : {
                    kind: "passive" as const,
                    id: offer.block.id,
                    definitionId: offer.block.definitionId,
                  },
            ),
          }
        : {}),
      coins: state.coins,
      round: { ...state.round },
    },
    ...(snapshot.stats ? { stats: { ...snapshot.stats } } : {}),
    ...(snapshot.rewarded ? { rewarded: snapshot.rewarded } : {}),
  };
}

/** Rebuild a snapshot, or null if the record is corrupt, from another version, or inconsistent. */
export function fromSaveRecord(
  value: unknown,
  cards: readonly CardBlock[],
  dealers: Registry<Dealer>,
): RunSnapshot | null {
  try {
    const record = value as SaveRecord;
    if (record?.version !== saveVersion) return null;
    if (!Number.isInteger(record.round) || record.round < 1) return null;
    if (!phases.includes(record.phase) || record.phase === "over") return null;
    if (record.shopAfter !== undefined && !stageKinds.includes(record.shopAfter)) return null;
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
    const passiveIds = new Set<string>();
    const passiveRack = (state.passiveRack ?? []).map(({ id, definitionId }) => {
      if (typeof id !== "string" || passiveIds.has(id) || typeof definitionId !== "string") {
        throw new Error("bad passive");
      }
      passiveIds.add(id);
      return createPassiveBlock(definitionId, id);
    });
    const shopStock = (state.shopStock ?? []).map((offer) => {
      if (offer.kind === "card") return { kind: "card" as const, block: resolve(offer.cardId) };
      if (offer.kind !== "passive" || typeof offer.id !== "string" || passiveIds.has(offer.id))
        throw new Error("bad shop offer");
      passiveIds.add(offer.id);
      return {
        kind: "passive" as const,
        block: createPassiveBlock(offer.definitionId, offer.id),
      };
    });
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
      passiveRack,
      ...(state.shopStock ? { shopStock } : {}),
      coins: nonnegativeInteger(state.coins ?? 0),
      round: {
        score: number(state.round.score),
        targetScore: number(state.round.targetScore),
        movesLeft: number(state.round.movesLeft),
        discardsLeft: number(state.round.discardsLeft),
      },
    };
    if (seen.size !== cards.length) return null;
    return {
      round: record.round,
      phase: record.phase,
      ...(record.phase === "shop" && record.shopAfter ? { shopAfter: record.shopAfter } : {}),
      dealer: record.dealer,
      state: restored,
      stats: parseRunStats(record.stats),
      ...parseRewarded(record.rewarded),
    };
  } catch {
    return null;
  }
}

/** A saved "already paid" marker, or nothing if it is missing or malformed. */
function parseRewarded(value: unknown): { rewarded: NonNullable<RunSnapshot["rewarded"]> } | null {
  const saved = value as RunSnapshot["rewarded"];
  if (!saved || typeof saved.stage !== "string" || !Array.isArray(saved.reward?.entries))
    return null;
  const entries = saved.reward.entries
    .filter((entry) => typeof entry?.label === "string" && Number.isFinite(entry?.coins))
    .map(({ source, label, coins }) => ({ source: String(source), label, coins }));
  return {
    rewarded: {
      stage: saved.stage,
      reward: {
        entries,
        balanceBefore: Number(saved.reward.balanceBefore) || 0,
        balance: Number(saved.reward.balance) || 0,
      },
    },
  };
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("bad number");
  return value;
}

function nonnegativeInteger(value: unknown): number {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("bad coin balance");
  return parsed;
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
  snapshot: RunSnapshot,
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
): RunSnapshot | null {
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
