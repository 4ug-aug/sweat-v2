import {
    type AgentInputItem,
    MCPServers,
    MCPServerStreamableHttp,
    MemorySession,
    type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  OpenAIResponsesModel,
    type ResponseStreamEvent,
    Runner,
    type Session,
} from "@openai/agents";
import {
    Capabilities,
    localBindMountStrategy,
    mount,
    SandboxAgent,
} from "@openai/agents/sandbox";
import { UnixLocalSandboxClient } from "@openai/agents/sandbox/local";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import OpenAI from "openai";

import type { CapabilitySessionBinding } from "../mcp/session";
import { openaiSkillsCapability } from "./openai-skills";
import type { Step } from "./step";

export interface OpenAICompatibleModel {
  provider?: "openai" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface AgentRuntimeRequest {
  task: string;
  instructions: string;
  agentId: string;
  model: OpenAICompatibleModel;
  capabilitySession?: CapabilitySessionBinding;
  /** Staged Agent Skills root inside the sandbox (e.g. /work/.agents/skills). */
  skillsRoot?: string;
}

export function normalizeModelBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.hostname === "api.openai.com" && url.pathname === "/") {
    url.pathname = "/v1";
  }
  return url.toString().replace(/\/$/, "");
}

export function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "type" in output &&
    output.type === "image"
  )
    return "[image]";
  try {
    const json = JSON.stringify(output, null, 2);
    if (json !== undefined) return json;
  } catch {
    // Fall through for circular or otherwise non-JSON values.
  }
  return String(output);
}

export type TokenDetails = Record<string, number>;
export type SanitizableUsage = {
  inputTokensDetails?: TokenDetails | TokenDetails[];
  outputTokensDetails?: TokenDetails | TokenDetails[];
  requestUsageEntries?: Array<{
    inputTokensDetails?: TokenDetails;
    outputTokensDetails?: TokenDetails;
  }>;
};

function numericDetails(details: TokenDetails): TokenDetails {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => typeof value === "number"),
  );
}

/** Drop non-numeric MLflow usage extensions the Agents SDK cannot serialize. */
export function sanitizeUsageDetails(usage: SanitizableUsage): void {
  if (usage.inputTokensDetails) {
    usage.inputTokensDetails = Array.isArray(usage.inputTokensDetails)
      ? usage.inputTokensDetails.map(numericDetails)
      : numericDetails(usage.inputTokensDetails);
  }
  if (usage.outputTokensDetails) {
    usage.outputTokensDetails = Array.isArray(usage.outputTokensDetails)
      ? usage.outputTokensDetails.map(numericDetails)
      : numericDetails(usage.outputTokensDetails);
  }
  for (const entry of usage.requestUsageEntries ?? []) {
    if (entry.inputTokensDetails) {
      entry.inputTokensDetails = numericDetails(entry.inputTokensDetails);
    }
    if (entry.outputTokensDetails) {
      entry.outputTokensDetails = numericDetails(entry.outputTokensDetails);
    }
  }
}

const responseItemStatuses = new Set([
  "in_progress",
  "completed",
  "incomplete",
]);

/** Map MLflow status aliases (e.g. "complete", null) onto Responses enums. */
export function sanitizeOutputStatuses(output: unknown[]): void {
  for (const value of output) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (
      (item.type === "message" || item.type === "function_call") &&
      !responseItemStatuses.has(String(item.status))
    ) {
      item.status = "completed";
    }
  }
}

function flattenTextToolOutputs(
  input: ModelRequest["input"],
): ModelRequest["input"] {
  if (typeof input === "string") return input;
  return input.map((item) => {
    if (
      item.type !== "function_call_result" ||
      !Array.isArray(item.output) ||
      !item.output.every((part) => part.type === "input_text")
    ) {
      return item;
    }
    return {
      ...item,
      output: item.output.map((part) => part.text).join("\n"),
    };
  });
}

function mcpProtocolType(item: {
  type?: unknown;
  name?: unknown;
  providerData?: unknown;
}): string | undefined {
  const providerData =
    item.providerData &&
    typeof item.providerData === "object" &&
    !Array.isArray(item.providerData)
      ? (item.providerData as Record<string, unknown>)
      : undefined;
  if (typeof providerData?.type === "string") return providerData.type;
  if (typeof item.name === "string" && item.name.startsWith("mcp_")) {
    return item.name;
  }
  if (typeof item.type === "string" && item.type.startsWith("mcp_")) {
    return item.type;
  }
  return undefined;
}

/**
 * vLLM's Harmony Responses path only accepts message / function_call /
 * function_call_output / reasoning as input. Drop OpenAI-hosted MCP protocol
 * items that would 400 with "Unknown input type: mcp_call".
 */
export function stripMcpProtocolInput(
  input: ModelRequest["input"],
): ModelRequest["input"] {
  if (typeof input === "string") return input;
  return input.filter((item) => {
    const type = mcpProtocolType(item);
    return !(typeof type === "string" && type.startsWith("mcp_"));
  });
}

/**
 * Match `@openai/agents` `toFunctionToolName`: MCP tools such as
 * `workspace.set_grill_frontier` are registered as `workspace_set_grill_frontier`.
 */
