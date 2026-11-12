/** Read-only, paginated gh GraphQL collector. Never invokes a mutation or shell. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Dependency, Issue, Page, PullRequest, Reference, Snapshot } from "./types.ts";

const execute = promisify(execFile);
export type Query = (
  query: string,
  variables: Record<string, string | number>,
) => Promise<Record<string, unknown>>;
export const ghQuery: Query = async (query, variables) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push("-F", `${key}=${value}`);
  let stdout: string;
  try {
    ({ stdout } = await execute("gh", args, { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 }));
  } catch {
    // Do not echo subprocess arguments, stderr, credentials or private API response bodies.
    throw new Error(
      "GitHub query failed. Check gh auth status, repository access and API rate limits.",
    );
  }
  const parsed = JSON.parse(stdout);
  if (parsed.errors?.length || !parsed.data)
    throw new Error("GitHub returned incomplete query data; no fresh report saved.");
  return parsed.data;
};
export async function currentRepository(): Promise<string> {
  try {
    const { stdout } = await execute(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      { timeout: 30_000 },
    );
    return stdout.trim();
  } catch {
    throw new Error(
      "Cannot resolve repository. Supply --repo owner/name and check gh authentication.",
    );
  }
}
const info = "pageInfo{hasNextPage endCursor}";
const comment = "body url author{login} createdAt updatedAt";
const common = `number title body url state createdAt updatedAt labels(first:100){nodes{name} ${info}} comments(first:100){nodes{${comment}} ${info}}`;
const prFields = `${common} headRefOid headRefName baseRefName isDraft mergeable mergeStateStatus reviewDecision mergedAt
 closingIssuesReferences(first:100){nodes{number url} ${info}}
 reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){totalCount nodes{${comment}} ${info}}} ${info}}
 reviews(first:100){nodes{body url author{login} state} ${info}}
 commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}} ${info}}}}}}`;

/** Cursor pagination also detects a broken/repeating cursor instead of spinning forever. */
export async function pages<T>(
  fetch: (cursor?: string) => Promise<Page<T>>,
  stop: (page: T[]) => boolean = () => false,
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetch(cursor);
    if (!page || !Array.isArray(page.nodes) || !page.pageInfo)
      throw new Error("Malformed GitHub connection.");
    result.push(...page.nodes);
    if (stop(page.nodes) || !page.pageInfo.hasNextPage) return result;
    const next = page.pageInfo.endCursor;
    if (!next || seen.has(next)) throw new Error("GitHub pagination did not advance.");
    seen.add(next);
    cursor = next;
  }
}

/** Only explicitly declared prerequisites, never every #mention in the body. */
export function declaredDependencies(body: string, repository: string): Reference[] {
  const refs = new Map<string, Reference>();
  let section = false;
  for (const original of body.split("\n")) {
    const line = original.replaceAll("**", "");
    if (/^\s*(?:#{1,6}\s*)?(?:dependencies|depends on|prerequisites)\s*:?\s*$/i.test(line)) {
      section = true;
      continue;
    }
    if (/^\s*#{1,6}\s/.test(line)) {
      section = false;
      continue;
    }
    // Explicit declarations can follow an introductory sentence, but following incidental
    // references are not swallowed into the prerequisite list.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const declaration = /^\s*(?:[-*]\s*)?(?:depends on|blocked by|requires)\b\s*:?\s*(.*)/i.exec(
        sentence,
      );
      const text = declaration?.[1] ?? (section && /^\s*[-*]\s/.test(sentence) ? sentence : "");
      const add = (repo: string, number: number, url: string) =>
        refs.set(`${repo}#${number}`, { repository: repo, number, url });
      for (const match of text.matchAll(
        /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g,
      ))
        add(match[1]!, Number(match[2]), match[0]);
      const local = text.replace(/https:\/\/github\.com\/[^\s)\]]+/g, "");
      for (const match of local.matchAll(/(?<![\w/])#([1-9]\d*)\b/g))
        add(repository, Number(match[1]), `https://github.com/${repository}/issues/${match[1]}`);
    }
  }
  return [...refs.values()];
}

