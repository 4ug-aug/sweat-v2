import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createAppleContainerSandboxProvider } from "../providers/apple-container-sandbox";
import {
  createAppleContainerClient,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
} from "../sdk/src";
import {
  ANTBOY_ID,
  SOFTWARE_ENGINEER_ID,
  createWorkspaceAgentsExecutor,
  type WorkspaceAgentAdapter,
} from "./roster";

const cursorConfig = () => ({
  apiKey: "cursor-key",
  model: "composer-2.5",
});

const modelConfig = () => ({
  baseUrl: "https://models.example/v1",
  apiKey: "test-key",
  model: "test-model",
});

test("software-engineer resolves to cursor kind with repository inputs and github grant", async () => {
  const calls: Array<{ args: readonly string[]; options?: CommandOptions }> =
    [];
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      calls.push({ args, options });
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  let preparedRepository: string | undefined;
  const adapter: WorkspaceAgentAdapter = {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: "acme/widgets",
        revision: "main",
      },
      source: {
        provider: "github",
        async checkout(_input, directory) {
          await writeFile(`${directory}/README.md`, "widgets");
          return { revision: "abc123" };
        },
      },
    },
    capability: {
      id: "github.pull-requests",
      resources: [{ provider: "github", repository: "acme/widgets" }],
      createUpstream({ workspace }) {
        preparedRepository = workspace?.git?.repository;
        return {
          async listTools() {
            return [
              { name: "github.create_pull_request" },
              { name: "github.wait_for_pull_request_checks" },
              { name: "github.compare" },
              { name: "github.get_file" },
              { name: "github.get_pull_request" },
            ];
          },
          async callTool() {
            return {};
          },
        };
      },
    },
  };
  let configuredCursor = cursorConfig();
  const executor = createWorkspaceAgentsExecutor({
    cursor: () => configuredCursor,
    model: modelConfig,
    cursorImage: "sweat-agent-cursor:test",
    image: "sweat-agent:test",
    adapters: [adapter],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-1",
    }),
  });

  const id = executor.startRun({
    task: "fix the issue",
    agentDefinitionId: SOFTWARE_ENGINEER_ID,
  });
  configuredCursor = { ...configuredCursor, model: "changed-after-start" };
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }

  const run = executor.getRun(id)!;
  expect(run.definition.id).toBe(SOFTWARE_ENGINEER_ID);
  expect(run.definition.runtime.kind).toBe("cursor");
  expect(run.definition.runtime.cursor?.model).toBe("composer-2.5");
  expect(run.definition.runtime.image).toBe("sweat-agent-cursor:test");
  expect(run.inputs).toEqual([adapter.repository!.input]);
  expect(run.capabilityGrant?.tools).toEqual([
    "github.create_pull_request",
    "github.wait_for_pull_request_checks",
    "github.compare",
    "github.get_file",
    "github.get_pull_request",
  ]);
  expect(run.capabilityGrant?.resources).toEqual([
    { provider: "github", repository: "acme/widgets" },
  ]);
  expect(preparedRepository).toBe("acme/widgets");
});

test("Issue repositoryBase overrides repository checkout revision", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  let checkedOutRevision: string | undefined;
  const adapter: WorkspaceAgentAdapter = {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: "acme/widgets",
        revision: "main",
      },
      source: {
        provider: "github",
        async checkout(input, directory) {
          checkedOutRevision = input.revision;
          await writeFile(`${directory}/README.md`, "widgets");
          return { revision: input.revision };
        },
      },
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    cursorImage: "sweat-agent-cursor:test",
    image: "sweat-agent:test",
    adapters: [adapter],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-branch",
    }),
  });

  const id = executor.startRun({
    task: "Continue initiative",
    agentDefinitionId: SOFTWARE_ENGINEER_ID,
    grantContext: { issueId: "issue-1", repositoryBase: "feat/initiative" },
  });
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }

  const run = executor.getRun(id)!;
  expect(run.inputs).toEqual([
    {
      type: "repository",
      provider: "github",
      repository: "acme/widgets",
      revision: "feat/initiative",
    },
  ]);
  expect(checkedOutRevision).toBe("feat/initiative");
});

