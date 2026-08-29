import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  assertPublicAddress,
  assertPublicHttpUrl,
  fetchPublicHttp,
  pinLookup,
  pinnedHttpTransport,
  type PublicHttpHop,
} from "./public-http";

const rejects = (url: string, pattern: RegExp | string) => {
  expect(() => assertPublicHttpUrl(url)).toThrow(pattern);
};

test("assertPublicHttpUrl accepts a public https URL", () => {
  const url = assertPublicHttpUrl("https://example.com/path?q=1");
  expect(url.href).toBe("https://example.com/path?q=1");
});

test("assertPublicHttpUrl rejects non-http schemes, credentials, and empty hosts", () => {
  rejects("file:///etc/passwd", /http/);
  rejects("ftp://example.com/", /http/);
  rejects("javascript:alert(1)", /http/);
  rejects("https://user:pass@example.com/", /credential/);
  rejects("https://user@example.com/", /credential/);
  rejects("https://", /invalid|host/);
});

test("assertPublicHttpUrl rejects loopback, private, link-local, and metadata addresses", () => {
  const blocked = [
    "http://127.0.0.1/",
    "http://127.1/",
    "http://localhost/",
    "http://LOCALHOST/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://10.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.170.2/",
    "http://100.64.0.1/",
    "http://192.0.2.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://[fc00::1]/",
    "http://[fd12:3456:789a:1::1]/",
    "http://[fe80::1]/",
    "http://metadata.google.internal/",
    "http://kubernetes.default.svc.cluster.local/",
  ];
  for (const url of blocked) {
    expect(() => assertPublicHttpUrl(url), url).toThrow(/not a public/i);
  }
});

test("assertPublicAddress rejects NAT64 and 6to4 encodings of loopback and link-local", () => {
  const blocked = [
    "64:ff9b::7f00:1",
    "64:ff9b::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::",
  ];
  for (const address of blocked) {
    expect(() => assertPublicAddress(address), address).toThrow(/not public/i);
  }
});

test("assertPublicHttpUrl rejects NAT64 and 6to4 literals of loopback and metadata", () => {
  rejects("http://[64:ff9b::7f00:1]/", /not a public/i);
  rejects("http://[2002:7f00:1::]/", /not a public/i);
  rejects("http://[2002:a9fe:a9fe::]/latest/meta-data/", /not a public/i);
});

test("assertPublicAddress accepts a globally routed unicast after unmapping", () => {
  expect(() => assertPublicAddress("93.184.216.34")).not.toThrow();
  expect(() => assertPublicAddress("::ffff:93.184.216.34")).not.toThrow();
  expect(() => assertPublicAddress("2002:5db8:d822::")).not.toThrow();
});

test("fetchPublicHttp rejects DNS records that are NAT64 or 6to4 private encodings", async () => {
  const records = [
    { address: "64:ff9b::7f00:1", family: 6 as const },
    { address: "2002:7f00:1::", family: 6 as const },
    { address: "2002:a9fe:a9fe::", family: 6 as const },
  ];
  for (const record of records) {
    await expect(
      fetchPublicHttp("https://evil.example/", {
        lookup: async () => [record],
        transport: async () => {
          throw new Error("must not connect");
        },
      }),
    ).rejects.toThrow(/not public/i);
  }
});

test("pinnedHttpTransport connects to the pin and sends the URL Host", async () => {
  const seen: { host?: string } = {};
  const server = http.createServer((req, res) => {
    seen.host = req.headers.host;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pinned");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    const result = await pinnedHttpTransport(
      {
        url: new URL(`http://example.com:${port}/page?q=1`),
        address: "127.0.0.1",
        family: 4,
      },
      { timeoutMs: 2_000, maxBytes: 1_024 },
    );
    expect(seen.host).toBe(`example.com:${port}`);
    expect(result.status).toBe(200);
    expect(Buffer.from(result.body).toString()).toBe("pinned");
  } finally {
    server.close();
  }
});

test("pinLookup forces node:http onto the pinned address", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("lookup-pin");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const request = http.request(
        {
          host: "example.com",
          port,
          path: "/",
          method: "GET",
          lookup: pinLookup("127.0.0.1", 4),
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks).toString()));
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(body).toBe("lookup-pin");
  } finally {
    server.close();
  }
});

test("pinLookup returns the pin for both all and single lookups", () => {
  const lookup = pinLookup("93.184.216.34", 4);
  lookup("example.com", { all: true }, (err, addresses) => {
    expect(err).toBeNull();
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
  lookup("example.com", { all: false }, (err, address, family) => {
    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });
});

test("fetchPublicHttp pins the TCP peer to a resolved public address", async () => {
  const hops: PublicHttpHop[] = [];
  const result = await fetchPublicHttp("https://example.com/page", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (hop) => {
      hops.push(hop);
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        body: new TextEncoder().encode("hello"),
      };
    },
  });
  expect(hops).toEqual([
    {
      url: new URL("https://example.com/page"),
      address: "93.184.216.34",
      family: 4,
    },
  ]);
  expect(result).toMatchObject({
    url: "https://example.com/page",
    status: 200,
    body: "hello",
  });
});

test("fetchPublicHttp rejects a DNS record that resolves to a private address", async () => {
  await expect(
    fetchPublicHttp("https://evil.example/", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      transport: async () => {
        throw new Error("must not connect");
      },
    }),
  ).rejects.toThrow(/not public/i);
});

test("fetchPublicHttp rejects a redirect onto a private URL and HTTPS downgrades", async () => {
  await expect(
    fetchPublicHttp("https://example.com/", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => ({
        status: 302,
        headers: new Headers({ location: "http://127.0.0.1/" }),
        body: new Uint8Array(),
      }),
    }),
  ).rejects.toThrow(/not a public/i);

  await expect(
    fetchPublicHttp("https://example.com/", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => ({
        status: 301,
        headers: new Headers({ location: "http://example.com/" }),
        body: new Uint8Array(),
      }),
    }),
  ).rejects.toThrow(/HTTPS to HTTP/i);
});

test("fetchPublicHttp follows a public redirect and caps hop count", async () => {
  const statuses = [302, 200];
  const result = await fetchPublicHttp("https://example.com/a", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (hop) => {
      const status = statuses.shift()!;
      if (status === 302)
        return {
          status,
          headers: new Headers({ location: "https://example.com/b" }),
          body: new Uint8Array(),
        };
      expect(hop.url.pathname).toBe("/b");
      return {
        status,
        headers: new Headers({ "content-type": "text/plain" }),
        body: new TextEncoder().encode("landed"),
      };
    },
  });
  expect(result.body).toBe("landed");
  expect(result.url).toBe("https://example.com/b");

  await expect(
    fetchPublicHttp("https://example.com/loop", {
      maxRedirects: 1,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => ({
        status: 302,
        headers: new Headers({ location: "https://example.com/loop" }),
        body: new Uint8Array(),
      }),
    }),
  ).rejects.toThrow(/Too many redirects/);
});

test("fetchPublicHttp refuses a body over the byte cap", async () => {
  await expect(
    fetchPublicHttp("https://example.com/", {
      maxBytes: 4,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        body: new TextEncoder().encode("too-big"),
      }),
    }),
  ).rejects.toThrow(/too large/i);
});
