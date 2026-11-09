/**
 * `npm run release` (#128): the only thing that changes the game's version. The next minor by
 * default (`npm run release -- major` only when the owner asks, or `-- x.y.z`).
 *
 * `main` is protected, so a release goes through a pull request: from a clean `main` level with
 * `origin/main`, this runs the checks, writes the new version into `package.json` and the
 * lockfile on a `release/vX.Y.Z` branch, commits it as `Release vX.Y.Z`, pushes it and opens the
 * PR. When that PR merges, `.github/workflows/release.yml` tags the merge and publishes the
 * GitHub release with the web build attached. On any failure before the push it restores the
 * files and branch, so it can be run again.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitIn, releaseVersion, type Git } from "./versioning.ts";

const files = ["package.json", "package-lock.json"] as const;

/** `package.json` and the lockfile's text at `version`. */
export function manifestsAt(pkg: string, lock: string, version: string): [string, string] {
  const p = JSON.parse(pkg);
  const l = JSON.parse(lock);
  p.version = version;
  l.version = version;
  if (l.packages?.[""]) l.packages[""].version = version;
  return [`${JSON.stringify(p, null, 2)}\n`, `${JSON.stringify(l, null, 2)}\n`];
}

type ReleaseOptions = {
  root?: string;
  level?: string;
  git?: Git;
  /** Run a command (the checks, `gh`). */
  run?: (command: string, args: string[]) => void;
  log?: (line: string) => void;
};

export function release({
  root = resolve(import.meta.dirname, ".."),
  level = "minor",
  git = gitIn(root),
  run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" }),
  log = console.info,
}: ReleaseOptions = {}): string {
  const path = (file: string) => resolve(root, file);
  const before = Object.fromEntries(files.map((file) => [file, readFileSync(path(file), "utf8")]));
  const version = releaseVersion(JSON.parse(before["package.json"]!).version, level);
  const tag = `v${version}`;
  const branch = `release/${tag}`;

  // Refuse before touching anything.
  if (git("status", "--porcelain")) throw new Error("The working tree is not clean.");
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main")
    throw new Error("Releases are made from main.");
  git("fetch", "--quiet", "--tags", "origin", "main");
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main"))
    throw new Error("main is not level with origin/main: pull or push first.");
  if (git("tag", "--list", tag)) throw new Error(`${tag} already exists.`);

  run("npx", ["vp", "check"]);
  run("npx", ["vp", "test", "run"]);
  run("npx", ["vp", "build"]);

  const [pkg, lock] = manifestsAt(before["package.json"]!, before["package-lock.json"]!, version);
  try {
    git("checkout", "--quiet", "-b", branch);
    writeFileSync(path("package.json"), pkg);
    writeFileSync(path("package-lock.json"), lock);
    git("add", ...files);
    git("commit", "--quiet", "-m", `Release ${tag}`);
    git("push", "--quiet", "-u", "origin", branch);
  } catch (error) {
    git("checkout", "--quiet", "--force", "main");
    for (const file of files) writeFileSync(path(file), before[file]!);
    try {
      git("branch", "-D", branch);
    } catch {
      // Never created.
    }
    throw error;
  }
  run("gh", [
    "pr",
    "create",
    "--title",
    `Release ${tag}`,
    "--body",
    `Releases Poker Blocks ${tag}. Merging this tags it and publishes the GitHub release with the web build (release.yml).`,
  ]);
  git("checkout", "--quiet", "main");
  log(`Opened the release PR for ${tag}. Merge it to publish.`);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  release({ level: process.argv[2] ?? "minor" });
