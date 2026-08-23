export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpUpstream {
  listTools(): Promise<readonly McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpGrant {
  tools: readonly string[];
  expiresAt: Date;
  resources?: readonly {
    provider: string;
    repository: string;
  }[];
}

export interface McpGateway {
  createSession(grant: McpGrant): { token: string; expiresAt: Date };
  listTools(token: string): Promise<readonly McpTool[]>;
  callTool(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  revokeSession(token: string): void;
}

export function createMcpGateway(options: {
  upstream?: McpUpstream;
  upstreams?: readonly McpUpstream[];
  now?: () => Date;
  createToken?: () => string;
}): McpGateway {
  const now = options.now ?? (() => new Date());
  const createToken = options.createToken ?? (() => crypto.randomUUID());
  const sessions = new Map<string, McpGrant>();
  const upstreams = options.upstreams ?? (options.upstream ? [options.upstream] : []);
  if (!upstreams.length) throw new Error("At least one MCP upstream is required");

  type Routes = Map<string, { upstream: McpUpstream; tool: McpTool }>;
  const listUpstreamTools = async (): Promise<Routes> => {
    const tools = await Promise.all(upstreams.map(async (upstream) => [upstream, await upstream.listTools()] as const));
    const routes: Routes = new Map();
    for (const [upstream, entries] of tools) {
      for (const tool of entries) {
        if (routes.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
        routes.set(tool.name, { upstream, tool });
      }
    }
    return routes;
  };

  // A gateway is built per capability session, so its upstream tool set is
  // fixed for the run: listing once spares every tools/call a fan-out to each
  // upstream. A failed listing is not cached, so a flaky upstream can retry.
  let routes: Promise<Routes> | undefined;
  const availableTools = (): Promise<Routes> =>
    (routes ??= listUpstreamTools().catch((error: unknown) => {
      routes = undefined;
      throw error;
    }));

  const grantFor = (token: string): McpGrant => {
    const grant = sessions.get(token);
    if (!grant || grant.expiresAt <= now()) throw new Error("MCP session expired");
    return grant;
  };

  return {
    createSession(grant) {
      if (grant.expiresAt <= now()) throw new Error("MCP session already expired");
      const token = createToken();
      sessions.set(token, grant);
      return { token, expiresAt: grant.expiresAt };
    },

    async listTools(token) {
      const granted = grantFor(token).tools;
      const allowed = new Set(granted);
      const routes = await availableTools();
      const tools = [...routes.keys()]
        .filter((name) => allowed.has(name))
        .map((name) => routes.get(name)!);
      const available = new Set(tools.map((tool) => tool.tool.name));
      const missing = granted.filter((name) => !available.has(name));
      if (missing.length) throw new Error(`Granted MCP tools are unavailable: ${missing.join(", ")}`);
      return tools.map((tool) => tool.tool);
    },

    async callTool(token, name, args) {
      if (!grantFor(token).tools.includes(name)) {
        throw new Error(`MCP tool is not granted: ${name}`);
      }
      const upstream = (await availableTools()).get(name);
      if (!upstream) throw new Error(`Granted MCP tool is unavailable: ${name}`);
      return upstream.upstream.callTool(name, args);
    },

    revokeSession: (token) => sessions.delete(token),
  };
}
