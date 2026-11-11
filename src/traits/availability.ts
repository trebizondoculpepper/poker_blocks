/**
 * Whether a block can be chosen now, and if not why (#462). Scenes send it with `input.enabled`,
 * as a plain boolean or `{ enabled, reason }`, from their own authoritative conditions; every
 * trait reads it the same way, so a disabled reason is always the current one.
 */
export type Availability = { enabled: boolean; reason?: string };

export function availability(payload: unknown): Availability {
  if (typeof payload === "object" && payload !== null) {
    const { enabled, reason } = payload as { enabled?: unknown; reason?: unknown };
    return { enabled: Boolean(enabled), ...(typeof reason === "string" ? { reason } : {}) };
  }
  return { enabled: Boolean(payload) };
}
