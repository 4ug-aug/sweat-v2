import { boundStepText, type Step } from "./step.ts";
import { readFile, writeFile } from "node:fs/promises";
import type { SettingSource } from "@cursor/sdk/bundled";

export interface CursorCapabilitySession {
  url: string;
  token: string;
  allowedTools: readonly string[];
}

export interface CursorAgentRuntimeRequest {
  task: string;
  instructions: string;
  agentId: string;
  apiKey: string;
  model: string;
  cwd?: string;
  capabilitySession?: CursorCapabilitySession;
}

/** Stable envelope fields from Cursor SDK stream events. Payloads are unknown. */
export type CursorSdkMessage =
  | {
      type: "assistant";
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id?: string; name?: string; input?: unknown }
        >;
      };
    }
  | {
      type: "thinking";
      text?: string;
    }
  | {
      type: "tool_call";
      call_id: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      result?: unknown;
    }
  | { type: string; [key: string]: unknown };

export interface CursorSdkRun {
  stream(): AsyncIterable<CursorSdkMessage>;
  wait(): Promise<{ status: string; result?: string }>;
}

export interface CursorSdkAgent {
  /** Present on real SDK agents; used for resume across warm turns. */
  agentId?: string;
  send(prompt: string): Promise<CursorSdkRun>;
  [Symbol.asyncDispose]?(): PromiseLike<void>;
}

export type CursorAgentFactory = (options: {
  apiKey: string;
  model: { id: string };
  local: {
    cwd: string;
    settingSources?: SettingSource[];
  };
  mcpServers?: Record<
    string,
    {
      type: "http";
      url: string;
      headers: Record<string, string>;
    }
  >;
}) => Promise<CursorSdkAgent>;

export type CursorAgentResumeFactory = (
  agentId: string,
  options: Parameters<CursorAgentFactory>[0],
) => Promise<CursorSdkAgent>;

export type CursorAgentSession = {
  send(task: string): Promise<string>;
  dispose(): Promise<void>;
  agentId?: string;
};

export type CursorAgentDependencies = {
  createAgent?: CursorAgentFactory;
  resumeAgent?: CursorAgentResumeFactory;
  onStep?: (step: Step) => void;
};

export function assistantText(message: Extract<CursorSdkMessage, { type: "assistant" }>): string {
  return message.message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Maps non-assistant/thinking Cursor stream events to Colony steps
 * (thinking + assistant are live-published in runTurn). */
export function mapCursorEventToSteps(event: CursorSdkMessage): Step[] {
  const at = Date.now();
  if (event.type === "thinking" || event.type === "assistant") return [];
  if (event.type === "tool_call") {
    const toolEvent = event as Extract<CursorSdkMessage, { type: "tool_call" }>;
    if (toolEvent.status === "running") {
      return [
        {
          kind: "tool_call",
          tool: toolEvent.name,
          callId: toolEvent.call_id,
          text: boundStepText(toolEvent.args ?? {}),
          at,
        },
      ];
    }
    if (toolEvent.status === "completed" || toolEvent.status === "error") {
      return [
        {
          kind: "tool_result",
          tool: toolEvent.name,
          callId: toolEvent.call_id,
          text: boundStepText(toolEvent.result ?? ""),
          at,
        },
      ];
    }
  }
  return [];
}

/** How often live thinking/assistant snapshots may publish as message steps. */
export const LIVE_MESSAGE_THROTTLE_MS = 400;

function combineLiveNarration(thinking: string, assistant: string): string {
  const t = thinking.trim();
  const a = assistant.trim();
  if (t && a) return `${t}\n\n${a}`;
  return t || a;
}

/**
 * Clears Cursor credentials from the process environment so local SDK shell
 * tools (which inherit process env) cannot observe them. Returns the key for
 * passing exclusively via the SDK `apiKey` option.
 */
export function takeCursorApiKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const apiKey = env.SWEAT_CURSOR_API_KEY ?? env.CURSOR_API_KEY;
  scrubCursorApiKeysFromEnv(env);
  if (!apiKey) throw new Error("SWEAT_CURSOR_API_KEY is required");
  return apiKey;
}

/** Remove Cursor key material from env; does not read a key value. */
export function scrubCursorApiKeysFromEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  delete env.SWEAT_CURSOR_API_KEY;
  delete env.CURSOR_API_KEY;
}

