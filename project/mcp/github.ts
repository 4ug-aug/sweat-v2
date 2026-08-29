import { App, Octokit } from "octokit";
import { boundStepText } from "../runtime/step";
import { createMcpGateway, type McpGateway, type McpTool, type McpUpstream } from "./gateway";

const tools: readonly McpTool[] = [
  {
    name: "github.create_pull_request",
    description: "Publish the workspace's committed HEAD under this run's platform-assigned remote branch, then create or update its pull request. The local branch name does not matter. It is safe to retry after a timeout. Do not use git push or configure a remote: GitHub authentication remains host-side.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "github.wait_for_pull_request_checks",
    description: "Wait up to four minutes for checks on a pull request, then return their status and failure details.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1 } },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    name: "github.compare",
    description: "List files changed between two refs in the granted repository. Default is path and status only. Set includeDiff to true for a truncated unified diff. Compare first; use github.get_file only for named paths. Do not git fetch.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string" },
        head: { type: "string" },
        includeDiff: { type: "boolean" },
      },
      required: ["base", "head"],
      additionalProperties: false,
    },
  },
  {
    name: "github.get_file",
    description: "Read one file at a branch, tag, or SHA in the granted repository. A directory path returns a truncated entry list. Use after github.compare for named paths, not to walk a whole tree.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ref: { type: "string" },
      },
      required: ["path", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "github.get_pull_request",
    description: "Read a pull request in the granted repository: title, body, head and base refs, state, and changed-file list without a patch.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1 } },
      required: ["number"],
      additionalProperties: false,
    },
  },
];

type PullRequestRequest = { title: string; body?: string };
type Change = { path: string; deleted: boolean };
type RemoteBranch = { sha: string; tree: string };
type WorkspaceState = { commits: readonly string[]; head: string; tree: string };
type PullRequestChecksRequest = { number: number };
type CompareRequest = { base: string; head: string; includeDiff: boolean };
type GetFileRequest = { path: string; ref: string };

const directoryEntryLimit = 100;

const checkWaitMs = 4 * 60_000;
const checkPollMs = 15_000;

function string(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function parsePullRequestRequest(value: Record<string, unknown>): PullRequestRequest {
  return {
    title: string(value.title, "GitHub pull request title is required"),
    ...(value.body === undefined ? {} : { body: string(value.body, "GitHub pull request body must be a string") }),
  };
}

function parsePullRequestChecksRequest(value: Record<string, unknown>): PullRequestChecksRequest {
  if (!Number.isInteger(value.number) || (value.number as number) < 1) {
    throw new Error("GitHub pull request number must be a positive integer");
  }
  return { number: value.number as number };
}

function parseCompareRequest(value: Record<string, unknown>): CompareRequest {
  return {
    base: string(value.base, "GitHub compare base is required"),
    head: string(value.head, "GitHub compare head is required"),
    includeDiff: value.includeDiff === true,
  };
}

function parseGetFileRequest(value: Record<string, unknown>): GetFileRequest {
  return {
    path: string(value.path, "GitHub file path is required"),
    ref: string(value.ref, "GitHub file ref is required"),
  };
}

function shortStatus(status: string): string {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  return "M";
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length) throw new Error("GitHub repository must be owner/name");
  return { owner, repo };
}

async function git(directory: string, args: readonly string[]): Promise<string> {
  return new TextDecoder().decode(await gitBytes(directory, args));
}

async function gitBytes(directory: string, args: readonly string[]): Promise<Uint8Array> {
  const process = Bun.spawn(["git", "-C", directory, ...args], {
    env: { PATH: Bun.env.PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).bytes(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode) throw new Error(stderr.trim() || `git ${args[0]} failed`);
  return stdout;
}

function changes(value: string): readonly Change[] {
  const fields = value.split("\0");
  const output: Change[] = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path) continue;
    output.push({ path, deleted: status.startsWith("D") });
  }
  return output;
}

type TreeItem = NonNullable<Parameters<Octokit["rest"]["git"]["createTree"]>[0]>["tree"][number];
type TreeMode = NonNullable<TreeItem["mode"]>;
type TreeType = NonNullable<TreeItem["type"]>;

