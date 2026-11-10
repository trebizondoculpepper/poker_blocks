/**
 * The game's versions (#127, #128; the model used by The Pool). A release is a `vX.Y.Z` tag,
 * made by the release workflow when `main` is pushed to the `release` branch: the next minor by
 * default, a major only when the owner asks. Every other build derives its patch: the last
 * release tag plus the first-parent commits on `main` since it, so it rises with every merged PR
 * and never repeats, and no build commits anything. Before the first tag, `package.json`'s
 * version is the base, counted from the commit that last changed it.
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

/** The last release tag on this checkout's first-parent history, or null when there is none. */
export function lastReleaseTag(git: Git): string | null {
  try {
    return (
      git(
        "describe",
        "--tags",
        "--first-parent",
        "--abbrev=0",
        "--match",
        "v[0-9]*.[0-9]*.[0-9]*",
      ) || null
    );
  } catch {
    return null;
  }
}

/** The first-parent commits since the last release tag, or null when history can't tell. */
export function commitsSinceRelease(git: Git, tag: string): number | null {
  try {
    if (git("rev-parse", "--is-shallow-repository") === "true") return null;
    return Number(git("rev-list", "--count", "--first-parent", `${tag}..HEAD`));
  } catch {
    return null;
  }
}

/**
 * This checkout's build version: the last release tag's, moved on by the commits since; or,
 * before any tag, `version` (package.json's) moved on by the commits since it last changed.
 */
export function buildVersion(version: string, git: Git): string {
  const tag = lastReleaseTag(git);
  if (tag) {
    const since = commitsSinceRelease(git, tag);
    return since === null ? `${tag.slice(1)}-dev` : derivedVersion(tag.slice(1), since);
  }
  const commits = commitsSinceVersionChange(git);
  return commits === null ? `${version}-dev` : derivedVersion(version, commits);
}
