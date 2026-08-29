import type { WorkspaceAgentAdapter } from "./roster";
import type { Octokit } from "octokit";
import { createGitHubRepositoryCheckoutSource } from "../inputs/github";
import { createAsanaMcpUpstream } from "../mcp/asana";
import { createGitHubMcpUpstream } from "../mcp/github";
import { createLinearMcpUpstream } from "../mcp/linear";
import {
  createGrafanaMcpUpstream,
  type GrafanaConfiguration,
} from "../mcp/grafana";
import {
  createPostgresMcpUpstream,
  type PostgresConfiguration,
} from "../mcp/postgres";
import {
  createOutlineMcpUpstream,
  type OutlineConfiguration,
} from "../mcp/outline";
import {
  createWorkspaceMcpUpstream,
  type WorkspaceRoomPort,
} from "../mcp/workspace";
import {
  createWorkspaceIssuesMcpUpstream,
  type AssignableOwner,
  type WorkspaceIssuesPort,
} from "../mcp/workspace-issues";
import { commandFailure } from "../sandboxes";
import { STEP_TEXT_LIMIT } from "../runtime/step";
import { rosterParticipant } from "./roster-meta";

export function createWorkspaceSoftwareEngineerAdapter(options: {
  port: WorkspaceRoomPort;
}): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "workspace.room",
      applies({ grantContext }) {
        return Boolean(grantContext?.roomId);
      },
      createUpstream({ grantContext }) {
        const roomId = grantContext?.roomId;
        if (!roomId) {
          throw new Error("A room id is required for the workspace capability");
        }
        return createWorkspaceMcpUpstream({
          port: options.port,
          roomId,
          agent: rosterParticipant(
            grantContext?.agentDefinitionId ?? "software-engineer",
          ),
          ...(grantContext?.rootId ? { rootId: grantContext.rootId } : {}),
          ...(grantContext?.threadReadRootId
            ? { threadReadRootId: grantContext.threadReadRootId }
            : {}),
        });
      },
    },
  };
}

export function createWorkspaceIssuesAdapter(options: {
  port: WorkspaceIssuesPort;
  listAssignableOwners?: () => AssignableOwner[];
}): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "workspace.issues",
      createUpstream({ grantContext }) {
        const agentDefinitionId = grantContext?.agentDefinitionId;
        if (!agentDefinitionId) {
          throw new Error(
            "An agent definition id is required for the workspace issues capability",
          );
        }
        return createWorkspaceIssuesMcpUpstream({
          port: {
            ...options.port,
            createIssue: (input) =>
              options.port.createIssue({
                ...input,
                createdBy: { kind: "agent", id: agentDefinitionId },
              }),
          },
          ...(options.listAssignableOwners
            ? { listAssignableOwners: options.listAssignableOwners }
            : {}),
        });
      },
    },
  };
}

export function createLinearSoftwareEngineerAdapter(options: {
  accessToken: string;
}): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "linear.issues",
      createUpstream: () => createLinearMcpUpstream(options),
    },
  };
}

export function createAsanaSoftwareEngineerAdapter(options: {
  apiToken: string;
  projectGid: string;
}): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "asana.tasks",
      createUpstream: () => createAsanaMcpUpstream(options),
    },
  };
}

/** Outline wiki documents. Requested by antboy only. */
export function createOutlineAdapter(
  options: OutlineConfiguration,
): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "outline.documents",
      createUpstream: () => createOutlineMcpUpstream(options),
    },
  };
}

/** Remote Grafana MCP. Requested by antboy only. */
export function createGrafanaAdapter(
  options: GrafanaConfiguration,
): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "grafana.observability",
      createUpstream: () => createGrafanaMcpUpstream(options),
    },
  };
}

/** Workspace-wide Postgres. Linked to any person, not role-hardcoded. */
export function createPostgresAdapter(
  options: PostgresConfiguration,
): WorkspaceAgentAdapter {
  return {
    capability: {
      id: "postgres.sql",
      createUpstream: () => createPostgresMcpUpstream(options),
    },
  };
}

export function createGitHubSoftwareEngineerAdapter(options: {
  octokit: Octokit;
  repository: string;
  base: string;
  verifyCommand?: string;
  /** After a successful Issue-linked publish, bind the PR head branch on the Issue. */
  bindIssueBranch?: (issueId: string, branch: string) => void;
}): WorkspaceAgentAdapter {
  return {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: options.repository,
        revision: options.base,
      },
      source: createGitHubRepositoryCheckoutSource({
        octokit: options.octokit,
        fallbackRevision: options.base,
      }),
    },
    ...(options.verifyCommand
      ? {
          capability: {
            id: "github.pull-requests",
            resources: [{ provider: "github", repository: options.repository }],
            createUpstream: ({ workspace, sandbox, grantContext }) => {
              if (workspace?.git?.repository !== options.repository) {
                throw new Error(
                  "GitHub capability and prepared repository must match",
                );
              }
              if (!sandbox) {
                throw new Error(
                  "A sandbox is required to verify a pull request",
                );
              }
              const base = grantContext?.repositoryBase ?? options.base;
              const branch = workspace.git.branch;
              const issueId = grantContext?.issueId;
              const upstream = createGitHubMcpUpstream({
                octokit: options.octokit,
                repository: options.repository,
                workspace: workspace.path,
                branch,
                baseCommit: workspace.git.baseCommit,
                base,
                verify: async () => {
                  const result = await sandbox.exec({
                    command: ["sh", "-lc", options.verifyCommand!],
                    workdir: "/work",
                  });
                  if (result.exitCode === 0) return;
                  throw new Error(
                    commandFailure("Verification", result, STEP_TEXT_LIMIT),
                  );
                },
              });
              if (!options.bindIssueBranch || !issueId) return upstream;
              return {
                listTools: () => upstream.listTools(),
                async callTool(name, args) {
                  const result = await upstream.callTool(name, args);
                  if (name === "github.create_pull_request") {
                    try {
                      options.bindIssueBranch!(issueId, branch);
                    } catch (error) {
                      console.error(
                        "Failed to bind Issue branch after pull request",
                        issueId,
                        branch,
                        error,
                      );
                    }
                  }
                  return result;
                },
              };
            },
          },
        }
      : {}),
  };
}

export type { WorkspaceAgentAdapter };
