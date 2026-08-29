// Client-safe roster presentation. This module must not import role modules:
// role instructions are server-owned and would otherwise ship in the GUI bundle.

import type { AgentRuntimeKind } from "./definition";

export const SOFTWARE_ENGINEER_ID = "software-engineer";
export const ANTBOY_ID = "antboy";

export const capabilityPresentation: Record<
  string,
  { name: string; tools: Record<string, string> }
> = {
  "workspace.issues": {
    name: "Issues",
    tools: {
      "workspace.list_issues": "List issues",
      "workspace.get_issue": "Get issues",
      "workspace.create_issue": "Create issues",
      "workspace.update_issue": "Update issues",
      "workspace.assign_issue": "Assign issues",
    },
  },
  "linear.issues": {
    name: "Linear issues",
    tools: {
      "linear.get_issue": "Get issues",
      "linear.list_issues": "List issues",
      "linear.save_comment": "Save comments",
      "linear.save_issue": "Save issues",
    },
  },
  "asana.tasks": {
    name: "Asana tasks",
    tools: {
      "asana.get_project": "Get project",
      "asana.create_task": "Create tasks",
      "asana.list_tasks": "List tasks",
      "asana.get_task": "Get task details",
      "asana.get_task_comments": "Read comments",
      "asana.set_task_completion": "Update completion",
      "asana.add_task_comment": "Add comments",
    },
  },
  "outline.documents": {
    name: "Outline wiki",
    tools: {
      "outline.list_documents": "Search documents",
      "outline.fetch": "Read documents",
      "outline.list_collections": "List collections",
      "outline.create_document": "Create documents",
      "outline.update_document": "Update documents",
    },
  },
  "grafana.observability": {
    name: "Grafana",
    tools: {
      "grafana.search_dashboards": "Search dashboards",
      "grafana.get_dashboard_summary": "Summarize dashboards",
      "grafana.get_dashboard_property": "Read dashboard properties",
      "grafana.get_dashboard_panel_queries": "Read panel queries",
      "grafana.list_datasources": "List datasources",
      "grafana.get_datasource": "Get datasources",
      "grafana.query_prometheus": "Query Prometheus",
      "grafana.list_prometheus_metric_metadata": "List metric metadata",
      "grafana.list_prometheus_metric_names": "List metric names",
      "grafana.list_prometheus_label_names": "List Prometheus labels",
      "grafana.list_prometheus_label_values": "List Prometheus label values",
      "grafana.query_loki_logs": "Query Loki logs",
      "grafana.list_loki_label_names": "List Loki labels",
      "grafana.list_loki_label_values": "List Loki label values",
      "grafana.query_loki_stats": "Query Loki stats",
      "grafana.list_alert_groups": "List alert groups",
      "grafana.get_alert_group": "Get alert groups",
    },
  },
  "postgres.sql": {
    name: "Postgres",
    tools: {
      "postgres.list_tables": "List tables",
      "postgres.describe_table": "Describe tables",
      "postgres.query": "Query Postgres",
    },
  },
  "github.pull-requests": {
    name: "GitHub pull requests",
    tools: {
      "github.create_pull_request": "Create pull requests",
      "github.wait_for_pull_request_checks": "Wait for pull request checks",
      "github.compare": "Compare refs",
      "github.get_file": "Read files at a ref",
      "github.get_pull_request": "Read pull requests",
    },
  },
  "workspace.room": {
    name: "Room",
    tools: {
      "workspace.read_messages": "Read messages",
      "workspace.post_message": "Post messages",
    },
  },
  "workspace.agents": {
    name: "Agents",
    tools: {
      "workspace.create_agent": "Create agents",
      "workspace.duplicate_agent": "Duplicate agents",
    },
  },
};

export function capabilityToolLabel(tool: string): string | undefined {
  for (const capability of Object.values(capabilityPresentation)) {
    const label = capability.tools[tool];
    if (label) return `${capability.name}: ${label}`;
  }
}

export type WorkspacePerson = {
  id: string;
  name: string;
  description: string;
  kind: AgentRuntimeKind;
  icon: string;
  includeRepository: boolean;
};

/** Single source of truth for who is in the workspace and how they present. */
export const WORKSPACE_PEOPLE: readonly WorkspacePerson[] = [
  {
    id: SOFTWARE_ENGINEER_ID,
    name: "Software engineer",
    description: "Build, debug, and review code in a checked-out repository.",
    kind: "cursor",
    icon: "bot",
    includeRepository: true,
  },
  {
    id: ANTBOY_ID,
    name: "Antboy",
    description:
      "Collaborative teammate for room and task work without a GitHub checkout.",
    kind: "openai-agents",
    icon: "bot-message-square",
    includeRepository: false,
  },
];

export function rosterPerson(id: string): WorkspacePerson | undefined {
  return WORKSPACE_PEOPLE.find((person) => person.id === id);
}

export function rosterMentionHandles(): ReadonlySet<string> {
  return new Set(WORKSPACE_PEOPLE.map((person) => person.id));
}

export function rosterMentionPattern(): RegExp {
  const ids = WORKSPACE_PEOPLE.map((person) =>
    person.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  return new RegExp(`(^|\\s)@(${ids})\\b\\s*`);
}

export function rosterParticipant(id: string): {
  id: string;
  name: string;
  image?: string;
} {
  const person = rosterPerson(id);
  return person ? { id: person.id, name: person.name } : { id, name: id };
}

export function rosterNotConfiguredMessage(kind: AgentRuntimeKind): string {
  return kind === "cursor"
    ? "Cursor agent runtime is not configured"
    : "LLM provider is not configured";
}
