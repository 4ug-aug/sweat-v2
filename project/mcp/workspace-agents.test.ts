import { expect, test } from "bun:test";
import {
  createWorkspaceAgentsMcpUpstream,
  type WorkspaceAgentDetail,
  type WorkspaceAgentRecord,
  type WorkspaceAgentsPort,
} from "./workspace-agents";

const unused = (): never => {
  throw new Error("unused");
};

const unusedPort = (
  overrides: Partial<WorkspaceAgentsPort> = {},
): WorkspaceAgentsPort => ({
  listAgents: unused,
  getAgent: unused,
  createAgent: unused,
  duplicateAgent: unused,
  updateAgent: unused,
  ...overrides,
});

test("create and duplicate record the Responsible Account as creator and the run's agent as Creating agent", async () => {
  const created: WorkspaceAgentRecord[] = [];
  const upstream = createWorkspaceAgentsMcpUpstream({
    responsibleAccountId: "ada",
    creatingAgentId: "antboy",
    port: unusedPort({
      createAgent(input, responsibleAccountId, creatingAgentId) {
        const record = {
          id: "researcher",
          ...input,
          creatorAccountId: responsibleAccountId,
          creatingAgentId,
        };
        created.push(record);
        return record;
      },
      duplicateAgent(id, responsibleAccountId, creatingAgentId) {
        return {
          id: `${id}-copy`,
          name: "Copy",
          description: "Copied",
          kind: "cursor",
          visibility: "workspace",
          creatorAccountId: responsibleAccountId,
          creatingAgentId,
        };
      },
    }),
  });

  const tools = await upstream.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "workspace.list_agents",
    "workspace.get_agent",
    "workspace.create_agent",
    "workspace.duplicate_agent",
    "workspace.update_agent",
  ]);

  const made = (await upstream.callTool("workspace.create_agent", {
    name: "Researcher",
    description: "Looks things up",
    instructions: "Stay concise.",
    kind: "openai-agents",
    visibility: "private",
  })) as { content: { text: string }[] };
  expect(JSON.parse(made.content[0]!.text)).toMatchObject({
    creatorAccountId: "ada",
    creatingAgentId: "antboy",
    visibility: "private",
  });

  const copy = (await upstream.callTool("workspace.duplicate_agent", {
    id: "software-engineer",
  })) as { content: { text: string }[] };
  expect(JSON.parse(copy.content[0]!.text)).toMatchObject({
    id: "software-engineer-copy",
    creatorAccountId: "ada",
    creatingAgentId: "antboy",
  });
});

test("list_agents returns Agent definitions visible to the Responsible Account", async () => {
  const listedFor: string[] = [];
  const agents: WorkspaceAgentRecord[] = [
    {
      id: "repository-maintainer",
      name: "Repository maintainer",
      description: "Keeps the repo healthy",
      kind: "cursor",
      visibility: "workspace",
      creatorAccountId: "ada",
      creatingAgentId: "antboy",
    },
  ];
  const upstream = createWorkspaceAgentsMcpUpstream({
    responsibleAccountId: "ada",
    creatingAgentId: "antboy",
    port: unusedPort({
      listAgents(responsibleAccountId) {
        listedFor.push(responsibleAccountId);
        return agents;
      },
    }),
  });

  expect((await upstream.listTools()).map((tool) => tool.name)).toContain(
    "workspace.list_agents",
  );

  const listed = (await upstream.callTool("workspace.list_agents", {})) as {
    content: { text: string }[];
  };
  expect(listedFor).toEqual(["ada"]);
  expect(JSON.parse(listed.content[0]!.text)).toEqual(agents);
});

test("get_agent returns one Agent including instructions and errors when missing", async () => {
  const detail: WorkspaceAgentDetail = {
    id: "repository-maintainer",
    name: "Repository maintainer",
    description: "Keeps the repo healthy",
    instructions: "Tidy the tree.",
    kind: "cursor",
    visibility: "workspace",
    creatorAccountId: "ada",
    creatingAgentId: "antboy",
  };
  const seen: string[] = [];
  const upstream = createWorkspaceAgentsMcpUpstream({
    responsibleAccountId: "ada",
    creatingAgentId: "antboy",
    port: unusedPort({
      getAgent(id, responsibleAccountId) {
        seen.push(`${responsibleAccountId}:${id}`);
        if (id === detail.id) return detail;
        return undefined;
      },
    }),
  });

  const got = (await upstream.callTool("workspace.get_agent", {
    id: "repository-maintainer",
  })) as { content: { text: string }[] };
  expect(seen).toEqual(["ada:repository-maintainer"]);
  expect(JSON.parse(got.content[0]!.text)).toEqual(detail);

  await expect(
    upstream.callTool("workspace.get_agent", { id: "missing" }),
  ).rejects.toThrow("Agent not found: missing");
  await expect(upstream.callTool("workspace.get_agent", {})).rejects.toThrow(
    "id is required",
  );
});

test("update_agent patches fields for the Responsible Account without changing the id", async () => {
  const calls: { id: string; patch: object; accountId: string }[] = [];
  const upstream = createWorkspaceAgentsMcpUpstream({
    responsibleAccountId: "ada",
    creatingAgentId: "antboy",
    port: unusedPort({
      updateAgent(id, patch, responsibleAccountId) {
        calls.push({ id, patch, accountId: responsibleAccountId });
        return {
          id,
          name: patch.name ?? "Repository maintainer",
          description: "Keeps the repo healthy",
          instructions: "Tidy the tree.",
          kind: "cursor",
          visibility: patch.visibility ?? "workspace",
          creatorAccountId: responsibleAccountId,
          creatingAgentId: "antboy",
        };
      },
    }),
  });

  const updated = (await upstream.callTool("workspace.update_agent", {
    id: "repository-maintainer",
    name: "Repo gardener",
  })) as { content: { text: string }[] };
  expect(calls).toEqual([
    {
      id: "repository-maintainer",
      patch: { name: "Repo gardener" },
      accountId: "ada",
    },
  ]);
  expect(JSON.parse(updated.content[0]!.text)).toMatchObject({
    id: "repository-maintainer",
    name: "Repo gardener",
    instructions: "Tidy the tree.",
  });

  await expect(
    upstream.callTool("workspace.update_agent", {
      id: "repository-maintainer",
      visibility: "secret",
    }),
  ).rejects.toThrow("Invalid visibility");
  await expect(upstream.callTool("workspace.update_agent", {})).rejects.toThrow(
    "id is required",
  );
});
