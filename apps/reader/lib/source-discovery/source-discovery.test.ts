import { describe, expect, it } from "vitest";

import {
  discoverSource,
  fetchBoundedText,
  isBlockedAddress,
  validateRemoteUrl,
  type SourceDiscoveryDependencies,
} from "./index";
import { createPinnedLookup } from "./bounded-fetch";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];

describe("source discovery URL safety", () => {
  it("returns a pinned address array when Node requests all lookup results", async () => {
    const address = { address: "8.8.8.8", family: 4 };
    const lookup = createPinnedLookup(address);

    await expect(new Promise((resolve, reject) => {
      lookup("example.com", { all: true }, (error, addresses) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(addresses);
      });
    })).resolves.toEqual([address]);
  });

  it("rejects local, private, metadata and IPv6 transition destinations", async () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isBlockedAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isBlockedAddress("2002:a9fe:a9fe::1")).toBe(true);
    expect(isBlockedAddress("fec0::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    await expect(validateRemoteUrl("http://localhost/feed", publicLookup)).rejects.toThrow(/blocked/i);
    await expect(validateRemoteUrl("http://[::1]/feed", publicLookup)).rejects.toThrow(/private|local|reserved/i);
    await expect(validateRemoteUrl("http://metadata.google.internal/feed", publicLookup)).rejects.toThrow(/blocked/i);
    await expect(validateRemoteUrl("https://example.com/feed", async () => [{ address: "192.168.1.3", family: 4 }]))
      .rejects.toThrow(/private/i);
  });

  it("validates every redirect target before following it", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, {
      headers: { location: "http://127.0.0.1/metadata" },
      status: 302,
    });
    await expect(fetchBoundedText("https://example.com/feed", { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/private|local|reserved/i);
  });

  it("rejects unsupported protocols and more than five redirects", async () => {
    await expect(validateRemoteUrl("file:///etc/passwd", publicLookup)).rejects.toThrow(/HTTP/i);
    let redirect = 0;
    const fetchImpl: typeof fetch = async () => new Response(null, {
      headers: { location: `https://example.com/redirect-${redirect += 1}` },
      status: 302,
    });
    await expect(fetchBoundedText("https://example.com/start", { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/five-redirect/i);
    expect(redirect).toBe(6);
  });

  it("stops reading after the configured response limit", async () => {
    const fetchImpl: typeof fetch = async () => new Response("x".repeat(101), { status: 200 });
    await expect(fetchBoundedText("https://example.com/feed", {
      fetchImpl,
      lookup: publicLookup,
      maxBytes: 100,
    })).rejects.toThrow(/limit/i);
  });
});

describe("RSS and Atom discovery", () => {
  it("finds an alternate feed, parses a bounded sample and proposes metadata", async () => {
    const html = '<html lang="en"><head><link rel="alternate" type="application/rss+xml" href="/news.xml"></head></html>';
    const rss = `<?xml version="1.0"?><rss><channel><title>Example AI News</title><language>en</language>
      <item><title>OpenAI releases a new model</title><link>https://example.com/story-1</link><pubDate>Fri, 17 Jul 2026 08:00:00 GMT</pubDate></item>
      <item><title>Developer AI platform update</title><link>https://example.com/story-2</link><pubDate>Fri, 17 Jul 2026 09:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      return new Response(url.endsWith("/news.xml") ? rss : html, {
        headers: { "content-type": url.endsWith(".xml") ? "application/rss+xml" : "text/html" },
        status: 200,
      });
    };
    const dependencies: SourceDiscoveryDependencies = { fetchImpl, lookup: publicLookup };
    const proposal = await discoverSource("https://example.com/article", new Set(), dependencies);

    expect(proposal).toMatchObject({
      alreadyExists: false,
      category: "AI / Technology",
      feedType: "rss",
      feedUrl: "https://example.com/news.xml",
      language: "en",
      name: "Example AI News",
      sampleItemCount: 2,
    });
  });

  it("marks a normalized feed URL already present in the catalog", async () => {
    const rss = "<rss><channel><title>Feed</title><item><title>Story</title><link>https://example.com/story</link></item></channel></rss>";
    const proposal = await discoverSource(
      "https://example.com/feed#fragment",
      new Set(["https://example.com/feed"]),
      { fetchImpl: async () => new Response(rss, { status: 200 }), lookup: publicLookup },
    );
    expect(proposal.alreadyExists).toBe(true);
  });
});
