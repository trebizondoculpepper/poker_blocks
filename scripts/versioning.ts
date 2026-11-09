/**
 * The game's versions (#127, #128; the model used by The Pool). `package.json` holds the
 * version of the last release, starting at 0.0.0. Every other build derives its patch: that
 * version plus the first-parent commits on `main` since the commit that last changed it, so it
 * rises with every merged PR and never repeats, and no build commits anything. A release
 * (`npm run release`) is the only thing that changes `package.json`'s version: the next minor
 * by default, a major only when the owner asks.
 */
import { execFileSync } from "node:child_process";

const pattern = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

/** A version's numbers, or an error if it is not one. */
export function versionParts(version: string): {
  major: number;
  minor: number;
  patch: number;
  pre: string;
} {
  const match = pattern.exec(version);
  if (!match) throw new Error(`Invalid package version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? "",
  };
}

/** The version `commits` commits past a release at `version`: its patch moved on. */
export function derivedVersion(version: string, commits: number): string {
  const { major, minor, patch } = versionParts(version);
  return commits <= 0 ? version : `${major}.${minor}.${patch + commits}`;
}

/** How each release level moves a version; an exact version is taken as given. */
const releaseLevels: Record<string, (parts: ReturnType<typeof versionParts>) => string> = {
  minor: ({ major, minor }) => `${major}.${minor + 1}.0`,
  major: ({ major }) => `${major + 1}.0.0`,
};

/** The next release's version: the next minor by default, a major when asked, or an exact one. */
export function releaseVersion(current: string, level = "minor"): string {
  const parts = versionParts(current);
  const next = releaseLevels[level]?.(parts) ?? level;
  versionParts(next);
  return next;
}

export type Git = (...args: string[]) => string;

/** git in `root`, its output trimmed; throws if git fails. */
export const gitIn =
  (root: string): Git =>
  (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

/**
 * The first-parent commits since `package.json`'s version last changed, or null when history
 * can't tell (no git, or a shallow clone).
 */
export function commitsSinceVersionChange(git: Git): number | null {
  try {
    if (git("rev-parse", "--is-shallow-repository") === "true") return null;
    // Along main's first parents, a merged release PR counts as the change, so the merge that
    // brings in a release is that release's own version.
    const base = git(
      "log",
      "-1",
      "--first-parent",
      "--diff-merges=first-parent",
      "--no-patch",
      "--format=%H",
      "-G",
      '"version": ',
      "--",
      "package.json",
    );
    if (!base) return null;
    return Number(git("rev-list", "--count", "--first-parent", `${base}..HEAD`));
  } catch {
    return null;
  }
}

/** This checkout's build version: the release's own, or derived from the commits since. */
export function buildVersion(version: string, git: Git): string {
  const commits = commitsSinceVersionChange(git);
  return commits === null ? `${version}-dev` : derivedVersion(version, commits);
}
