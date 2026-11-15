import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vite-plus/test";
import { materialDefinitions, experimentalMaterials } from "../src/materials";
import { passiveDefinitions } from "../src/passives";
import "../src/trial-modifiers";
import "../src/transmogrifiers";
import "../src/nothingifier";
import { escapeHtml } from "./prepare-website";
const ids = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/data-entry-id="([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
describe("website catalogue source coverage (#1457)", () => {
  it("lists every authored built-in material, including experimental appearances", () => {
    expect(ids("materials.html")).toEqual(
      [...materialDefinitions, ...experimentalMaterials].map((d) => d.id).sort(),
    );
  });
  it("lists every registered passive and usable item, preserving its description", () => {
    expect(ids("modifiers.html")).toEqual(passiveDefinitions.names().sort());
    const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ");
    const page = normalizeWhitespace(readFileSync("modifiers.html", "utf8"));
    for (const id of passiveDefinitions.names())
      expect(page).toContain(
        normalizeWhitespace(escapeHtml(passiveDefinitions.get(id).description)),
      );
  });
  it("keeps preparation-time game modules out of all deployed page scripts", () => {
    for (const file of ["index.html", "materials.html", "modifiers.html"]) {
      const page = readFileSync(file, "utf8");
      expect(page).not.toMatch(/<script[^>]+src=/);
      for (const destination of ["materials.html", "modifiers.html", "./game/"])
        expect(page).toContain(destination);
    }
  });
  it("keeps authored HTML characters as text", () => {
    expect(escapeHtml('<b title="x">A&B\'</b>')).toBe(
      "&lt;b title=&quot;x&quot;&gt;A&amp;B&#39;&lt;/b&gt;",
    );
  });
  it("contains no CSS imitation cube geometry in website source", () => {
    expect(readFileSync("src/website/site.css", "utf8")).not.toContain("preserve-3d");
    expect(readFileSync("index.html", "utf8")).not.toContain("data-cube");
  });
  it("has image assets for all HTML references", () => {
    const imageFiles = readdirSync("src/website/art");
    for (const file of ["index.html", "materials.html", "modifiers.html"])
      for (const match of readFileSync(file, "utf8").matchAll(
        /src="\.\/src\/website\/art\/([^"]+)"/g,
      ))
        expect(imageFiles).toContain(match[1]);
  });
});
