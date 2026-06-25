import { describe, expect, it } from "vitest";

import { filterReaderItems, normalizeReaderDensity, normalizeReaderViewId } from "./reader-feed-filters";
import type { NewsItemWithState } from "./news";

function item(overrides: Partial<NewsItemWithState> = {}): NewsItemWithState {
  return {
    archivedAt: null,
    category: "Software / IT",
    digestDate: "2026-06-20",
    externalId: "external-1",
    feedback: null,
    id: "item-1",
    importanceScore: 50,
    practicalBucket: null,
    preview: null,
    publishedAt: "2026-06-20T10:00:00.000Z",
    recommendedAction: null,
    readAt: null,
    savedAt: null,
    scoreComponents: {},
    source: "Example",
    sourceUrl: "https://example.com",
    summary: "Summary",
    title: "Title",
    whyInteresting: null,
    ...overrides,
  };
}

describe("reader feed filters", () => {
  it("normalizes unknown view and density values", () => {
    expect(normalizeReaderViewId("saved")).toBe("saved");
    expect(normalizeReaderViewId("unknown")).toBe("all");
    expect(normalizeReaderDensity("compact")).toBe("compact");
    expect(normalizeReaderDensity("wide")).toBe("comfortable");
  });

  it("filters archived items out of normal views and into archived view", () => {
    const archived = item({ archivedAt: "2026-06-20T11:00:00.000Z", id: "archived" });
    const unread = item({ id: "unread" });

    expect(filterReaderItems([archived, unread], "all", "all").map((newsItem) => newsItem.id)).toEqual(["unread"]);
    expect(filterReaderItems([archived, unread], "all", "archived").map((newsItem) => newsItem.id)).toEqual([
      "archived",
    ]);
  });

  it("filters by category feed and reading view together", () => {
    const savedSoftware = item({ id: "saved", savedAt: "2026-06-20T11:00:00.000Z" });
    const readSoftware = item({ id: "read", readAt: "2026-06-20T11:00:00.000Z" });
    const savedSecurity = item({
      category: "Cybersecurity Global",
      id: "security",
      savedAt: "2026-06-20T11:00:00.000Z",
    });

    expect(filterReaderItems([savedSoftware, readSoftware, savedSecurity], "software", "saved").map((newsItem) => newsItem.id)).toEqual([
      "saved",
    ]);
    expect(filterReaderItems([savedSoftware, readSoftware, savedSecurity], "software", "unread").map((newsItem) => newsItem.id)).toEqual([
      "saved",
    ]);
  });
});
