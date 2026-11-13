/**
 * Spawning a new block beyond a reacting pair (#425; first use: air beside boiling water makes a
 * Cloud). A reaction result, configured on the reacting material, so nothing here names air,
 * water or cloud.
 *
 * For each face neighbour of the reacting block that matches `partner` (material and, optionally,
 * state bonus), once per committed play:
 * - **Where:** only the two cells immediately beyond the pair on its shared axis are eligible:
 *   one past the reacting block, one past the partner. A cell is free when nothing is in it. If
 *   neither is free, nothing happens.
 * - **Which, when both are free:** the one whose lines would score more with the new block in
 *   them, scored with the run's own scorer on a copy of the field. Nothing is committed and the
 *   run's random stream is untouched: any value source (a die) reads a fixed mid-range roll, the
 *   same for both. On a tie, the cell beyond the partner.
 * - **The new card:** the higher-ranked input's suit, and the rank above the higher input's,
 *   capped at Ace. On equal rank it takes the partner's suit. It is made of `material`, owned by
 *   the field (`asGenerated`, #424), so it leaves with the table and never joins the deck.
 * - Inputs are unchanged. The new block is reported as an applied reaction with `sound`.
 */
import {
  createCard,
  rankValue,
  ranks,
  type CardBlock,
  type IdentityTrait,
  pokerIdentity,
} from "./cards";
import type { GameEvent } from "./passives";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { reactionResults } from "./reactions";
import { registerRuleCommand } from "./rule-commands";
import { asGenerated } from "./card-ownership";
import type { SoundEffectId } from "./audio/sfx-registry";
import { cellKey, faceNormal, faces, type Cell } from "./traits/attachable";

export type PairSpawnConfig = {
  /** The neighbour the reacting block pairs with. */
  partner: { material: BlockMaterial; stateBonus?: string };
  /** What the new block is made of. */
  material: BlockMaterial;
  /** The registered sound presenting the new block. */
  sound?: SoundEffectId;
};

/** The rank above this one in the game's order, capped at Ace (the highest). */
export function rankAbove(rank: IdentityTrait["rank"]) {
  const ordered = [...ranks].sort((a, b) => rankValue(a) - rankValue(b));
  return ordered[Math.min(ordered.indexOf(rank) + 1, ordered.length - 1)]!;
}

/** The identity a new block takes from its two inputs; equal ranks take the partner's suit. */
export function spawnedIdentity(reacting: CardBlock, partner: CardBlock) {
  const a = pokerIdentity(reacting);
  const b = pokerIdentity(partner);
  const higher = rankValue(a.rank) > rankValue(b.rank) ? a : b;
  return { rank: rankAbove(higher.rank), suit: higher.suit };
}

const add = (cell: Cell, offset: Cell, times = 1): Cell => ({
  x: cell.x + offset.x * times,
  y: cell.y + offset.y * times,
  z: cell.z + offset.z * times,
});

/** The points of every line through `cell`, with `placed` on the field. */
function linePointsThrough(state: GameState, placed: PlacedBlock): number {
  // A fixed mid-range roll for any value source (a die), so both candidates are judged alike and
  // the run's random stream is never touched (#428 review).
  return scoreFieldWithPassives([...state.field, placed], state.passiveRack, undefined, () => 0.5)
    .filter(({ line }) => line.blocks.some(({ id }) => id === placed.block.id))
    .reduce((sum, { points }) => sum + points, 0);
}

/** A fresh id for a spawned block: unique among the cards in play. */
function freshId(state: GameState, base: string): string {
  const taken = new Set(
    [
      ...state.field.map(({ block }) => block),
      ...state.hand,
      ...state.deck,
      ...state.discardPile,
    ].map(({ id }) => id),
  );
  let n = 1;
  while (taken.has(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}

// Partners are chosen from the play's snapshot, so a neighbour that changes this play (water
// that boils now) can't make a cloud until the next play (#428 review).
reactionResults.register("spawn-beyond-pair", (block, config, neighbours) => {
  const { partner } = config as PairSpawnConfig;
  const partnerIds = neighbours
    .filter(
      (mate) =>
        materialOf(mate) === partner.material &&
        (partner.stateBonus === undefined || mate.traits.stateBonus?.id === partner.stateBonus),
    )
    .map(({ id }) => id);
  return [
    { id: "spawn-beyond-pair", config: { ...(config as object), blockId: block.id, partnerIds } },
  ];
});

registerRuleCommand<PairSpawnConfig & { blockId: string; partnerIds: readonly string[] }>(
  "spawn-beyond-pair",
  ({ blockId, partnerIds, material, sound }, target) => {
    const events: GameEvent[] = [];
    const origin = target.state.field.find(({ block }) => block.id === blockId);
    for (const face of origin ? faces : []) {
      const state = target.state;
      const axis = faceNormal(face) as Cell;
      const near = add(origin!.cell, axis);
      const mate = state.field.find(({ cell }) => cellKey(cell) === cellKey(near))?.block;
      // Only partners chosen from the snapshot; their cells and the free cells are read live.
      if (!partnerIds.includes(mate?.id ?? "")) continue;
      const occupied = new Set(state.field.map(({ cell }) => cellKey(cell)));
      // Beyond the partner first, so a tie keeps that cell.
      const candidates = [add(origin!.cell, axis, 2), add(origin!.cell, axis, -1)].filter(
        (cell) => !occupied.has(cellKey(cell)),
      );
      if (!candidates.length) continue;
      const card = asGenerated(
        withMaterial(
          createCard(
            spawnedIdentity(origin!.block, mate!),
            freshId(state, `${material}.${blockId}`),
          ),
          getMaterialDefinition(material),
        ),
      );
      const best = candidates
        .map((cell) => ({ cell, points: linePointsThrough(state, { block: card, cell }) }))
        .reduce((a, b) => (b.points > a.points ? b : a));
      target.update({
        ...state,
        field: [...state.field, { block: card, cell: best.cell }],
        generatedCards: [...(state.generatedCards ?? []), card],
      });
      events.push({
        type: "reaction.applied",
        blockId: card.id,
        reaction: { from: { material }, to: { material }, ...(sound ? { sound } : {}) },
      });
    }
    return events;
  },
);
