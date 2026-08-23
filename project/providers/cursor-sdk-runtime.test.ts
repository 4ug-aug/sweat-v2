import { expect, test } from "bun:test";
import { serializeStep, type Step } from "../runtime/step";
import { createCursorSdkRuntime } from "./cursor-sdk-runtime";

test("the Cursor runtime passes the definition and task to its container command", async () => {
  let request: unknown;
  const runtime = createCursorSdkRuntime();

  await runtime.run(
    {
      id: "sandbox-1",
      exec: async (value) => {
        request = value;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
      dispose: async () => {},
    },
    {
      task: "Fix the test",
      definition: {
        id: "software-engineer",
        instructions: "Inspect and verify.",
        requestedCapabilities: [],
        runtime: {
          kind: "cursor",
          image: "sweat-agent-cursor:latest",
          cursor: {
            apiKey: "cursor-secret",
            model: "composer-2.5",
          },
        },
        executionPolicy: { maxDurationMs: 1000, maxOutputBytes: 1000, maxSteps: 100 },
      },
      workspace: "/work",
    },
  );

  const { onOutput: _onOutput, ...rest } = request as Record<string, unknown>;
  expect(rest).toEqual({
    command: ["bun", "/app/cursor-cli.js"],
    env: {
      SWEAT_AGENT_TASK: "Fix the test",
      SWEAT_AGENT_ID: "software-engineer",
      SWEAT_AGENT_INSTRUCTIONS: "Inspect and verify.",
      SWEAT_CURSOR_API_KEY: "cursor-secret",
      SWEAT_CURSOR_MODEL: "composer-2.5",
      NODE_PATH: "/app/node_modules",
    },
    workdir: "/work",
  });
  expect(typeof _onOutput).toBe("function");
});

test("the Cursor runtime rejects openai-agents definitions", async () => {
  const runtime = createCursorSdkRuntime();
  await expect(
    runtime.run(
      {
        id: "sandbox-1",
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        dispose: async () => {},
      },
      {
        task: "t",
        definition: {
          id: "antboy",
          instructions: "x",
          requestedCapabilities: [],
          runtime: {
            kind: "openai-agents",
            image: "sweat-agent:latest",
            model: {
              baseUrl: "https://example/v1",
              apiKey: "k",
              model: "m",
            },
          },
          executionPolicy: {
            maxDurationMs: 1000,
            maxOutputBytes: 1000,
            maxSteps: 100,
          },
        },
      },
    ),
  ).rejects.toThrow(/not a Cursor runtime/);
});

const minimalDefinition = {
  id: "agent-cursor",
  instructions: "Do stuff.",
  requestedCapabilities: [] as const,
  runtime: {
    kind: "cursor" as const,
    image: "sweat-agent-cursor:latest",
    cursor: { apiKey: "key", model: "composer-2.5" },
  },
  executionPolicy: { maxDurationMs: 5000, maxOutputBytes: 10000, maxSteps: 100 },
};

function makeSandbox(chunks: Array<{ stream: "stdout" | "stderr"; text: string }>) {
  return {
    id: "sandbox-test",
    exec: async (req: {
      onOutput?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void;
    }) => {
      for (const chunk of chunks) req.onOutput?.(chunk);
      return { exitCode: 0, stdout: "raw-ignored", stderr: "err-text" };
    },
    dispose: async () => {},
  };
}

test("Cursor runtime stdout is the last message step", async () => {
  const early: Step = { kind: "message", text: "working", at: 1 };
  const answer: Step = { kind: "message", text: "done", at: 2 };
  const runtime = createCursorSdkRuntime();
  const result = await runtime.run(
    makeSandbox([
      { stream: "stdout", text: serializeStep(early) + "\n" },
      { stream: "stdout", text: serializeStep(answer) + "\n" },
    ]),
    { task: "t", definition: minimalDefinition },
  );
  expect(result.stdout).toBe("done");
});

test("Cursor runtime reassembles chunked NDJSON steps", async () => {
  const step: Step = { kind: "message", text: "hello", at: 1000 };
  const line = serializeStep(step);
  const received: Step[] = [];
  const runtime = createCursorSdkRuntime();
  await runtime.run(
    makeSandbox([
      { stream: "stdout", text: line.slice(0, 5) },
      { stream: "stdout", text: line.slice(5) + "\n" },
    ]),
    {
      task: "t",
      definition: minimalDefinition,
      onStep: (s) => received.push(s),
    },
  );
  expect(received).toEqual([step]);
});