async function materializeTree(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  workspace: string;
  commit: string;
  changed: readonly Change[];
}): Promise<TreeItem[]> {
  return Promise.all(options.changed.map(async (file): Promise<TreeItem> => {
    // GitHub rejects a tree entry without mode and type, deletions included; sha null drops the path whatever its real mode was.
    if (file.deleted) return { path: file.path, mode: "100644", type: "blob", sha: null };
    const entry = new TextDecoder().decode(await gitBytes(options.workspace, ["ls-tree", "-z", options.commit, "--", file.path]));
    const match = /^(040000|100644|100755|120000|160000) (blob|tree|commit) ([0-9a-f]+)\t/.exec(entry);
    if (!match) throw new Error(`Git tree entry not found for ${file.path}`);
    const [, rawMode, rawType, sha] = match;
    const mode = rawMode as TreeMode;
    const type = rawType as TreeType;
    if (type !== "blob") return { path: file.path, mode, type, sha };
    const content = Buffer.from(await gitBytes(options.workspace, ["show", `${options.commit}:${file.path}`])).toString("base64");
    return {
      path: file.path,
      mode,
      type,
      sha: (await options.octokit.rest.git.createBlob({
        ...options.repository,
        content,
        encoding: "base64",
      })).data.sha,
    };
  }));
}

async function workspaceState(options: {
  workspace: string;
  baseCommit: string;
}): Promise<WorkspaceState> {
  if ((await git(options.workspace, ["status", "--porcelain"])).trim()) {
    throw new Error("Commit workspace changes before creating a pull request");
  }
  const head = (await git(options.workspace, ["rev-parse", "HEAD"])).trim();
  let mergeBase: string;
  try {
    mergeBase = (await git(options.workspace, ["merge-base", options.baseCommit, head])).trim();
  } catch {
    throw new Error("Workspace HEAD must descend from the prepared base commit");
  }
  if (mergeBase !== options.baseCommit) {
    throw new Error("Workspace HEAD must descend from the prepared base commit");
  }
  const commits = (await git(options.workspace, ["rev-list", "--reverse", `${options.baseCommit}..${head}`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  return {
    commits,
    head,
    tree: (await git(options.workspace, ["rev-parse", `${head}^{tree}`])).trim(),
  };
}

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "status" in error
    && (error as { status?: unknown }).status === status;
}

async function remoteBranch(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  branch: string;
}): Promise<RemoteBranch | undefined> {
  try {
    const ref = await options.octokit.rest.git.getRef({
      ...options.repository,
      ref: `heads/${options.branch}`,
    });
    const commit = await options.octokit.rest.git.getCommit({
      ...options.repository,
      commit_sha: ref.data.object.sha,
    });
    return { sha: ref.data.object.sha, tree: commit.data.tree.sha };
  } catch (error) {
    if (hasStatus(error, 404)) return undefined;
    throw error;
  }
}

function checkResult(checks: readonly {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}[]): { state: "passed" | "failed" | "pending"; checks: readonly unknown[] } {
  const result = checks.map((check) => ({
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    ...(check.details_url ? { detailsUrl: check.details_url } : {}),
  }));
  if (!checks.length || checks.some((check) => check.status !== "completed")) {
    return { state: "pending", checks: result };
  }
  return {
    state: checks.some((check) => !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))
      ? "failed"
      : "passed",
    checks: result,
  };
}

async function existingPullRequest(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  branch: string;
  base: string;
}): Promise<unknown | undefined> {
  const response = await options.octokit.rest.pulls.list({
    ...options.repository,
    state: "all",
    head: `${options.repository.owner}:${options.branch}`,
    base: options.base,
  });
  return response.data[0];
}

async function compareRefs(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  args: Record<string, unknown>;
}): Promise<{ base: string; head: string; files: { path: string; status: string }[]; diff?: string }> {
  const input = parseCompareRequest(options.args);
  const comparison = await options.octokit.rest.repos.compareCommits({
    ...options.repository,
    base: input.base,
    head: input.head,
  });
  const files = (comparison.data.files ?? []).map((file) => ({
    path: file.filename,
    status: shortStatus(file.status ?? "modified"),
  }));
  if (!input.includeDiff) return { base: input.base, head: input.head, files };
  const diff = boundStepText(
    (comparison.data.files ?? []).map((file) => file.patch).filter(Boolean).join("\n"),
  );
  return { base: input.base, head: input.head, files, diff };
}

