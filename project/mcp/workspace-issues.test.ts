import { expect, test } from "bun:test";
import {
  createWorkspaceIssuesMcpUpstream,
  type WorkspaceIssue,
  type WorkspaceIssuesPort,
} from "./workspace-issues";

function makePort(seed: WorkspaceIssue[] = []): WorkspaceIssuesPort & {
  issues: WorkspaceIssue[];
} {
  const issues = [...seed];
  let nextNumber = seed.reduce((max, issue) => Math.max(max, issue.number), 0) + 1;
  const byRef = (ref: string) => {
    const match = /^(?:COL|SWE)-(\d+)$/i.exec(ref.trim());
    if (match) return issues.find((issue) => issue.number === Number(match[1]));
    return issues.find((issue) => issue.id === ref.trim());
  };
  return {
    issues,
    listIssues(filter) {
      return filter?.status
        ? issues.filter((issue) => issue.status === filter.status)
        : [...issues];
    },
    getIssue(ref) {
      return byRef(ref);
    },
    createIssue(input) {
      const issue: WorkspaceIssue = {
        id: `id-${nextNumber}`,
        number: nextNumber,
        title: input.title,
        description: input.description ?? "",
        deliverable: "",
        status: input.status ?? "backlog",
        priority: input.priority ?? "none",
        tags: input.tags ?? [],
        timeSpent: [],
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.owner ? { owner: input.owner } : {}),
        createdAt: nextNumber,
        updatedAt: nextNumber,
      };
      nextNumber += 1;
      issues.push(issue);
      return issue;
    },
    updateIssue(ref, patch) {
      const issue = byRef(ref);
      if (!issue) throw new Error(`Issue not found: ${ref}`);
      Object.assign(issue, {
        ...patch,
        parentId:
          patch.parentId === undefined
            ? issue.parentId
            : patch.parentId === null
              ? undefined
              : patch.parentId,
        branch:
          patch.branch === undefined
            ? issue.branch
            : patch.branch === null
              ? undefined
              : patch.branch,
        updatedAt: issue.updatedAt + 1,
      });
      if (patch.parentId === null) delete issue.parentId;
      if (patch.branch === null) delete issue.branch;
      return issue;
    },
    assignIssue(ref, owner) {
      const issue = byRef(ref);
      if (!issue) throw new Error(`Issue not found: ${ref}`);
      if (owner) issue.owner = owner;
      else delete issue.owner;
      issue.updatedAt += 1;
      return issue;
    },
  };
}

test("listTools returns the five Issue tools", async () => {
  const upstream = createWorkspaceIssuesMcpUpstream({ port: makePort() });
  const tools = await upstream.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "workspace.list_issues",
    "workspace.get_issue",
    "workspace.create_issue",
    "workspace.update_issue",
    "workspace.assign_issue",
  ]);
});

test("create, assign, and get Issues through MCP tools", async () => {
  const port = makePort();
  const upstream = createWorkspaceIssuesMcpUpstream({ port });
  const created = (await upstream.callTool("workspace.create_issue", {
    title: "Dock badge",
    description: "Show unread count",
  })) as { content: { text: string }[] };
  const issue = JSON.parse(created.content[0]!.text) as WorkspaceIssue;
  expect(issue.number).toBe(1);

  await upstream.callTool("workspace.assign_issue", {
    ref: "COL-1",
    owner: { kind: "agent", id: "software-engineer" },
  });
  const got = (await upstream.callTool("workspace.get_issue", {
    ref: "COL-1",
  })) as { content: { text: string }[] };
  expect(JSON.parse(got.content[0]!.text)).toMatchObject({
    title: "Dock badge",
    owner: { kind: "agent", id: "software-engineer" },
  });
  expect(port.issues).toHaveLength(1);
});