test("Issue mergeRevisions are passed to repository checkout", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  let checkedOut: { revision?: string; mergeRevisions?: string[] } | undefined;
  const adapter: WorkspaceAgentAdapter = {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: "acme/widgets",
        revision: "main",
      },
      source: {
        provider: "github",
        async checkout(input, directory) {
          checkedOut = {
            revision: input.revision,
            mergeRevisions: input.mergeRevisions,
          };
          await writeFile(`${directory}/README.md`, "widgets");
          return { revision: input.revision };
        },
      },
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    cursorImage: "sweat-agent-cursor:test",
    image: "sweat-agent:test",
    adapters: [adapter],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-merge",
    }),
  });

  const id = executor.startRun({
    task: "Integrate children",
    agentDefinitionId: SOFTWARE_ENGINEER_ID,
    grantContext: {
      issueId: "issue-1",
      repositoryBase: "sweat/issue/COL-1",
      mergeRevisions: ["sweat/run-ui", "sweat/run-api"],
    },
  });
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }

  const run = executor.getRun(id)!;
  expect(run.inputs).toEqual([
    {
      type: "repository",
      provider: "github",
      repository: "acme/widgets",
      revision: "sweat/issue/COL-1",
      mergeRevisions: ["sweat/run-ui", "sweat/run-api"],
    },
  ]);
  expect(checkedOut).toEqual({
    revision: "sweat/issue/COL-1",
    mergeRevisions: ["sweat/run-ui", "sweat/run-api"],
  });
});

test("antboy resolves to openai-agents without repository inputs or github tools", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const adapter: WorkspaceAgentAdapter = {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: "acme/widgets",
        revision: "main",
      },
      source: {
        provider: "github",
        async checkout(_input, directory) {
          await writeFile(`${directory}/README.md`, "widgets");
          return { revision: "abc123" };
        },
      },
    },
    capability: {
      id: "github.pull-requests",
      resources: [{ provider: "github", repository: "acme/widgets" }],
      createUpstream() {
        return {
          async listTools() {
            return [{ name: "github.create_pull_request" }];
          },
          async callTool() {
            return {};
          },
        };
      },
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    cursorImage: "sweat-agent-cursor:test",
    image: "sweat-agent:test",
    adapters: [adapter],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-antboy",
    }),
  });

  const id = executor.startRun({
    task: "summarize the room",
    agentDefinitionId: ANTBOY_ID,
  });
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }

  const run = executor.getRun(id)!;
  expect(run.definition.id).toBe(ANTBOY_ID);
  expect(run.definition.runtime.kind).toBe("openai-agents");
  expect(run.definition.runtime.model?.model).toBe("test-model");
  expect(run.definition.runtime.image).toBe("sweat-agent:test");
  expect(run.inputs).toEqual([]);
  expect(run.capabilityGrant).toBeUndefined();
});

test("a repository-scoped capability cannot be configured without its repository", () => {
  expect(() =>
    createWorkspaceAgentsExecutor({
      model: modelConfig,
      cursor: cursorConfig,
      adapters: [
        {
          capability: {
            id: "github.pull-requests",
            resources: [{ provider: "github", repository: "acme/widgets" }],
            createUpstream: () => ({
              listTools: async () => [],
              callTool: async () => ({}),
            }),
          },
        },
      ],
      createCapabilityEndpoint: () => ({
        url: "http://capabilities.example/mcp",
        close: async () => {},
      }),
      sandboxProvider: createAppleContainerSandboxProvider({
        container: createAppleContainerClient({
          async run(args) {
            return { args, exitCode: 0, stdout: "", stderr: "" };
          },
        }),
      }),
    }),
  ).toThrow("requires its repository adapter");
});

test("antboy attachments become workspace inputs and an auditable task note", async () => {
  const bytes = new TextEncoder().encode("brief\n");
  const attachment = {
    type: "attachment" as const,
    id: "attachment-1",
    roomId: "room-1",
    filename: "brief.txt",
    byteSize: 6,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    model: modelConfig,
    attachmentSource: {
      async read(id) {
        return id === attachment.id ? { ...attachment, bytes } : undefined;
      },
    },
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-attachment",
    }),
  });

  const id = executor.startRun({
    task: "review the brief",
    agentDefinitionId: ANTBOY_ID,
    attachments: [attachment],
  });
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? ""))
    await Bun.sleep(0);

  expect(executor.getRun(id)?.inputs).toEqual([attachment]);
  expect(executor.getRun(id)?.task).toBe(
    "review the brief\n\nAttachments (inspect these paths before acting):\n- brief.txt: /work/.sweat/attachments/attachment-1/brief.txt",
  );
});

test("software-engineer start requires cursor; antboy start requires model", () => {
  const sandboxProvider = createAppleContainerSandboxProvider({
    container: createAppleContainerClient({
      async run(args) {
        return { args, exitCode: 0, stdout: "", stderr: "" };
      },
    }),
  });
  const cursorOnly = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    sandboxProvider,
  });
  expect(() =>
    cursorOnly.startRun({
      task: "hi",
      agentDefinitionId: ANTBOY_ID,
    }),
  ).toThrow("LLM provider is not configured");

  const modelOnly = createWorkspaceAgentsExecutor({
    model: modelConfig,
    sandboxProvider,
  });
  expect(() =>
    modelOnly.startRun({
      task: "hi",
      agentDefinitionId: SOFTWARE_ENGINEER_ID,
    }),
  ).toThrow("Cursor agent runtime is not configured");
});

