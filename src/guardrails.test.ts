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

const ident = "[\\w$]";
const literal = "[\"'`][^\"'`]*[\"'`]";
const word = "[\"'`][\\w$][^\"'`]+[\"'`]";
const eq = "[!=]==?";

/** Each forbidden shape, with the reason an agent will read in the failure. */
export const forbidden: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "compares a kind/phase/scene/room/id against a literal",
    pattern: new RegExp(
      `(?<!typeof )(?<!${ident})(?:${ident}+\\??\\.)*(?:${kindWords})(?:\\(\\))?\\s*${eq}\\s*${literal}|${literal}\\s*${eq}\\s*(?:${ident}+\\??\\.)*(?:${kindWords})(?!${ident})`,
    ),
  },
  {
    name: "switches over a kind/phase/scene/room/id",
    pattern: new RegExp(
      `(?<!\\.\\s*)(?<![\\w$])switch\\s*\\(\\s*(?:${ident}+\\??\\.)*(?:${kindWords})(?!${ident})`,
    ),
  },
  {
    name: "reads a trait as a flag (if (traits.x) / traits.x ? :)",
    pattern:
      /\bif\s*\(\s*!?\s*(?:[\w$]+\??\.)*[\w$]*[tT]raits\??\.[\w$]+\s*\)|\b[\w$]*[tT]raits\??\.[\w$]+\s*\?\s/,
  },
  {
    name: 'chains literal comparisons on one value (x === "a" || x === "b" / else if)',
    pattern: new RegExp(
      `(?<!\\.\\s*)(?<!${ident})((?:${ident}+\\??\\.)*${ident}+)\\s*={2,3}\\s*${word}\\s*\\)?\\s*\\|\\|\\s*\\(?\\s*\\1\\s*={2,3}\\s*${word}|\\belse\\s+if\\s*\\(\\s*(?:${ident}+\\??\\.)*${ident}+\\s*={2,3}\\s*${word}`,
    ),
  },
  {
    name: "asks whether a room is a dev room",
    pattern: /\.dev\s*[?&)|]/,
  },
];

/** A line that is only a comment cannot branch. */
const commentOnly = /^\s*(?:\/\/|\/?\*)/;

/** The rules a line breaks, or none. Each offending line counts once. */
export function offences(line: string): string[] {
  if (commentOnly.test(line) || /\/\/\s*branch-ok:\s*#\d+/.test(line)) return [];
  return forbidden.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name);
}

/** Offending lines per file, exempt lines excluded. */
export function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const hits = text.split("\n").flatMap((line, i) => {
      const broken = offences(line);
      return broken.length ? [`${i + 1}: ${broken.join("; ")}: ${line.trim()}`] : [];
    });
    if (hits.length) found.set(file, hits);
  }
  return found;
}

describe("the guardrail's patterns", () => {
  it.each([
    'if (game.phase === "shop") go();',
    'if (scene.id == "title") go();',
    "switch (room.kind) {",
    "if (roomTraits.quiet) music.windDown();",
    "const x = traits.sandbox ? a : b;",
    'if (next === "settings" || next === "title") go();',
    'if ((next === "settings") || (next === "title")) go();',
    'else if (next === "over") end();',
    'if (a.b.next === "aa" || a.b.next === "bb") go();',
    'if ($next === "aa" || $next === "bb") go();',
    "if (room.dev) list();",
    "else switch (kind) {",
  ])("flags %s", (line) => expect(offences(line)).not.toEqual([]));

  it.each([
    "sceneManager.switch(id);",
    "sceneManager .switch(id);",
    'if (typeof id !== "string") throw new Error("bad");',
    '} else if (c === """ || c === "\'") {',
    '// if (game.phase === "shop") is how we used to do it',
    ' * game.phase === "shop" in a doc comment',
    'if (a === "aa" || b === "bb") go();',
    'if (obj.value === "alpha" || value === "beta") go();',
    "my$switch(kind);",
    "sceneManager. switch(kind);",
    'if (game.phase === "shop") go(); // branch-ok: #12',
  ])("does not flag %s", (line) => expect(offences(line)).toEqual([]));

  it("counts a line that breaks several rules once", () =>
    expect(offences('if (kind === "aa" || kind === "bb") go();')).toHaveLength(2));
});

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
