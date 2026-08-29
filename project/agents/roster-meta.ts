// Server-side roster: pairs the client-safe presentation in ./roster-people
// with the role modules that own each person's system instructions.

import { requestedCapabilitiesFor } from "./platform-capabilities";
import { antboyRole } from "../roles/antboy";
import type { AgentRole } from "../roles/role";
import { softwareEngineerRole } from "../roles/software-engineer";
import type { AgentRuntimeKind } from "./definition";
import {
  ANTBOY_ID,
  SOFTWARE_ENGINEER_ID,
  WORKSPACE_PEOPLE,
  capabilityPresentation,
  type WorkspacePerson,
} from "./roster-people";

export * from "./roster-people";

export type WorkspaceRosterPerson = WorkspacePerson & { role: AgentRole };

const rolesById: Record<string, AgentRole> = {
  [SOFTWARE_ENGINEER_ID]: softwareEngineerRole,
  [ANTBOY_ID]: antboyRole,
};

export const WORKSPACE_ROSTER: readonly WorkspaceRosterPerson[] =
  WORKSPACE_PEOPLE.map((person) => {
    const role = rolesById[person.id];
    if (!role) {
      throw new Error(`Workspace person ${person.id} has no role`);
    }
    if (role.id !== person.id) {
      throw new Error(
        `Role ${role.id} does not match workspace person ${person.id}`,
      );
    }
    return { ...person, role };
  });

export type RosterDefinitionSummary = {
  id: string;
  name: string;
  description: string;
  kind: AgentRuntimeKind;
  icon: string;
  includeRepository: boolean;
  visibility?: "private" | "workspace";
  creatorAccountId?: string;
  creatingAgentId?: string;
  archivedAt?: number;
  instructions?: string;
  capabilities: { id: string; name: string; tools: string[] }[];
  skills: { id: string; name: string; description: string }[];
};

export function agentIcon(kind: AgentRuntimeKind): string {
  return kind === "cursor" ? "bot" : "bot-message-square";
}

function presentedCapabilities(
  githubAccess: boolean,
  linked: readonly { id: string; name: string; tools: string[] }[],
): { id: string; name: string; tools: string[] }[] {
  const roleCapabilities = requestedCapabilitiesFor(githubAccess).map(
    (capability) => {
      const presentation = capabilityPresentation[capability.id];
      return {
        id: capability.id,
        name: presentation?.name ?? capability.id,
        tools: capability.tools.map(
          (tool) => presentation?.tools[tool] ?? tool,
        ),
      };
    },
  );
  const seen = new Set(roleCapabilities.map((capability) => capability.id));
  const capabilities = [...roleCapabilities];
  for (const capability of linked) {
    if (seen.has(capability.id)) continue;
    seen.add(capability.id);
    capabilities.push(capability);
  }
  return capabilities;
}

export function summaryFromPerson(
  person: {
    id: string;
    name: string;
    description: string;
    kind: AgentRuntimeKind;
    githubAccess: boolean;
    visibility?: "private" | "workspace";
    creatorAccountId?: string;
    creatingAgentId?: string;
    archivedAt?: number;
    instructions?: string;
  },
  skills: readonly { id: string; name: string; description: string }[] = [],
  linked: readonly { id: string; name: string; tools: string[] }[] = [],
): RosterDefinitionSummary {
  return {
    id: person.id,
    name: person.name,
    description: person.description,
    kind: person.kind,
    icon: agentIcon(person.kind),
    includeRepository: person.githubAccess,
    ...(person.instructions ? { instructions: person.instructions } : {}),
    ...(person.visibility ? { visibility: person.visibility } : {}),
    ...(person.creatorAccountId
      ? { creatorAccountId: person.creatorAccountId }
      : {}),
    ...(person.creatingAgentId
      ? { creatingAgentId: person.creatingAgentId }
      : {}),
    ...(person.archivedAt !== undefined
      ? { archivedAt: person.archivedAt }
      : {}),
    capabilities: presentedCapabilities(person.githubAccess, linked),
    skills: [...skills],
  };
}

export function rosterDefinitionSummaries(
  skillsByAgent: ReadonlyMap<
    string,
    readonly { id: string; name: string; description: string }[]
  > = new Map(),
  connectionCapabilitiesByAgent: ReadonlyMap<
    string,
    readonly { id: string; name: string; tools: string[] }[]
  > = new Map(),
): RosterDefinitionSummary[] {
  return WORKSPACE_ROSTER.map((person) => {
    const roleCapabilities = person.role.requestedCapabilities.map(
      (capability) => {
        const presentation = capabilityPresentation[capability.id];
        return {
          id: capability.id,
          name: presentation?.name ?? capability.id,
          tools: capability.tools.map(
            (tool) => presentation?.tools[tool] ?? tool,
          ),
        };
      },
    );
    const linked = connectionCapabilitiesByAgent.get(person.id) ?? [];
    const seen = new Set(roleCapabilities.map((capability) => capability.id));
    const capabilities = [...roleCapabilities];
    for (const capability of linked) {
      if (seen.has(capability.id)) continue;
      seen.add(capability.id);
      capabilities.push(capability);
    }
    return {
      id: person.id,
      name: person.name,
      description: person.description,
      kind: person.kind,
      icon: person.icon,
      includeRepository: person.includeRepository,
      capabilities,
      skills: [...(skillsByAgent.get(person.id) ?? [])],
    };
  });
}
