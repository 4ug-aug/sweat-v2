import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boundStepText,
  STEP_TEXT_LIMIT,
} from "./step";
import {
  mapCursorEventToSteps,
  runCursorAgent,
  runCursorAgentPersisted,
  scrubCursorApiKeysFromEnv,
  takeCursorApiKeyFromEnv,
  type CursorAgentFactory,
  type CursorSdkMessage,
} from "./cursor-sdk";

test("takeCursorApiKeyFromEnv clears SWEAT_CURSOR_API_KEY and CURSOR_API_KEY", () => {
  const env: Record<string, string | undefined> = {
    SWEAT_CURSOR_API_KEY: "secret-from-sweat",
    CURSOR_API_KEY: "should-also-clear",
    PATH: "/usr/bin",
  };
  expect(takeCursorApiKeyFromEnv(env)).toBe("secret-from-sweat");
  expect(env.SWEAT_CURSOR_API_KEY).toBeUndefined();
  expect(env.CURSOR_API_KEY).toBeUndefined();
  expect(env.PATH).toBe("/usr/bin");
});

test("mapCursorEventToSteps ignores assistant and thinking (live-published in runTurn)", () => {
  const assistant: CursorSdkMessage = {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "x", name: "shell", input: {} },
      ],
    },
  };
  const thinking: CursorSdkMessage = {
    type: "thinking",
    text: "secret chain of thought",
  };
  expect(mapCursorEventToSteps(assistant)).toEqual([]);
  expect(mapCursorEventToSteps(thinking)).toEqual([]);
});

test("mapCursorEventToSteps pairs tool start and completion", () => {
  const start: CursorSdkMessage = {
    type: "tool_call",
    call_id: "c1",
    name: "shell",
    status: "running",
    args: { command: "ls" },
  };
  const done: CursorSdkMessage = {
    type: "tool_call",
    call_id: "c1",
    name: "shell",
    status: "completed",
    result: { stdout: "ok" },
  };
  expect(mapCursorEventToSteps(start)).toEqual([
    expect.objectContaining({
      kind: "tool_call",
      tool: "shell",
      callId: "c1",
      text: JSON.stringify({ command: "ls" }),
    }),
  ]);
  expect(mapCursorEventToSteps(done)).toEqual([
    expect.objectContaining({
      kind: "tool_result",
      tool: "shell",
      callId: "c1",
      text: JSON.stringify({ stdout: "ok" }),
    }),
  ]);
});

test("boundStepText truncates oversized payloads", () => {
  const huge = "x".repeat(STEP_TEXT_LIMIT + 50);
  const text = boundStepText(huge);
  expect(text.length).toBeLessThan(huge.length);
  expect(text.endsWith("…[truncated]")).toBe(true);
});

test("runCursorAgent coalesces streamed assistant deltas into one message step", async () => {
  const steps: Array<{ kind: string; text: string }> = [];
  const createAgent: CursorAgentFactory = async () => ({
    async send() {
      return {
        async *stream() {
          for (const text of [
            "no checkout",
            ", no open",
            " PR, and nothing",
            " to build",
            " or fix",
            " right",
            " now.",
          ]) {
            yield {
              type: "assistant",
              message: { content: [{ type: "text", text }] },
            } satisfies CursorSdkMessage;
          }
        },
        async wait() {
          return {
            status: "finished",
            result:
              "no checkout, no open PR, and nothing to build or fix right now.",
          };
        },
      };
    },
    async [Symbol.asyncDispose]() {},
  });

  await runCursorAgent(
    {
      task: "status",
      instructions: "Be brief.",
      agentId: "software-engineer",
      apiKey: "k",
      model: "composer-2.5",
    },
    { createAgent, onStep: (step) => steps.push(step) },
  );

  expect(steps).toEqual([
    {
      kind: "message",
      text: "no checkout, no open PR, and nothing to build or fix right now.",
      at: expect.any(Number),
    },
  ]);
});

