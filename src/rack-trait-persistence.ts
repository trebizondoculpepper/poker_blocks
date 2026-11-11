/**
 * How a rack item's traits are saved (#388): a registry keyed by trait name. The save service
 * (src/save.ts) runs whichever an item's traits register and never asks what kind of item it
 * is; a module that owns a persisted trait registers it here (the transmogrifier's material in
 * src/transmogrifiers.ts).
 */
import { Registry } from "./core/registry";

/**
 * How a rack item's trait is saved and restored, keyed by trait name. The save service runs
 * whichever an item's traits register, never asking what kind of item it is. `restore`
 * validates and throws on a malformed value.
 */
export type RackTraitPersistence = {
  save(value: unknown): unknown;
  restore(saved: unknown): unknown;
};
export const rackTraitPersistence = new Registry<RackTraitPersistence>("rack trait persistence");

const wholeNumber = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("bad rack trait");
  return value as number;
};
rackTraitPersistence.register("limitedUse", {
  save: (value) => ({ ...(value as object) }),
  restore: (saved) => {
    const { uses, total } = (saved ?? {}) as { uses?: unknown; total?: unknown };
    const left = wholeNumber(uses);
    const all = wholeNumber(total);
    if (left < 1 || left > all) throw new Error("bad rack item uses");
    return { uses: left, total: all };
  },
});
rackTraitPersistence.register("priced", {
  save: (value) => ({ ...(value as object) }),
  restore: (saved) => ({ basePrice: wholeNumber((saved as { basePrice?: unknown })?.basePrice) }),
});
