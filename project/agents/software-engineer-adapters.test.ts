import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import {
  createGitHubSoftwareEngineerAdapter,
  createWorkspaceIssuesAdapter,
  createWorkspaceSoftwareEngineerAdapter,
} from "./software-engineer-adapters";

test("workspace.room binds workspace.post_message to the invocation root from grantContext.rootId", async () => {
  const calls: unknown[] = [];
  const adapter = createWorkspaceSoftwareEngineerAdapter({
    port: {
      listMessages: () => [],
      listThreadMessages: () => [],
      postMessage: (input) => {
        calls.push(input);
      },
    },
  });
  const upstream = adapter.capability!.createUpstream({
    grantContext: { roomId: "room-1", rootId: "root-1" },
  });
  await upstream.callTool("workspace.post_message", { text: "progress" });
  expect(calls).toEqual([
    {
      roomId: "room-1",
      author: {
        kind: "agent",
        id: "software-engineer",
        name: "Software engineer",
      },
      text: "progress",
      rootId: "root-1",
    },
  ]);
});

test("workspace.room omits rootId for a top-level invocation without a bound root", async () => {
  const calls: unknown[] = [];
  const adapter = createWorkspaceSoftwareEngineerAdapter({
    port: {
      listMessages: () => [],
      listThreadMessages: () => [],
      postMessage: (input) => {
        calls.push(input);
      },
    },
  });
  const upstream = adapter.capability!.createUpstream({
    grantContext: { roomId: "room-1" },
  });
  await upstream.callTool("workspace.post_message", { text: "hello" });
  expect(calls).toEqual([
    {
      roomId: "room-1",
      author: {
        kind: "agent",
        id: "software-engineer",
        name: "Software engineer",
      },
      text: "hello",
    },
  ]);
});

test("workspace.room reads the thread transcript when grantContext.threadReadRootId is set", async () => {
  const adapter = createWorkspaceSoftwareEngineerAdapter({
    port: {
      listMessages: () => {
        throw new Error(
          "must not read flat Room scope for a thread invocation",
        );
      },
      listThreadMessages: (roomId, rootId) => [
        {
          author: { kind: "user", id: "u1", name: "Ada" },
          text: `root of ${roomId}/${rootId}`,
          createdAt: 0,
        },
      ],
      postMessage: () => {},
    },
  });
  const upstream = adapter.capability!.createUpstream({
    grantContext: {
      roomId: "room-1",
      rootId: "root-1",
      threadReadRootId: "root-1",
    },
  });
  const result = (await upstream.callTool("workspace.read_messages", {})) as {
    content: { text: string }[];
  };
  expect(result.content[0].text).toContain("root of room-1/root-1");
});

async function preparedGitWorkspace(prefix: string): Promise<{
  path: string;
  baseCommit: string;
  dispose: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  const git = async (args: string[]) => {
    const process = Bun.spawn(["git", "-C", path, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, err] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ]);
    if (code) throw new Error(err);
  };
  await writeFile(join(path, "README.md"), "before\n");
  await git(["init", "--initial-branch", "sweat/run-1"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "commit.gpgsign", "false"]);
  await git(["add", "README.md"]);
  await git(["commit", "--quiet", "--message", "Base"]);
  const baseCommit = (
    await new Response(
      Bun.spawn(["git", "-C", path, "rev-parse", "HEAD"], {
        stdout: "pipe",
      }).stdout,
    ).text()
  ).trim();
  await writeFile(join(path, "README.md"), "after\n");
  await git(["add", "README.md"]);
  await git(["commit", "--quiet", "--message", "Change"]);
  return {
    path,
    baseCommit,
    dispose: () => rm(path, { force: true, recursive: true }),
  };
}

