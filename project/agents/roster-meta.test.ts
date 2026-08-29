import { expect, test } from "bun:test";
import { requestedCapabilitiesFor } from "./platform-capabilities";
import { rosterDefinitionSummaries, summaryFromPerson } from "./roster-meta";
import { ANTBOY_ID, SOFTWARE_ENGINEER_ID } from "./roster-people";

test("rosterDefinitionSummaries uses the live catalog including web and workspace.agents", () => {
  const summaries = rosterDefinitionSummaries();
  const engineer = summaries.find((person) => person.id === SOFTWARE_ENGINEER_ID);
  const antboy = summaries.find((person) => person.id === ANTBOY_ID);
  const expectedIds = requestedCapabilitiesFor(true).map(
    (capability) => capability.id,
  );
  expect(engineer?.includeRepository).toBe(true);
  expect(antboy?.includeRepository).toBe(false);
  expect(engineer?.capabilities.map((capability) => capability.id)).toEqual(
    expectedIds,
  );
  expect(antboy?.capabilities.map((capability) => capability.id)).toEqual(
    requestedCapabilitiesFor(false).map((capability) => capability.id),
  );
  expect(expectedIds).toContain("web");
  expect(expectedIds).toContain("workspace.agents");
});

test("summaryFromPerson and rosterDefinitionSummaries share presented capabilities", () => {
  const [fallback] = rosterDefinitionSummaries();
  const fromPerson = summaryFromPerson({
    id: SOFTWARE_ENGINEER_ID,
    name: "Software engineer",
    description: "Build",
    kind: "cursor",
    githubAccess: true,
  });
  expect(fallback?.capabilities).toEqual(fromPerson.capabilities);
});