export function toAgentsFunctionToolName(name: string): string {
  const sanitized = name.replace(/\s/g, "_").replace(/[^a-zA-Z0-9]/g, "_");
  if (!sanitized) throw new Error("Tool name cannot be empty");
  return sanitized;
}

/**
 * vLLM often classifies ordinary tool calls as `mcp_call` when the Harmony
 * recipient is not `functions.<name>`. Rewrite those into function_call items
 * so the Agents SDK can execute local tools and the next turn stays on
 * function_call / function_call_output (which vLLM accepts).
 */
export function rewriteVllmMcpCalls(output: unknown[]): void {
  for (let index = 0; index < output.length; index += 1) {
    const value = output[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const providerData =
      item.providerData &&
      typeof item.providerData === "object" &&
      !Array.isArray(item.providerData)
        ? (item.providerData as Record<string, unknown>)
        : {};
    const type = mcpProtocolType(item);
    if (item.type !== "hosted_tool_call" || !type?.startsWith("mcp_")) continue;

    if (type !== "mcp_call") {
      output.splice(index, 1);
      index -= 1;
      continue;
    }

    const toolName =
      typeof providerData.name === "string" ? providerData.name.trim() : "";
    // Drop Harmony control-token junk such as "<|constrain|>json".
    if (!toolName || toolName.includes("<|")) {
      output.splice(index, 1);
      index -= 1;
      continue;
    }

    const callId =
      (typeof providerData.id === "string" && providerData.id) ||
      (typeof item.id === "string" && item.id) ||
      `call_mcp_${index}`;
    const status =
      item.status === "in_progress" ||
      item.status === "completed" ||
      item.status === "incomplete"
        ? item.status
        : "completed";

    output[index] = {
      type: "function_call",
      id: typeof item.id === "string" ? item.id : undefined,
      callId,
      name: toAgentsFunctionToolName(toolName),
      arguments:
        typeof providerData.arguments === "string"
          ? providerData.arguments
          : "{}",
      status,
    };
  }
}

function sanitizeCompatibleInput(
  input: ModelRequest["input"],
): ModelRequest["input"] {
  return flattenTextToolOutputs(stripMcpProtocolInput(input));
}

function sanitizeCompatibleOutput(output: unknown[]): void {
  rewriteVllmMcpCalls(output);
  sanitizeOutputStatuses(output);
}

export class CompatibleResponsesModel extends OpenAIResponsesModel {
  protected override _buildResponsesCreateRequest(
    request: ModelRequest,
    stream: boolean,
  ) {
    return super._buildResponsesCreateRequest({
      ...request,
      input: sanitizeCompatibleInput(request.input),
    }, stream);
  }

  // fallow-ignore-next-line unused-class-member -- called through the SDK Model contract
  override async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await super.getResponse(request);
    sanitizeUsageDetails(response.usage);
    sanitizeCompatibleOutput(response.output);
    return response;
  }

  // fallow-ignore-next-line unused-class-member -- called through the SDK Model contract
  override async *getStreamedResponse(
    request: ModelRequest,
  ): AsyncIterable<ResponseStreamEvent> {
    for await (const event of super.getStreamedResponse(request)) {
      if (event.type === "response_done") {
        sanitizeUsageDetails(event.response.usage);
        sanitizeCompatibleOutput(event.response.output);
      }
      yield event;
    }
  }
}

export function createModelProvider(
  model: OpenAICompatibleModel,
): ModelProvider {
  const baseURL = normalizeModelBaseUrl(model.baseUrl);
  // Always use CompatibleResponsesModel for vLLM/MLflow response shaping.
  const client = new OpenAI({ apiKey: model.apiKey, baseURL });
  return {
    getModel: (name) =>
      new CompatibleResponsesModel(client, name ?? model.model),
  };
}

