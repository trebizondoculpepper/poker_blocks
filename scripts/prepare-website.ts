/** Static reference pages from authored registries (#1457; doc/game-website.md). Never bundled for visitors. */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { createServer } from "vite-plus";
import type { MaterialDefinition } from "../src/materials";

export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
type Entry = { id: string; name: string; description: string; labels: string[] };
const navigation =
  '<nav class="site-nav" aria-label="Site"><a href="./index.html">Overview</a><a href="./materials.html">Materials</a><a href="./modifiers.html">Modifiers</a><a href="./game/">Play game</a></nav>';
export async function prepareWebsite(root: string): Promise<void> {
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const materials = (await server.ssrLoadModule(
      "/src/materials.ts",
    )) as typeof import("../src/materials");
    // Discover the source registration modules, excluding tests; no game bootstrap or hand-maintained ID list.
    for (const file of (await readdir(join(root, "src")))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort()) {
      const source = await readFile(join(root, "src", file), "utf8");
      if (/passiveDefinitions\s*\.\s*register\s*\(/u.test(source))
        await server.ssrLoadModule("/src/" + file);
    }
    const passives = (await server.ssrLoadModule(
      "/src/passives.ts",
    )) as typeof import("../src/passives");
    const { releaseStatusDescriptor } = (await server.ssrLoadModule(
      "/src/release-status.ts",
    )) as typeof import("../src/release-status");
    const { projectLinks, projectHome } = (await server.ssrLoadModule(
      "/src/project-links.ts",
    )) as typeof import("../src/project-links");
    const footer =
      '<nav aria-label="Project links" class="links">' +
      projectLinks
        .flatMap(({ label, href }) =>
          href
            ? [
                `<a class="block-button steel small" href="${escapeHtml(href)}"><span class="face">${escapeHtml(label)}</span></a>`,
              ]
            : [],
        )
        .join("") +
      '</nav><p class="art-credit"><a href="./art-notices/NOTICE.txt">Artwork &amp; font notices</a></p>';
    const scoring = {
      additive: (value: number) => `Card base: ${value >= 0 ? "+" : ""}${value}`,
      multiplicative: (value: number) => `Line multiplier: ×${value}`,
      exponential: (value: number) => `Line power: ^${value}`,
    };
    const materialEntry = (definition: MaterialDefinition, origin: string): Entry => ({
      id: definition.id,
      name: definition.name,
      description:
        Object.entries(definition.scoringModifier ?? {})
          .map(([field, value]) => scoring[field as keyof typeof scoring](value))
          .join(" · ") ||
        "No fixed scoring bonus. See the game rules for reactions and other effects.",
      labels: [origin, releaseStatusDescriptor(definition.id, definition.releaseStatus).label],
    });
    const materialEntries = [
      ...materials.materialDefinitions.map((d) => materialEntry(d, "Material")),
      ...materials.experimentalMaterials.map((d) => materialEntry(d, "Experimental appearance")),
    ];
    const modifierEntries = passives.passiveDefinitions.names().map((id) => {
      const d = passives.passiveDefinitions.get(id);
      return {
        id,
        name: d.name,
        description: d.description,
        labels: [
          releaseStatusDescriptor(id, d.releaseStatus).label,
          ...(d.retired ? ["Retired — historical entry"] : []),
        ],
      };
    });
    const pages = [
      {
        file: "materials.html",
        title: "Materials",
        intro:
          "The authored materials and experimental appearances. Fixed scoring modifiers are shown where supplied; reactions and state-dependent effects are explained in the game rules. Appearance variants are included for reference, not as a promise of shop availability.",
        entries: materialEntries,
      },
      {
        file: "modifiers.html",
        title: "Modifiers",
        intro:
          "The game’s installed passives and usable rack items, with their authored descriptions. Provisional entries are still being tried out; retired entries remain here for historical saves. This is a reference, not a shop inventory or a guarantee of availability.",
        entries: modifierEntries,
      },
    ];
    for (const page of pages) {
      const entries = page.entries.sort(
        (a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id),
      );
      const body = entries
        .map(
          (entry) =>
            `<article class="reference-entry" id="${escapeHtml(entry.id)}" data-entry-id="${escapeHtml(entry.id)}"><h2>${escapeHtml(entry.name)}</h2><p class="entry-labels">${entry.labels.map(escapeHtml).join(" · ")}</p><p>${escapeHtml(entry.description)}</p></article>`,
        )
        .join("\n");
      await writeFile(
        join(root, page.file),
        `<!doctype html>\n<!-- Generated by scripts/prepare-website.ts; edit definitions, not this list. -->\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} · Poker Blocks</title><link rel="stylesheet" href="./src/website/site.css"></head><body>${navigation}<header class="reference-header"><a href="./index.html"><img src="./src/website/art/title.png" width="1600" height="720" alt="Poker Blocks" class="reference-logo"></a><h1>${page.title}</h1><p>${page.intro}</p><p>${entries.length} entries · <a href="${projectHome}/blob/main/doc/game.md">Read the game rules</a></p></header><main class="reference-list">${body}</main><footer class="table-edge">${footer}</footer></body></html>\n`,
      );
    }
    const home = await readFile(join(root, "index.html"), "utf8");
    await writeFile(
      join(root, "index.html"),
      home
        .replace(
          /<!-- site-navigation -->[\s\S]*?<!-- \/site-navigation -->/u,
          "<!-- site-navigation -->" + navigation + "<!-- /site-navigation -->",
        )
        .replace(
          /<!-- project-footer -->[\s\S]*?<!-- \/project-footer -->/u,
          "<!-- project-footer -->" + footer + "<!-- /project-footer -->",
        ),
    );
  } finally {
    await server.close();
  }
  // Use the project's existing formatter so regeneration never leaves formatted source dirty.
  await promisify(execFile)(
    join(root, "node_modules/.bin/vp"),
    ["fmt", "index.html", "materials.html", "modifiers.html"],
    { cwd: root },
  );
}
