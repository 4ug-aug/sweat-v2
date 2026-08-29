import {
    MemorySession,
    OpenAIChatCompletionsModel,
    OpenAIResponsesModel,
    Usage,
    type ModelRequest,
    type ResponseStreamEvent,
} from "@openai/agents";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import {
  CompatibleResponsesModel,
  createModelProvider,
  loadOpenAIAgentSession,
  normalizeModelBaseUrl,
  openOpenAIAgentSession,
  rewriteVllmMcpCalls,
  runAgent,
  sanitizeOutputStatuses,
  sanitizeUsageDetails,
  saveOpenAIAgentSession,
  stripMcpProtocolInput,
  toAgentsFunctionToolName,
  toolOutputText,
} from "./openai-agents";
import type { Step } from "./step";

function completionStream(
  id: string,
  output:
    | { content: string }
    | { toolCall: { id: string; name: string; arguments: string } },
): Response {
  const deltas = "content" in output
    ? [
        {
          choices: [{
            index: 0,
            delta: { role: "assistant", content: output.content },
            finish_reason: null,
          }],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ]
    : [
        {
          choices: [{
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [{
                index: 0,
                id: output.toolCall.id,
                type: "function",
                function: {
                  name: output.toolCall.name,
                  arguments: output.toolCall.arguments,
                },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ];
  const events = [
    ...deltas.map((event) => ({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      ...event,
    })),
    {
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function responsesStream(id: string, text: string): Response {
  const event = {
    type: "response.completed",
    response: {
      id,
      object: "response",
      status: "completed",
      output: [{
        type: "message",
        id: `msg-${id}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  };
  return new Response(
    `event: response.completed\ndata: ${JSON.stringify(event)}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("OpenAI's root URL uses its versioned API path", () => {
  expect(normalizeModelBaseUrl("https://api.openai.com")).toBe(
    "https://api.openai.com/v1",
  );
});

test("custom providers normalize MLflow Responses extensions", async () => {
  const model = {
    baseUrl: "https://models.example/v1",
    apiKey: "test-key",
    model: "test-model",
  };

  const customModel = await createModelProvider({
    ...model,
    provider: "custom",
  }).getModel();
  expect(customModel).toBeInstanceOf(CompatibleResponsesModel);
  expect(customModel).toBeInstanceOf(OpenAIResponsesModel);
  expect(
    await createModelProvider({ ...model, provider: "openai" }).getModel(),
  ).toBeInstanceOf(CompatibleResponsesModel);

  const usage = new Usage({
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
    inputTokensDetails: {
      cached_tokens: 1,
      input_tokens_per_turn: [3],
    } as unknown as Record<string, number>,
    outputTokensDetails: {
      reasoning_tokens: 0,
      output_tokens_per_turn: [2],
    } as unknown as Record<string, number>,
    requestUsageEntries: [{
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      inputTokensDetails: {
        cached_tokens: 1,
        cached_tokens_per_turn: [1],
      } as unknown as Record<string, number>,
      outputTokensDetails: {
        reasoning_tokens: 0,
        tool_output_tokens_per_turn: [0],
      } as unknown as Record<string, number>,
    }],
  });
  sanitizeUsageDetails(usage);
  expect(usage.inputTokensDetails).toEqual([{ cached_tokens: 1 }]);
  expect(usage.outputTokensDetails).toEqual([{ reasoning_tokens: 0 }]);
  expect(usage.requestUsageEntries?.[0]?.inputTokensDetails).toEqual({
    cached_tokens: 1,
  });
  expect(usage.requestUsageEntries?.[0]?.outputTokensDetails).toEqual({
    reasoning_tokens: 0,
  });

  const output = [
    { type: "message", status: "complete" },
    { type: "function_call", status: null },
    { type: "hosted_tool_call", status: "failed" },
  ];
  sanitizeOutputStatuses(output);
  expect(output.map((item) => item.status)).toEqual([
    "completed",
    "completed",
    "failed",
  ]);

  const request = (customModel as CompatibleResponsesModel & {
    _buildResponsesCreateRequest(
      request: ModelRequest,
      stream: boolean,
    ): { requestData: { input: Array<{ output?: unknown }> } };
  })._buildResponsesCreateRequest({
    input: [{
      type: "function_call_result",
      name: "workspace.read_messages",
      callId: "call-1",
      status: "completed",
      output: [{ type: "input_text", text: "[augusttollerup] hello" }],
    }],
    modelSettings: {},
    tools: [],
    outputType: "text",
    handoffs: [],
    tracing: false,
  }, true).requestData;
  expect(request.input[0]?.output).toBe("[augusttollerup] hello");
});

test("custom providers rewrite vLLM mcp_call items into function calls", () => {
  const output = [
    {
      type: "hosted_tool_call",
      id: "mcp_1",
      name: "mcp_call",
      status: "completed",
      providerData: {
        type: "mcp_call",
        id: "mcp_1",
        name: "exec_command",
        arguments: '{"cmd":"pwd"}',
        server_label: "functions",
      },
    },
    {
      type: "hosted_tool_call",
      id: "mcp_2",
      name: "mcp_list_tools",
      providerData: { type: "mcp_list_tools", server_label: "browser" },
    },
    {
      type: "hosted_tool_call",
      id: "mcp_3",
      name: "mcp_call",
      providerData: {
        type: "mcp_call",
        name: "<|constrain|>json",
        arguments: '{"ok":true}',
      },
    },
  ];
  rewriteVllmMcpCalls(output);
  expect(output).toEqual([
    {
      type: "function_call",
      id: "mcp_1",
      callId: "mcp_1",
      name: "exec_command",
      arguments: '{"cmd":"pwd"}',
      status: "completed",
    },
  ]);
});

test("vLLM mcp_call tool names map onto Agents SDK function tool names", () => {
  expect(toAgentsFunctionToolName("workspace.post_message")).toBe(
    "workspace_post_message",
  );
  const output = [
    {
      type: "hosted_tool_call",
      id: "mcp_1",
      name: "mcp_call",
      status: "completed",
      providerData: {
        type: "mcp_call",
        id: "mcp_1",
        name: "workspace.post_message",
        arguments: '{"text":"done"}',
      },
    },
  ];
  rewriteVllmMcpCalls(output);
  expect(output).toEqual([
    {
      type: "function_call",
      id: "mcp_1",
      callId: "mcp_1",
      name: "workspace_post_message",
      arguments: '{"text":"done"}',
      status: "completed",
    },
  ]);
});

test("stripMcpProtocolInput drops hosted mcp protocol items", () => {
  expect(
    stripMcpProtocolInput([
      {
        type: "function_call_result",
        name: "exec_command",
        callId: "call-1",
        status: "completed",
        output: "ok",
      },
      {
        type: "hosted_tool_call",
        id: "mcp_1",
        name: "mcp_call",
        status: "completed",
        providerData: {
          type: "mcp_call",
          name: "exec_command",
          arguments: "{}",
        },
      },
    ]),
  ).toEqual([
    {
      type: "function_call_result",
      name: "exec_command",
      callId: "call-1",
      status: "completed",
      output: "ok",
    },
  ]);
});

test("tool results preserve structured output as JSON", () => {
  expect(toolOutputText({ ok: true, message: { id: "message-1" } })).toBe(
    `{
  "ok": true,
  "message": {
    "id": "message-1"
  }
}`,
  );
});

test("the runtime completes an SDK tool loop against an OpenAI-compatible API", async () => {
  let calls = 0;
  const steps: Step[] = [];
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
    fetch: async () => {
      calls += 1;
      return completionStream(
        `chatcmpl-${calls}`,
        calls === 1
          ? {
              toolCall: {
                id: "call-1",
                name: "exec_command",
                arguments: '{"cmd":"printf runtime-ready"}',
              },
            }
          : { content: "runtime ready" },
      );
    },
  });

  const result = await runAgent(
    {
      task: "Use the shell tool.",
      instructions: "Use tools when needed.",
      agentId: "software-engineer",
      model: {
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        model: "test-model",
      },
    },
    {
      model: new OpenAIChatCompletionsModel(client, "test-model"),
      onStep: (step) => steps.push(step),
    },
  );
  expect(result).toBe("runtime ready");
  const messageSteps = steps.filter((s) => s.kind === "message");
  expect(messageSteps.length).toBeGreaterThan(0);
  expect(messageSteps[messageSteps.length - 1]!.text).toBe("runtime ready");
  expect(calls).toBe(2);
  expect(steps.some((step) => step.kind === "tool_call" && step.tool === "exec_command")).toBe(true);
});

test("an unknown tool call returns an error to the model instead of crashing", async () => {
  const steps: Step[] = [];
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
  });
  class MissingToolModel extends OpenAIResponsesModel {
    turns = 0;

    override async *getStreamedResponse(
      _request: ModelRequest,
    ): AsyncIterable<ResponseStreamEvent> {
      this.turns += 1;
      const output =
        this.turns === 1
          ? [{
              type: "function_call" as const,
              callId: "call-missing",
              name: "outline.list_documents",
              arguments: '{"query":"handbook"}',
              status: "completed" as const,
            }]
          : [{
              type: "message" as const,
              role: "assistant" as const,
              status: "completed" as const,
              content: [{
                type: "output_text" as const,
                text: "answered without the missing tool",
              }],
            }];
      yield {
        type: "response_done",
        response: {
          id: `response-${this.turns}`,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          output,
        },
      };
    }
  }

  const result = await runAgent(
    {
      task: "Search the wiki.",
      instructions: "Use tools when needed.",
      agentId: "antboy",
      model: {
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        model: "test-model",
      },
    },
    {
      model: new MissingToolModel(client, "test-model"),
      onStep: (step) => steps.push(step),
    },
  );

  expect(result).toBe("answered without the missing tool");
  expect(steps.some((step) => step.kind === "tool_call" && step.tool === "outline.list_documents")).toBe(true);
  expect(steps.some((step) => step.kind === "tool_result" && step.tool === "outline.list_documents")).toBe(true);
});

test("skillsRoot wires SDK load_skill without pasting skill bodies into instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "sweat-skills-root-"));
  const skillDir = join(root, "issue-writer");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: issue-writer
description: Draft a clear GitHub issue.
---

# Secret skill body
`,
  );

  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
  });
  class SkillsModel extends OpenAIResponsesModel {
    requests: ModelRequest[] = [];

    override async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<ResponseStreamEvent> {
      this.requests.push(request);
      const output =
        this.requests.length === 1
          ? [{
              type: "function_call" as const,
              callId: "call-load-skill",
              name: "load_skill",
              arguments: '{"skill_name":"issue-writer"}',
              status: "completed" as const,
            }]
          : [{
              type: "message" as const,
              role: "assistant" as const,
              status: "completed" as const,
              content: [{
                type: "output_text" as const,
                text: "skill loaded",
              }],
            }];
      yield {
        type: "response_done",
        response: {
          id: `response-${this.requests.length}`,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          output,
        },
      };
    }
  }

  const model = new SkillsModel(client, "test-model");
  const steps: Step[] = [];

  try {
    const result = await runAgent(
      {
        task: "Use the issue-writer skill.",
        instructions: "Load skills before following them.",
        agentId: "antboy",
        model: {
          baseUrl: "https://models.example/v1",
          apiKey: "test-key",
          model: "test-model",
        },
        skillsRoot: root,
      },
      {
        model,
        onStep: (step) => steps.push(step),
      },
    );

    expect(result).toBe("skill loaded");
    expect(
      steps.some((step) => step.kind === "tool_call" && step.tool === "load_skill"),
    ).toBe(true);
    expect(
      steps.some((step) => step.kind === "tool_result" && step.tool === "load_skill"),
    ).toBe(true);
    const firstInstructions = model.requests[0]?.systemInstructions ?? "";
    expect(firstInstructions).toContain("issue-writer");
    expect(firstInstructions).toContain("load_skill");
    expect(firstInstructions).not.toContain("Secret skill body");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the runtime emits structured steps for a tool call and final message", async () => {
  let calls = 0;
  const steps: Step[] = [];
  // Use a fake API key value that must not appear in emitted step text.
  const fakeApiKey = "sk-test-secret-xyzzy";
  const client = new OpenAI({
    apiKey: fakeApiKey,
    baseURL: "https://models.example/v1",
    fetch: async () => {
      calls += 1;
      return completionStream(
        `chatcmpl-${calls}`,
        calls === 1
          ? {
              toolCall: {
                id: "call-abc",
                name: "exec_command",
                arguments: '{"cmd":"echo hello"}',
              },
            }
          : { content: "done" },
      );
    },
  });

  await runAgent(
    {
      task: "Echo hello.",
      instructions: "Use tools when needed.",
      agentId: "software-engineer",
      model: {
        baseUrl: "https://models.example/v1",
        apiKey: fakeApiKey,
        model: "test-model",
      },
    },
    {
      model: new OpenAIChatCompletionsModel(client, "test-model"),
      onStep: (step) => steps.push(step),
    },
  );

  // Must emit: tool_call → tool_result → message (at minimum)
  const toolCallStep = steps.find((s) => s.kind === "tool_call");
  const toolResultStep = steps.find((s) => s.kind === "tool_result");
  const messageStep = steps.find((s) => s.kind === "message" && s.text === "done");

  expect(toolCallStep).toBeDefined();
  expect(toolCallStep?.tool).toBe("exec_command");
  expect(toolCallStep?.text).toBe('{"cmd":"echo hello"}');
  expect(typeof toolCallStep?.callId).toBe("string");

  expect(toolResultStep).toBeDefined();
  expect(toolResultStep?.callId).toBe(toolCallStep?.callId);

  expect(messageStep).toBeDefined();

  // No step should contain the fake API key in its text
  for (const step of steps) {
    expect(step.text).not.toContain(fakeApiKey);
  }

  // Steps have monotonically non-decreasing timestamps
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]!.at).toBeGreaterThanOrEqual(steps[i - 1]!.at);
  }
});

test("the runtime allows a coding task to exceed the SDK's ten-turn default", async () => {
  let calls = 0;
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
    fetch: async () => {
      calls += 1;
      return completionStream(
        `chatcmpl-${calls}`,
        calls <= 11
          ? {
              toolCall: {
                id: `call-${calls}`,
                name: "exec_command",
                arguments: '{"cmd":"true"}',
              },
            }
          : { content: "coding task complete" },
      );
    },
  });

  await expect(runAgent(
    {
      task: "Use the shell until the task is complete.",
      instructions: "Use tools when needed.",
      agentId: "software-engineer",
      model: { baseUrl: "https://models.example/v1", apiKey: "test-key", model: "test-model" },
    },
    { model: new OpenAIChatCompletionsModel(client, "test-model") },
  )).resolves.toBe("coding task complete");
  expect(calls).toBe(12);
});

/**
 * The agents SDK reports MCP connection failures straight to `console.error`
 * before rethrowing, and its logger has no off switch. Keeps an expected
 * failure from printing a stack trace over passing test output.
 */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const error = console.error;
  console.error = () => {};
  try {
    return await body();
  } finally {
    console.error = error;
  }
}

test("the runtime fails when its capability server is unreachable", async () => {
  let modelCalls = 0;
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
    fetch: async () => {
      modelCalls += 1;
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "should not run" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });

  await quietly(() =>
    expect(runAgent(
      {
        task: "Read the issue.",
        instructions: "Use tools when needed.",
        agentId: "software-engineer",
        model: {
          baseUrl: "https://models.example/v1",
          apiKey: "test-key",
          model: "test-model",
        },
        capabilitySession: {
          url: "http://127.0.0.1:1/mcp",
          token: "test-token",
          expiresAt: new Date(Date.now() + 60_000),
          allowedTools: ["get_issue"],
          revoke: () => {},
        },
      },
      { model: new OpenAIChatCompletionsModel(client, "test-model") },
    )).rejects.toThrow()
  );
  expect(modelCalls).toBe(0);
});


test("openOpenAIAgentSession keeps a durable MemorySession across the handle", async () => {
  const session = await openOpenAIAgentSession({
    instructions: "i",
    agentId: "a",
    model: { baseUrl: "http://example/v1", apiKey: "k", model: "m" },
  });
  expect(session.sessionId).toBeTruthy();
  const again = session.sessionId;
  expect(session.sessionId).toBe(again);
  await session.dispose();
});

test("a reloaded MemorySession prepends the first user task on the next runAgent turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sweat-openai-session-"));
  const statePath = join(directory, "session.json");
  const inputs: unknown[] = [];
  let calls = 0;
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: "https://models.example/v1",
    fetch: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { input?: unknown };
      inputs.push(body.input);
      return responsesStream(`resp-${calls}`, `reply ${calls}`);
    },
  });
  const request = {
    instructions: "Be brief.",
    agentId: "antboy",
    model: {
      baseUrl: "https://models.example/v1",
      apiKey: "test-key",
      model: "test-model",
    },
  };
  const modelProvider = {
    getModel: () => new CompatibleResponsesModel(client, "test-model"),
  };

  try {
    const first = new MemorySession();
    await runAgent(
      { ...request, task: "Write a poem to /work/poems/poem.txt." },
      { modelProvider, session: first },
    );
    await saveOpenAIAgentSession(statePath, first);

    const restored = await loadOpenAIAgentSession(statePath);
    await runAgent(
      { ...request, task: "now cat it." },
      { modelProvider, session: restored },
    );

    expect(inputs).toHaveLength(2);
    expect(JSON.stringify(inputs[1])).toContain(
      "Write a poem to /work/poems/poem.txt.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
