import { expect, test } from "bun:test";
import { softwareEngineerRole } from "./software-engineer";

test("the software engineer requests scoped issue and pull request tools", () => {
  expect(softwareEngineerRole.id).toBe("software-engineer");
  expect(softwareEngineerRole.requestedCapabilities).toContainEqual({
    id: "workspace.issues",
    tools: [
      "workspace.list_issues",
      "workspace.get_issue",
      "workspace.create_issue",
      "workspace.update_issue",
      "workspace.assign_issue",
    ],
  });
  expect(
    softwareEngineerRole.requestedCapabilities.some(
      (capability) => capability.id === "asana.tasks",
    ),
  ).toBe(false);
  expect(
    softwareEngineerRole.requestedCapabilities.some(
      (capability) => capability.id === "postgres.sql",
    ),
  ).toBe(false);
  expect(softwareEngineerRole.requestedCapabilities).toContainEqual({
    id: "github.pull-requests",
    tools: [
      "github.create_pull_request",
      "github.wait_for_pull_request_checks",
      "github.compare",
      "github.get_file",
      "github.get_pull_request",
    ],
  });
  expect(softwareEngineerRole.instructions).toContain(
    "Make at most two repair attempts",
  );
  expect(softwareEngineerRole.instructions).toContain(
    "github.compare first",
  );
  expect(softwareEngineerRole.instructions).toContain(
    "do not git fetch",
  );
  expect(softwareEngineerRole.instructions).toContain(
    "Do not use workspace.post_message to deliver your final result",
  );
  expect(softwareEngineerRole.instructions).not.toContain("Room");
});
