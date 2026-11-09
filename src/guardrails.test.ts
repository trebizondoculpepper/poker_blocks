/**
 * Guardrail: no branching on what kind of thing something is, and identity is opaque.
 *
 * Behaviour comes from composed traits (see AGENTS.md, "No special cases"). This test fails
 * when source code compares a phase, scene, mode, kind, type, material or id against a
 * literal, switches over one, reads a trait as a flag (`if (traits.x)`), uses a mode's or
 * scene's identity as a key (`[mode.id]`, `.includes(scene.id)`), looks a table up by a kind
 * (`colours[kind]`, `set.has(phase)`), or names a specific developer mode outside
 * `src/game-modes.ts`.
 *
 * Code written before the rule is listed line by line in `guardrails-baseline.json`. A new
 * offending line fails even if an old one was removed in the same change; entries may only
 * be removed (or moved verbatim with their code). A line ending in `// branch-ok: #<issue>`
 * is exempt, and the issue must record the user's agreement.
 */
import { describe, expect, it } from "vite-plus/test";
import { gameModeRegistry, modeConsoleNames } from "./game-modes";
import baseline from "./guardrails-baseline.json";

/** Every non-test source file under src/, as text, keyed "src/<path>". */
const sources = Object.entries(
  import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).map(([path, text]) => [`src/${path.slice(2)}`, text] as const);
const kindWords = "phase|scene|room|kind|type|material|id|name|mode|screen|dealer|step|trait";
/** What kind of thing something is (ids and names of individual items are data, not kinds). */
const kindKeys = "phase|scene|room|kind|type|material|mode|screen|dealer|step|trait";
/** Every developer mode's console name and alias: naming one outside its definition is a special case. */
const devModeNames = gameModeRegistry
  .names()
  .flatMap((id) => {
    const mode = gameModeRegistry.get(id);
    return modeConsoleNames(mode).length
      ? [id, ...modeConsoleNames(mode), ...(mode.aliases ?? [])]
      : [];
  })
  .filter((name, index, all) => all.indexOf(name) === index);
const devModeAlternatives = devModeNames
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const ident = "[\\w$]";
const literal = "[\"'`][^\"'`]*[\"'`]";
const word = "[\"'`][\\w$][^\"'`]+[\"'`]";
const eq = "[!=]==?";

/**
 * A lookup or membership test: `.includes(x)`, `.has(x)`, `.indexOf(x)`, `.get(x)`, or `table[x]`
 * (including an inline `{ … }[x]`). A registry's own lookup (`fooRegistry.get(x)`) is the
 * permitted way to resolve a handle, so it is not a lookup here.
 */
const lookupOf = `(?:(?<![rR]egistry)\\.(?:includes|has|indexOf|get)\\(\\s*|[\\w$)\\]}]\\s*\\[\\s*)`;
/**
 * The same without `.get(x)`: event channels and registries of handlers keyed by an event
 * type or a dealer name are the endorsed pattern, so `.get(type)` is not a side table.
 */
const lookupOfKind = `(?:\\.(?:includes|has|indexOf)\\(\\s*|[\\w$)\\]}]\\s*\\[\\s*)`;

