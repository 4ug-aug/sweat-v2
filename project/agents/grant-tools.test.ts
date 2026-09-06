import { expect, test } from "bun:test";
import {
  expandGrantedNames,
  intersectGrantedTools,
  selectGrantedTools,
} from "./grant-tools";

const eligible = [
  "workspace.list_issues",
  "workspace.get_issue",
  "github.compare",
  "github.get_file",
];
const bundles = {
  issues: ["workspace.list_issues", "workspace.get_issue"],
  github: ["github.compare", "github.get_file"],
};

test("all mode returns every eligible tool", async () => {
  expect(
    await selectGrantedTools({ mode: "all" }, { task: "anything", eligibleTools: eligible }),
  ).toEqual({ tools: eligible, reason: "all" });
});

test("allowlist intersects with eligible and fails open to eligible", async () => {
  expect(
    await selectGrantedTools(
      { mode: "allowlist", tools: ["workspace.get_issue", "missing.tool"] },
      { task: "read COL-123", eligibleTools: eligible },
    ),
  ).toEqual({ tools: ["workspace.get_issue"], reason: "narrowed" });
  expect(
    await selectGrantedTools(
      { mode: "allowlist", tools: ["missing.tool"] },
      { task: "read COL-123", eligibleTools: eligible },
    ),
  ).toEqual({ tools: eligible, reason: "fallback" });
});

test("allowlist expands bundle ids", async () => {
  expect(
    await selectGrantedTools(
      { mode: "allowlist", tools: ["issues"], bundles },
      { task: "list issues", eligibleTools: eligible, bundles },
    ),
  ).toEqual({
    tools: ["workspace.list_issues", "workspace.get_issue"],
    reason: "narrowed",
  });
});

test("model picker yields tools and ignores unknown names", async () => {
  const selected = await selectGrantedTools(
    { mode: "model" },
    { task: "diff main and this branch", eligibleTools: eligible, bundles },
    {
      pick: async () => ["github", "bogus.tool"],
    },
  );
  expect(selected).toEqual({
    tools: ["github.compare", "github.get_file"],
    reason: "narrowed",
  });
});

test("model picker failure logs and falls back to allowlist then eligible", async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    expect(
      await selectGrantedTools(
        { mode: "model", tools: ["workspace.get_issue"] },
        { task: "go", eligibleTools: eligible },
        { pick: async () => { throw new Error("provider down"); } },
      ),
    ).toEqual({ tools: ["workspace.get_issue"], reason: "picker-failed" });
    expect(
      await selectGrantedTools(
        { mode: "model" },
        { task: "go", eligibleTools: eligible },
        { pick: async () => { throw new Error("provider down"); } },
      ),
    ).toEqual({ tools: eligible, reason: "picker-failed" });
    expect(errors.length).toBeGreaterThan(0);
  } finally {
    console.error = original;
  }
});

test("model picker listing includes bundle ids and tool descriptions", async () => {
  let seen: { names: readonly string[]; listing: string } | undefined;
  await selectGrantedTools(
    { mode: "model" },
    {
      task: "x",
      eligibleTools: ["workspace.get_issue"],
      bundles: { issues: ["workspace.get_issue"] },
      descriptions: { "workspace.get_issue": "Issues: Get issues" },
    },
    {
      pick: async ({ names, listing }) => {
        seen = { names, listing };
        return ["issues"];
      },
    },
  );
  expect(seen?.names).toEqual(["issues", "workspace.get_issue"]);
  expect(seen?.listing).toContain("issues (bundle)");
  expect(seen?.listing).toContain("Issues: Get issues");
});

test("expand and intersect keep grant names unique and eligible", () => {
  expect(expandGrantedNames(["issues", "github.compare"], bundles)).toEqual([
    "workspace.list_issues",
    "workspace.get_issue",
    "github.compare",
  ]);
  expect(intersectGrantedTools(["github.compare", "nope"], eligible)).toEqual([
    "github.compare",
  ]);
});
