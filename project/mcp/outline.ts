import type { McpTool, McpUpstream } from "./gateway";
import { createRemoteMcpUpstream } from "./remote";

export type OutlineConfiguration = { url: string; apiKey: string };

/** Accept instance root or a pasted `…/mcp` endpoint; always talk to `<instance>/mcp`. */
export function outlineMcpUrl(instanceOrMcpUrl: string): string {
  const base = instanceOrMcpUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/mcp$/i, "");
  return `${base}/mcp`;
}

const listDocumentsDescription =
  'Search the Outline wiki: pass query for full-text search, or omit it to list recent documents. Then read a hit with outline.fetch { resource: "document", id }.';

const fetchDescription =
  'Read an Outline wiki document, collection, user, attachment, or template. To read a wiki page, call with resource "document" and the id from outline.list_documents.';

/** Replace Outline's generic list/fetch blurbs so agents search, then fetch by resource+id. */
export function clarifyOutlineUpstream(upstream: McpUpstream): McpUpstream {
  return {
    async listTools() {
      return (await upstream.listTools()).map((tool): McpTool => {
        if (tool.name === "outline.list_documents")
          return { ...tool, description: listDocumentsDescription };
        if (tool.name === "outline.fetch")
          return { ...tool, description: fetchDescription };
        return tool;
      });
    },
    callTool: (name, args) => upstream.callTool(name, args),
  };
}

/** Outline serves MCP at `<instance>/mcp`; cloud instances are https://<subdomain>.getoutline.com. */
export function createOutlineMcpUpstream(
  options: OutlineConfiguration,
): McpUpstream {
  return clarifyOutlineUpstream(
    createRemoteMcpUpstream({
      name: "outline",
      url: outlineMcpUrl(options.url),
      accessToken: options.apiKey,
    }),
  );
}

export function readOutlineConfiguration(
  environment: Record<string, string | undefined> = process.env,
): OutlineConfiguration | undefined {
  const url = environment.OUTLINE_URL || undefined;
  const apiKey = environment.OUTLINE_API_KEY || undefined;
  if (Boolean(url) !== Boolean(apiKey))
    throw new Error(
      "OUTLINE_URL and OUTLINE_API_KEY must be configured together",
    );
  return url && apiKey ? { url, apiKey } : undefined;
}
