/**
 * How a profiled row names its motion (#973), with no dependencies, so the report and the
 * command's artifact writer (plain Node) can use it. A recorded motion carries its driver's tag:
 * stationary has none, so a stationary row keeps the plain name every row had before motion.
 */

/** A driver by name, its plain configuration, and (as recorded) the tag rows are named with. */
export type MotionReference = {
  driver: string;
  config?: Readonly<Record<string, number>>;
  tag?: string;
};

/** A row's display name: its label, then its phase and its motion's tag, where it has them. */
export function displayName(row: {
  label: string;
  phase?: string;
  motion?: MotionReference;
}): string {
  const tags = [row.phase, row.motion?.tag].filter(Boolean);
  return tags.length ? `${row.label} (${tags.join(", ")})` : row.label;
}

/** A row's key: its case id, then its phase and its motion's tag, where it has them. */
export function rowKey(row: { id: string; phase?: string; motion?: MotionReference }): string {
  return [row.id, row.phase, row.motion?.tag].filter(Boolean).join(":");
}
