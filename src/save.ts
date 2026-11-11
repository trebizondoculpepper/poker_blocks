import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { Dealer } from "./dealer";
import type { RunPhase, RunSnapshot } from "./game-run";
import type { RandomCursor } from "./random";
import type { GameState } from "./game-state";
import type { Cell } from "./traits/attachable";
import { withoutSelectable } from "./traits/selectable";
// Registers the transmogrifier definitions, so saved rack items resolve (#388).
import "./transmogrifiers";
import "./nothingifier";
import { restoreModifierRegisters } from "./modifier-registers";
import { rackTraitPersistence } from "./rack-trait-persistence";
import { asGenerated } from "./card-ownership";
import { type CardState } from "./card-material";
import { applyCardStates } from "./card-states";
// Each registers how its saved card state is restored (#387, #365, #372).
import "./card-material";
import "./state-bonuses";
import "./cooking";
import { stateBonuses } from "./state-bonuses";
import { blockMaterials, type BlockMaterial } from "./materials";
import { parseRunStats, type RunStats } from "./run-stats";
import { createPassiveBlock, passiveDefinitions, type PassiveBlock } from "./passives";
import {
  isOfferKind,
  offerKind,
  restoreCard,
  saveCard,
  type OfferRestore,
  type SavedCard,
  type SavedOffer,
} from "./offer-kinds";
import { stageKinds, type StageKind } from "./run-rules";
import type { GameFlow, FlowTransition } from "./game-flow";
import type { SceneName } from "./game-modes";
import type { RunPositionOutcome } from "./game-run";
import { standardGameFlow } from "./standard-game-flow";

/** The mode's flow, which says which scene each run position shows. */
export type SaveFlow = GameFlow<RunPositionOutcome, SceneName>;

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
  /**
   * The scene the run was in, by name (the save key already names the mode). Saves written
   * before scenes were recorded have `phase` instead; see `legacyPhaseScenes`.
   */
  scene?: SceneName;
  /** Legacy: the run phase, in saves written before `scene`. Never written now. */
  phase?: RunPhase;
  /** Stage immediately before this shop; absent in older boss-only shop saves. */
  shopAfter?: StageKind;
  dealer: string;
  state: {
    field: { cardId: string; cell: Cell }[];
    hand: string[];
    deck: string[];
    discardPile: string[];
    /** Optional to keep previously saved runs readable. */
    passiveRack?: SavedRackItem[];
    /** Each offer as its kind saves it (src/offer-kinds.ts). */
    shopStock?: SavedOffer[];
    /** Cards bought this run, saved in full (#143); absent in older saves. */
    boughtCards?: SavedCard[];
    /** Cards made on the field during play (#424), saved in full; absent when there are none. */
    generatedCards?: SavedCard[];
    /** Cards removed for the rest of the run (#156), by id; absent when none. */
    removedCards?: string[];
    /** Cards whose material changed this run, by id (#387); absent in older saves. */
    cardStates?: Record<string, { material?: string; stateBonus?: string; doneness?: number }>;
    /** Optional so runs saved before the economy was added begin with zero coins. */
    coins?: number;
    round: GameState["round"];
  };
  /** Added after version 1 shipped; optional so older saves still load. */
  stats?: RunStats;
  /** The last stage paid out and its ledger, so a reload never pays it twice. */
  rewarded?: RunSnapshot["rewarded"];
  /**
   * The seed a run setup step dealt this run's deck from. Absent in saves written before run
   * setup existed, and in runs whose deck does not depend on one.
   */
  seed?: number;
  /** The session's random seed and its sequence position, so Continue resumes it (#134). */
  random?: { seed: number; position: number };
};

/**
 * How a legacy `phase` save migrates to a scene name: each stage and the shop to the matching
 * scene, and `over` to none, because a lost run is never resumed. An unknown phase is invalid.
 */
const legacyPhaseScenes: Readonly<Record<RunPhase, SceneName | null>> = {
  "stage-1": "stage-1",
  "stage-2": "stage-2",
  boss: "boss",
  shop: "shop",
  over: null,
};

/** The scene a transition shows; a pop shows none of its own. */
function sceneOf(transition: FlowTransition<SceneName> | undefined): SceneName | undefined {
  return transition && "scene" in transition ? transition.scene : undefined;
}

/** The scene a run position shows under a flow. */
function sceneForPhase(flow: SaveFlow, phase: RunPhase): SceneName {
  const scene = sceneOf(flow[`run.position.${phase}`]);
  if (!scene) throw new Error(`The flow shows no scene for ${phase}`);
  return scene;
}

/** The positions a run can be resumed in: any but a lost run's. */
const resumablePhases: readonly RunPhase[] = ["stage-1", "stage-2", "boss", "shop"];

