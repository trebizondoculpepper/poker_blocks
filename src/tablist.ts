/**
 * Tablist keyboard behaviour, as plain functions so it can be tested without a DOM (#1378;
 * doc/run-status.md, "Host, providers and lifecycle"). A tab list is a row of tabs where one is
 * selected: the arrow keys move focus along it, Home and End jump to either end, and Enter or Space
 * selects the tab that has focus. Activating a tab is a separate step from focusing it, so a long
 * list is never re-read while the player is still choosing.
 *
 * It knows nothing about what a tab shows: a host supplies the tabs and the selection it keeps.
 */

/** How far each key moves focus along the row; any other key doesn't move it. */
const steps: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The index focus moves to from `index` on `key` among `count` tabs, or null to leave it be. */
export function tabFocusAfter(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = steps[key];
  return step === undefined ? null : (index + step + count) % count;
}

/** Whether `key` activates the focused tab. */
export const isTabActivationKey = (key: string): boolean => key === "Enter" || key === " ";

/** Whether `key` asks to close the panel. */
export const isPanelCloseKey = (key: string): boolean => key === "Escape";

/** Where selection goes when the selected tab is gone: the same index, or the last one left. */
export function selectionAfterRemoval(index: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.min(Math.max(0, index), count - 1);
}