/** Each forbidden shape, with the reason an agent will read in the failure. */
export const forbidden: readonly {
  name: string;
  pattern: RegExp;
  /** Files where the shape is the definition itself, not a special case. */
  except?: readonly string[];
}[] = [
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
      /\bif\s*\(\s*!?\s*(?:[\w$]+\??\.)*[\w$]*[tT]raits\??\.[\w$]+\s*\)|\b[\w$]*[tT]raits\??\.[\w$]+\s*(?:\?\s|&&)/,
  },
  {
    name: "uses a mode's or scene's identity as a key (identity is opaque)",
    pattern: new RegExp(
      `${lookupOf}(?:${ident}+\\??\\.)*${ident}*(?:[mM]ode|[sS]cene|[rR]oom)\\??\\.(?:id|name)\\s*[\\])]`,
    ),

    // The registry implementations themselves store and look things up by id.
    except: ["src/scenes.ts", "src/core/registry.ts"],
  },
  {
    name: "looks a table or set up by a kind/phase/scene/material (data belongs on the definition)",
    pattern: new RegExp(`${lookupOfKind}(?:${ident}+\\??\\.)*(?:${kindKeys})\\s*[\\])]`),
  },
  {
    name: "names a specific developer mode outside src/game-modes.ts",
    pattern: new RegExp(
      `["'\`](?:${devModeAlternatives})["'\`]|(?<![\\w$.])(?:${devModeAlternatives})\\s*:(?!:)`,
    ),
    except: ["src/game-modes.ts"],
  },
  {
    name: 'chains literal comparisons on one value (x === "a" || x === "b" / else if)',
    pattern: new RegExp(
      `(?<!\\.\\s*)(?<!${ident})((?:${ident}+\\??\\.)*${ident}+)\\s*={2,3}\\s*${word}\\s*\\)?\\s*\\|\\|\\s*\\(?\\s*\\1\\s*={2,3}\\s*${word}|\\belse\\s+if\\s*\\(\\s*(?:${ident}+\\??\\.)*${ident}+\\s*={2,3}\\s*${word}`,
    ),
  },
  {
    name: "asks whether a mode is a dev mode",
    pattern: /\.dev\s*[?&)|]/,
  },
];

/** A line that is only a comment cannot branch. */
const commentOnly = /^\s*(?:\/\/|\/?\*)/;