async function getFile(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  args: Record<string, unknown>;
}): Promise<unknown> {
  const input = parseGetFileRequest(options.args);
  const response = await options.octokit.rest.repos.getContent({
    ...options.repository,
    path: input.path,
    ref: input.ref,
  });
  if (Array.isArray(response.data)) {
    const truncated = response.data.length > directoryEntryLimit;
    return {
      type: "dir",
      path: input.path,
      ref: input.ref,
      entries: response.data.slice(0, directoryEntryLimit).map((entry) => ({
        path: entry.path,
        type: entry.type,
      })),
      ...(truncated ? { truncated: true } : {}),
    };
  }
  if (response.data.type !== "file") {
    throw new Error(`GitHub path is not a file: ${input.path}`);
  }
  if (!response.data.content || response.data.encoding === "none") {
    throw new Error("GitHub file is too large to read; name a smaller path");
  }
  return {
    path: response.data.path,
    ref: input.ref,
    content: boundStepText(Buffer.from(response.data.content, "base64").toString("utf8")),
  };
}

async function getPullRequest(options: {
  octokit: Octokit;
  repository: { owner: string; repo: string };
  args: Record<string, unknown>;
}): Promise<unknown> {
  const input = parsePullRequestChecksRequest(options.args);
  const [pullRequest, files] = await Promise.all([
    options.octokit.rest.pulls.get({ ...options.repository, pull_number: input.number }),
    options.octokit.rest.pulls.listFiles({
      ...options.repository,
      pull_number: input.number,
      per_page: 100,
    }),
  ]);
  return {
    number: pullRequest.data.number,
    title: pullRequest.data.title,
    body: pullRequest.data.body ?? "",
    state: pullRequest.data.state,
    head: { ref: pullRequest.data.head.ref, sha: pullRequest.data.head.sha },
    base: { ref: pullRequest.data.base.ref, sha: pullRequest.data.base.sha },
    files: files.data.map((file) => ({
      path: file.filename,
      status: shortStatus(file.status),
    })),
  };
}

export async function createGitHubAppInstallationClient(options: {
  appId: string;
  privateKey: string;
  installationId: number;
}): Promise<Octokit> {
  return new App({ appId: options.appId, privateKey: options.privateKey })
    .getInstallationOctokit(options.installationId);
}

export function createGitHubTokenClient(token: string): Octokit {
  const auth = token.trim();
  if (!auth) throw new Error("GitHub token is required");
  return new Octokit({ auth });
}

