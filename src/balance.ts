/**
 * The balance config: the single source of the game's tuning numbers (doc/game.md, "Shop
 * rules"). Consumers read it and never hold their own copies. `validateBalance` checks it, and
 * `balance.test.ts` runs that check, so a bad entry fails CI rather than a run.
 *
 * Base prices are fixed data. Anything that changes a price later (a passive that raises a
 * sale payout, say) is a modifier applied on top, never an edit here.
 */

/** A passive's catalogue entry (issue #7). */
export type PassiveBalance = {
  /** What the passive costs in the shop, in coins, before any modifier. */
  basePrice: number;
  /** The first round its offer can appear in stock. */
  unlockRound: number;
};

/** Every passive definition the shop can stock, by definition id. */
export const passiveBalance: Readonly<Record<string, PassiveBalance>> = {
  "double-line": { basePrice: 4, unlockRound: 1 },
  "quad-line": { basePrice: 9, unlockRound: 2 },
  "gold-standard": { basePrice: 5, unlockRound: 4 },
  carnivore: { basePrice: 3, unlockRound: 3 },
  woodworker: { basePrice: 4, unlockRound: 1 },
  crossroads: { basePrice: 2, unlockRound: 1 },
  "long-haul": { basePrice: 4, unlockRound: 1 },
  "seeing-red": { basePrice: 6, unlockRound: 1 },
  scrapper: { basePrice: 8, unlockRound: 2 },
  "ace-exchange": { basePrice: 5, unlockRound: 2 },
};

/** A passive's catalogue entry; an unknown passive is a configuration error. */
export function passiveBalanceOf(definitionId: string): PassiveBalance {
  const entry = passiveBalance[definitionId];
  if (!entry) throw new Error(`No balance entry for passive "${definitionId}"`);
  return entry;
}

/** Everything wrong with the balance config, for the given passive definition ids. */
export function validateBalance(passiveIds: readonly string[]): string[] {
  const problems: string[] = [];
  for (const id of passiveIds) {
    const entry = passiveBalance[id];
    if (!entry) {
      problems.push(`${id}: no balance entry`);
      continue;
    }
    if (!Number.isSafeInteger(entry.basePrice) || entry.basePrice < 1)
      problems.push(`${id}: base price must be a positive whole number of coins`);
    if (!Number.isSafeInteger(entry.unlockRound) || entry.unlockRound < 1)
      problems.push(`${id}: unlock round must be a positive whole number`);
  }
  return problems;
}
