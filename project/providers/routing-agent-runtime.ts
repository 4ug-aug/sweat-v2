import type { AgentProvider, RuntimeRequest } from "../runs";
import { createCursorSdkRuntime } from "./cursor-sdk-runtime";
import { createOpenAIAgentsRuntime } from "./openai-agents-runtime";

/**
 * Routes to the Cursor or OpenAI Agents runtime based on definition.runtime.kind.
 */
export function createRoutingAgentRuntime(options: {
  openai?: AgentProvider;
  cursor?: AgentProvider;
} = {}): AgentProvider {
  const openai = options.openai ?? createOpenAIAgentsRuntime({});
  const cursor = options.cursor ?? createCursorSdkRuntime({});

  const select = (request: Pick<RuntimeRequest, "definition">): AgentProvider =>
    request.definition.runtime.kind === "cursor" ? cursor : openai;

  return {
    run: async (sandbox, request: RuntimeRequest) =>
      select(request).run(sandbox, request),
    openWarmSession: async (sandbox, request) => {
      const provider = select(request);
      if (!provider.openWarmSession) {
        throw new Error("Runtime does not support warm runs");
      }
      return provider.openWarmSession(sandbox, request);
    },
  };
}