test("antboy runs in a room while a GitHub adapter is configured", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const roomAdapter: WorkspaceAgentAdapter = {
    capability: {
      id: "workspace.room",
      applies: ({ grantContext }) =>
        Boolean((grantContext as { roomId?: string } | undefined)?.roomId),
      createUpstream: () => ({
        listTools: async () => [
          { name: "workspace.read_messages" },
          { name: "workspace.post_message" },
        ],
        callTool: async () => ({}),
      }),
    },
  };
  const githubAdapter: WorkspaceAgentAdapter = {
    repository: {
      input: {
        type: "repository",
        provider: "github",
        repository: "acme/widgets",
        revision: "main",
      },
      source: {
        provider: "github",
        checkout: async () => ({ revision: "abc123" }),
      },
    },
    capability: {
      id: "github.pull-requests",
      resources: [{ provider: "github", repository: "acme/widgets" }],
      createUpstream({ workspace }) {
        if (workspace?.git?.repository !== "acme/widgets") {
          throw new Error(
            "GitHub capability and prepared repository must match",
          );
        }
        return {
          listTools: async () => [{ name: "github.create_pull_request" }],
          callTool: async () => ({}),
        };
      },
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    adapters: [roomAdapter, githubAdapter],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-antboy",
    }),
  });

  const id = executor.startRun({
    task: "summarize the room",
    agentDefinitionId: ANTBOY_ID,
    grantContext: { roomId: "room-1", agentDefinitionId: ANTBOY_ID },
  });
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }
  const run = executor.getRun(id)!;
  expect(run.state).toBe("succeeded");
  expect(run.definition.instructions).toContain("You are working from a Room.");
  expect(run.capabilityGrant?.tools ?? []).not.toContain(
    "github.create_pull_request",
  );
});

test("connection adapters are granted only when linked for that agent", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const outlineTools = [
    "outline.list_documents",
    "outline.fetch",
    "outline.list_collections",
    "outline.create_document",
    "outline.update_document",
  ];
  const outlineAdapter: WorkspaceAgentAdapter = {
    capability: {
      id: "outline.documents",
      tools: outlineTools,
      createUpstream: () => ({
        listTools: async () => outlineTools.map((name) => ({ name })),
        callTool: async () => ({}),
      }),
    },
  };
  let runs = 0;
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    connectionAdapters: (agentDefinitionId) =>
      agentDefinitionId === ANTBOY_ID ? [outlineAdapter] : [],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => `run-outline-${(runs += 1)}`,
    }),
  });
  const finish = async (id: string) => {
    while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
      await Bun.sleep(0);
    }
    return executor.getRun(id)!;
  };

  const antboy = await finish(
    executor.startRun({
      task: "check the wiki",
      agentDefinitionId: ANTBOY_ID,
    }),
  );
  // A succeeded state means the session warm-up found every granted tool.
  expect(antboy.state).toBe("succeeded");
  expect(antboy.capabilityGrant?.tools).toEqual(outlineTools);

  const engineer = await finish(
    executor.startRun({
      task: "check the wiki",
      agentDefinitionId: SOFTWARE_ENGINEER_ID,
    }),
  );
  expect(engineer.state).toBe("succeeded");
  expect(engineer.capabilityGrant).toBeUndefined();
});