/**
 * The resumable run position a saved scene stands for: the one whose transition shows that
 * scene. None for a lost run's scene or an unknown one, so such a save is never resumed.
 */
function phaseForScene(flow: SaveFlow, scene: unknown): RunPhase | undefined {
  return resumablePhases.find((phase) => sceneOf(flow[`run.position.${phase}`]) === scene);
}

/** The scene a record resumes: its own, or its legacy phase's; null for a lost or bad run. */
function savedScene(record: SaveRecord): SceneName | null {
  if (record.scene !== undefined) return record.scene;
  return Object.hasOwn(legacyPhaseScenes, record.phase ?? "")
    ? legacyPhaseScenes[record.phase!]
    : null;
}

export function toSaveRecord(snapshot: RunSnapshot, flow: SaveFlow = standardGameFlow): SaveRecord {
  const ids = (blocks: readonly CardBlock[]) => blocks.map(({ id }) => id);
  const { state } = snapshot;
  return {
    version: saveVersion,
    round: snapshot.round,
    scene: sceneForPhase(flow, snapshot.phase),
    ...(snapshot.shopAfter ? { shopAfter: snapshot.shopAfter } : {}),
    dealer: snapshot.dealer,
    state: {
      field: state.field.map(({ block, cell }) => ({ cardId: block.id, cell: { ...cell } })),
      hand: ids(state.hand),
      deck: ids(state.deck),
      discardPile: ids(state.discardPile),
      passiveRack: state.passiveRack.map(saveRackItem),
      ...(state.shopStock
        ? {
            shopStock: state.shopStock.map((offer) => offerKind(offer).save(offer.block)),
          }
        : {}),
      ...(state.boughtCards?.length ? { boughtCards: state.boughtCards.map(saveCard) } : {}),
      ...(state.generatedCards?.length
        ? { generatedCards: state.generatedCards.map(saveCard) }
        : {}),
      ...(state.cardStates && Object.keys(state.cardStates).length
        ? { cardStates: structuredClone(state.cardStates) }
        : {}),
      ...(state.removedCards?.length ? { removedCards: [...state.removedCards] } : {}),
      coins: state.coins,
      round: { ...state.round },
    },
    ...(snapshot.stats ? { stats: { ...snapshot.stats } } : {}),
    ...(snapshot.rewarded ? { rewarded: snapshot.rewarded } : {}),
    ...(snapshot.seed === undefined ? {} : { seed: snapshot.seed }),
    ...(snapshot.random === undefined ? {} : { random: snapshot.random }),
  };
}

