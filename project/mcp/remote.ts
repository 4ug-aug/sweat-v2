import { MCPServerStreamableHttp } from "@openai/agents";
import type { McpUpstream } from "./gateway";

export type RemoteMcpServer = Pick<
  MCPServerStreamableHttp,
  "connect" | "listTools" | "callTool"
>;

/** Namespaces an upstream's tools as `<name>.<tool>` so the gateway can route by prefix. */
export function namespaceMcpUpstream(
  name: string,
  server: RemoteMcpServer,
): McpUpstream {
  const prefix = `${name}.`;
  let connected: Promise<void> | undefined;
  const connect = () => (connected ??= server.connect());

  return {
    async listTools() {
      await connect();
      return (await server.listTools()).map((tool) => ({
        ...tool,
        name: `${prefix}${tool.name}`,
      }));
    },
    async callTool(tool, args) {
      if (!tool.startsWith(prefix)) throw new Error(`Unknown ${name} tool: ${tool}`);
      await connect();
      return server.callTool(tool.slice(prefix.length), args);
    },
  };
}

/** Remote MCP server over Streamable HTTP with a bearer token. */
export function createRemoteMcpUpstream(options: {
  name: string;
  url: string;
  accessToken: string;
}): McpUpstream {
  return namespaceMcpUpstream(
    options.name,
    new MCPServerStreamableHttp({
      name: options.name,
      url: options.url,
      requestInit: {
        headers: { Authorization: `Bearer ${options.accessToken}` },
      },
      cacheToolsList: true,
    }),
  );
}
