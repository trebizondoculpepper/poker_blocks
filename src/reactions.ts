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
import { countOperation } from "./lifecycle/operations";
import type { CardBlock } from "./cards";
import type { RuleCommand } from "./event-rules";
import type { GameState, PlacedBlock } from "./game-state";
import type { ReactionState } from "./passives";
import type { SoundEffectId } from "./audio/sfx-registry";
import { changeCardMaterial } from "./card-material";
import { setCardStateBonus } from "./state-bonuses";
import { getMaterialDefinition, materialOf, type BlockMaterial } from "./materials";
import { commitCommands, registerRuleCommand, type CommandTarget } from "./rule-commands";
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

/**
 * What a reaction asks for, as rule commands (#363): a result handler only collects them; they
 * are committed afterwards through the shared `commitCommands` path, never here.
 */
export type ReactionResult = (
  block: CardBlock,
  config: unknown,
  /** The block's face neighbours in the play's snapshot, before any reaction commits (#428). */
  neighbours: readonly CardBlock[],
) => RuleCommand[];

export const reactionMatchers = new Registry<ReactionMatcher>("reaction matcher");
export const reactionResults = new Registry<ReactionResult>("reaction result");

// A neighbour made of a given material and, optionally, holding a given state bonus (hot water
// is water with the "heated" bonus, #367).
reactionMatchers.register("neighbour-state", (_block, neighbours, config) => {
  const { material, stateBonus } = config as { material: BlockMaterial; stateBonus: string };
  return neighbours.some(
    (neighbour) =>
      materialOf(neighbour) === material && neighbour.traits.stateBonus?.id === stateBonus,
  );
});

// A neighbour made of a given material (flame beside ice, say), unless the block already holds
// one of the listed state bonuses (boiling water stays boiling beside ordinary flame, #368).
reactionMatchers.register("neighbour-material", (block, neighbours, config) => {
  const {
    material,
    unlessState = [],
    unlessNeighbour = [],
  } = config as {
    material: BlockMaterial;
    unlessState?: readonly string[];
    /** Other matchers that, if any accepts the same neighbours, prevent it (#383: no freezing beside heat). */
    unlessNeighbour?: readonly HandlerRef[];
  };
  if (unlessState.includes(block.traits.stateBonus?.id ?? "")) return false;
  if (unlessNeighbour.some(({ id, config }) => reactionMatchers.get(id)(block, neighbours, config)))
    return false;
  return neighbours.some((neighbour) => materialOf(neighbour) === material);
});

// A neighbour whose material is a source of heat (#383): flame, or any material declaring `heat`.
reactionMatchers.register("neighbour-heat", (_block, neighbours) =>
  neighbours.some((neighbour) => getMaterialDefinition(materialOf(neighbour)).heat !== undefined),
);

// Become another material and/or take a state bonus.
reactionResults.register("transform", (block, config) => [
  { id: "transform-block", config: { ...(config as object), blockId: block.id } },
]);

/**
 * The command that changes a reacted block: its material and/or state bonus (#387, #365). It
 * reports `reaction.applied` only when something actually changed, so a reaction that finds
 * its block already transformed is not presented or rewarded again.
 */
registerRuleCommand<{
  blockId: string;
  material?: BlockMaterial;
  stateBonus?: string;
  /** The registered sound presenting the change (#367). */
  sound?: SoundEffectId;
}>("transform-block", ({ blockId, material, stateBonus, sound }, target) => {
  const before = target.state;
  const from = reactionState(before, blockId);
  const changed = [material ?? []]
    .flat()
    .reduce((current, kind) => changeCardMaterial(current, blockId, kind) ?? current, before);
  const after = [stateBonus ?? []]
    .flat()
    .reduce((current, id) => setCardStateBonus(current, blockId, id) ?? current, changed);
  target.update(after);
  return after === before
    ? []
    : [
        {
          type: "reaction.applied",
          blockId,
          reaction: {
            from: from!,
            to: reactionState(after, blockId)!,
            ...(sound ? { sound } : {}),
          },
        },
      ];
});

/** A block's material and state bonus, as a reaction event reports them. */
function reactionState(state: GameState, blockId: string): ReactionState | undefined {
  const block = state.field.find((placed) => placed.block.id === blockId)?.block;
  return (
    block && {
      material: materialOf(block),
      ...Object.fromEntries(
        [block.traits.stateBonus ?? []].flat().map(({ id }) => ["stateBonus", id]),
      ),
    }
  );
}

/** A reaction that changed its block this play, before and after, for presentation (#366). */
export type AppliedReaction = {
  blockId: string;
  from: ReactionState;
  to: ReactionState;
  /** The registered sound presenting it, if the reaction names one. */
  sound?: SoundEffectId;
};

/** The reactions a block's material lists, in order. */
export const materialReactions = (block: CardBlock): readonly Reaction[] =>
  getMaterialDefinition(materialOf(block)).reactions ?? [];

/** The blocks sharing a face with this one, from a cell map of the field. */
export function faceNeighbours(
  placed: PlacedBlock,
  byCell: ReadonlyMap<string, CardBlock>,
): CardBlock[] {
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
 * Select one play's reactions from a snapshot of the field: each block's first matching
 * reaction, in field order. Returns the commands their results ask for; nothing is changed.
 */
export function resolveReactions(
  state: GameState,
  reactionsFor: (block: CardBlock) => readonly Reaction[] = materialReactions,
): RuleCommand[] {
  const byCell = new Map(state.field.map(({ block, cell }) => [cellKey(cell), block]));
  return state.field.flatMap((placed) => {
    const neighbours = faceNeighbours(placed, byCell);
    // Each matcher and result is charged to the resolving action, matched or not (#661 review).
    const reaction = reactionsFor(placed.block).find(({ when }) => {
      countOperation(`reaction matcher ${when.id}`);
      return reactionMatchers.get(when.id)(placed.block, neighbours, when.config);
    });
    return (reaction?.results ?? []).flatMap((result) => {
      countOperation(`reaction result ${result.id}`);
      return reactionResults.get(result.id)(placed.block, result.config, neighbours);
    });
  });
}

/**
 * Resolve and commit one play's reactions through the shared command path, against `target`
 * (the run's own, in `GameRun.play`). Returns the reactions that changed something.
 */
export function commitReactions(
  target: CommandTarget,
  reactionsFor: (block: CardBlock) => readonly Reaction[] = materialReactions,
): AppliedReaction[] {
  const events = commitCommands(resolveReactions(target.state, reactionsFor), target);
  return events.flatMap(({ blockId, reaction }) =>
    blockId && reaction ? [{ blockId, ...reaction }] : [],
  );
}

/** For tests and tools: commit one play's reactions to a bare state. */
export function applyReactions(
  state: GameState,
  reactionsFor: (block: CardBlock) => readonly Reaction[] = materialReactions,
): { state: GameState; applied: AppliedReaction[] } {
  let current = state;
  const target: CommandTarget = {
    get state() {
      return current;
    },
    update: (next) => void (current = next),
    grantUnownedPassive: () => [],
  };
  const applied = commitReactions(target, reactionsFor);
  return { state: current, applied };
}