export async function openCursorAgentSession(
  request: Omit<CursorAgentRuntimeRequest, "task"> & { resumeAgentId?: string },
  dependencies: CursorAgentDependencies = {},
): Promise<CursorAgentSession> {
  scrubCursorApiKeysFromEnv();

  const createAgent =
    dependencies.createAgent ??
    (async (options) => {
      const { Agent } = await import("@cursor/sdk/bundled");
      return Agent.create(options) as Promise<CursorSdkAgent>;
    });
  const resumeAgent =
    dependencies.resumeAgent ??
    (async (agentId, options) => {
      const { Agent } = await import("@cursor/sdk/bundled");
      return Agent.resume(agentId, options) as Promise<CursorSdkAgent>;
    });

  const mcpServers = request.capabilitySession
    ? {
        sweat: {
          type: "http" as const,
          url: request.capabilitySession.url,
          headers: {
            Authorization: `Bearer ${request.capabilitySession.token}`,
          },
        },
      }
    : undefined;

  const options = {
    apiKey: request.apiKey,
    model: { id: request.model },
    local: {
      cwd: request.cwd ?? "/work",
      settingSources: ["project" as const],
    },
    ...(mcpServers ? { mcpServers } : {}),
  };

  const agent = request.resumeAgentId
    ? await resumeAgent(request.resumeAgentId, options)
    : await createAgent(options);

  const runTurn = async (task: string): Promise<string> => {
    const prompt = `${request.instructions}\n\nTask:\n${task}`;
    let lastMessageText: string | undefined;
    let thinkingText = "";
    let assistantBuf = "";
    let lastPublished = "";
    let throttleTimer: ReturnType<typeof setTimeout> | undefined;

    const publishLive = (): void => {
      const text = combineLiveNarration(thinkingText, assistantBuf);
      if (!text || text === lastPublished) return;
      lastPublished = text;
      lastMessageText = text;
      dependencies.onStep?.({
        kind: "message",
        text: boundStepText(text),
        at: Date.now(),
      });
    };

    const scheduleLive = (): void => {
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = undefined;
        publishLive();
      }, LIVE_MESSAGE_THROTTLE_MS);
    };

    const flushLive = (): void => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = undefined;
      }
      publishLive();
      thinkingText = "";
      assistantBuf = "";
      lastPublished = "";
    };

    const run = await agent.send(prompt);
    for await (const event of run.stream()) {
      if (event.type === "thinking") {
        const thinking = event as Extract<CursorSdkMessage, { type: "thinking" }>
        thinkingText += thinking.text ?? "";
        scheduleLive();
        continue;
      }
      if (event.type === "assistant") {
        assistantBuf += assistantText(
          event as Extract<CursorSdkMessage, { type: "assistant" }>,
        );
        scheduleLive();
        continue;
      }
      flushLive();
      for (const step of mapCursorEventToSteps(event)) {
        dependencies.onStep?.(step);
      }
    }
    flushLive();
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(`Cursor run failed with status ${result.status}`);
    }
    if (result.status === "cancelled") {
      throw new Error("Cursor run was cancelled");
    }
    const finalOutput = result.result ?? "";
    if (
      dependencies.onStep &&
      finalOutput &&
      finalOutput !== lastMessageText
    ) {
      dependencies.onStep({
        kind: "message",
        text: boundStepText(finalOutput),
        at: Date.now(),
      });
      lastMessageText = finalOutput;
    }
    return finalOutput || lastMessageText || "";
  };

  return {
    send: runTurn,
    agentId: agent.agentId,
    dispose: async () => {
      await agent[Symbol.asyncDispose]?.();
    },
  };
}

export async function runCursorAgent(
  request: CursorAgentRuntimeRequest,
  dependencies: CursorAgentDependencies = {},
): Promise<string> {
  const session = await openCursorAgentSession(request, dependencies);
  try {
    return await session.send(request.task);
  } finally {
    await session.dispose();
  }
}

export async function runCursorAgentPersisted(
  request: CursorAgentRuntimeRequest,
  statePath: string,
  dependencies: CursorAgentDependencies = {},
): Promise<string> {
  let resumeAgentId: string | undefined;
  try {
    resumeAgentId = (await readFile(statePath, "utf8")).trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const session = await openCursorAgentSession(
    { ...request, ...(resumeAgentId ? { resumeAgentId } : {}) },
    dependencies,
  );
  try {
    if (session.agentId) await writeFile(statePath, session.agentId, "utf8");
    return await session.send(request.task);
  } finally {
    await session.dispose();
  }
}
