import { expect, test } from "bun:test";
import { requestedCapabilitiesFor } from "./platform-capabilities";

test("workspace.agents grants list, get, create, duplicate, and update", () => {
  expect(requestedCapabilitiesFor(false)).toContainEqual({
    id: "workspace.agents",
    tools: [
      "workspace.list_agents",
      "workspace.get_agent",
      "workspace.create_agent",
      "workspace.duplicate_agent",
      "workspace.update_agent",
    ],
  });
});

test("web grants search and fetch", () => {
  expect(requestedCapabilitiesFor(false)).toContainEqual({
    id: "web",
    tools: ["web.search", "web.fetch"],
  });
});
