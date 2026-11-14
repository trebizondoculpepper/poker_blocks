/**
 * Run-owned active instances in saves (#894; doc/opaque-actives.md, "Persistence and clone
 * compatibility"). An active instance names its registered definition (`traits.active`); the
 * save records it under optional `state.activeObjects` as `{ definition, components }`, and
 * Continue rebuilds it through that definition and its registered component codecs. Ordinary
 * cards keep their existing ledgers: an instance is saved in exactly one store.
 *
 * Unknown definitions or codecs and malformed component state reject the save; nothing is
 * inferred from an ID's spelling or forced through the standard deck.
 */
import type { CardBlock } from "./cards";
import type { LifecycleDeclaration } from "./lifecycle-resolver";
import { Registry } from "./core/registry";

/** A registered active definition: how a fresh instance with this ID is created. */
export type ActiveDefinition = {
  create(id: string): CardBlock;
  /** Components an instance of this definition cannot work without: a record lacking one is corrupt. */
  requires?: readonly string[];
  /** Its lifecycle declaration (#917): retention and reset, resolved through its parents. */
  lifecycle?: LifecycleDeclaration;
};
export const activeDefinitions = new Registry<ActiveDefinition>("active definition");

/**
 * A registered component codec: what of an instance it saves (undefined: nothing), and how that
 * saved value is restored onto a freshly created instance; `restore` throws on a bad value.
 */
export type ActiveComponentCodec = {
  /** Identities the saved component owns (a stored payload's), reserved against every other. */
  ownedIds?(saved: unknown): readonly string[];
  save(block: CardBlock): unknown;
  restore(block: CardBlock, saved: unknown): CardBlock;
};
export const activeComponentCodecs = new Registry<ActiveComponentCodec>("active component codec");

/** One saved active instance. */
export type SavedActiveObject = { definition: string; components: Record<string, unknown> };

/** The active instances among these blocks, keyed by ID, as the save records them. */
export function saveActiveObjects(blocks: readonly CardBlock[]): Record<string, SavedActiveObject> {
  return Object.fromEntries(
    blocks.flatMap((block) =>
      [block.traits.active ?? []].flat().map(({ definition }) => [
        block.id,
        {
          definition,
          components: Object.fromEntries(
            activeComponentCodecs.names().flatMap((name) => {
              const value = activeComponentCodecs.get(name).save(block);
              return value === undefined ? [] : [[name, structuredClone(value)]];
            }),
          ),
        },
      ]),
    ),
  );
}

/** Rebuild saved active instances; throws on an unknown definition or codec or a bad record. */
export function restoreActiveObjects(
  saved: unknown,
  /**
   * The same instance as configured in the run's starting deck, when it is there: its record's
   * components are restored onto it rather than onto a fresh one, keeping its configuration.
   */
  startingInstance: (id: string, definition: string) => CardBlock | undefined = () => undefined,
): CardBlock[] {
  if (saved === undefined) return [];
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw new Error("bad active objects");
  return Object.entries(saved).map(([id, record]) => {
    const { definition, components } = (record ?? {}) as Partial<SavedActiveObject>;
    if (typeof definition !== "string" || !activeDefinitions.has(definition))
      throw new Error(`unknown active definition for ${id}`);
    if (typeof components !== "object" || components === null || Array.isArray(components))
      throw new Error(`bad active components for ${id}`);
    const missing = (activeDefinitions.get(definition).requires ?? []).filter(
      (name) => !Object.hasOwn(components, name),
    );
    if (missing.length) throw new Error(`${id} is missing component(s) ${missing.join(", ")}`);
    const created =
      startingInstance(id, definition) ?? activeDefinitions.get(definition).create(id);
    return Object.entries(components).reduce((block, [name, value]) => {
      if (!activeComponentCodecs.has(name)) throw new Error(`unknown active component "${name}"`);
      return activeComponentCodecs.get(name).restore(block, value);
    }, created);
  });
}

/**
 * The identities saved components own (a stored payload's, #927), from their codecs, skipping the
 * records under `retired` (removed for the run), which own nothing any more.
 */
export function ownedIdentities(saved: unknown, retired: ReadonlySet<string>): string[] {
  return Object.entries((saved ?? {}) as Record<string, Partial<SavedActiveObject>>)
    .filter(([id]) => !retired.has(id))
    .flatMap(([, { components = {} }]) =>
      Object.entries(components).flatMap(([name, value]) =>
        activeComponentCodecs.has(name)
          ? (activeComponentCodecs.get(name).ownedIds?.(value) ?? [])
          : [],
      ),
    );
}
