/** A complete, editable JSON draft of the shop's numeric balance. No edit touches live data. */
import {
  validateTransmogrifierBalance,
  gameTuning,
  validateMaterialBalance,
  validatePassiveBalance,
} from "../balance";
import { defaultShop } from "../game-modes";
import { materialDefinitions, type MaterialDefinition } from "../materials";
import { passiveFrequencies, validateWeightCurve, type WeightCurve } from "../offer-weights";
import { passiveDefinitions, type PassiveDefinition } from "../passives";
import { materialsNamedBy } from "../offer-eligibility";
import { validateShopStock } from "../shop-stock-config";

export type DraftCurve = [round: number, weight: number][];
export type ShopBalanceDraft = {
  schemaVersion: 1;
  stock: {
    minOffers: number;
    maxOffers: number;
    guaranteedPassives: number;
    guaranteedCards: number;
    itemSlots: number;
  };
  cardRankSurcharge: Record<string, number>;
  /** Transmogrifier uses and price multiple (#392). */
  transmogrifier: { uses: number; priceFactor: number };
  materials: Record<string, { basePrice: number; weights: DraftCurve } | null>;
  passives: Record<string, { basePrice: number; unlockRound: number; frequency: string } | null>;
  frequencies: Record<string, DraftCurve>;
};

export type DraftError = { path: string; message: string };

const copyCurve = (curve: WeightCurve): DraftCurve =>
  curve.map(([round, weight]) => [round, weight]);

/** Read the definitions in use now; each editor opening begins with a fresh draft. */
export function currentShopBalanceDraft(): ShopBalanceDraft {
  return {
    schemaVersion: 1,
    stock: {
      minOffers: defaultShop.minOffers,
      maxOffers: defaultShop.maxOffers,
      guaranteedPassives: defaultShop.guaranteedPassives ?? 1,
      guaranteedCards: defaultShop.guaranteedCards ?? 1,
      itemSlots: defaultShop.itemSlots ?? 1,
    },
    cardRankSurcharge: { ...gameTuning.cardRankSurcharge } as Record<string, number>,
    transmogrifier: { ...gameTuning.transmogrifier },
    materials: Object.fromEntries(
      (materialDefinitions as readonly MaterialDefinition[]).map(({ id, shop }) => [
        id,
        shop ? { basePrice: shop.basePrice, weights: copyCurve(shop.weights) } : null,
      ]),
    ),
    passives: Object.fromEntries(
      passiveDefinitions.names().map((id) => {
        const shop = passiveDefinitions.get(id).shop;
        return [id, shop ? { ...shop } : null];
      }),
    ),
    frequencies: Object.fromEntries(
      passiveFrequencies.names().map((id) => [id, copyCurve(passiveFrequencies.get(id))]),
    ),
  };
}

const safeWhole = (value: unknown, minimum: number): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const keysMatch = (actual: Record<string, unknown> | null | undefined, expected: string[]) =>
  actual &&
  Object.keys(actual).length === expected.length &&
  Object.keys(actual).every((key) => expected.includes(key));