/** The rules a line breaks, or none. Each offending line counts once. */
export function offences(line: string, file = "", registries: readonly string[] = []): string[] {
  if (commentOnly.test(line) || /\/\/\s*branch-ok:\s*#\d+/.test(line)) return [];
  // Asking a registry whether it holds an id is looking the thing up (AGENTS.md), not a
  // membership test on a kind (#181), so `<registry>.has(...)` is read as a lookup.
  const read = registries.length
    ? line.replace(new RegExp(`\\b(?:${registries.join("|")})\\s*\\.has\\(`, "g"), "lookup(")
    : line;
  return forbidden
    .filter(({ pattern, except }) => !except?.includes(file) && pattern.test(read))
    .map(({ name }) => name);
}

/**
 * The names of every `Registry` the sources declare (`x: Registry<…>` or `x = new Registry`),
 * so their `.has` lookups aren't mistaken for membership tests on a kind (#181).
 */
export function registryNames(texts: readonly string[]): string[] {
  const names = new Set<string>();
  const declared = /\b([\w$]+)\s*(?::\s*(?:Readonly<)?Registry\s*<|=\s*new\s+Registry\b)/g;
  for (const text of texts) for (const match of text.matchAll(declared)) names.add(match[1]!);
  return [...names];
}

/** One offending line: where it is, what it breaks, and its text (the baseline's key). */
type Hit = { line: number; rules: string[]; text: string };

/** Offending lines per file, exempt lines excluded. */
export function scan(): Map<string, Hit[]> {
  const found = new Map<string, Hit[]>();
  const registries = registryNames(sources.map(([, text]) => text));
  for (const [file, text] of sources) {
    const hits = text.split("\n").flatMap((line, i) => {
      const rules = offences(line, file, registries);
      return rules.length ? [{ line: i + 1, rules, text: line.trim() }] : [];
    });
    if (hits.length) found.set(file, hits);
  }
  return found;
}

/** Hits not covered by the file's baseline lines (each baseline line covers one hit). */
function uncovered(hits: readonly Hit[], allowed: readonly string[]): Hit[] {
  const left = [...allowed];
  return hits.filter(({ text }) => {
    const index = left.indexOf(text);
    if (index < 0) return true;
    left.splice(index, 1);
    return false;
  });
}

/** Baseline lines no longer present in the file's hits. */
function stale(hits: readonly Hit[], allowed: readonly string[]): string[] {
  const left = hits.map(({ text }) => text);
  return allowed.filter((text) => {
    const index = left.indexOf(text);
    if (index < 0) return true;
    left.splice(index, 1);
    return false;
  });
}

describe("the guardrail's patterns", () => {
  it.each([
    'if (game.phase === "shop") go();',
    'if (scene.id == "title") go();',
    "switch (room.kind) {",
    "if (modeTraits.quiet) music.windDown();",
    "const x = traits.sandbox ? a : b;",
    'if (next === "settings" || next === "title") go();',
    'if ((next === "settings") || (next === "title")) go();',
    'else if (next === "over") end();',
    'if (a.b.next === "aa" || a.b.next === "bb") go();',
    'if ($next === "aa" || $next === "bb") go();',
    "if (room.dev) list();",
    'const mix = steps.find((step) => step.step === "destructibleMix");',
    'if (["dev3"].includes(currentMode.id)) go();',
    "const bonus = { dev3: 2 }[currentMode.id] ?? 0;",
    "const bonus = bonuses[currentMode.id];",
    "const bonus = { classic: 2 }[currentMode.id] ?? 0;",
    "const bonus = bonuses.get(currentMode.id);",
    "const colour = { steel: 1 }[kind];",
    "if (allowed.has(scene.id)) go();",
    "const colour = edgeColours[kind];",
    "const label = labels[game.phase];",
    "if (transparentMaterials.has(kind)) go();",
    "const quiet = modeTraits.quiet && windDown();",
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
    "if (selected.has(block.id)) go();",
    "const block = blocks[index];",
    "run(host, [mode]) {",
    "const scene = gameModeRegistry.get(id);",
    'if (!sceneRegistry.has(scene.id)) throw new Error("unknown scene");',
    "const mode = gameModeRegistry.get(params.mode);",
    "const listeners = this.listeners.get(event.type) ?? [];",
    "this.activeDealer = dealers.get(setup.dealer);",
    "const id = modeSceneId(currentMode.id, name);",
    'const devKey = "poker-blocks.dev-material-seed";',
  ])("does not flag %s", (line) => expect(offences(line)).toEqual([]));

  it("reads .has on a registry as a lookup, but still flags it on any other set (#181)", () => {
    const registries = registryNames(["function load(dealers: Registry<Dealer>) {}"]);
    expect(registries).toEqual(["dealers"]);
    expect(offences("if (!dealers.has(record.dealer)) return null;", "", registries)).toEqual([]);
    expect(offences("if (!seen.has(record.dealer)) return null;", "", registries)).not.toEqual([]);
    expect(registryNames(['export const modes = new Registry<Mode>("mode");'])).toEqual(["modes"]);
  });

  it("counts a line that breaks several rules once", () =>
    expect(offences('if (kind === "aa" || kind === "bb") go();')).toHaveLength(2));
});

describe("no special-case branching (AGENTS.md)", () => {
  it("covers developer tools under src/tools like game code, with no exemption (#71)", () => {
    expect(sources.some(([file]) => file.startsWith("src/tools/"))).toBe(true);
  });

  const allowed = baseline as Record<string, string[]>;
  it("adds no new special cases: every offending line is a recorded legacy line", () => {
    const report = [...scan()].flatMap(([file, hits]) =>
      uncovered(hits, allowed[file] ?? []).map(
        ({ line, rules, text }) => `${file}:${line}: ${rules.join("; ")}: ${text}`,
      ),
    );
    expect(
      report,
      "Move the behaviour into a trait instead of branching. See AGENTS.md, 'No special cases'.",
    ).toEqual([]);
  });

  it("keeps the baseline honest: removed legacy lines are removed from it", () => {
    const now = scan();
    const report = Object.entries(allowed).flatMap(([file, lines]) =>
      stale(now.get(file) ?? [], lines).map((text) => `${file}: ${text}`),
    );
    expect(
      report,
      "Remove these lines from src/guardrails-baseline.json (never add new ones).",
    ).toEqual([]);
  });
});
