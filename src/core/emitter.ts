export type Listener = (payload: unknown) => void;

/** A minimal named-event channel. */
export class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Subscribe. Returns an unsubscribe function. */
  on(type: string, listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  // Iterate over a snapshot so listeners may subscribe or unsubscribe mid-emit.
  emit(type: string, payload?: unknown): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(payload);
  }

  /** Whether anything is listening for `type`. */
  listens(type: string): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
