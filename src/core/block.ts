import { Emitter } from "./emitter";
import type { AnyTraitDef, TraitContext, TraitDef, TraitEntry, TraitInstance } from "./trait";

interface Attachment {
  readonly def: AnyTraitDef;
  readonly ctx: TraitContext<object>;
  instance?: TraitInstance;
}

/**
 * A block in play: an identity, an event channel and attached traits. It has no
 * gameplay code of its own; all behavior comes from traits.
 */
export class Block {
  readonly id: string;
  readonly traits = new Map<AnyTraitDef, Attachment>();
  private readonly events = new Emitter();
  private disposed = false;

  constructor(id: string) {
    this.id = id;
  }

  /** Attach a trait. Settings are merged over the trait's defaults. */
  add<S extends object>(def: TraitDef<S>, settings: Partial<S> = {}): this {
    if (this.traits.has(def)) {
      throw new Error(`Trait "${def.name}" is already attached to "${this.id}"`);
    }
    const ctx: TraitContext<S> = {
      block: this,
      settings: { ...structuredClone(def.defaults), ...settings },
    };
    const attachment: Attachment = { def, ctx };
    this.traits.set(def, attachment);
    const result = def.setup?.(ctx);
    if (result) attachment.instance = typeof result === "function" ? { dispose: result } : result;
    return this;
  }

  /** Detach a trait, running its cleanup. No-op if not attached. */
  remove(def: AnyTraitDef): this {
    const attachment = this.traits.get(def);
    if (!attachment) return this;
    this.traits.delete(def);
    attachment.instance?.dispose?.();
    return this;
  }

  has(def: AnyTraitDef): boolean {
    return this.traits.has(def);
  }

  /** The live settings of an attached trait, or undefined. */
  settingsOf<S extends object>(def: TraitDef<S>): S | undefined {
    return this.traits.get(def)?.ctx.settings as S | undefined;
  }

  traitNames(): string[] {
    return [...this.traits.keys()].map((def) => def.name);
  }

  /** Attach every trait in a list. */
  addAll(entries: readonly TraitEntry[]): this {
    for (const { def, settings } of entries) this.add(def, settings);
    return this;
  }

  /** Subscribe to an event on this block. Returns an unsubscribe function. */
  on(type: string, listener: (payload: unknown) => void): () => void {
    return this.events.on(type, listener);
  }

  emit(type: string, payload?: unknown): void {
    this.events.emit(type, payload);
  }

  listens(type: string): boolean {
    return this.events.listens(type);
  }

  update(dt: number): void {
    // Snapshot so traits may add or remove things mid-loop.
    for (const { def, ctx, instance } of Array.from(this.traits.values())) {
      def.update?.(ctx, dt);
      instance?.update?.(dt);
    }
  }

  /** Detach traits in reverse order of attachment. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const def of [...this.traits.keys()].reverse()) this.remove(def);
    this.events.clear();
  }
}
