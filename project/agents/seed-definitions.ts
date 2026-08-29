import { antboyRole } from "../roles/antboy";
import { softwareEngineerRole } from "../roles/software-engineer";
import type { AgentRuntimeKind } from "./definition";
import { ANTBOY_ID, SOFTWARE_ENGINEER_ID } from "./roster-people";

export type SeededAgentDefinition = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  kind: AgentRuntimeKind;
  githubAccess: boolean;
};

export const SEEDED_AGENT_DEFINITIONS: readonly SeededAgentDefinition[] = [
  {
    id: SOFTWARE_ENGINEER_ID,
    name: "Software engineer",
    description: "Build, debug, and review code in a checked-out repository.",
    instructions: softwareEngineerRole.instructions,
    kind: "cursor",
    githubAccess: true,
  },
  {
    id: ANTBOY_ID,
    name: "Antboy",
    description:
      "Collaborative teammate for room and task work without a GitHub checkout.",
    instructions: antboyRole.instructions,
    kind: "openai-agents",
    githubAccess: false,
  },
];
