import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const menus = read("./menus.ts");
const styles = read("./style.css");

describe("the New Game confirmation (#197)", () => {
  const markup = menus.slice(menus.indexOf('data-menu="confirm"'), menus.indexOf("</div>`"));

  it("offers only Start New Game and Cancel", () => {
    expect([...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual([
      "Start New Game",
      "Cancel",
    ]);
    expect(markup).toContain('role="alertdialog"');
  });

  it("hides the title's own items while it is up, and only asks when a run is saved", () => {
    expect(menus).toMatch(/function confirmNewGame[\s\S]*?titleItems\.hidden = shown/);
    expect(menus).toMatch(/if \(callbacks\.hasSave\(\)\) \{\s*confirmNewGame\(true\)/);
    expect(styles).toMatch(/\.menu-buttons\[hidden\]\s*\{\s*display:\s*none/);
  });
});
