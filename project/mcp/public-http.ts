import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1_048_576;

const blockedNames =
  /^(localhost|metadata\.google\.internal|kubernetes\.default(\.svc(\.cluster\.local)?)?)$/i;

const blockedError = (detail: string) =>
  new Error(`URL is not a public HTTP(S) resource: ${detail}`);

export function ipFamily(address: string): 4 | 6 | undefined {
  const family = isIP(address);
  if (family === 4 || family === 6) return family;
}

function hostnameAddress(hostname: string): string | undefined {
  if (hostname.startsWith("[") && hostname.endsWith("]"))
    return hostname.slice(1, -1);
  if (ipFamily(hostname)) return hostname;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (blockedNames.test(host)) return true;
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  return false;
}

function parseHextet(value: string): number | undefined {
  if (!value || value.length > 4) return undefined;
  if (!/^[0-9a-f]+$/i.test(value)) return undefined;
  const n = Number.parseInt(value, 16);
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) return undefined;
  return n;
}

function ipv4TailToHextets(dotted: string): [number, number] | undefined {
  const parts = dotted.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return undefined;
  return [
    (octets[0]! << 8) | octets[1]!,
    (octets[2]! << 8) | octets[3]!,
  ];
}

function parseHextetList(side: string): number[] | undefined {
  if (side === "") return [];
  const out: number[] = [];
  for (const piece of side.split(":")) {
    const n = parseHextet(piece);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

function expandIpv6(address: string): number[] | undefined {
  let addr = address.toLowerCase().split("%")[0]!;
  const v4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const mapped = ipv4TailToHextets(v4[1]!);
    if (!mapped) return undefined;
    addr = `${addr.slice(0, v4.index)}:${mapped[0].toString(16)}:${mapped[1].toString(16)}`;
  }
  if (addr.includes("::")) {
    const halves = addr.split("::");
    if (halves.length !== 2) return undefined;
    const head = parseHextetList(halves[0]!);
    const tail = parseHextetList(halves[1]!);
    if (!head || !tail) return undefined;
    const zeros = 8 - head.length - tail.length;
    if (zeros < 0) return undefined;
    return [...head, ...Array<number>(zeros).fill(0), ...tail];
  }
  const pieces = addr.split(":");
  if (pieces.length !== 8) return undefined;
  const out: number[] = [];
  for (const piece of pieces) {
    const n = parseHextet(piece);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

function hextetsToIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function canonicalAddress(
  address: string,
): { address: string; family: 4 | 6 } | undefined {
  const family = ipFamily(address);
  if (family === 4) return { address, family };
  if (family !== 6) return undefined;
  const h = expandIpv6(address);
  if (!h || h.length !== 8) return undefined;
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  )
    return { address: hextetsToIpv4(h[6]!, h[7]!), family: 4 };
  if (
    h[0] === 0x64 &&
    h[1] === 0xff9b &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0
  )
    return { address: hextetsToIpv4(h[6]!, h[7]!), family: 4 };
  if (h[0] === 0x2002)
    return { address: hextetsToIpv4(h[1]!, h[2]!), family: 4 };
  return { address, family: 6 };
}

function ipv4Int(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return undefined;
  return (
    (((octets[0]! << 24) >>> 0) +
      (octets[1]! << 16) +
      (octets[2]! << 8) +
      octets[3]!) >>>
    0
  );
}

function inPrefix(ip: number, prefix: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip ^ prefix) & mask) === 0;
}

/** IANA special-purpose IPv4 ranges that are not globally routed unicast. */
const ipv4NotGlobal: readonly [prefix: number, bits: number][] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function isGloballyRoutedUnicast(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const ip = ipv4Int(address);
    if (ip === undefined) return false;
    return !ipv4NotGlobal.some(([prefix, bits]) => inPrefix(ip, prefix, bits));
  }
  const h = expandIpv6(address);
  if (!h) return false;
  if ((h[0]! & 0xe000) !== 0x2000) return false;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false;
  return true;
}