function githubFetchMock(options: {
  missingBranch: string;
  baseBranch: string;
}): (url: string, init?: RequestInit) => Promise<Response> {
  const missing = `git/ref/heads%2F${options.missingBranch.replaceAll("/", "%2F")}`;
  const base = `git/ref/heads%2F${options.baseBranch.replaceAll("/", "%2F")}`;
  return async (url) => {
    if (url.includes(missing)) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (url.includes(base)) {
      return Response.json({ object: { sha: "base-commit" } });
    }
    if (url.includes("git/commits/base-commit")) {
      return Response.json({ tree: { sha: "base-tree" } });
    }
    if (url.includes("/git/blobs")) return Response.json({ sha: "blob" });
    if (url.includes("/git/trees")) return Response.json({ sha: "tree" });
    if (url.includes("/git/commits")) return Response.json({ sha: "commit" });
    if (url.includes("/git/refs")) return Response.json({});
    if (url.includes("/pulls")) return Response.json({ number: 9 });
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
}

test("GitHub PR merge base uses grantContext.repositoryBase when set", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const adapter = createGitHubSoftwareEngineerAdapter({
    octokit: new Octokit({
      auth: "secret",
      request: {
        fetch: async (url: string, init?: RequestInit) => {
          requests.push({
            url,
            body: typeof init?.body === "string" ? init.body : undefined,
          });
          return githubFetchMock({
            missingBranch: "sweat/run-1",
            baseBranch: "feat/initiative",
          })(url, init);
        },
      },
    }),
    repository: "acme/widgets",
    base: "main",
    verifyCommand: "true",
  });

  const workspace = await preparedGitWorkspace("sweat-base-");
  try {
    const upstream = adapter.capability!.createUpstream({
      workspace: {
        path: workspace.path,
        git: {
          repository: "acme/widgets",
          baseRevision: "feat/initiative",
          baseCommit: workspace.baseCommit,
          branch: "sweat/run-1",
        },
        dispose: async () => {},
      },
      sandbox: {
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
      grantContext: { repositoryBase: "feat/initiative" },
    });

    await upstream.callTool("github.create_pull_request", { title: "Ship" });
    expect(
      requests.some((request) =>
        request.url.includes("heads%2Ffeat%2Finitiative"),
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.url.includes("heads%2Fmain")),
    ).toBe(false);
    const createPull = requests.find(
      (request) => request.url.endsWith("/pulls") && request.body !== undefined,
    );
    expect(JSON.parse(createPull!.body!)).toMatchObject({
      base: "feat/initiative",
      head: "sweat/run-1",
    });
  } finally {
    await workspace.dispose();
  }
}, 15_000);

test("GitHub PR publish binds the run branch onto the Issue", async () => {
  const bindings: Array<{ issueId: string; branch: string }> = [];
  const adapter = createGitHubSoftwareEngineerAdapter({
    octokit: new Octokit({
      auth: "secret",
      request: {
        fetch: githubFetchMock({
          missingBranch: "sweat/run-1",
          baseBranch: "main",
        }),
      },
    }),
    repository: "acme/widgets",
    base: "main",
    verifyCommand: "true",
    bindIssueBranch: (issueId, branch) => {
      bindings.push({ issueId, branch });
    },
  });

  const workspace = await preparedGitWorkspace("sweat-bind-");
  try {
    const upstream = adapter.capability!.createUpstream({
      workspace: {
        path: workspace.path,
        git: {
          repository: "acme/widgets",
          baseRevision: "main",
          baseCommit: workspace.baseCommit,
          branch: "sweat/run-1",
        },
        dispose: async () => {},
      },
      sandbox: {
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
      grantContext: { issueId: "issue-1" },
    });

    await upstream.callTool("github.create_pull_request", { title: "Ship" });
    expect(bindings).toEqual([{ issueId: "issue-1", branch: "sweat/run-1" }]);
  } finally {
    await workspace.dispose();
  }
}, 15_000);

test("GitHub PR publish skips Issue branch bind without issueId", async () => {
  const bindings: Array<{ issueId: string; branch: string }> = [];
  const adapter = createGitHubSoftwareEngineerAdapter({
    octokit: new Octokit({
      auth: "secret",
      request: {
        fetch: githubFetchMock({
          missingBranch: "sweat/run-1",
          baseBranch: "main",
        }),
      },
    }),
    repository: "acme/widgets",
    base: "main",
    verifyCommand: "true",
    bindIssueBranch: (issueId, branch) => {
      bindings.push({ issueId, branch });
    },
  });

  const workspace = await preparedGitWorkspace("sweat-nobind-");
  try {
    const upstream = adapter.capability!.createUpstream({
      workspace: {
        path: workspace.path,
        git: {
          repository: "acme/widgets",
          baseRevision: "main",
          baseCommit: workspace.baseCommit,
          branch: "sweat/run-1",
        },
        dispose: async () => {},
      },
      sandbox: {
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
      grantContext: {},
    });

    await upstream.callTool("github.create_pull_request", { title: "Ship" });
    expect(bindings).toEqual([]);
  } finally {
    await workspace.dispose();
  }
}, 15_000);

test("workspace.issues stamps createdBy from grantContext.agentDefinitionId", async () => {
  const created: unknown[] = [];
  const adapter = createWorkspaceIssuesAdapter({
    port: {
      listIssues: () => [],
      getIssue: () => undefined,
      createIssue: (input) => {
        created.push(input.createdBy);
        return {
          id: "id-1",
          number: 1,
          title: input.title,
          description: "",
          deliverable: "",
          status: "backlog",
          priority: "none",
          tags: [],
          timeSpent: [],
          createdAt: 1,
          updatedAt: 1,
        };
      },
      updateIssue: () => {
        throw new Error("unused");
      },
      assignIssue: () => {
        throw new Error("unused");
      },
    },
  });
  expect(() =>
    adapter.capability!.createUpstream({ grantContext: {} }),
  ).toThrow(
    "An agent definition id is required for the workspace issues capability",
  );
  const upstream = adapter.capability!.createUpstream({
    grantContext: { agentDefinitionId: "antboy" },
  });
  await upstream.callTool("workspace.create_issue", {
    title: "From antboy",
    createdBy: { kind: "account", id: "ada" },
  });
  expect(created).toEqual([{ kind: "agent", id: "antboy" }]);
});