test("runCursorAgent publishes thinking as a message step", async () => {
  const steps: Array<{ kind: string; text: string }> = [];
  const createAgent: CursorAgentFactory = async () => ({
    async send() {
      return {
        async *stream() {
          yield {
            type: "thinking",
            text: "Considering the frontier…",
          } satisfies CursorSdkMessage;
          yield {
            type: "thinking",
            text: " then wrap up.",
          } satisfies CursorSdkMessage;
        },
        async wait() {
          return { status: "finished", result: "" };
        },
      };
    },
    async [Symbol.asyncDispose]() {},
  });

  await runCursorAgent(
    {
      task: "t",
      instructions: "i",
      agentId: "software-engineer",
      apiKey: "k",
      model: "composer-2.5",
    },
    { createAgent, onStep: (step) => steps.push(step) },
  );

  expect(steps).toEqual([
    {
      kind: "message",
      text: "Considering the frontier… then wrap up.",
      at: expect.any(Number),
    },
  ]);
});

test("runCursorAgent flushes coalesced assistant text before tool calls", async () => {
  const steps: Array<{ kind: string; text: string }> = [];
  const createAgent: CursorAgentFactory = async () => ({
    async send() {
      return {
        async *stream() {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Looking " }] },
          } satisfies CursorSdkMessage;
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "now" }] },
          } satisfies CursorSdkMessage;
          yield {
            type: "tool_call",
            call_id: "t1",
            name: "shell",
            status: "running",
            args: { command: "ls" },
          } satisfies CursorSdkMessage;
          yield {
            type: "tool_call",
            call_id: "t1",
            name: "shell",
            status: "completed",
            result: "ok",
          } satisfies CursorSdkMessage;
        },
        async wait() {
          return { status: "finished", result: "Looking now" };
        },
      };
    },
    async [Symbol.asyncDispose]() {},
  });

  await runCursorAgent(
    {
      task: "t",
      instructions: "i",
      agentId: "software-engineer",
      apiKey: "k",
      model: "composer-2.5",
    },
    { createAgent, onStep: (step) => steps.push(step) },
  );

  expect(steps[0]).toMatchObject({ kind: "message", text: "Looking now" });
  expect(steps[1]).toMatchObject({ kind: "tool_call", tool: "shell" });
});

test("runCursorAgent scrubs residual Cursor keys from process.env", async () => {
  const previous = process.env.SWEAT_CURSOR_API_KEY;
  process.env.SWEAT_CURSOR_API_KEY = "leaked";
  try {
    const createAgent: CursorAgentFactory = async () => ({
      async send() {
        return {
          async *stream() {},
          async wait() {
            return { status: "finished", result: "ok" };
          },
        };
      },
      async [Symbol.asyncDispose]() {},
    });
    await runCursorAgent(
      {
        task: "t",
        instructions: "i",
        agentId: "a",
        apiKey: "request-key",
        model: "composer-2.5",
      },
      { createAgent },
    );
    expect(process.env.SWEAT_CURSOR_API_KEY).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.SWEAT_CURSOR_API_KEY;
    else process.env.SWEAT_CURSOR_API_KEY = previous;
  }
});

test("trust boundary: shell tool result must not contain the Cursor API key", async () => {
  const apiKey = "super-secret-cursor-key";
  const envAfterBootstrap: Record<string, string | undefined> = {
    SWEAT_CURSOR_API_KEY: apiKey,
    CURSOR_API_KEY: apiKey,
    PATH: "/usr/bin",
  };
  const taken = takeCursorApiKeyFromEnv(envAfterBootstrap);
  expect(taken).toBe(apiKey);
  scrubCursorApiKeysFromEnv(envAfterBootstrap);

  const steps: Array<{ kind: string; text: string }> = [];
  const createAgent: CursorAgentFactory = async () => ({
    async send() {
      return {
        async *stream() {
          const shellEnv = Object.entries(envAfterBootstrap)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");
          yield {
            type: "tool_call",
            call_id: "env-1",
            name: "shell",
            status: "completed",
            result: shellEnv,
          } satisfies CursorSdkMessage;
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "ok" }] },
          } satisfies CursorSdkMessage;
        },
        async wait() {
          return { status: "finished", result: "ok" };
        },
      };
    },
    async [Symbol.asyncDispose]() {},
  });

  await runCursorAgent(
    {
      task: "Print env",
      instructions: "Use shell.",
      agentId: "software-engineer",
      apiKey: taken,
      model: "composer-2.5",
    },
    { createAgent, onStep: (step) => steps.push(step) },
  );

  const toolResult = steps.find((s) => s.kind === "tool_result");
  expect(toolResult).toBeDefined();
  expect(toolResult!.text).not.toContain(apiKey);
  expect(toolResult!.text).not.toContain("SWEAT_CURSOR_API_KEY");
  expect(toolResult!.text).not.toContain("CURSOR_API_KEY");
  expect(steps.every((s) => !s.text.includes(apiKey))).toBe(true);
});