export function assertPublicAddress(address: string): void {
  const canonical = canonicalAddress(address);
  if (!canonical) throw blockedError(`unrecognized address ${address}`);
  if (!isGloballyRoutedUnicast(canonical.address, canonical.family))
    throw blockedError(`${address} is not public`);
}

export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw blockedError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw blockedError("only http and https are allowed");
  if (url.username || url.password)
    throw blockedError("credentials are not allowed");
  if (!url.hostname) throw blockedError("a host is required");
  if (isBlockedHostname(url.hostname))
    throw blockedError(`${url.hostname} is not public`);
  const address = hostnameAddress(url.hostname);
  if (address) assertPublicAddress(address);
  return url;
}

export type ResolvedPeer = { address: string; family: 4 | 6 };

export type LookupPublicHost = (
  hostname: string,
) => Promise<readonly ResolvedPeer[]>;

export type PublicHttpHop = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export type PublicHttpHopResult = {
  status: number;
  headers: Headers;
  body: Uint8Array;
};

export type PublicHttpTransport = (
  hop: PublicHttpHop,
  options: { timeoutMs: number; maxBytes: number },
) => Promise<PublicHttpHopResult>;

export type PublicHttpResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

const defaultLookup: LookupPublicHost = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw blockedError(`could not resolve ${hostname}`);
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

async function resolvePublicPeer(
  url: URL,
  lookup: LookupPublicHost,
): Promise<ResolvedPeer> {
  const literal = hostnameAddress(url.hostname);
  if (literal) {
    assertPublicAddress(literal);
    return { address: literal, family: ipFamily(literal)! };
  }
  const records = await lookup(url.hostname);
  if (!records.length) throw blockedError(`could not resolve ${url.hostname}`);
  for (const record of records) assertPublicAddress(record.address);
  return records[0]!;
}

export function pinLookup(address: string, family: 4 | 6): LookupFunction {
  return (
    _hostname: string,
    lookupOptions: LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    if (lookupOptions.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

export function pinnedHttpTransport(
  hop: PublicHttpHop,
  options: { timeoutMs: number; maxBytes: number },
): Promise<PublicHttpHopResult> {
  const { url, address, family } = hop;
  const client = url.protocol === "https:" ? https : http;
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: url.protocol,
        host: address,
        family,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: hostnameAddress(url.hostname) ? undefined : url.hostname,
        headers: {
          Host: url.host,
          Accept:
            "text/html, text/plain, application/json, application/xhtml+xml, */*;q=0.1",
          "Accept-Language": "en",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        timeout: options.timeoutMs,
        lookup: pinLookup(address, family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          response.destroy();
          reject(new Error("Response is too large"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new Error("Response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(", "));
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchPublicHttp(
  input: string,
  options: {
    lookup?: LookupPublicHost;
    transport?: PublicHttpTransport;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
  } = {},
): Promise<PublicHttpResponse> {
  const lookup = options.lookup ?? defaultLookup;
  const transport = options.transport ?? pinnedHttpTransport;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = assertPublicHttpUrl(input);
  const originProtocol = current.protocol;

  for (let hops = 0; hops <= maxRedirects; hops++) {
    const peer = await resolvePublicPeer(current, lookup);
    const result = await transport(
      { url: current, address: peer.address, family: peer.family },
      { timeoutMs, maxBytes },
    );
    if (result.body.byteLength > maxBytes)
      throw new Error("Response is too large");
    if (result.status >= 300 && result.status < 400) {
      const location = (result.headers.get("location") ?? "").trim();
      if (!location) throw new Error("Redirect is missing a Location header");
      if (hops === maxRedirects) throw new Error("Too many redirects");
      const next = new URL(location, current);
      if (originProtocol === "https:" && next.protocol === "http:")
        throw blockedError("HTTPS to HTTP redirect is not allowed");
      current = assertPublicHttpUrl(next.href);
      continue;
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error(`HTTP ${result.status} from ${current.href}`);
    const contentType = result.headers.get("content-type") ?? "";
    return {
      url: current.href,
      status: result.status,
      contentType,
      body: Buffer.from(result.body).toString("utf8"),
    };
  }
  throw new Error("Too many redirects");
}
