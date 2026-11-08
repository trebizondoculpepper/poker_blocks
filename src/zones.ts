/**
 * Move one item within an ordered zone (the hand now, the passive rack later).
 * Returns a new array with the same item instances; out-of-range indexes return null.
 * Moving an item to its own index is a no-op that still returns a copy.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] | null {
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < items.length;
  if (!inRange(from) || !inRange(to)) return null;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Insert items at an index (clamped to the zone), keeping everything else in order. */
export function insertAt<T>(items: readonly T[], index: number, added: readonly T[]): T[] {
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), ...added, ...items.slice(at)];
}
