/**
 * `npm run release` (#128, made to work like The Pool's): pushes `main` to the `release`
 * branch, and that push is the release. `.github/workflows/release.yml` runs the checks,
 * builds the game at the next minor version, tags it `vX.Y.Z`, publishes the GitHub release
 * with the web build and pushes the build to itch.io.
 *
 * A major (only when the owner asks) or an exact version: `npm run release -- major` or
 * `-- 1.2.3` runs the same workflow on `main` with that level instead of pushing.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitIn, type Git } from "./versioning.ts";

type ReleaseOptions = {
  level?: string;
  git?: Git;
  /** Run a command (`gh`). */
  run?: (command: string, args: string[]) => void;
  log?: (line: string) => void;
};

export function release({
  level = "minor",
  git = gitIn(resolve(import.meta.dirname, "..")),
  run = (command, args) => execFileSync(command, args, { stdio: "inherit" }),
  log = console.info,
}: ReleaseOptions = {}): void {
  git("fetch", "--quiet", "--tags", "origin", "main");
  const head = git("rev-parse", "origin/main");
  if (level === "minor") {
    // Fast-forward only: the release branch only ever follows main.
    git("push", "--quiet", "origin", `${head}:refs/heads/release`);
    log(`Pushed main (${head.slice(0, 7)}) to release: the release workflow publishes it.`);
  } else {
    run("gh", ["workflow", "run", "release.yml", "--ref", "main", "-f", `level=${level}`]);
    log(`Started a ${level} release of main (${head.slice(0, 7)}).`);
  }
  log(
    "Follow it with: gh run watch $(gh run list -w release.yml -L 1 --json databaseId -q '.[0].databaseId')",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  release({ level: process.argv[2] ?? "minor" });