test("unlinked connection adapters are omitted; linked agents receive tools", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const grafanaTools = [
    "grafana.search_dashboards",
    "grafana.get_dashboard_summary",
    "grafana.get_dashboard_property",
    "grafana.get_dashboard_panel_queries",
    "grafana.list_datasources",
    "grafana.get_datasource",
    "grafana.query_prometheus",
    "grafana.list_prometheus_metric_metadata",
    "grafana.list_prometheus_metric_names",
    "grafana.list_prometheus_label_names",
    "grafana.list_prometheus_label_values",
    "grafana.query_loki_logs",
    "grafana.list_loki_label_names",
    "grafana.list_loki_label_values",
    "grafana.query_loki_stats",
    "grafana.list_alert_groups",
    "grafana.get_alert_group",
  ];
  const grafanaAdapter: WorkspaceAgentAdapter = {
    capability: {
      id: "grafana.observability",
      tools: grafanaTools,
      createUpstream: () => ({
        listTools: async () => grafanaTools.map((name) => ({ name })),
        callTool: async () => ({}),
      }),
    },
  };
  let runs = 0;
  const unlinked = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    connectionAdapters: () => [],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => `run-grafana-${(runs += 1)}`,
    }),
  });
  const finish = async (
    executor: ReturnType<typeof createWorkspaceAgentsExecutor>,
    id: string,
  ) => {
    while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
      await Bun.sleep(0);
    }
    return executor.getRun(id)!;
  };

  const omitted = await finish(
    unlinked,
    unlinked.startRun({
      task: "check dashboards",
      agentDefinitionId: ANTBOY_ID,
    }),
  );
  expect(omitted.state).toBe("succeeded");
  expect(omitted.capabilityGrant).toBeUndefined();

  const linked = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    connectionAdapters: (agentDefinitionId) =>
      agentDefinitionId === ANTBOY_ID ? [grafanaAdapter] : [],
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => `run-grafana-linked-${(runs += 1)}`,
    }),
  });
  const granted = await finish(
    linked,
    linked.startRun({
      task: "check dashboards",
      agentDefinitionId: ANTBOY_ID,
    }),
  );
  expect(granted.state).toBe("succeeded");
  expect(granted.capabilityGrant?.tools).toEqual(grafanaTools);
});

test("client-safe roster presentation never reaches role instructions", async () => {
  // run-helpers.ts and markdown.tsx import roster-people from the GUI bundle.
  // Anything it reaches transitively ships to the browser, so role modules
  // (which own system instructions) must stay out of its import graph.
  const seen = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = await Bun.file(path).text();
    const directory = path.slice(0, path.lastIndexOf("/"));
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const resolved = Bun.resolveSync(match[1]!, directory);
      expect(resolved).not.toContain("/roles/");
      await visit(resolved);
    }
  };

  await visit(Bun.resolveSync("./roster-people.ts", import.meta.dir));
  expect(seen.size).toBeGreaterThan(1);
});

test("every person boots the configured sandbox provider", async () => {
  const booted: string[] = [];
  const provider = (name: string) => ({
    create: async () => {
      booted.push(name);
      return {
        id: name,
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        dispose: async () => {},
      };
    },
  });
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    sandboxProvider: provider("microvm"),
  });

  for (const person of [SOFTWARE_ENGINEER_ID, ANTBOY_ID]) {
    const id = executor.startRun({ task: "work", agentDefinitionId: person });
    while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
      await Bun.sleep(0);
    }
  }

  expect(booted).toEqual(["microvm", "microvm"]);
});

test("selectTools narrows session tools and keeps the stored grant", async () => {
  const runner: CommandRunner = {
    async run(args, options): Promise<CommandResult> {
      const stdout =
        args[0] === "exec"
          ? `${JSON.stringify({ kind: "message", text: "done", at: 1 })}\n`
          : "";
      if (stdout) options?.onOutput?.({ stream: "stdout", text: stdout });
      return { args, exitCode: 0, stdout, stderr: "" };
    },
  };
  const githubTools = [
    "github.create_pull_request",
    "github.wait_for_pull_request_checks",
    "github.compare",
    "github.get_file",
    "github.get_pull_request",
  ];
  const adapter: WorkspaceAgentAdapter = {
    capability: {
      id: "github.pull-requests",
      createUpstream: () => ({
        listTools: async () => githubTools.map((name) => ({ name })),
        callTool: async () => ({}),
      }),
    },
  };
  const executor = createWorkspaceAgentsExecutor({
    cursor: cursorConfig,
    model: modelConfig,
    adapters: [adapter],
    selectTools: async ({ eligibleTools }) => ({
      tools: eligibleTools.filter((name) => name === "github.compare"),
      reason: "narrowed",
    }),
    createCapabilityEndpoint: () => ({
      url: "http://capabilities.example/mcp",
      close: async () => {},
    }),
    sandboxProvider: createAppleContainerSandboxProvider({
      container: createAppleContainerClient(runner),
      createId: () => "run-select-tools",
    }),
  });

  const id = executor.startRun({
    task: "compare this branch to main",
    agentDefinitionId: SOFTWARE_ENGINEER_ID,
  });
  expect(executor.getRun(id)?.capabilityGrant?.tools).toEqual(githubTools);
  while (["preparing", "running"].includes(executor.getRun(id)?.state ?? "")) {
    await Bun.sleep(0);
  }
  const run = executor.getRun(id)!;
  expect(run.state).toBe("succeeded");
  expect(run.capabilityGrant?.tools).toEqual(githubTools);
  expect(run.preparation).toContain("Tools narrowed to 1 of 5");
});