export function createGitHubMcpUpstream(options: {
  octokit: Octokit;
  repository: string;
  workspace: string;
  branch: string;
  baseCommit: string;
  base: string;
  verify?: () => Promise<void>;
}): McpUpstream {
  const repository = repositoryParts(options.repository);

  return {
    listTools: async () => tools,
    async callTool(name, args) {
      if (name === "github.compare") {
        return compareRefs({ octokit: options.octokit, repository, args });
      }
      if (name === "github.get_file") {
        return getFile({ octokit: options.octokit, repository, args });
      }
      if (name === "github.get_pull_request") {
        return getPullRequest({ octokit: options.octokit, repository, args });
      }
      if (name === "github.wait_for_pull_request_checks") {
        const input = parsePullRequestChecksRequest(args);
        const deadline = Date.now() + checkWaitMs;
        let latest: ReturnType<typeof checkResult> = { state: "pending", checks: [] };
        do {
          const pullRequest = await options.octokit.rest.pulls.get({ ...repository, pull_number: input.number });
          const checks = await options.octokit.rest.checks.listForRef({
            ...repository,
            ref: pullRequest.data.head.sha,
          });
          latest = checkResult(checks.data.check_runs);
          if (latest.state !== "pending") return latest;
          await Bun.sleep(Math.min(checkPollMs, Math.max(0, deadline - Date.now())));
        } while (Date.now() < deadline);
        return latest;
      }
      if (name !== "github.create_pull_request") throw new Error(`Unknown GitHub tool: ${name}`);
      const input = parsePullRequestRequest(args);
      const workspace = await workspaceState(options);
      if (!workspace.commits.length) throw new Error("Workspace HEAD has no commits to publish");
      await options.verify?.();
      const branch = await remoteBranch({ octokit: options.octokit, repository, branch: options.branch });
      if (branch) {
        if (branch.tree === workspace.tree) {
          const pullRequest = await existingPullRequest({
            octokit: options.octokit, repository, branch: options.branch, base: options.base,
          });
          if (pullRequest) return pullRequest;
          return (await options.octokit.rest.pulls.create({
            ...repository,
            title: input.title,
            body: input.body,
            head: options.branch,
            base: options.base,
          })).data;
        }
        const changed = changes(await git(options.workspace, ["diff", "--name-status", "-z", options.baseCommit, workspace.head]));
        const tree = await options.octokit.rest.git.createTree({
          ...repository,
          base_tree: branch.tree,
          tree: await materializeTree({
            octokit: options.octokit, repository, workspace: options.workspace, commit: workspace.head, changed,
          }),
        });
        const next = await options.octokit.rest.git.createCommit({
          ...repository,
          message: "Sync run branch",
          tree: tree.data.sha,
          parents: [branch.sha],
        });
        await options.octokit.rest.git.updateRef({
          ...repository,
          ref: `heads/${options.branch}`,
          sha: next.data.sha,
          force: false,
        });
        const pullRequest = await existingPullRequest({
          octokit: options.octokit, repository, branch: options.branch, base: options.base,
        });
        if (pullRequest) return pullRequest;
        return (await options.octokit.rest.pulls.create({
          ...repository,
          title: input.title,
          body: input.body,
          head: options.branch,
          base: options.base,
        })).data;
      }

      const head = await options.octokit.rest.git.getRef({
        ...repository,
        ref: `heads/${options.base}`,
      });
      const commit = await options.octokit.rest.git.getCommit({
        ...repository,
        commit_sha: head.data.object.sha,
      });
      let remoteCommit = head.data.object.sha;
      let remoteTree = commit.data.tree.sha;
      for (const localCommit of workspace.commits) {
        const localParent = (await git(options.workspace, ["rev-parse", `${localCommit}^`])).trim();
        const changed = changes(await git(options.workspace, ["diff", "--name-status", "-z", localParent, localCommit]));
        const tree = await options.octokit.rest.git.createTree({
          ...repository,
          base_tree: remoteTree,
          tree: await materializeTree({
            octokit: options.octokit, repository, workspace: options.workspace, commit: localCommit, changed,
          }),
        });
        const next = await options.octokit.rest.git.createCommit({
          ...repository,
          message: (await git(options.workspace, ["log", "-1", "--format=%B", localCommit])).trim(),
          tree: tree.data.sha,
          parents: [remoteCommit],
        });
        remoteCommit = next.data.sha;
        remoteTree = tree.data.sha;
      }
      try {
        await options.octokit.rest.git.createRef({
          ...repository,
          ref: `refs/heads/${options.branch}`,
          sha: remoteCommit,
        });
      } catch (error) {
        const branch = await remoteBranch({ octokit: options.octokit, repository, branch: options.branch });
        if (!hasStatus(error, 422) || !branch || branch.tree !== workspace.tree) throw error;
      }
      try {
        return (await options.octokit.rest.pulls.create({
          ...repository,
          title: input.title,
          body: input.body,
          head: options.branch,
          base: options.base,
        })).data;
      } catch (error) {
        const pullRequest = await existingPullRequest({
          octokit: options.octokit, repository, branch: options.branch, base: options.base,
        });
        if (!hasStatus(error, 422) || !pullRequest) throw error;
        return pullRequest;
      }
    },
  };
}

export function createGitHubMcpGateway(options: {
  octokit: Octokit;
  repository: string;
  workspace: string;
  branch: string;
  baseCommit: string;
  base: string;
  verify?: () => Promise<void>;
  now?: () => Date;
  createToken?: () => string;
}): McpGateway {
  return createMcpGateway({
    now: options.now,
    createToken: options.createToken,
    upstream: createGitHubMcpUpstream(options),
  });
}
