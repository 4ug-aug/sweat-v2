import { antboyRole } from "../roles/antboy";
import { softwareEngineerRole } from "../roles/software-engineer";
import type { AgentRuntimeKind } from "./definition";
import {
  ANTBOY_ID,
  SOFTWARE_ENGINEER_ID,
  WORKSPACE_PEOPLE,
  type SeededAgentId,
} from "./roster-people";

export type SeededAgentDefinition = {
  id: SeededAgentId;
  name: string;
  description: string;
  instructions: string;
  kind: AgentRuntimeKind;
  githubAccess: boolean;
};

const seed = (
  id: SeededAgentId,
  instructions: string,
): SeededAgentDefinition => {
  const person = WORKSPACE_PEOPLE[id];
  return {
    id,
    name: person.name,
    description: person.description,
    instructions,
    kind: person.kind,
    githubAccess: person.includeRepository,
  };
};

/** Every workspace person must have a seed. Adding a catalog entry fails the typecheck until this dict is updated. */
export const SEEDED_AGENT_DEFINITIONS: Record<
  SeededAgentId,
  SeededAgentDefinition
> = {
  [SOFTWARE_ENGINEER_ID]: seed(
    SOFTWARE_ENGINEER_ID,
    softwareEngineerRole.instructions,
  ),
  [ANTBOY_ID]: seed(ANTBOY_ID, antboyRole.instructions),
};
