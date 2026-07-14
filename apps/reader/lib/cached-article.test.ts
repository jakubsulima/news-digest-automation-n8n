import { describe, expect, it } from "vitest";

import { selectCachedArticle, type CachedArticleCandidate } from "./cached-article";

function candidate(overrides: Partial<CachedArticleCandidate> = {}): CachedArticleCandidate {
  return {
    canonical_url: "https://example.test/story",
    content_mode: "readable",
    enriched_fetched_at: "2026-07-13T08:00:00.000Z",
    enriched_text: "Cached article body",
    enriched_word_count: 300,
    id: "article-1",
    raw_summary: "Short summary",
    source: "Example",
    ...overrides,
  };
}

describe("cached article selection", () => {
  it("prefers a readable copy of the published source", () => {
    const result = selectCachedArticle(
      [
        candidate({ canonical_url: "https://other.test/story", enriched_word_count: 900, id: "other" }),
        candidate({ id: "published" }),
      ],
      "https://example.test/story",
    );

    expect(result?.articleId).toBe("published");
  });

  it("falls back to the fullest readable source variant", () => {
    const result = selectCachedArticle(
      [
        candidate({ content_mode: "insufficient_text", id: "paywall" }),
        candidate({ canonical_url: "https://other.test/short", enriched_word_count: 250, id: "short" }),
        candidate({ canonical_url: "https://other.test/full", enriched_word_count: 800, id: "full" }),
      ],
      "https://paywall.test/story",
    );

    expect(result?.articleId).toBe("full");
  });

  it("does not expose teasers or login pages as cached articles", () => {
    expect(
      selectCachedArticle(
        [candidate({ content_mode: "insufficient_text", enriched_text: "Subscribe to continue" })],
        "https://example.test/story",
      ),
    ).toBeNull();
  });

  it("uses full text supplied in a public feed before enrichment is rerun", () => {
    const result = selectCachedArticle(
      [
        candidate({
          content_mode: "unknown",
          enriched_text: null,
          enriched_word_count: 0,
          raw_summary: "Public feed reporting with detailed context. ".repeat(50),
        }),
      ],
      "https://example.test/story",
    );

    expect(result?.wordCount).toBeGreaterThan(170);
    expect(result?.text).toContain("Public feed reporting");
  });
});
