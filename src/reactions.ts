/**
 * Material reactions (#366; contract in doc/game-architecture.md, "Material reactions", #363).
 *
 * A reaction is data on the reacting material's definition: `when` a registered matcher accepts
 * the block's face neighbours, its `results` (registered result handlers) change that block.
 * Only the six face-sharing cells count; edges and corners never do.
 *
 * Once per committed play, after scoring (reactions never score), `resolveReactions` takes a
 * snapshot of the field and checks every placed block, in field order, against its own
 * material's reactions: each block takes at most one, the first whose matcher accepts. Every
 * selected result reads the snapshot, so a block changed this play cannot set off its
 * neighbours until the next play. The results are then committed together. Unconfigured pairs
 * do nothing. Nothing here names a material.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { changeCardMaterial } from "./card-material";
import { setCardStateBonus } from "./state-bonuses";
import { getMaterialDefinition, materialOf, type BlockMaterial } from "./materials";
import { cellKey, faceNormal, faces } from "./traits/attachable";

/** A configured handler: a registered name and its configuration. */
export type HandlerRef = { id: string; config: unknown };

/** One reaction on a material's definition. */
export type Reaction = { when: HandlerRef; results: readonly HandlerRef[] };

/** Whether a block's face neighbours (from the snapshot) set off a reaction. */
export type ReactionMatcher = (
  block: CardBlock,
  neighbours: readonly CardBlock[],
  config: unknown,
) => boolean;

/** What a reaction does to its block, applied to the state after resolution. */
export type ReactionResult = (state: GameState, block: CardBlock, config: unknown) => GameState;

export const reactionMatchers = new Registry<ReactionMatcher>("reaction matcher");
export const reactionResults = new Registry<ReactionResult>("reaction result");

// A neighbour made of a given material (flame beside ice, say).
reactionMatchers.register("neighbour-material", (_block, neighbours, config) => {
  const { material } = config as { material: BlockMaterial };
  return neighbours.some((neighbour) => materialOf(neighbour) === material);
});

// Become another material and/or take a state bonus; a part already in place changes nothing.
reactionResults.register("transform", (state, block, config) => {
  const { material, stateBonus } = config as { material?: BlockMaterial; stateBonus?: string };
  const changed = [material ?? []]
    .flat()
    .reduce((current, kind) => changeCardMaterial(current, block.id, kind) ?? current, state);
  return [stateBonus ?? []]
    .flat()
    .reduce((current, id) => setCardStateBonus(current, block.id, id) ?? current, changed);
});

/** A reaction that fired this play: the block and the reaction's results, for presentation. */
export type AppliedReaction = { blockId: string; results: readonly HandlerRef[] };

/** The reactions a block's material lists, in order. */
export const materialReactions = (block: CardBlock): readonly Reaction[] =>
  getMaterialDefinition(materialOf(block)).reactions ?? [];

/** The blocks sharing a face with this one, from a cell map of the field. */
function faceNeighbours(placed: PlacedBlock, byCell: ReadonlyMap<string, CardBlock>): CardBlock[] {
  return faces.flatMap((face) => {
    const offset = faceNormal(face);
    const neighbour = byCell.get(
      cellKey({
        x: placed.cell.x + offset.x,
        y: placed.cell.y + offset.y,
        z: placed.cell.z + offset.z,
      }),
    );
    return neighbour ? [neighbour] : [];
  });
}

/**
 * Resolve and commit one play's reactions. Selection reads only the snapshot taken here; the
 * results are then applied in field order. Returns the new state and what fired.
 */
export function resolveReactions(
  state: GameState,
  reactionsFor: (block: CardBlock) => readonly Reaction[] = materialReactions,
): { state: GameState; applied: AppliedReaction[] } {
  const snapshot = state.field;
  const byCell = new Map(snapshot.map(({ block, cell }) => [cellKey(cell), block]));
  const selected = snapshot.flatMap((placed) => {
    const neighbours = faceNeighbours(placed, byCell);
    const reaction = reactionsFor(placed.block).find(({ when }) =>
      reactionMatchers.get(when.id)(placed.block, neighbours, when.config),
    );
    return reaction ? [{ block: placed.block, reaction }] : [];
  });
  const next = selected.reduce(
    (current, { block, reaction }) =>
      reaction.results.reduce(
        (inner, result) => reactionResults.get(result.id)(inner, block, result.config),
        current,
      ),
    state,
  );
  return {
    state: next,
    applied: selected.map(({ block, reaction }) => ({
      blockId: block.id,
      results: reaction.results,
    })),
  };
}
