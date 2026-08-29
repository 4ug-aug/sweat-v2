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

export type WorkspaceAgentDetail = WorkspaceAgentRecord & {
  instructions: string;
};

export type WorkspaceAgentUpdate = Partial<{
  name: string;
  description: string;
  instructions: string;
  visibility: WorkspaceAgentCreate["visibility"];
}>;

export interface WorkspaceAgentsPort {
  listAgents(responsibleAccountId: string): WorkspaceAgentRecord[];
  getAgent(
    id: string,
    responsibleAccountId: string,
  ): WorkspaceAgentDetail | undefined;
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
  updateAgent(
    id: string,
    patch: WorkspaceAgentUpdate,
    responsibleAccountId: string,
  ): WorkspaceAgentDetail;
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
          name: "workspace.list_agents",
          description:
            "List Agent definitions visible to this run's Responsible Account (workspace Agents and that Account's private Agents). Returns id, name, description, kind, and visibility — not instructions. Use workspace.get_agent to read instructions.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "workspace.get_agent",
          description:
            "Get one Agent definition by id (slug), including instructions. The Agent must be visible to this run's Responsible Account.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
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
        {
          name: "workspace.update_agent",
          description:
            "Update an Agent definition created by this run's Responsible Account. Pass the Agent id (slug), not the display name — use workspace.list_agents to find ids. Name changes do not change the id. Patch name, description, instructions, and/or visibility.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              instructions: { type: "string" },
              visibility: { type: "string", enum: ["private", "workspace"] },
            },
            required: ["id"],
          },
        },
      ];
    },
    async callTool(name, args) {
      if (name === "workspace.list_agents") {
        return textResult(options.port.listAgents(options.responsibleAccountId));
      }
      if (name === "workspace.get_agent") {
        const id = asString(args.id)?.trim();
        if (!id) throw new Error("id is required");
        const agent = options.port.getAgent(id, options.responsibleAccountId);
        if (!agent) throw new Error(`Agent not found: ${id}`);
        return textResult(agent);
      }
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
      if (name === "workspace.update_agent") {
        const id = asString(args.id)?.trim();
        if (!id) throw new Error("id is required");
        const visibility = asVisibility(args.visibility);
        if (args.visibility !== undefined && visibility === undefined)
          throw new Error("Invalid visibility");
        return textResult(
          options.port.updateAgent(
            id,
            {
              ...(asString(args.name) !== undefined
                ? { name: asString(args.name)! }
                : {}),
              ...(asString(args.description) !== undefined
                ? { description: asString(args.description)! }
                : {}),
              ...(asString(args.instructions) !== undefined
                ? { instructions: asString(args.instructions)! }
                : {}),
              ...(visibility ? { visibility } : {}),
            },
            options.responsibleAccountId,
          ),
        );
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };
}
