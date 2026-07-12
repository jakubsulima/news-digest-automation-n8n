import { describe, expect, it } from "vitest";

import type { NewsItemWithState } from "./news";
import { buildFeedbackProfile } from "./reader-feedback";
import { filterFeedItems, groupReaderItems, priorityLabel, rankReaderItems } from "./reader-feed-ranking";

function item(id: string, overrides: Partial<NewsItemWithState> = {}): NewsItemWithState {
  return {
    archivedAt: null,
    category: "Software / Engineering",
    changedFields: ["new"],
    digestDate: "2026-07-11",
    editorialScore: 60,
    entityTags: [],
    externalId: `story:${id}`,
    feedback: null,
    feedbackReason: null,
    firstSelectedAt: "2026-07-11T08:00:00.000Z",
    id,
    importanceScore: 60,
    lastMaterialChangeAt: "2026-07-11T08:00:00.000Z",
    lastSelectedAt: "2026-07-11T08:00:00.000Z",
    practicalBucket: "product_trend",
    preview: null,
    publishedAt: "2026-07-11T07:00:00.000Z",
    readAt: null,
    recommendedAction: null,
    savedAt: null,
    scoreComponents: {},
    selectionScore: 60,
    source: "Example",
    sourceCount: 1,
    sourceUrl: `https://example.com/${id}`,
    sourceVariants: [],
    storyClusterId: id,
    summary: "A software platform release",
    title: `Story ${id}`,
    topicTags: ["software"],
    updateHistory: [],
    whyInteresting: null,
    ...overrides,
  };
}

describe("reader feed ranking", () => {
  it("supports top, latest, and personalized ordering", () => {
    const items = [
      item("older-top", { category: "Business", editorialScore: 90, lastSelectedAt: "2026-07-10T08:00:00.000Z", source: "Top Source", summary: "Macro markets report", topicTags: ["markets"] }),
      item("newer", { editorialScore: 72, lastSelectedAt: "2026-07-11T09:00:00.000Z", source: "Preferred" }),
    ];
    const profile = buildFeedbackProfile([{ category: "Software", sentiment: "more", source: "Preferred", summary: "software platform", title: "Platform" }]);
    const now = Date.parse("2026-07-11T10:00:00.000Z");

    expect(rankReaderItems(items, profile, "top", null, now)[0].id).toBe("older-top");
    expect(rankReaderItems(items, profile, "latest", null, now)[0].id).toBe("newer");
    expect(rankReaderItems(items, profile, "for-you", null, now)[0].id).toBe("newer");
  });

  it("filters latest, history, and since-visit periods", () => {
    const items = [
      item("old", { digestDate: "2026-07-10", firstSelectedAt: "2026-07-10T08:00:00.000Z", lastMaterialChangeAt: null }),
      item("updated", { digestDate: "2026-07-10", firstSelectedAt: "2026-07-10T08:00:00.000Z", lastMaterialChangeAt: "2026-07-11T09:00:00.000Z" }),
      item("latest"),
    ];
    const common = { feed: "all" as const, latestDigestDate: "2026-07-11", previousVisitAt: "2026-07-11T07:00:00.000Z", view: "all" as const };

    expect(filterFeedItems(items, { ...common, period: "latest" }).map((value) => value.id)).toEqual(["latest"]);
    expect(filterFeedItems(items, { ...common, period: "since-visit" }).map((value) => value.id)).toEqual(["updated", "latest"]);
    expect(filterFeedItems(items, { ...common, period: "history" })).toHaveLength(3);
  });

  it("groups top, actionable, worth-knowing, and remaining stories without duplication", () => {
    const profile = buildFeedbackProfile([]);
    const ranked = rankReaderItems(
      Array.from({ length: 22 }, (_, index) => item(String(index), { editorialScore: 100 - index, practicalBucket: index === 6 ? "security_risk" : "product_trend" })),
      profile,
      "top",
      null,
      Date.parse("2026-07-11T10:00:00.000Z"),
    );
    const grouped = groupReaderItems(ranked);
    const ids = [grouped.top, grouped.actionable, grouped.worthKnowing, grouped.more].flat().map((value) => value.id);

    expect(grouped.top).toHaveLength(5);
    expect(grouped.actionable.map((value) => value.id)).toEqual(["6"]);
    expect(new Set(ids).size).toBe(22);
    expect(priorityLabel(85)).toBe("Critical");
    expect(priorityLabel(54)).toBe("Background");
  });
});
