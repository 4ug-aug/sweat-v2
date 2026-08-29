import { boundStepText, STEP_TEXT_LIMIT } from "../runtime/step";
import type { McpUpstream } from "./gateway";
import {
  assertPublicHttpUrl,
  fetchPublicHttp,
  type PublicHttpResponse,
} from "./public-http";

const DDG_LITE = "https://lite.duckduckgo.com/lite/";
const QUERY_MAX = 400;
const DEFAULT_RESULTS = 8;
const MAX_RESULTS = 10;

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebFetchPage = {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
};

export type WebSearchFetch = (url: string) => Promise<PublicHttpResponse>;

export type WebSearch = (query: string) => Promise<WebSearchHit[]>;

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function decodeEntities(value: string): string {
  const fromPoint = (n: number): string => {
    if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return "";
    try {
      return String.fromCodePoint(n);
    } catch {
      return "";
    }
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      fromPoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      fromPoint(Number.parseInt(dec, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function collapseText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function contentKind(contentType: string, body: string): "html" | "text" {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    mime === "" && /<\s*(html|head|body|p|div|article)\b/i.test(body)
  )
    return "html";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript"
  )
    return "text";
  throw new Error(`Unsupported content type: ${mime || "unknown"}`);
}

export function readablePageFromHttp(response: PublicHttpResponse): WebFetchPage {
  const kind = contentKind(response.contentType, response.body);
  let title: string | undefined;
  let raw = response.body;
  if (kind === "html") {
    title = collapseText(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "",
    ) || undefined;
    raw = raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ");
    raw = collapseText(raw);
  }
  const truncated = raw.length > STEP_TEXT_LIMIT;
  return {
    url: response.url,
    ...(title ? { title } : {}),
    text: boundStepText(raw),
    truncated,
  };
}

function unwrapResultUrl(href: string): string | undefined {
  try {
    const raw = decodeEntities(href);
    const parsed = new URL(raw, DDG_LITE);
    const target = parsed.searchParams.get("uddg") ?? parsed.href;
    return assertPublicHttpUrl(target).href;
  } catch {
    return undefined;
  }
}

export function searchResultsFromDuckDuckGoLite(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const attrs = match[1] ?? "";
    if (!/\bclass=(["'])[^"']*result-link[^"']*\1/i.test(attrs)) continue;
    const href = /\bhref=(["'])([^"']*)\1/i.exec(attrs)?.[2];
    const title = collapseText(match[2] ?? "");
    const url = href ? unwrapResultUrl(href) : undefined;
    if (!url || !title) continue;
    const after = html.slice(match.index! + match[0].length);
    const nextLink = after.search(/class=(["'])[^"']*result-link/i);
    const window = nextLink === -1 ? after : after.slice(0, nextLink);
    const snippetMatch = /class=(["'])[^"']*result-snippet[^"']*\1[^>]*>([\s\S]*?)<\//i.exec(
      window,
    );
    hits.push({
      title,
      url,
      snippet: collapseText(snippetMatch?.[2] ?? ""),
    });
  }
  return hits;
}

export async function searchDuckDuckGoLite(
  query: string,
  fetchPage: WebSearchFetch = fetchPublicHttp,
): Promise<WebSearchHit[]> {
  const response = await fetchPage(
    `${DDG_LITE}?q=${encodeURIComponent(query)}`,
  );
  return searchResultsFromDuckDuckGoLite(response.body);
}

function requireQuery(value: unknown): string {
  const query = asString(value)?.trim();
  if (!query) throw new Error("query is required");
  if (query.length > QUERY_MAX)
    throw new Error(`query must be at most ${QUERY_MAX} characters`);
  return query;
}

function resultLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_RESULTS;
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error("maxResults must be an integer");
  if (value < 1 || value > MAX_RESULTS)
    throw new Error(`maxResults must be between 1 and ${MAX_RESULTS}`);
  return value;
}

export function createWebSearchMcpUpstream(options: {
  fetch?: WebSearchFetch;
  search?: WebSearch;
} = {}): McpUpstream {
  const fetchPage = async (url: string) => {
    assertPublicHttpUrl(url);
    return (options.fetch ?? fetchPublicHttp)(url);
  };
  const search =
    options.search ?? ((query) => searchDuckDuckGoLite(query, fetchPage));

  return {
    async listTools() {
      return [
        {
          name: "web.search",
          description:
            "Search the public web via DuckDuckGo. Returns titles, URLs, and snippets. Use web.fetch to read a result page. Do not use this for private or local URLs.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              maxResults: {
                type: "integer",
                minimum: 1,
                maximum: MAX_RESULTS,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "web.fetch",
          description:
            "Fetch a public http(s) URL and return extracted text (HTML stripped to text). Rejects private, loopback, and link-local targets. Use after web.search to read a page.",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
      ];
    },
    async callTool(name, args) {
      if (name === "web.search") {
        const query = requireQuery(args.query);
        const limit = resultLimit(args.maxResults);
        return textResult({ results: (await search(query)).slice(0, limit) });
      }
      if (name === "web.fetch") {
        const url = asString(args.url)?.trim();
        if (!url) throw new Error("url is required");
        const page = readablePageFromHttp(await fetchPage(url));
        return textResult(page);
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };
}
