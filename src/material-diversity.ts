/**
 * Material diversity (#819; doc/experiments/spatial-modifiers.md, "Material equivalence"): how
 * many distinct material families a row's actual scored subset holds. Each card's family is its
 * current material definition's opaque `materialFamily` token, compared by equality only; the
 * query never reads a token's name. Non-scoring cards in the row, and cards elsewhere, don't count.
 */
import { contextQueries } from "./context-queries";
import { getMaterialDefinition, materialOf } from "./materials";

contextQueries.register("materialDiversity", {
  cost: "O(n) in placed blocks",
  limit: 1_000_000,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot, raw) => {
    const wanted = new Set(((raw ?? {}) as { ids?: readonly string[] }).ids ?? []);
    const scored = snapshot.field.map(({ block }) => block).filter(({ id }) => wanted.has(id));
    if (!scored.length) return { available: false, reason: "no scored blocks" };
    const families = new Set(
      scored.map((card) => getMaterialDefinition(materialOf(card)).materialFamily),
    );
    return { available: true, value: { families: families.size, count: scored.length } };
  },
});
