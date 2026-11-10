import { describe, expect, it } from "vite-plus/test";
import { defaultShop } from "../game-modes";
import { materialDefinitions } from "../materials";
import { passiveFrequencies } from "../offer-weights";
import { passiveDefinitions } from "../passives";
import { currentShopBalanceDraft, validateShopBalanceDraft } from "./shop-balance-draft";

describe("shop balance draft", () => {
  it("exports every current shop parameter without sharing mutable source arrays", () => {
    const draft = currentShopBalanceDraft();
    expect(validateShopBalanceDraft(draft)).toEqual([]);
    expect(Object.keys(draft.materials)).toEqual(materialDefinitions.map(({ id }) => id));
    expect(Object.keys(draft.passives)).toEqual(passiveDefinitions.names());
    expect(Object.keys(draft.frequencies)).toEqual(passiveFrequencies.names());
    expect(draft.stock).toMatchObject(defaultShop);
    draft.frequencies.additiveScoring![0]![1] = 99;
    expect(passiveFrequencies.get("additiveScoring")[0]![1]).not.toBe(99);
  });

  it("blocks invalid counts, prices, unlocks, keyframes and unsupported entries", () => {
    const draft = currentShopBalanceDraft();
    draft.stock.maxOffers = 10;
    draft.stock.guaranteedPassives = 6;
    draft.materials.gold!.basePrice = -1;
    draft.passives["gold-standard"]!.unlockRound = 0;
    draft.frequencies.additiveScoring!.push([1, 2]);
    draft.cardRankSurcharge.A = -2;
    (draft.materials as Record<string, unknown>).unknown = { basePrice: 1, weights: [[1, 1]] };
    const paths = validateShopBalanceDraft(draft).map(({ path }) => path);
    expect(paths).toContain("stock.maxOffers");
    expect(paths).toContain("stock.guaranteedPassives");
    expect(paths).toContain("materials.gold.basePrice");
    expect(paths).toContain("passives.gold-standard.unlockRound");
    expect(paths).toContain("frequencies.additiveScoring");
    expect(paths).toContain("cardRankSurcharge.A");
    expect(paths).toContain("materials");
  });

  it("keeps passive unlocks aligned with edited material curves", () => {
    const draft = currentShopBalanceDraft();
    draft.materials.gold!.weights = [[6, 1]];
    expect(validateShopBalanceDraft(draft)).toContainEqual(
      expect.objectContaining({ path: "passives.gold-standard.unlockRound" }),
    );
    draft.materials.gold!.weights = [[2, 1]];
    draft.passives["gold-standard"]!.unlockRound = 2;
    expect(validateShopBalanceDraft(draft)).toEqual([]);
  });

  it("reports an unsupported keyframe shape without throwing", () => {
    const draft = currentShopBalanceDraft();
    (draft.frequencies.even as unknown[]).push(null);
    expect(validateShopBalanceDraft(draft)).toContainEqual(
      expect.objectContaining({ path: "frequencies.even.1" }),
    );
  });
});
