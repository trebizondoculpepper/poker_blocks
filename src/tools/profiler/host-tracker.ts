/**
 * The preview hosts still applied to the profiler's scene (#720 review). Each is undone exactly
 * once: when its preview ends, or when a run starts while its factory is still building, so a
 * measurement is always lit by its own host alone.
 */
export function createHostTracker() {
  const pending = new Set<() => void>();
  return {
    /** Track a host's undo; the returned function undoes it once and stops tracking it. */
    track(undo: () => void): () => void {
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        pending.delete(release);
        undo();
      };
      pending.add(release);
      return release;
    },
    /** Undo every host still applied, whether or not its preview has finished building. */
    releaseAll(): void {
      // A snapshot: each release removes itself from the set as it runs.
      for (const release of Array.from(pending)) release();
    },
    get size(): number {
      return pending.size;
    },
  };
}