export async function runAgent(
  request: AgentRuntimeRequest,
  dependencies: {
    model?: Model;
    modelProvider?: ModelProvider;
    onStep?: (step: Step) => void;
    /** Host path bind-mounted as `work/` in the SDK session. Defaults to cwd. */
    workspaceRoot?: string;
    /** Reuse across warm Grill follow-ups for conversation continuity. */
    session?: Session;
    /** When set with an external session, skip opening/closing MCP. */
    mcpServers?: Awaited<ReturnType<typeof MCPServers.open>>;
    retainMcp?: boolean;
  } = {},
): Promise<string> {
  const mcpServers =
    dependencies.mcpServers ??
    (request.capabilitySession
      ? await MCPServers.open([
          new MCPServerStreamableHttp({
            name: "capabilities",
            url: request.capabilitySession.url,
            requestInit: {
              headers: {
                Authorization: `Bearer ${request.capabilitySession.token}`,
              },
            },
            toolFilter: {
              allowedToolNames: [...request.capabilitySession.allowedTools],
            },
            timeout: 5 * 60_000,
            cacheToolsList: true,
          }),
        ], { strict: true })
      : undefined);

  const workspaceRoot = resolve(dependencies.workspaceRoot ?? process.cwd());
  const skillsRoot = request.skillsRoot
    ? resolve(request.skillsRoot)
    : undefined;
  const skillsCapability = skillsRoot
    ? openaiSkillsCapability(skillsRoot)
    : undefined;

  const agent = new SandboxAgent({
    name: request.agentId,
    instructions: request.instructions,
    model: dependencies.model ?? request.model.model,
    mcpServers: mcpServers?.active,
    defaultManifest: {
      entries: {
        work: mount({
          source: workspaceRoot,
          // Unix-local bind mounts are symlinks; the SDK requires an explicit
          // writable flag because it cannot enforce read-only symlink mounts.
          readOnly: false,
          mountStrategy: localBindMountStrategy(),
        }),
      },
      extraPathGrants: skillsRoot
        ? [{
            path: skillsRoot,
            readOnly: true,
            description: "Staged Agent Skills",
          }]
        : [],
    },
    capabilities: [
      ...Capabilities.default(),
      ...(skillsCapability ? [skillsCapability] : []),
    ],
  });

  try {
    const result = await new Runner({
      modelProvider:
        dependencies.modelProvider ??
        createModelProvider(request.model),
      tracingDisabled: true,
      // Hallucinated/ungranted tool names (often from role text) should guide
      // the model, not kill the run.
      toolNotFoundBehavior: "return_error_to_model",
    }).run(agent, request.task, {
      maxTurns: 50,
      stream: true,
      sandbox: { client: new UnixLocalSandboxClient() },
      ...(dependencies.session ? { session: dependencies.session } : {}),
    });

    let lastMessageText: string | undefined;

    for await (const event of result) {
      if (event.type !== "run_item_stream_event") continue;
      const { name, item } = event;
      if (name === "message_output_created") {
        const text = (item as { content: string }).content;
        lastMessageText = text;
        dependencies.onStep?.({ kind: "message", text, at: Date.now() });
      } else if (name === "tool_called") {
        const toolItem = item as { toolName?: string; callId?: string; rawItem: { arguments: string } };
        dependencies.onStep?.({
          kind: "tool_call",
          tool: toolItem.toolName ?? "",
          text: toolItem.rawItem.arguments,
          callId: toolItem.callId,
          at: Date.now(),
        });
      } else if (name === "tool_output") {
        const outputItem = item as { output: unknown; callId?: string; rawItem: { type?: string; name?: string } };
        const rawItem = outputItem.rawItem;
        const toolName = rawItem.type === "function_call_result" && typeof rawItem.name === "string" ? rawItem.name : "";
        dependencies.onStep?.({
          kind: "tool_result",
          tool: toolName,
          text: toolOutputText(outputItem.output),
          callId: outputItem.callId,
          at: Date.now(),
        });
      }
    }
    await result.completed;

    const finalOutput = result.finalOutput ?? "";
    if (dependencies.onStep && finalOutput && finalOutput !== lastMessageText) {
      dependencies.onStep({ kind: "message", text: finalOutput, at: Date.now() });
    }

    return finalOutput;
  } finally {
    if (!dependencies.retainMcp) {
      await mcpServers?.close();
    }
  }
}

export type OpenAIAgentSession = {
  runTurn(task: string): Promise<string>;
  dispose(): Promise<void>;
  sessionId: string;
};

export async function loadOpenAIAgentSession(
  statePath: string,
): Promise<MemorySession> {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      sessionId?: unknown;
      items?: unknown;
    };
    if (typeof state.sessionId !== "string" || !Array.isArray(state.items)) {
      throw new Error("Invalid persisted OpenAI agent session");
    }
    return new MemorySession({
      sessionId: state.sessionId,
      initialItems: state.items as AgentInputItem[],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new MemorySession();
    }
    throw error;
  }
}

export async function saveOpenAIAgentSession(
  statePath: string,
  session: MemorySession,
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      sessionId: await session.getSessionId(),
      items: await session.getItems(),
    }),
    "utf8",
  );
}

/** Warm Grill path: MemorySession continuity across follow-up submits. */
export async function openOpenAIAgentSession(
  request: Omit<AgentRuntimeRequest, "task">,
  dependencies: {
    model?: Model;
    modelProvider?: ModelProvider;
    onStep?: (step: Step) => void;
    workspaceRoot?: string;
  } = {},
): Promise<OpenAIAgentSession> {
  const session = new MemorySession();
  const mcpServers = request.capabilitySession
    ? await MCPServers.open([
        new MCPServerStreamableHttp({
          name: "capabilities",
          url: request.capabilitySession.url,
          requestInit: {
            headers: {
              Authorization: `Bearer ${request.capabilitySession.token}`,
            },
          },
          toolFilter: {
            allowedToolNames: [...request.capabilitySession.allowedTools],
          },
          timeout: 5 * 60_000,
          cacheToolsList: true,
        }),
      ], { strict: true })
    : undefined;

  return {
    sessionId: await session.getSessionId(),
    runTurn: (task) =>
      runAgent(
        { ...request, task },
        {
          ...dependencies,
          session,
          mcpServers,
          retainMcp: true,
        },
      ),
    dispose: async () => {
      await session.clearSession();
      await mcpServers?.close();
    },
  };
}
