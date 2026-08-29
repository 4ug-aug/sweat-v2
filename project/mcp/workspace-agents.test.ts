import { expect, test } from "bun:test";
import {
  createWorkspaceAgentsMcpUpstream,
  type WorkspaceAgentRecord,
} from "./workspace-agents";

test("create and duplicate record the Responsible Account as creator and the run's agent as Creating agent", async () => {
  const created: WorkspaceAgentRecord[] = [];
  const upstream = createWorkspaceAgentsMcpUpstream({
    responsibleAccountId: "ada",
    creatingAgentId: "antboy",
    port: {
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
    },
  });

  const tools = await upstream.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "workspace.create_agent",
    "workspace.duplicate_agent",
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
