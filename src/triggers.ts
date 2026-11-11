/**
 * Triggers (#433): the reusable contract by which something triggers a block, and the block
 * responds. It knows nothing about bombs or any other user of it.
 *
 * - **Responses** are data: a block's `triggerable.responses`, registered rule commands on its
 *   material definition (so a saved card restores them with its material). Any effect may supply
 *   them; the dispatcher never asks what they do.
 * - **Dispatch** is the `trigger-block` rule command, committed through the shared command path
 *   (`commitCommands`), so a trigger is one more command: no separate queue. Its config names
 *   the target block, the cause, and the chain (`path`) of blocks already triggered.
 * - **Snapshot before removal:** before any response runs, the target's block and cell are
 *   captured and handed to every response as `trigger.source`, so a response that removes the
 *   block (a future self-destruct, #435) and those after it still know what and where it was.
 * - **Order:** responses commit in their listed order; a response that triggers another block
 *   (propagation, #435) does so depth-first, in place, through the same command.
 * - **Cancellation:** a target no longer in the hand or on the table (removed earlier in the
 *   same chain, or by anything else) does nothing.
 * - **Repeats:** a chain records every block it has triggered, across all its branches
 *   (`visited`), and never triggers one twice, so it can neither loop nor reach a block by two
 *   routes; a later, separate trigger starts a new chain and may trigger it again. `path` keeps
 *   each block's ancestry for responses to read.
 * - **Not triggerable:** a block with no responses ignores a trigger and emits nothing.
 * - **Events:** each trigger that runs emits `block.triggered` (with its `trigger` context)
 *   before its responses' own follow-up events.
 */
import type { CardBlock } from "./cards";
import type { RuleCommand } from "./event-rules";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, materialOf } from "./materials";
import type { GameEvent } from "./passives";
import { commitCommands, registerRuleCommand, type CommandTarget } from "./rule-commands";
import type { Cell } from "./traits/attachable";

/** The triggered block as it was before any response ran: what it was, and where. */
export type TriggerSource = { block: CardBlock; cell?: Cell };

/** What a response, and the `block.triggered` event, know about the trigger. */
export type TriggerContext = {
  /** Who or what triggered it: opaque, for responses and presentation to read. */
  cause: string;
  /** The block, captured before its responses ran. */
  source: TriggerSource;
  /** This block's ancestry in the chain: who triggered whom to reach it, this block last. */
  path: readonly string[];
  /**
   * Every block the whole chain has triggered so far, across all its branches: none of them is
   * triggered again by this chain (#488 review). Transient: it lives only while the chain runs.
   */
  visited: Set<string>;
};

export type TriggerConfig = {
  blockId: string;
  cause: string;
  path?: readonly string[];
  /** The chain's shared record of triggered blocks; a new chain starts its own. */
  visited?: Set<string>;
};

/** A block's responses, from its material: none when it doesn't respond to triggers. */
export const materialTriggerResponses = (block: CardBlock): readonly RuleCommand[] =>
  getMaterialDefinition(materialOf(block)).triggerable?.responses ?? [];

/** Where a block is: on the table with its cell, or in the hand; none when it has left play. */
function locate(state: GameState, blockId: string): TriggerSource | null {
  const placed: PlacedBlock | undefined = state.field.find(({ block }) => block.id === blockId);
  if (placed) return { block: placed.block, cell: placed.cell };
  const held = state.hand.find(({ id }) => id === blockId);
  return held ? { block: held } : null;
}

/**
 * Commit one trigger against `target`: the `trigger-block` command's work, with the responses
 * read by `responsesFor` (materials by default; tests and tools may supply their own).
 */
export function commitTrigger(
  { blockId, cause, path = [], visited = new Set(path) }: TriggerConfig,
  target: CommandTarget,
  responsesFor: (block: CardBlock) => readonly RuleCommand[] = materialTriggerResponses,
): GameEvent[] {
  if (visited.has(blockId)) return [];
  const source = locate(target.state, blockId);
  if (!source) return [];
  const configured = responsesFor(source.block);
  // A block that doesn't respond to triggers isn't triggered: nothing happens, nothing is said.
  if (!configured.length) return [];
  visited.add(blockId);
  const trigger: TriggerContext = { cause, source, path: [...path, blockId], visited };
  const responses = configured.map(({ id, config }) => ({
    id,
    config: { ...(config as object), trigger },
  }));
  return [{ type: "block.triggered", blockId, trigger }, ...commitCommands(responses, target)];
}

/**
 * A `trigger-block` command's own trigger, carrying the chain on: a response's config holds its
 * parent's `trigger`, whose path the new trigger extends (an explicit `path` wins), so
 * configured responses that trigger blocks, their own included, can never loop.
 */
export function inheritedTrigger(
  config: TriggerConfig & { trigger?: Pick<TriggerContext, "path" | "visited"> },
): TriggerConfig {
  const path = config.path ?? config.trigger?.path ?? [];
  return {
    blockId: config.blockId,
    cause: config.cause,
    path,
    // The chain's shared record, so sibling branches never trigger a block twice.
    visited: config.visited ?? config.trigger?.visited ?? new Set(path),
  };
}

registerRuleCommand<TriggerConfig & { trigger?: TriggerContext }>(
  "trigger-block",
  (config, target) => commitTrigger(inheritedTrigger(config), target),
);

/** For tests and tools: trigger one block in a bare state. */
export function triggerBlock(
  state: GameState,
  config: TriggerConfig,
  responsesFor?: (block: CardBlock) => readonly RuleCommand[],
): { state: GameState; events: GameEvent[] } {
  let current = state;
  const target: CommandTarget = {
    get state() {
      return current;
    },
    update: (next) => void (current = next),
    grantUnownedPassive: () => [],
  };
  const events = commitTrigger(config, target, responsesFor);
  return { state: current, events };
}
