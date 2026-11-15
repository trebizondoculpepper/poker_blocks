/**
 * Canonical command codecs and primitive executors (#1243; doc/experiments/command-journal.md,
 * "Model-owned successful command metadata"). Each registered codec, keyed by command reference,
 * normalizes a command's arguments into a plain, frozen descriptor and executes that command
 * through the ordinary model mutation. The model captures the descriptor for each command it
 * successfully commits; replay and setup adapters share the same primitive executors.
 *
 * Executors are primitive: `play` plays, `discard` discards, and neither refills. A composite that
 * also refills (the scenario setup replay) composes that explicitly. Logical IDs are opaque
 * references the executor passes on; they never select behaviour.
 */
import { Registry } from "./core/registry";
import type { PlayAction } from "./game-state";

/** A committed command, as plain data. */
export type CommandDescriptor = Readonly<{ command: string; version: number; args: unknown }>;

/** What an executor drives: the ordinary model commands. */
export type CommandTarget = {
  play(action: PlayAction, actionId?: string): unknown;
  discard(cardIds: readonly string[], actionId?: string): unknown;
  /** The ordinary refill (#1244): the cards it drew, none when it changed nothing. */
  refillHand(): readonly unknown[];
};

export type CommandCodec = {
  version: number;
  /** A plain, frozen copy of valid arguments; throws on anything invalid. */
  normalize(args: unknown): unknown;
  /** Run the command on the model with normalized arguments; true when it committed. */
  execute(target: CommandTarget, args: unknown): boolean;
};

export const commandCodecs = new Registry<CommandCodec>("command codec");

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${what} must be an id`);
  return value;
};

const ids = (value: unknown, what: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${what} must be a list of ids`);
  return Object.freeze(value.map((id) => text(id, what)));
};

commandCodecs.register("play", {
  version: 1,
  normalize(args) {
    const action = args as Partial<PlayAction> | null;
    if (typeof action !== "object" || action === null) throw new Error("play needs an action");
    return Object.freeze({
      cardId: text(action.cardId, "play cardId"),
      // An empty group is a single-card play, as the model treats it (#1276).
      ...(action.cardIds === undefined ||
      (Array.isArray(action.cardIds) && action.cardIds.length === 0)
        ? {}
        : { cardIds: ids(action.cardIds, "play cardIds") }),
      ...(action.targetId === undefined
        ? {}
        : { targetId: text(action.targetId, "play targetId") }),
      ...(action.face === undefined ? {} : { face: text(action.face, "play face") }),
    });
  },
  execute: (target, args) => target.play(args as PlayAction) !== null,
});

commandCodecs.register("discard", {
  version: 1,
  normalize(args) {
    const { cardIds } = (args ?? {}) as { cardIds?: unknown };
    return Object.freeze({ cardIds: ids(cardIds, "discard cardIds") });
  },
  execute: (target, args) =>
    target.discard((args as { cardIds: readonly string[] }).cardIds) !== null,
});

/**
 * The ordinary hand refill (#1244; doc/experiments/command-journal.md, "Refill is an explicit
 * separate step"): no arguments. It commits only when it draws; a full hand or an empty deck
 * records nothing.
 */
commandCodecs.register("refillHand", {
  version: 1,
  normalize(args) {
    if (
      args !== undefined &&
      (typeof args !== "object" || args === null || Object.keys(args).length)
    )
      throw new Error("refillHand takes no arguments");
    return Object.freeze({});
  },
  execute: (target) => target.refillHand().length > 0,
});

/** Capture a command's descriptor now, before a caller can change its arguments. */
export function describeCommand(command: string, args: unknown): CommandDescriptor {
  const codec = commandCodecs.get(command);
  return Object.freeze({ command, version: codec.version, args: codec.normalize(args) });
}

/** Run a descriptor's command through its registered primitive executor. */
export function executeCommand(target: CommandTarget, descriptor: CommandDescriptor): boolean {
  const codec = commandCodecs.get(descriptor.command);
  if (descriptor.version !== codec.version)
    throw new Error(`${descriptor.command} v${descriptor.version} is not v${codec.version}`);
  return codec.execute(target, codec.normalize(descriptor.args));
}

/**
 * What the model publishes with each committed action's facts: its identity and context, the
 * descriptor of the command it committed or an explicit reason none is available, and the
 * model random source's checkpoint after it, when one is configured.
 */
export type CommittedMetadata = Readonly<{
  actionId: string;
  kind: string;
  context: Readonly<{ stage: unknown; round: number; version: number }>;
  command: CommandDescriptor | Readonly<{ unavailable: string }>;
  checkpoint?: Readonly<{ state: number; draws: number }>;
}>;