/** Validate both the JSON shape and the same numeric rules used by the game. */
export function validateShopBalanceDraft(draft: ShopBalanceDraft): DraftError[] {
  const errors: DraftError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  if (draft.schemaVersion !== 1) add("schemaVersion", "Unsupported draft version");
  if (
    !keysMatch(draft as unknown as Record<string, unknown>, [
      "schemaVersion",
      "stock",
      "cardRankSurcharge",
      "transmogrifier",
      "materials",
      "passives",
      "frequencies",
    ])
  )
    add("schemaVersion", "Unsupported top-level configuration fields");
  const stock = draft.stock;
  if (
    !stock ||
    !keysMatch(stock, [
      "minOffers",
      "maxOffers",
      "guaranteedPassives",
      "guaranteedCards",
      "itemSlots",
    ])
  )
    add("stock", "Stock fields must match the configuration schema");
  if (stock)
    for (const { field, message } of validateShopStock(stock)) add(`stock.${field}`, message);

  if (!keysMatch(draft.transmogrifier, ["uses", "priceFactor"]))
    add("transmogrifier", "Transmogrifier fields must match the configuration schema");
  else {
    for (const message of validateTransmogrifierBalance(draft.transmogrifier))
      add("transmogrifier", message);
    // Every derived price must be a whole number of at least 1 coin, or the item would be
    // free to buy yet resell for at least 1.
    for (const [id, material] of Object.entries(draft.materials ?? {}))
      if (material && Math.round(material.basePrice * draft.transmogrifier.priceFactor) < 1)
        add("transmogrifier.priceFactor", `Makes the ${id} transmogrifier free`);
  }

  const rankKeys = Object.keys(gameTuning.cardRankSurcharge);
  if (!keysMatch(draft.cardRankSurcharge, rankKeys))
    add("cardRankSurcharge", "Rank bonuses must match the current configuration");
  for (const rank of rankKeys)
    if (!safeWhole(draft.cardRankSurcharge?.[rank], 0))
      add(`cardRankSurcharge.${rank}`, "Use a nonnegative whole coin amount");

  const materialIds = materialDefinitions.map(({ id }) => id);
  if (!keysMatch(draft.materials, materialIds))
    add("materials", "Material IDs must match the current definitions");
  for (const original of materialDefinitions as readonly MaterialDefinition[]) {
    const value = draft.materials?.[original.id];
    const path = `materials.${original.id}`;
    if (!original.shop) {
      if (value !== null) add(path, "This material is not shop eligible");
      continue;
    }
    if (!value || !keysMatch(value, ["basePrice", "weights"])) {
      add(path, "Material price and weights are required");
      continue;
    }
    if (!safeWhole(value.basePrice, 1)) add(`${path}.basePrice`, "Use a positive whole coin price");
    if (!Array.isArray(value.weights)) {
      add(`${path}.weights`, "A weight curve is required");
      continue;
    }
    for (const [index, pair] of value.weights.entries())
      if (!Array.isArray(pair) || pair.length !== 2)
        add(`${path}.weights.${index}`, "Each keyframe needs round and weight");
    if (value.weights.every((pair) => Array.isArray(pair) && pair.length === 2))
      for (const message of validateWeightCurve(original.id, value.weights))
        add(`${path}.weights`, message);
  }

  const passiveIds = passiveDefinitions.names();
  if (!keysMatch(draft.passives, passiveIds))
    add("passives", "Passive IDs must match the current definitions");
  for (const id of passiveIds) {
    const original = passiveDefinitions.get(id);
    const value = draft.passives?.[id];
    const path = `passives.${id}`;
    if (!original.shop) {
      if (value !== null) add(path, "This passive is not shop eligible");
      continue;
    }
    if (!value || !keysMatch(value, ["basePrice", "unlockRound", "frequency"])) {
      add(path, "Passive price, unlock and frequency are required");
      continue;
    }
    if (!safeWhole(value.basePrice, 1)) add(`${path}.basePrice`, "Use a positive whole coin price");
    if (!safeWhole(value.unlockRound, 1)) add(`${path}.unlockRound`, "Use a positive whole round");
    if (!passiveFrequencies.has(value.frequency))
      add(`${path}.frequency`, "Choose a known frequency curve");
    for (const material of materialsNamedBy(original)) {
      const curve = draft.materials?.[material.id]?.weights;
      const unlock =
        curve?.find((pair) => Array.isArray(pair) && pair.length === 2 && pair[1] > 0)?.[0] ??
        Number.POSITIVE_INFINITY;
      if (Number.isFinite(unlock) && value.unlockRound < unlock)
        add(`${path}.unlockRound`, `Must not unlock before ${material.name} (round ${unlock})`);
    }
  }

  const frequencyIds = passiveFrequencies.names();
  if (!keysMatch(draft.frequencies, frequencyIds))
    add("frequencies", "Frequency IDs must match the current definitions");
  for (const id of frequencyIds) {
    const curve = draft.frequencies?.[id];
    if (!Array.isArray(curve)) {
      add(`frequencies.${id}`, "A frequency curve is required");
      continue;
    }
    for (const [index, pair] of curve.entries())
      if (!Array.isArray(pair) || pair.length !== 2)
        add(`frequencies.${id}.${index}`, "Each keyframe needs round and weight");
    if (curve.every((pair) => Array.isArray(pair) && pair.length === 2))
      for (const message of validateWeightCurve(id, curve)) add(`frequencies.${id}`, message);
  }

  if (errors.length) return errors;
  // Feed the draft values through the production balance validators too.
  const materials = materialDefinitions.map((definition) => ({
    ...definition,
    shop: draft.materials[definition.id] ?? undefined,
  })) as MaterialDefinition[];
  for (const message of validateMaterialBalance(materials)) add("materials", message);
  const passives = passiveIds.map((id) => ({
    ...passiveDefinitions.get(id),
    shop: draft.passives[id] ?? undefined,
  })) as PassiveDefinition[];
  for (const message of validatePassiveBalance(passives, materials)) add("passives", message);
  return errors;
}