test("get_issue includes live related work and list_issues includes active run and deliverable", async () => {
  const upstream = createWorkspaceIssuesMcpUpstream({
    port: makePort([
      {
        id: "parent",
        number: 1,
        title: "Add auth",
        description: "",
        deliverable: "",
        status: "in_progress",
        priority: "none",
        tags: [],
        timeSpent: [],
        hasActiveRun: true,
        createdAt: 1,
        updatedAt: 1,
        children: [
          {
            id: "child-ui",
            number: 2,
            status: "in_progress",
            deliverable: "",
            owner: { kind: "agent", id: "antboy" },
            hasActiveRun: true,
          },
          {
            id: "child-api",
            number: 3,
            status: "in_review",
            deliverable: "Session API shipped.",
            owner: { kind: "agent", id: "software-engineer" },
          },
        ],
      },
      {
        id: "child-ui",
        number: 2,
        title: "Login UI",
        description: "",
        deliverable: "",
        status: "in_progress",
        priority: "none",
        tags: [],
        timeSpent: [],
        parentId: "parent",
        hasActiveRun: true,
        owner: { kind: "agent", id: "antboy" },
        createdAt: 2,
        updatedAt: 2,
        children: [],
      },
    ]),
  });

  const listed = (await upstream.callTool("workspace.list_issues", {})) as {
    content: { text: string }[];
  };
  const rows = JSON.parse(listed.content[0]!.text) as WorkspaceIssue[];
  expect(rows[0]).toMatchObject({
    number: 1,
    deliverable: "",
    hasActiveRun: true,
  });
  expect(rows[1]).toMatchObject({
    number: 2,
    deliverable: "",
    hasActiveRun: true,
  });

  const got = (await upstream.callTool("workspace.get_issue", {
    ref: "COL-1",
  })) as { content: { text: string }[] };
  expect(JSON.parse(got.content[0]!.text)).toMatchObject({
    number: 1,
    hasActiveRun: true,
    children: [
      {
        id: "child-ui",
        number: 2,
        status: "in_progress",
        deliverable: "",
        hasActiveRun: true,
        owner: { kind: "agent", id: "antboy" },
      },
      {
        id: "child-api",
        number: 3,
        status: "in_review",
        deliverable: "Session API shipped.",
        owner: { kind: "agent", id: "software-engineer" },
      },
    ],
  });
});

test("create_issue does not accept createdBy from tool args", async () => {
  const port = makePort();
  const upstream = createWorkspaceIssuesMcpUpstream({ port });
  const created = (await upstream.callTool("workspace.create_issue", {
    title: "From agent",
    createdBy: { kind: "account", id: "ada" },
  })) as { content: { text: string }[] };
  const issue = JSON.parse(created.content[0]!.text) as WorkspaceIssue;
  expect(issue.title).toBe("From agent");
  expect(issue.createdBy).toBeUndefined();
});

test("assign_issue explains owner shape and suggests close matches", async () => {
  const upstream = createWorkspaceIssuesMcpUpstream({
    port: makePort([
      {
        id: "id-31",
        number: 31,
        title: "Example",
        description: "",
        deliverable: "",
        status: "todo",
        priority: "none",
        tags: [],
        timeSpent: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
    listAssignableOwners: () => [
      { kind: "agent", id: "software-engineer", name: "Software engineer" },
      { kind: "agent", id: "antboy", name: "Antboy" },
      { kind: "account", id: "user-1", name: "August" },
    ],
  });

  await expect(
    upstream.callTool("workspace.assign_issue", {
      ref: "31",
      owner: { name: "software engineer" },
    }),
  ).rejects.toThrow(
    /Expected \{ "kind": "agent" \| "account", "id": "<id>" \} or null[\s\S]*Did you mean: \{ "kind": "agent", "id": "software-engineer" \}[\s\S]*Known owners:/,
  );
});

test("assign_issue rejects unknown agent ids with suggestions", async () => {
  const upstream = createWorkspaceIssuesMcpUpstream({
    port: makePort([
      {
        id: "id-1",
        number: 1,
        title: "Example",
        description: "",
        deliverable: "",
        status: "todo",
        priority: "none",
        tags: [],
        timeSpent: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
    listAssignableOwners: () => [
      { kind: "agent", id: "software-engineer", name: "Software engineer" },
    ],
  });

  await expect(
    upstream.callTool("workspace.assign_issue", {
      ref: "COL-1",
      owner: { kind: "agent", id: "software_engineer" },
    }),
  ).rejects.toThrow(
    /Unknown agent "software_engineer"[\s\S]*Did you mean: \{ "kind": "agent", "id": "software-engineer" \}/,
  );
});
