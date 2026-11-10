/**
 * Where each registered sound is used (developer tooling, Node only): every source file under
 * `src/` that names the sound's id as a string literal, outside the registry itself and tests.
 * That covers direct `playSfx("id")` calls and data that names a sound (a scene's `enterSound`,
 * a material's activation, a sound family's variant), plus registry entries that name it as
 * their `placeholder`.
 *
 * `npm run sfx:usage` writes the result to `src/audio/sfx-usage.json`, the registry's record of
 * how many places use each sound; `src/audio/sfx-usage.test.ts` fails when that record is out of
 * date, so the counts can be trusted.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { soundEffects } from "../src/audio/sfx-registry.ts";

export type SfxUsage = Record<string, { uses: number; files: Record<string, number> }>;

const srcDir = join(import.meta.dirname, "..", "src");

/** Source files that may play or name a sound: TypeScript, not tests, not the registry. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "assets" ? [] : sourceFiles(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    if (entry.name === "sfx-registry.ts") return [];
    return [path];
  });
}

/** Every registered sound, with how many places name it and in which files. */
export function scanSfxUsage(): SfxUsage {
  const files = sourceFiles(srcDir).map((path) => ({
    name: relative(srcDir, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));
  const usage: SfxUsage = {};
  for (const { id } of soundEffects) {
    const counts: Record<string, number> = {};
    for (const { name, text } of files) {
      const count = text.split(`"${id}"`).length - 1;
      if (count > 0) counts[name] = count;
    }
    // A sound named as another's placeholder plays wherever that one does (#232).
    const placeholderFor = soundEffects.filter((effect) => effect.placeholder === id).length;
    if (placeholderFor > 0) counts["audio/sfx-registry.ts (placeholder)"] = placeholderFor;
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    usage[id] = { uses: Object.values(counts).reduce((sum, n) => sum + n, 0), files: sorted };
  }
  return usage;
}

/** The record as it is written to disk. */
export function formatSfxUsage(usage: SfxUsage): string {
  return `${JSON.stringify(usage, null, 2)}\n`;
}
