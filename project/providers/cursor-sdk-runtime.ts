import type { AgentProvider, RuntimeRequest } from "../runs";
import {
  capabilitySessionEnv,
  createStdoutStepRuntime,
} from "./stdout-step-runtime";

export function createCursorSdkRuntime(options: {
  command?: readonly string[];
} = {}): AgentProvider {
  const command = options.command ?? (["bun", "/app/cursor-cli.js"] as const);

  return createStdoutStepRuntime({
    command: () => command,
    env: (request: RuntimeRequest) => {
      const runtime = request.definition.runtime;
      if (runtime.kind !== "cursor") {
        throw new Error(
          `Agent definition ${request.definition.id} is not a Cursor runtime`,
        );
      }
      return {
        SWEAT_AGENT_TASK: request.task,
        SWEAT_AGENT_ID: request.definition.id,
        SWEAT_AGENT_INSTRUCTIONS: request.definition.instructions,
        SWEAT_CURSOR_API_KEY: runtime.cursor.apiKey,
        SWEAT_CURSOR_MODEL: runtime.cursor.model,
        // Packages live under /app; sandbox workdir is /work for the agent cwd.
        NODE_PATH: "/app/node_modules",
        ...capabilitySessionEnv(request),
      };
    },
  });
}