/** Rebuild a snapshot, or null if the record is corrupt, from another version, or inconsistent. */
export function fromSaveRecord(
  value: unknown,
  cards: readonly CardBlock[],
  dealers: Registry<Dealer>,
  flow: SaveFlow = standardGameFlow,
): RunSnapshot | null {
  try {
    const record = value as SaveRecord;
    if (record?.version !== saveVersion) return null;
    if (record.seed !== undefined && parseSeed(record.seed).seed === undefined) return null;
    if (!Number.isInteger(record.round) || record.round < 1) return null;
    const phase = phaseForScene(flow, savedScene(record));
    if (!phase) return null;
    if (record.shopAfter !== undefined && !stageKinds.includes(record.shopAfter)) return null;
    if (!dealers.has(record.dealer)) return null;
    // The run's cards: its starting deck plus every card it bought (#143).
    const boughtCards = (record.state.boughtCards ?? []).map(restoreCard);
    // Materials changed this run (#387): validated, then applied to the rebuilt cards.
    const cardStates = restoreCardStates(record.state.cardStates);
    // Cards made on the field (#424) are rebuilt in full and owned by the field again.
    const generatedCards = (record.state.generatedCards ?? []).map((saved) =>
      asGenerated(restoreCard(saved)),
    );
    const runCards = [...cards, ...boughtCards, ...generatedCards].map((card) =>
      applyCardStates(card, cardStates),
    );
    const byId = new Map(runCards.map((card) => [card.id, card]));
    if (byId.size !== runCards.length) return null;
    if (Object.keys(cardStates ?? {}).some((id) => !byId.has(id))) return null;
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
    // A retired passive has no effect, so an older save that installed one drops it here
    // rather than carrying a dead slot for the rest of the run (doc/game.md).
    const passiveRack = (state.passiveRack ?? []).flatMap((saved) => {
      const { id, definitionId } = saved;
      if (typeof id !== "string" || passiveIds.has(id) || typeof definitionId !== "string") {
        throw new Error("bad passive");
      }
      passiveIds.add(id);
      return passiveDefinitions.get(definitionId).retired ? [] : [restoreRackItem(saved)];
    });
    // Each offer is rebuilt by its own kind; an unknown kind makes the save invalid.
    const restoreOffer: OfferRestore = {
      takePassiveId(id) {
        if (typeof id !== "string" || passiveIds.has(id)) throw new Error("bad passive id");
        passiveIds.add(id);
        return id;
      },
    };
    // Saves from before #143 borrowed card offers from the starting deck and saved only their
    // id. Such a card goes back to the deck, and its offer is dropped.
    const borrowed = (state.shopStock ?? []).flatMap((saved) =>
      Object.hasOwn(saved ?? {}, "cardId") ? [resolve(saved.cardId)] : [],
    );
    const offers = (state.shopStock ?? []).filter((saved) => !Object.hasOwn(saved ?? {}, "cardId"));
    const shopStock = offers.map((saved) => {
      if (!isOfferKind(saved?.kind)) throw new Error("bad shop offer");
      return { kind: saved.kind, block: offerKind(saved).restore(saved, restoreOffer) };
    });
    const field = state.field.map(({ cardId, cell }) => {
      if (![cell?.x, cell?.y, cell?.z].every(Number.isInteger)) throw new Error("bad cell");
      return {
        block: withoutSelectable(resolve(cardId)),
        cell: { x: cell.x, y: cell.y, z: cell.z },
      };
    });
    // A removed card is accounted for here, so it is never dealt again (#156).
    const removedCards = (state.removedCards ?? []).map((id) => resolve(id).id);
    const restored: GameState = {
      field,
      hand: state.hand.map(resolve),
      deck: [...state.deck.map(resolve), ...borrowed],
      discardPile: state.discardPile.map(resolve),
      passiveRack,
      ...(state.shopStock ? { shopStock } : {}),
      ...(boughtCards.length ? { boughtCards: boughtCards.map((card) => byId.get(card.id)!) } : {}),
      ...(generatedCards.length
        ? { generatedCards: generatedCards.map((card) => byId.get(card.id)!) }
        : {}),
      ...(cardStates ? { cardStates } : {}),
      ...(removedCards.length ? { removedCards } : {}),
      coins: nonnegativeInteger(state.coins ?? 0),
      round: {
        score: number(state.round.score),
        targetScore: number(state.round.targetScore),
        movesLeft: number(state.round.movesLeft),
        discardsLeft: number(state.round.discardsLeft),
      },
    };
    if (seen.size !== runCards.length) return null;
    return {
      round: record.round,
      phase,
      // Only a shop reads it; GameRun ignores it elsewhere.
      ...(record.shopAfter ? { shopAfter: record.shopAfter } : {}),
      dealer: record.dealer,
      state: restored,
      stats: parseRunStats(record.stats),
      ...parseRewarded(record.rewarded),
      ...parseSeed(record.seed),
      ...parseRandom(record.random),
    };
  } catch {
    return null;
  }
}

/** A saved random cursor; nothing when the run has none, so older saves still load. */
function parseRandom(value: unknown): { random: RandomCursor } | Record<string, never> {
  const cursor = value as RandomCursor | undefined;
  const seed = cursor?.seed;
  const position = cursor?.position;
  if (
    typeof seed !== "number" ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  )
    return {};
  return { random: { seed, position } };
}

/** A saved deck seed; nothing when the run was dealt no seeded deck. */
function parseSeed(value: unknown): { seed: number } | Record<string, never> {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 4294967296
    ? { seed: value }
    : {};
}

/** A saved paid-stage marker; malformed data must never permit a second payout. */
function parseRewarded(
  value: unknown,
): { rewarded: NonNullable<RunSnapshot["rewarded"]> } | Record<string, never> {
  if (value === undefined) return {};
  const saved = value as RunSnapshot["rewarded"];
  if (
    !saved ||
    typeof saved.stage !== "string" ||
    !/^[1-9]\d*:(stage-1|stage-2|boss)$/.test(saved.stage) ||
    !Array.isArray(saved.reward?.entries)
  )
    throw new Error("bad paid-stage marker");
  const entries = saved.reward.entries.map(({ source, label, coins }) => {
    if (
      typeof source !== "string" ||
      !source ||
      typeof label !== "string" ||
      !label ||
      !Number.isSafeInteger(coins) ||
      coins < 0
    )
      throw new Error("bad reward entry");
    return { source, label, coins };
  });
  const balanceBefore = nonnegativeInteger(saved.reward.balanceBefore);
  const balance = nonnegativeInteger(saved.reward.balance);
  if (balance !== balanceBefore + entries.reduce((total, entry) => total + entry.coins, 0))
    throw new Error("bad reward balance");
  return {
    rewarded: {
      stage: saved.stage,
      reward: { entries, balanceBefore, balance },
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
  flow: SaveFlow = standardGameFlow,
): boolean {
  if (!storage) return false;
  try {
    // A lost run is never resumed, so its save is cleared rather than written.
    if (!phaseForScene(flow, sceneOf(flow[`run.position.${snapshot.phase}`])))
      storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(toSaveRecord(snapshot, flow)));
    return true;
  } catch {
    return false;
  }
}

export function loadRun(
  storage: SaveStorage | null,
  /**
   * The deck to resolve a saved run's cards against. A function when the deck depends on the
   * run (a material mix rebuilt from its own seed); `fromSaveRecord` parses that seed first.
   */
  cards: readonly CardBlock[] | ((seed: number | undefined) => readonly CardBlock[]),
  dealers: Registry<Dealer>,
  key = saveKey,
  flow: SaveFlow = standardGameFlow,
  requiresSeed = false,
): RunSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as SaveRecord;
    // A legacy save of a lost run is never resumed, and is cleared.
    if (isLegacyLostRun(record)) {
      storage.removeItem(key);
      return null;
    }
    // Validate before resolving card IDs: a fresh material deck would silently change them.
    const seed = parseSeed(record.seed).seed;
    if (seed === undefined && (requiresSeed || record.seed !== undefined)) return null;
    const selected = typeof cards === "function" ? cards(seed) : cards;
    return fromSaveRecord(record, selected, dealers, flow);
  } catch {
    return null;
  }
}

