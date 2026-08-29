import type { McpUpstream } from "./gateway";

export type WorkspaceAgentCreate = {
  name: string;
  description: string;
  instructions: string;
  kind: "cursor" | "openai-agents";
  visibility: "private" | "workspace";
};

export type WorkspaceAgentRecord = {
  id: string;
  name: string;
  description: string;
  kind: "cursor" | "openai-agents";
  visibility: "private" | "workspace";
  creatorAccountId: string;
  creatingAgentId?: string;
};

export interface WorkspaceAgentsPort {
  createAgent(
    input: WorkspaceAgentCreate,
    responsibleAccountId: string,
    creatingAgentId: string,
  ): WorkspaceAgentRecord;
  duplicateAgent(
    id: string,
    responsibleAccountId: string,
    creatingAgentId: string,
  ): WorkspaceAgentRecord;
}

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asKind = (value: unknown): WorkspaceAgentCreate["kind"] | undefined =>
  value === "cursor" || value === "openai-agents" ? value : undefined;

const asVisibility = (
  value: unknown,
): WorkspaceAgentCreate["visibility"] | undefined =>
  value === "private" || value === "workspace" ? value : undefined;

export function createWorkspaceAgentsMcpUpstream(options: {
  port: WorkspaceAgentsPort;
  responsibleAccountId: string;
  creatingAgentId: string;
}): McpUpstream {
  return {
    async listTools() {
      return [
        {
          name: "workspace.create_agent",
          description:
            "Create an Agent definition on behalf of this run's Responsible Account. You are recorded as the Creating agent; that Account remains the Agent creator.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              instructions: { type: "string" },
              kind: { type: "string", enum: ["cursor", "openai-agents"] },
              visibility: { type: "string", enum: ["private", "workspace"] },
            },
            required: ["name", "description", "instructions", "kind"],
          },
        },
        {
          name: "workspace.duplicate_agent",
          description:
            "Duplicate an existing Agent definition on behalf of this run's Responsible Account. The duplicate gets a new Agent slug.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
      ];
    },
    async callTool(name, args) {
      if (name === "workspace.create_agent") {
        const nameValue = asString(args.name);
        const description = asString(args.description);
        const instructions = asString(args.instructions);
        const kind = asKind(args.kind);
        if (!nameValue || !description || !instructions || !kind)
          throw new Error(
            "name, description, instructions, and kind (cursor | openai-agents) are required",
          );
        return textResult(
          options.port.createAgent(
            {
              name: nameValue,
              description,
              instructions,
              kind,
              visibility: asVisibility(args.visibility) ?? "workspace",
            },
            options.responsibleAccountId,
            options.creatingAgentId,
          ),
        );
      }
      if (name === "workspace.duplicate_agent") {
        const id = asString(args.id);
        if (!id) throw new Error("id is required");
        return textResult(
          options.port.duplicateAgent(
            id,
            options.responsibleAccountId,
            options.creatingAgentId,
          ),
        );
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };
}
