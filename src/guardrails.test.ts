/**
 * Guardrail: no branching on what kind of thing something is.
 *
 * Behaviour comes from composed traits (see AGENTS.md, "No special cases"). This test fails
 * when source code compares a phase, scene, room, kind, type, material or id against a
 * literal, switches over one, or reads a trait as a flag (`if (traits.x)`). Code written
 * before the rule is listed in `guardrails-baseline.json`; a file's count there may only go
 * down. A line ending in `// branch-ok: #<issue>` is exempt, and the issue must explain why.
 */
import { describe, expect, it } from "vite-plus/test";
import baseline from "./guardrails-baseline.json";

/** Every non-test source file under src/, as text, keyed "src/<path>". */
const sources = Object.entries(
  import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).map(([path, text]) => [`src/${path.slice(2)}`, text] as const);
const kindWords = "phase|scene|room|kind|type|material|id|name|mode|screen|dealer";

/** Each forbidden shape, with the reason an agent will read in the failure. */
export const forbidden: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "compares a kind/phase/scene/room/id against a literal",
    pattern: new RegExp(
      `(?<!typeof )\\b(?:\\w+\\.)*(?:${kindWords})(?:\\(\\))?\\s*[!=]==?\\s*["'\`]|["'\`][^"'\`]*["'\`]\\s*[!=]==?\\s*(?:\\w+\\.)*(?:${kindWords})\\b`,
    ),
  },
  {
    name: "switches over a kind/phase/scene/room/id",
    pattern: new RegExp(`(?<![.\\w])switch\\s*\\(\\s*(?:\\w+\\.)*(?:${kindWords})\\b`),
  },
  {
    name: "reads a trait as a flag (if (traits.x) / traits.x ? :)",
    pattern: /\bif\s*\(\s*!?\s*(?:\w+\.)*\w*[tT]raits\.\w+\s*\)|\b\w*[tT]raits\.\w+\s*\?\s/,
  },
  {
    name: 'chains literal comparisons on one value (x === "a" || x === "b" / else if)',
    pattern:
      /\b(\w+)\s*===\s*["'`]\w[\w.-]+["'`]\s*\|\|\s*\1\s*===\s*["'`]\w|\belse\s+if\s*\(\s*\w+\s*===\s*["'`]\w[\w.-]+["'`]/,
  },
  {
    name: "asks whether a room is a dev room",
    pattern: /\.dev\s*[?&)|]/,
  },
];

/** Offending lines per file, exempt lines excluded. */
export function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const lines = text.split("\n");
    const hits = lines.flatMap((line, i) =>
      /\/\/\s*branch-ok:\s*#\d+/.test(line)
        ? []
        : forbidden
            .filter(({ pattern }) => pattern.test(line))
            .map(({ name }) => `${i + 1}: ${name}: ${line.trim()}`),
    );
    if (hits.length) found.set(file, hits);
  }
  return found;
}

describe("no special-case branching (AGENTS.md)", () => {
  it("adds no new branches on kind, phase, scene, room or trait flags", () => {
    const allowed = baseline as Record<string, number>;
    const grown = [...scan()].filter(([file, hits]) => hits.length > (allowed[file] ?? 0));
    const report = grown.map(
      ([file, hits]) =>
        `${file}: ${hits.length} (baseline ${allowed[file] ?? 0})\n  ${hits.join("\n  ")}`,
    );
    expect(
      report,
      "Move the behaviour into a trait instead of branching. See AGENTS.md, 'No special cases'.",
    ).toEqual([]);
  });

  it("keeps the baseline honest: counts shrink as legacy branches are removed", () => {
    const now = scan();
    const stale = Object.entries(baseline as Record<string, number>).filter(
      ([file, count]) => (now.get(file)?.length ?? 0) < count,
    );
    expect(
      stale.map(([file, count]) => `${file}: baseline ${count}, now ${now.get(file)?.length ?? 0}`),
      "Lower these entries in src/guardrails-baseline.json (never raise them).",
    ).toEqual([]);
  });
});
