/**
 * CI's guard on the version (#128): only a `Release vX.Y.Z` commit, made by `npm run release`,
 * may change `package.json`'s version, and only to exactly X.Y.Z with the lockfile's two version
 * fields the same. Any other version change fails. Merge commits are skipped: the release
 * commit they bring in is checked on its own.
 *
 *   node scripts/version-guard.ts <from> [to]
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitIn, type Git } from "./versioning.ts";

/** What is wrong with one commit's version change, or null if nothing. */
export function versionChangeProblem(change: {
  subject: string;
  before: string | null;
  after: string;
  lock: string;
  lockRoot: string;
}): string | null {
  const { subject, before, after, lock, lockRoot } = change;
  if (before === after) return null;
  if (subject !== `Release v${after}`)
    return `changes the version ${before ?? "(none)"} → ${after} but is not "Release v${after}" (only npm run release changes it)`;
  if (lock !== after || lockRoot !== after)
    return `leaves the lockfile at ${lock} / ${lockRoot}, not ${after}`;
  return null;
}

function versionAt(git: Git, rev: string, file: string, root = false): string | null {
  try {
    const json = JSON.parse(git("show", `${rev}:${file}`));
    return String(root ? json.packages?.[""]?.version : json.version);
  } catch {
    return null;
  }
}

/** The problems in the non-merge commits `from..to` (or `to` alone), one line each. */
export function guardRange(git: Git, from: string | null, to: string): string[] {
  const commits = git("rev-list", "--no-merges", "--reverse", from ? `${from}..${to}` : `${to}^!`)
    .split("\n")
    .filter(Boolean);
  return commits.flatMap((sha) => {
    const after = versionAt(git, sha, "package.json");
    if (after === null) return [];
    const problem = versionChangeProblem({
      subject: git("log", "-1", "--format=%s", sha),
      before: versionAt(git, `${sha}^`, "package.json"),
      after,
      lock: versionAt(git, sha, "package-lock.json") ?? "(none)",
      lockRoot: versionAt(git, sha, "package-lock.json", true) ?? "(none)",
    });
    return problem ? [`${sha.slice(0, 8)} ${problem}`] : [];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [from, to = "HEAD"] = process.argv.slice(2);
  const git = gitIn(resolve(import.meta.dirname, ".."));
  // A new branch's (all-zero) or unknown `from` checks `to` alone.
  const known = (() => {
    if (!from || /^0+$/.test(from)) return null;
    try {
      git("cat-file", "-e", `${from}^{commit}`);
      return from;
    } catch {
      return null;
    }
  })();
  const problems = guardRange(git, known, to);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.info("No version changes outside a release.");
}
