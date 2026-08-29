import { expect, test } from "bun:test";
import { STEP_TEXT_LIMIT } from "../runtime/step";
import {
  createWebSearchMcpUpstream,
  readablePageFromHttp,
  searchDuckDuckGoLite,
  searchResultsFromDuckDuckGoLite,
} from "./web-search";

const liteHtml = `
<table>
<tr><td><a rel="nofollow" class="result-link" href="https://en.wikipedia.org/wiki/Duck">Duck - Wikipedia</a></td></tr>
<tr><td class="result-snippet">Ducks are birds in the family Anatidae.</td></tr>
<tr><td><a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.britannica.com%2Fanimal%2Fduck&amp;rut=abc">duck | Britannica</a></td></tr>
<tr><td class="result-snippet">Duck, any of various species of relatively small waterfowl.</td></tr>
<tr><td><a rel="nofollow" class="result-link" href="http://127.0.0.1/admin">Internal</a></td></tr>
<tr><td class="result-snippet">Dropped private hit.</td></tr>
</table>
`;

test("searchResultsFromDuckDuckGoLite unwraps uddg links and drops private URLs", () => {
  expect(searchResultsFromDuckDuckGoLite(liteHtml)).toEqual([
    {
      title: "Duck - Wikipedia",
      url: "https://en.wikipedia.org/wiki/Duck",
      snippet: "Ducks are birds in the family Anatidae.",
    },
    {
      title: "duck | Britannica",
      url: "https://www.britannica.com/animal/duck",
      snippet:
        "Duck, any of various species of relatively small waterfowl.",
    },
  ]);
});

test("readablePageFromHttp strips markup and truncates to the step budget", () => {
  const page = readablePageFromHttp({
    url: "https://example.com/hi",
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<html><head><title>Hello</title><script>alert(1)</script><style>p{}</style></head><body><p>Hi &amp; welcome</p></body></html>",
  });
  expect(page).toMatchObject({
    url: "https://example.com/hi",
    title: "Hello",
    truncated: false,
  });
  expect(page.text).toContain("Hi & welcome");
  expect(page.text).not.toContain("alert");

  const huge = readablePageFromHttp({
    url: "https://example.com/big",
    status: 200,
    contentType: "text/plain",
    body: "x".repeat(STEP_TEXT_LIMIT + 50),
  });
  expect(huge.truncated).toBe(true);
  expect(huge.text.endsWith("…[truncated]")).toBe(true);
  expect(huge.text.length).toBeLessThanOrEqual(STEP_TEXT_LIMIT + 20);
});

test("searchDuckDuckGoLite fetches lite HTML and parses hits", async () => {
  const urls: string[] = [];
  const hits = await searchDuckDuckGoLite("duck", async (url) => {
    urls.push(url);
    return {
      url,
      status: 200,
      contentType: "text/html",
      body: liteHtml,
    };
  });
  expect(urls[0]).toContain("lite.duckduckgo.com");
  expect(urls[0]).toContain("q=duck");
  expect(hits).toEqual(searchResultsFromDuckDuckGoLite(liteHtml));
});

test("web.search dispatches to the search port and web.fetch reads pages", async () => {
  const queries: string[] = [];
  const fetches: string[] = [];
  const upstream = createWebSearchMcpUpstream({
    search: async (query) => {
      queries.push(query);
      return [
        {
          title: "Duck - Wikipedia",
          url: "https://en.wikipedia.org/wiki/Duck",
          snippet: "Ducks are birds in the family Anatidae.",
        },
        {
          title: "duck | Britannica",
          url: "https://www.britannica.com/animal/duck",
          snippet: "waterfowl",
        },
      ];
    },
    fetch: async (url) => {
      fetches.push(url);
      return {
        url,
        status: 200,
        contentType: "text/html",
        body: "<html><head><title>Duck</title></head><body><p>Waterfowl.</p></body></html>",
      };
    },
  });

  expect((await upstream.listTools()).map((tool) => tool.name)).toEqual([
    "web.search",
    "web.fetch",
  ]);

  const search = (await upstream.callTool("web.search", {
    query: "duck",
    maxResults: 1,
  })) as { content: { text: string }[] };
  expect(queries).toEqual(["duck"]);
  expect(JSON.parse(search.content[0]!.text)).toEqual({
    results: [
      {
        title: "Duck - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Duck",
        snippet: "Ducks are birds in the family Anatidae.",
      },
    ],
  });

  const page = (await upstream.callTool("web.fetch", {
    url: "https://en.wikipedia.org/wiki/Duck",
  })) as { content: { text: string }[] };
  expect(JSON.parse(page.content[0]!.text)).toMatchObject({
    url: "https://en.wikipedia.org/wiki/Duck",
    title: "Duck",
    truncated: false,
  });
  expect(fetches).toEqual(["https://en.wikipedia.org/wiki/Duck"]);
});

test("web.search and web.fetch reject empty input and unsupported bodies", async () => {
  const upstream = createWebSearchMcpUpstream({
    fetch: async () => ({
      url: "https://example.com/file.pdf",
      status: 200,
      contentType: "application/pdf",
      body: "%PDF",
    }),
  });
  await expect(upstream.callTool("web.search", { query: "  " })).rejects.toThrow(
    /query/i,
  );
  await expect(upstream.callTool("web.fetch", { url: "" })).rejects.toThrow(
    /url/i,
  );
  await expect(
    upstream.callTool("web.fetch", { url: "https://example.com/file.pdf" }),
  ).rejects.toThrow(/unsupported/i);
});

test("web.fetch refuses private URLs before contacting the network", async () => {
  const upstream = createWebSearchMcpUpstream({
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  await expect(
    upstream.callTool("web.fetch", { url: "http://127.0.0.1/" }),
  ).rejects.toThrow(/not a public/i);
});
