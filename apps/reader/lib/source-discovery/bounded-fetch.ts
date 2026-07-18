import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

import type { BoundedFetchResult, DnsAddress, SourceDiscoveryDependencies } from "./types";
import { defaultDnsLookup, resolveRemoteUrl } from "./url-safety";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = "DailyNewsDigestSourceDiscovery/1.0";

function requestHeaders(userAgent: string) {
  return {
    accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8",
    "accept-encoding": "identity",
    "user-agent": userAgent,
  } as const;
}

async function boundedBody(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Source response exceeds the 2 MB limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Source response exceeds the 2 MB limit.");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function boundedIncomingBody(response: IncomingMessage, maxBytes: number) {
  const encoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
  if (encoding !== "identity") {
    response.destroy();
    throw new Error("Compressed discovery responses are rejected to preserve the 2 MB decompressed limit.");
  }
  const declared = Number(response.headers["content-length"] || 0);
  if (declared > maxBytes) {
    response.destroy();
    throw new Error("Source response exceeds the 2 MB limit.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      response.destroy();
      throw new Error("Source response exceeds the 2 MB limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

type DiscoveryResponse = {
  discard: () => Promise<void>;
  getHeader: (name: string) => string | null;
  ok: boolean;
  readBody: () => Promise<string>;
  status: number;
};

export function createPinnedLookup(address: DnsAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

async function pinnedRequest(
  url: URL,
  address: DnsAddress,
  signal: AbortSignal,
  maxBytes: number,
  userAgent: string,
): Promise<DiscoveryResponse> {
  const lookup = createPinnedLookup(address);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers: requestHeaders(userAgent),
      lookup,
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      signal,
    }, (response) => {
      const status = response.statusCode || 0;
      resolve({
        discard: async () => {
          response.resume();
        },
        getHeader: (name) => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] || null : value === undefined ? null : String(value);
        },
        ok: status >= 200 && status < 300,
        readBody: () => boundedIncomingBody(response, maxBytes),
        status,
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function discoveryRequest(
  url: URL,
  address: DnsAddress,
  signal: AbortSignal,
  maxBytes: number,
  userAgent: string,
  fetchImpl?: typeof fetch,
): Promise<DiscoveryResponse> {
  if (!fetchImpl) return pinnedRequest(url, address, signal, maxBytes, userAgent);
  const response = await fetchImpl(url, {
    headers: requestHeaders(userAgent),
    redirect: "manual",
    signal,
  });
  return {
    discard: async () => {
      await response.body?.cancel();
    },
    getHeader: (name) => response.headers.get(name),
    ok: response.ok,
    readBody: () => boundedBody(response, maxBytes),
    status: response.status,
  };
}

export async function fetchBoundedText(
  rawUrl: string,
  dependencies: SourceDiscoveryDependencies = {},
): Promise<BoundedFetchResult> {
  const lookup = dependencies.lookup || defaultDnsLookup;
  const maxBytes = dependencies.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = dependencies.maxRedirects ?? 5;
  const timeoutMs = dependencies.timeoutMs ?? 8_000;
  const userAgent = dependencies.userAgent || DEFAULT_USER_AGENT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Source request timed out.")), timeoutMs);
  let current = await resolveRemoteUrl(rawUrl, lookup);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await discoveryRequest(
        current.url,
        current.addresses[0],
        controller.signal,
        maxBytes,
        userAgent,
        dependencies.fetchImpl,
      );
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.getHeader("location");
        if (!location) throw new Error("Source redirect is missing a Location header.");
        await response.discard();
        if (redirectCount === maxRedirects) throw new Error("Source exceeded the five-redirect limit.");
        current = await resolveRemoteUrl(new URL(location, current.url).toString(), lookup);
        continue;
      }
      if (!response.ok) {
        await response.discard();
        throw new Error(`Source returned HTTP ${response.status}.`);
      }
      return {
        body: await response.readBody(),
        contentType: response.getHeader("content-type") || "",
        finalUrl: current.url.toString(),
        redirectCount,
      };
    }
    throw new Error("Source exceeded the redirect limit.");
  } finally {
    clearTimeout(timeout);
  }
}
