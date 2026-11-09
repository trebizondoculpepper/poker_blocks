import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/**
 * Credentials are never committed (#130): publishing keys live in GitHub Actions secrets, read
 * as `${{ secrets.NAME }}`. This fails if any tracked file assigns a value to one of them.
 */
const secretNames = ["BUTLER_API_KEY", "ELEVENLABS_API_KEY"];
const root = resolve(import.meta.dirname, "..");
const textFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(ts|js|mjs|json|ya?ml|md|sh|html|env|txt)$|^\.env/.test(file));

/** An assignment of a literal value (not a secrets or env reference) to a secret's name. */
const assigned = (name: string) =>
  new RegExp(`${name}\\s*[:=]\\s*["']?(?!\\$\\{\\{|\\$|process\\.env)[A-Za-z0-9_\\-]{16,}`);

describe("no committed credentials (#130)", () => {
  it.each(secretNames)("no tracked file assigns a value to %s", (name) => {
    const offenders = textFiles.filter((file) => {
      try {
        return assigned(name).test(readFileSync(resolve(root, file), "utf8"));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it("recognises an assignment, but not a secrets reference", () => {
    // Built at run time, so this file never holds an assignment itself.
    const sample = ["BUTLER_API_KEY", "abcdefghij0123456789"].join("=");
    expect(assigned("BUTLER_API_KEY").test(sample)).toBe(true);
    expect(assigned("BUTLER_API_KEY").test("BUTLER_API_KEY: ${{ secrets.BUTLER_API_KEY }}")).toBe(
      false,
    );
  });
});
