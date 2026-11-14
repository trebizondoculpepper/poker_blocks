/**
 * Read-only debug snapshot (#987, doc/debug-snapshot.md): diagnostic evidence for an odd state,
 * gathered from registered providers. Each owning service registers a provider for its own
 * section and unregisters it when disposed. A section with no provider reports `unavailable`,
 * never an empty or healthy value. Providers only read: the snapshot never mutates gameplay,
 * draws RNG or ticks the scheduler. Everything is bounded (depth, items, string length and
 * total bytes) and every cut is reported in `truncated`. This is not a save or a replay.
 */

export type DiagnosticProvider = () => unknown;

export type SnapshotLimits = {
  depth: number;
  items: number;
  stringLength: number;
  bytes: number;
};

export const defaultSnapshotLimits: SnapshotLimits = {
  depth: 6,
  items: 50,
  stringLength: 400,
  bytes: 64 * 1024,
};

export type SnapshotSection =
  | { status: "ok"; data: unknown }
  | { status: "unavailable" }
  | { status: "failed"; error: string };

export type DebugSnapshot = {
  schema: 1;
  takenAt: string;
  sections: Record<string, SnapshotSection>;
  truncated: string[];
};

export type DiagnosticRegistry = {
  /** Register a section's provider; the returned function unregisters it. */
  register(section: string, provider: DiagnosticProvider): () => void;
  snapshot(limits?: Partial<SnapshotLimits>): DebugSnapshot;
};

/**
 * @param expected sections always listed, so a missing provider shows as `unavailable`.
 */
export function createDiagnosticRegistry(
  expected: readonly string[],
  now: () => Date = () => new Date(),
): DiagnosticRegistry {
  const providers = new Map<string, DiagnosticProvider>();
  return {
    register(section, provider) {
      if (providers.has(section)) throw new Error(`Diagnostic section "${section}" is taken`);
      providers.set(section, provider);
      return () => {
        if (providers.get(section) === provider) providers.delete(section);
      };
    },
    snapshot(overrides = {}) {
      const limits = { ...defaultSnapshotLimits, ...overrides };
      const truncated: string[] = [];
      const sections: Record<string, SnapshotSection> = {};
      const names = [...new Set([...expected, ...providers.keys()])];
      for (const name of names) {
        const provider = providers.get(name);
        if (!provider) {
          sections[name] = { status: "unavailable" };
          continue;
        }
        try {
          sections[name] = { status: "ok", data: bound(provider(), name, 0, limits, truncated) };
        } catch (error) {
          sections[name] = {
            status: "failed",
            error: clip(error instanceof Error ? error.message : String(error), limits),
          };
        }
      }
      const snapshot: DebugSnapshot = {
        schema: 1,
        takenAt: now().toISOString(),
        sections,
        truncated,
      };
      // Over the byte budget: drop the largest sections' data until it fits, saying which.
      while (byteLength(snapshot) > limits.bytes) {
        const largest = Object.entries(sections)
          .filter(([, section]) => section.status === "ok")
          .sort(([, a], [, b]) => byteLength(b) - byteLength(a))[0];
        if (!largest) break;
        sections[largest[0]] = { status: "failed", error: "dropped: over the snapshot byte limit" };
        truncated.push(`${largest[0]}: bytes`);
      }
      return snapshot;
    },
  };
}

const byteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

const clip = (text: string, limits: SnapshotLimits): string =>
  text.length > limits.stringLength ? `${text.slice(0, limits.stringLength)}…` : text;

/** A plain-data copy within the limits: callbacks and live resources are never serialised. */
function bound(
  value: unknown,
  path: string,
  depth: number,
  limits: SnapshotLimits,
  truncated: string[],
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") {
    if (value.length > limits.stringLength) truncated.push(`${path}: string`);
    return clip(value, limits);
  }
  if (typeof value !== "object") return `[${typeof value}]`;
  if (depth >= limits.depth) {
    truncated.push(`${path}: depth`);
    return "[…]";
  }
  if (Array.isArray(value)) {
    if (value.length > limits.items) truncated.push(`${path}: ${value.length} items`);
    return value
      .slice(0, limits.items)
      .map((item, index) => bound(item, `${path}[${index}]`, depth + 1, limits, truncated));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return "[unserialisable]";
  const entries = Object.entries(value);
  if (entries.length > limits.items) truncated.push(`${path}: ${entries.length} keys`);
  return Object.fromEntries(
    entries
      .slice(0, limits.items)
      .map(([key, item]) => [key, bound(item, `${path}.${key}`, depth + 1, limits, truncated)]),
  );
}