test("runCursorAgent passes only inline MCP gateway session", async () => {
  let createOptions: {
    mcpServers?: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    local: { settingSources?: readonly string[] };
  } | undefined;

  const createAgent: CursorAgentFactory = async (options) => {
    createOptions = options;
    return {
      async send() {
        return {
          async *stream() {},
          async wait() {
            return { status: "finished", result: "done" };
          },
        };
      },
      async [Symbol.asyncDispose]() {},
    };
  };

  await runCursorAgent(
    {
      task: "t",
      instructions: "i",
      agentId: "a",
      apiKey: "k",
      model: "composer-2.5",
      capabilitySession: {
        url: "http://host.container.internal:9/mcp",
        token: "mcp-token",
        allowedTools: ["github.create_pull_request"],
      },
    },
    { createAgent },
  );

  expect(createOptions?.local.settingSources).toEqual(["project"]);
  expect(createOptions?.mcpServers).toEqual({
    sweat: {
      type: "http",
      url: "http://host.container.internal:9/mcp",
      headers: { Authorization: "Bearer mcp-token" },
    },
  });
});

test("openCursorAgentSession multi-send keeps one Agent instance", async () => {
  let createCount = 0;
  let disposeCount = 0;
  const prompts: string[] = [];
  const createAgent: CursorAgentFactory = async () => {
    createCount++;
    return {
      agentId: "agent-warm-1",
      async send(prompt) {
        prompts.push(prompt);
        return {
          async *stream() {},
          async wait() {
            return { status: "finished", result: `reply:${prompts.length}` };
          },
        };
      },
      async [Symbol.asyncDispose]() {
        disposeCount++;
      },
    };
  };

  const { openCursorAgentSession } = await import("./cursor-sdk");
  const session = await openCursorAgentSession(
    {
      instructions: "Interview",
      agentId: "interviewer",
      apiKey: "k",
      model: "composer-2.5",
    },
    { createAgent },
  );
  expect(session.agentId).toBe("agent-warm-1");
  expect(await session.send("q1")).toBe("reply:1");
  expect(await session.send("q2")).toBe("reply:2");
  expect(createCount).toBe(1);
  expect(disposeCount).toBe(0);
  await session.dispose();
  expect(disposeCount).toBe(1);
  expect(prompts).toHaveLength(2);
});

test("persisted Cursor turns resume the same SDK agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sweat-cursor-session-"));
  const statePath = join(directory, "agent-id");
  let creates = 0;
  const resumed: string[] = [];
  const agent = {
    agentId: "agent-warm-1",
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: "finished", result: "ok" };
        },
      };
    },
    async [Symbol.asyncDispose]() {},
  };

  try {
    const request = {
      task: "turn",
      instructions: "Interview",
      agentId: "interviewer",
      apiKey: "k",
      model: "composer-2.5",
    };
    const dependencies = {
      createAgent: async () => {
        creates++;
        return agent;
      },
      resumeAgent: async (agentId: string) => {
        resumed.push(agentId);
        return agent;
      },
    };

    await runCursorAgentPersisted(request, statePath, dependencies);
    await runCursorAgentPersisted(request, statePath, dependencies);

    expect(creates).toBe(1);
    expect(resumed).toEqual(["agent-warm-1"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
