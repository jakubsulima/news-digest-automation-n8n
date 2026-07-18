import { describe, expect, it } from "vitest";

import type { RunArticle } from "../run-articles";
import { fetchArticleEnrichment } from "./enrichment";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];

function article(canonicalUrl: string): RunArticle {
  return {
    canonical_url: canonicalUrl,
    raw_summary: "",
  } as RunArticle;
}

describe("article enrichment outbound safety", () => {
  it("rejects a redirect to a private article destination", async () => {
    const result = await fetchArticleEnrichment(article("https://example.test/story"), {
      fetchImpl: async () => new Response(null, {
        headers: { location: "http://169.254.169.254/latest/meta-data" },
        status: 302,
      }),
      lookup: publicLookup,
    });

    expect(result).toMatchObject({ status: "fetch_error" });
    expect("error" in result ? result.error : "").toMatch(/private|local|reserved/i);
  });

  it("rejects an article response above the bounded size", async () => {
    const result = await fetchArticleEnrichment(article("https://example.test/large"), {
      fetchImpl: async () => new Response(null, {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        status: 200,
      }),
      lookup: publicLookup,
    });

    expect(result).toMatchObject({ status: "fetch_error" });
    expect("error" in result ? result.error : "").toMatch(/2 MB limit/i);
  });

  it("preserves enrichment for a bounded public article", async () => {
    const result = await fetchArticleEnrichment(article("https://example.test/story"), {
      fetchImpl: async () => new Response(
        '<html><head><meta name="description" content="Useful public article"></head><body>Story</body></html>',
        { status: 200 },
      ),
      lookup: publicLookup,
    });

    expect(result).toMatchObject({
      description: "Useful public article",
      status: "enriched",
    });
  });
});