export async function collect(
  repository: string,
  options: { since?: string; issue?: number } = {},
  query: Query = ghQuery,
  now: () => Date = () => new Date(),
): Promise<Snapshot> {
  const [owner, name] = repository.split("/");
  const vars = { owner: owner!, name: name! };
  const warnings: string[] = [];
  const startedAt = now().toISOString();
  let rateLimit: Snapshot["rateLimit"] = null;
  const request = async (source: string, variables: Record<string, string | number> = {}) => {
    const data = await query(source, { ...vars, ...variables });
    rateLimit = (data.rateLimit as Snapshot["rateLimit"]) ?? rateLimit;
    const repo = data.repository as Record<string, unknown> | null;
    if (!repo) throw new Error(`Repository unavailable: ${repository}`);
    return repo;
  };
  const collection = async <T extends { updatedAt: string }>(
    field: string,
    fields: string,
    states: string,
    cutoff?: string,
  ) => {
    const source = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){${field}(first:50,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}${states}){nodes{${fields}} ${info}}} rateLimit{remaining resetAt}}`;
    const nodes = await pages<T>(
      async (cursor) => (await request(source, cursor ? { cursor } : {}))[field] as Page<T>,
      (batch) => !!cutoff && batch.some((node) => Date.parse(node.updatedAt) < Date.parse(cutoff)),
    );
    return cutoff
      ? nodes.filter((node) => Date.parse(node.updatedAt) >= Date.parse(cutoff))
      : nodes;
  };
  const [issues, pullRequests] = await Promise.all([
    collection<Issue>("issues", `${common} stateReason`, ",states:OPEN"),
    collection<PullRequest>("pullRequests", prFields, ",states:OPEN"),
  ]);
  const issueSource = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){${common} stateReason}}}`;
  if (options.issue && !issues.some((issue) => issue.number === options.issue)) {
    const detail = (await request(issueSource, { number: options.issue })).issue as Issue | null;
    if (!detail) throw new Error(`Issue #${options.issue} is unavailable.`);
    issues.push(detail);
  }
  // All comments are available for semantic reconciliation, even if the briefing shows excerpts.
  for (const item of [...issues, ...pullRequests]) {
    if (item.comments.pageInfo.hasNextPage) {
      const source = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){issueOrPullRequest(number:$number){... on Issue{comments(first:100,after:$cursor){nodes{${comment}} ${info}}} ... on PullRequest{comments(first:100,after:$cursor){nodes{${comment}} ${info}}}}}`;
      const initial = item.comments;
      item.comments.nodes = await pages(async (cursor) => {
        if (!cursor) return initial;
        const node = (await request(source, { number: item.number, cursor }))
          .issueOrPullRequest as { comments: Issue["comments"] };
        return node.comments;
      });
      item.comments.pageInfo = { hasNextPage: false, endCursor: null };
    }
    if (item.labels.pageInfo.hasNextPage)
      warnings.push(`${item.url}: labels exceed 100; label analysis incomplete.`);
  }
  for (const pr of pullRequests) {
    const nested = [
      ["closing references", pr.closingIssuesReferences],
      ["review threads", pr.reviewThreads],
      ["reviews", pr.reviews],
      ["head checks", pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts],
    ] as const;
    for (const [label, connection] of nested)
      if (connection?.pageInfo.hasNextPage)
        warnings.push(`${pr.url}: ${label} exceed 100; review/merge evidence incomplete.`);
  }
  const local = new Map(
    [...issues, ...pullRequests].map((item) => [`${repository}#${item.number}`, item]),
  );
  const refs = new Map(
    issues
      .flatMap((item) => declaredDependencies(item.body, repository))
      .map((ref) => [`${ref.repository}#${ref.number}`, ref]),
  );
  const dependencies: Dependency[] = [];
  for (const [key, ref] of refs) {
    let item = local.get(key) as (Issue & { mergedAt?: string | null }) | undefined;
    if (!item) {
      const [refOwner, refName] = ref.repository.split("/");
      const data = await query(
        `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issueOrPullRequest(number:$number){... on Issue{title state stateReason url} ... on PullRequest{title state mergedAt url}}}}`,
        { owner: refOwner!, name: refName!, number: ref.number },
      );
      const repo = data.repository as { issueOrPullRequest: typeof item } | null;
      item = repo?.issueOrPullRequest;
    }
    dependencies.push({
      ...ref,
      available: !!item,
      ...(item
        ? {
            state: item.state,
            stateReason: item.stateReason,
            mergedAt: item.mergedAt,
            title: item.title,
            url: item.url,
          }
        : {}),
    });
    if (!item) warnings.push(`${ref.url}: declared prerequisite unavailable.`);
  }
  let changed: Snapshot["changed"] = [];
  if (options.since) {
    const values = await Promise.all([
      collection<Issue>("issues", `${common} stateReason`, ",states:[OPEN,CLOSED]", options.since),
      collection<PullRequest>(
        "pullRequests",
        prFields,
        ",states:[OPEN,CLOSED,MERGED]",
        options.since,
      ),
    ]);
    changed = values.flat().map(({ number, title, url, state, updatedAt }) => ({
      number,
      title,
      url,
      state,
      updatedAt,
    }));
  }
  return {
    schemaVersion: 1,
    repository,
    startedAt,
    fetchedAt: now().toISOString(),
    issues,
    pullRequests,
    dependencies,
    changed,
    since: options.since ?? null,
    warnings,
    rateLimit,
  };
}
