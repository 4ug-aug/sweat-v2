export const WORKSPACE_ISSUE_TOOLS = [
  "workspace.list_issues",
  "workspace.get_issue",
  "workspace.create_issue",
  "workspace.update_issue",
  "workspace.assign_issue",
] as const;

export const WORKSPACE_ROOM_TOOLS = [
  "workspace.read_messages",
  "workspace.post_message",
] as const;

export const WORKSPACE_AGENT_TOOLS = [
  "workspace.list_agents",
  "workspace.get_agent",
  "workspace.create_agent",
  "workspace.duplicate_agent",
  "workspace.update_agent",
] as const;

export const GITHUB_PULL_REQUEST_TOOLS = [
  "github.create_pull_request",
  "github.wait_for_pull_request_checks",
  "github.compare",
  "github.get_file",
  "github.get_pull_request",
] as const;

export const WEB_SEARCH_TOOLS = ["web.search", "web.fetch"] as const;

export type RequestedCapability = {
  id: string;
  tools: readonly string[];
};

export function requestedCapabilitiesFor(
  githubAccess: boolean,
): RequestedCapability[] {
  return [
    { id: "workspace.issues", tools: WORKSPACE_ISSUE_TOOLS },
    { id: "workspace.room", tools: WORKSPACE_ROOM_TOOLS },
    { id: "workspace.agents", tools: WORKSPACE_AGENT_TOOLS },
    { id: "web", tools: WEB_SEARCH_TOOLS },
    ...(githubAccess
      ? [{ id: "github.pull-requests", tools: GITHUB_PULL_REQUEST_TOOLS }]
      : []),
  ];
}