/** A legacy save of a lost run: its phase migrates to no scene. */
function isLegacyLostRun(record: SaveRecord | null): boolean {
  const phase = record?.scene === undefined ? record?.phase : undefined;
  if (phase === undefined || !Object.hasOwn(legacyPhaseScenes, phase)) return false;
  return legacyPhaseScenes[phase] === null; // branch-ok: #86
}

/** Discard a saved run. The key is the active mode's, so a dev mode clears its own slot. */
export function clearRun(storage: SaveStorage | null, key = saveKey): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/** A saved ledger of card states, checked: a gameplay material and/or a registered bonus. */
function restoreCardStates(saved: unknown): Record<string, CardState> | undefined {
  if (saved === undefined) return undefined;
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw new Error("bad card states");
  return Object.fromEntries(
    Object.entries(saved).map(([id, state]) => {
      const { material, stateBonus, doneness, countdown, modifiers } = (state ?? {}) as {
        material?: unknown;
        stateBonus?: unknown;
        doneness?: unknown;
        countdown?: unknown;
        modifiers?: unknown;
      };
      if (
        material === undefined &&
        stateBonus === undefined &&
        doneness === undefined &&
        countdown === undefined &&
        modifiers === undefined
      )
        throw new Error("bad card state");
      if (doneness !== undefined && (!Number.isSafeInteger(doneness) || (doneness as number) < 0))
        throw new Error("bad card state doneness");
      if (
        countdown !== undefined &&
        (!Number.isSafeInteger(countdown) || (countdown as number) < 0)
      )
        throw new Error("bad card state countdown");
      if (material !== undefined && !blockMaterials.includes(material as BlockMaterial))
        throw new Error("bad card state material");
      if (
        stateBonus !== undefined &&
        (typeof stateBonus !== "string" || !stateBonuses.has(stateBonus))
      )
        throw new Error("bad card state bonus");
      return [
        id,
        {
          ...(material === undefined ? {} : { material: material as BlockMaterial }),
          ...(stateBonus === undefined ? {} : { stateBonus: stateBonus as string }),
          ...(doneness === undefined ? {} : { doneness: doneness as number }),
          ...(countdown === undefined ? {} : { countdown: countdown as number }),
          ...(modifiers === undefined ? {} : { modifiers: restoreModifierRegisters(modifiers) }),
        },
      ];
    }),
  );
}

/**
 * A rack item as saved: its id and definition, plus the traits that registered how they
 * persist (`rackTraitPersistence`): a transmogrifier's uses, price and material (#388).
 */
export type SavedRackItem = { id: string; definitionId: string; traits?: Record<string, unknown> };

function saveRackItem(block: PassiveBlock): SavedRackItem {
  const traits = Object.fromEntries(
    Object.entries(block.traits).flatMap(([name, value]) =>
      rackTraitPersistence.has(name) ? [[name, rackTraitPersistence.get(name).save(value)]] : [],
    ),
  );
  return {
    id: block.id,
    definitionId: block.definitionId,
    ...(Object.keys(traits).length ? { traits } : {}),
  };
}

function restoreRackItem(saved: SavedRackItem): PassiveBlock {
  const block = createPassiveBlock(saved.definitionId, saved.id);
  const traits = Object.fromEntries(
    Object.entries(saved.traits ?? {}).map(([name, value]) => [
      name,
      rackTraitPersistence.get(name).restore(value),
    ]),
  );
  return { ...block, traits: { ...block.traits, ...traits } };
}
