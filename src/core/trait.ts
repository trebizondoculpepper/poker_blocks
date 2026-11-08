import type { Block } from "./block";

/** What a trait hook sees: the block it is attached to, its settings, and its parent. */
export interface TraitContext<S extends object> {
  readonly block: Block;
  /** This attachment's settings. Mutable so other systems can tune behavior at runtime. */
  readonly settings: S;
}

/**
 * A trait is the only place behavior lives. Blocks are containers; attaching a
 * trait (with settings) to a block gives it that behavior.
 */
export interface TraitDef<S extends object> {
  readonly name: string;
  /** Default settings. Settings must stay plain data (serializable). */
  readonly defaults: S;
  /**
   * Called when attached. May return a cleanup function (called when detached),
   * or a {@link TraitInstance} to keep per-block state between frames.
   */
  setup?(ctx: TraitContext<S>): void | (() => void) | TraitInstance;
  /** Called every frame while attached. */
  update?(ctx: TraitContext<S>, dt: number): void;
}

/** Per-attachment hooks returned from `setup`, closing over that attachment's state. */
export interface TraitInstance {
  update?(dt: number): void;
  dispose?(): void;
}

export function defineTrait<S extends object>(def: TraitDef<S>): TraitDef<S> {
  return def;
}

export type AnyTraitDef = TraitDef<object>;

/** A trait plus setting overrides, as used in block configs. */
export interface TraitEntry {
  readonly def: AnyTraitDef;
  readonly settings: object;
}

/** Type-checked helper for building a {@link TraitEntry}. */
export function trait<S extends object>(def: TraitDef<S>, settings: Partial<S> = {}): TraitEntry {
  return { def, settings };
}
